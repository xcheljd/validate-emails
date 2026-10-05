//! Run-scoped MX machinery (I5).
//!
//! Upstream `check_email` builds a new DNS resolver and resolves MX for every
//! address, so a list dominated by a few providers resolves the same records
//! thousands of times. It also lets a run open as many simultaneous SMTP
//! sessions to one MX host as it has concurrency slots, which from one IP is
//! a blocklist trigger. A run instead shares one `MxRun`: one resolver, a
//! per-domain MX cache, and a per-MX-host cap on concurrent SMTP sessions.

use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use check_if_email_exists::mx::MxError;
use check_if_email_exists::smtp::{SmtpDetails, SmtpError};
use hickory_resolver::error::ResolveErrorKind;
use hickory_resolver::lookup::MxLookup;
use hickory_resolver::system_conf::read_system_conf;
use hickory_resolver::{Name, TokioAsyncResolver};
use tokio::sync::{OnceCell, OwnedSemaphorePermit, Semaphore};
use tokio_util::sync::CancellationToken;

/// Default cap on concurrent SMTP sessions per MX host per run.
pub const DEFAULT_MX_CONCURRENCY: u32 = 3;
pub const MAX_MX_CONCURRENCY: u32 = 16;

/// Clamp the user's per-MX cap to `1..=MAX_MX_CONCURRENCY` (0 would block
/// every SMTP session forever).
pub fn clamp_mx_concurrency(cap: u32) -> usize {
    cap.clamp(1, MAX_MX_CONCURRENCY) as usize
}

/// How long a failed lookup (DNS error, not "no MX") is reused before the
/// domain is resolved again. Records and "no MX" are kept for the whole run;
/// a failure may be transient, so it only absorbs the burst of addresses
/// queued behind it rather than condemning the domain for the run.
pub const MX_ERROR_TTL: Duration = Duration::from_secs(60);

/// One MX record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MxHost {
    pub preference: u16,
    pub exchange: Name,
}

impl MxHost {
    /// Semaphore key: case-insensitive, trailing dot ignored.
    pub fn key(&self) -> String {
        self.exchange.to_lowercase().to_ascii().trim_end_matches('.').to_string()
    }
}

/// Outcome of one domain's MX lookup, in the three shapes upstream's
/// `check_mx` distinguishes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MxResolution {
    /// Ascending preference; ties keep DNS answer order (stable sort), so
    /// `hosts[0]` is the host upstream's `min_by_key` would pick.
    Records(Vec<MxHost>),
    /// The domain has no MX records (upstream: `Ok` with an `Err` lookup).
    NoRecords,
    /// The lookup itself failed; Display of upstream's `MxError`.
    Failed(String),
}

impl MxResolution {
    pub fn from_hosts(mut hosts: Vec<MxHost>) -> Self {
        if hosts.is_empty() {
            // Upstream would panic on an empty answer; no MX is the truth.
            return Self::NoRecords;
        }
        hosts.sort_by_key(|h| h.preference);
        Self::Records(hosts)
    }

    fn from_lookup(lookup: &MxLookup) -> Self {
        Self::from_hosts(
            lookup
                .iter()
                .map(|mx| MxHost { preference: mx.preference(), exchange: mx.exchange().clone() })
                .collect(),
        )
    }

    /// Number of MX records found; 0 for a failed lookup (B15).
    pub fn record_count(&self) -> u32 {
        match self {
            Self::Records(hosts) => hosts.len() as u32,
            Self::NoRecords | Self::Failed(_) => 0,
        }
    }
}

struct CachedMx {
    resolution: Arc<MxResolution>,
    /// None = valid for the rest of the run.
    expires: Option<tokio::time::Instant>,
}

impl CachedMx {
    fn is_fresh(&self) -> bool {
        self.expires.map_or(true, |at| tokio::time::Instant::now() < at)
    }
}

type DomainSlot = Arc<tokio::sync::Mutex<Option<CachedMx>>>;

/// Per-domain MX cache, populated lazily. Each domain has its own async
/// slot, so the first address for a domain resolves while every other
/// address for it waits and then reuses the answer (one lookup per domain
/// even when 64 tasks hit a cold domain at once), and domains never wait on
/// each other.
#[derive(Default)]
pub struct MxCache {
    domains: Mutex<HashMap<String, DomainSlot>>,
}

impl MxCache {
    /// MX records for `domain`, calling `resolve` only on a miss (or an
    /// expired failure). None if `token` is cancelled first.
    pub async fn get_or_resolve<R, Fut>(
        &self,
        domain: &str,
        resolve: R,
        token: &CancellationToken,
    ) -> Option<Arc<MxResolution>>
    where
        R: FnOnce(String) -> Fut,
        Fut: Future<Output = MxResolution>,
    {
        let slot = {
            // Never held across an await; survives poisoning like B19.
            let mut domains = self.domains.lock().unwrap_or_else(PoisonError::into_inner);
            domains.entry(domain.to_lowercase()).or_default().clone()
        };
        let mut entry = tokio::select! {
            biased;
            _ = token.cancelled() => return None,
            entry = slot.lock() => entry,
        };
        if let Some(cached) = entry.as_ref().filter(|c| c.is_fresh()) {
            return Some(cached.resolution.clone());
        }
        let resolution = tokio::select! {
            biased;
            _ = token.cancelled() => return None,
            resolution = resolve(domain.to_string()) => resolution,
        };
        let expires = matches!(resolution, MxResolution::Failed(_))
            .then(|| tokio::time::Instant::now() + MX_ERROR_TTL);
        let resolution = Arc::new(resolution);
        *entry = Some(CachedMx { resolution: resolution.clone(), expires });
        Some(resolution)
    }
}

/// Caps concurrent SMTP sessions per MX host (across all of the run's
/// proxies: they all hit the same MX).
pub struct MxHostLimiter {
    per_host: usize,
    hosts: Mutex<HashMap<String, Arc<Semaphore>>>,
}

impl MxHostLimiter {
    pub fn new(per_host: usize) -> Self {
        Self { per_host: per_host.max(1), hosts: Mutex::new(HashMap::new()) }
    }

    /// Wait for a session slot on `host`. None if `token` is cancelled while
    /// waiting, so Stop/Pause never leaves a task parked here.
    pub async fn acquire(&self, host: &MxHost, token: &CancellationToken) -> Option<OwnedSemaphorePermit> {
        let semaphore = {
            let mut hosts = self.hosts.lock().unwrap_or_else(PoisonError::into_inner);
            hosts
                .entry(host.key())
                .or_insert_with(|| Arc::new(Semaphore::new(self.per_host)))
                .clone()
        };
        tokio::select! {
            biased;
            _ = token.cancelled() => None,
            permit = semaphore.acquire_owned() => permit.ok(),
        }
    }
}

/// MX state shared by every email of one run.
pub struct MxRun {
    cache: MxCache,
    hosts: MxHostLimiter,
    token: CancellationToken,
    /// Built on first use and reused for the rest of the run (cloning a
    /// hickory resolver shares its connection pool and cache; borrowing it
    /// is enough here).
    resolver: OnceCell<TokioAsyncResolver>,
}

impl MxRun {
    pub fn new(mx_concurrency: u32, token: CancellationToken) -> Self {
        Self {
            cache: MxCache::default(),
            hosts: MxHostLimiter::new(clamp_mx_concurrency(mx_concurrency)),
            token,
            resolver: OnceCell::new(),
        }
    }

    /// The domain's MX records via the run cache. None if cancelled.
    pub async fn resolve<R, Fut>(&self, domain: &str, resolve: R) -> Option<Arc<MxResolution>>
    where
        R: FnOnce(String) -> Fut,
        Fut: Future<Output = MxResolution>,
    {
        self.cache.get_or_resolve(domain, resolve, &self.token).await
    }

    /// Run the SMTP step against the primary (lowest-preference) MX, holding
    /// one of that host's session slots for its duration. `hosts` must be
    /// non-empty. None if the run is cancelled while waiting or mid-session.
    pub async fn smtp<A, Fut>(&self, hosts: &[MxHost], attempt: A) -> Option<Result<SmtpDetails, SmtpError>>
    where
        A: Fn(&MxHost) -> Fut,
        Fut: Future<Output = Result<SmtpDetails, SmtpError>>,
    {
        let host = hosts.first()?;
        let _permit = self.hosts.acquire(host, &self.token).await?;
        tokio::select! {
            biased;
            _ = self.token.cancelled() => None,
            result = attempt(host) => Some(result),
        }
    }

    /// Production lookup through the run's shared system resolver, mapped
    /// exactly like upstream `check_mx`: "no records" is `NoRecords`, every
    /// other resolver error is `Failed`.
    pub async fn system_lookup(&self, domain: String) -> MxResolution {
        // get_or_try_init: a failed resolver build is retried next lookup.
        let resolver = self
            .resolver
            .get_or_try_init(|| async {
                read_system_conf().map(|(config, opts)| TokioAsyncResolver::tokio(config, opts))
            })
            .await;
        let resolver = match resolver {
            Ok(resolver) => resolver,
            Err(e) => return MxResolution::Failed(MxError::from(e).to_string()),
        };
        match resolver.mx_lookup(domain.as_str()).await {
            Ok(lookup) => MxResolution::from_lookup(&lookup),
            Err(err) => match err.kind() {
                ResolveErrorKind::NoRecordsFound { .. } => MxResolution::NoRecords,
                _ => MxResolution::Failed(MxError::from(err).to_string()),
            },
        }
    }
}

#[cfg(test)]
pub fn test_host(preference: u16, exchange: &str) -> MxHost {
    MxHost { preference, exchange: Name::from_ascii(exchange).unwrap() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn test_from_hosts_orders_by_preference_stably() {
        let res = MxResolution::from_hosts(vec![
            test_host(20, "b.example.com."),
            test_host(10, "a1.example.com."),
            test_host(10, "a2.example.com."),
        ]);
        let MxResolution::Records(hosts) = res else { panic!("expected records") };
        let names: Vec<String> = hosts.iter().map(|h| h.exchange.to_string()).collect();
        assert_eq!(names, ["a1.example.com.", "a2.example.com.", "b.example.com."]);
        assert_eq!(MxResolution::from_hosts(vec![]), MxResolution::NoRecords);
    }

    #[test]
    fn test_host_key_normalizes_case_and_dot() {
        assert_eq!(test_host(0, "MX1.Example.COM.").key(), "mx1.example.com");
        assert_eq!(test_host(0, "mx1.example.com").key(), "mx1.example.com");
    }

    #[test]
    fn test_clamp_mx_concurrency() {
        assert_eq!(clamp_mx_concurrency(0), 1);
        assert_eq!(clamp_mx_concurrency(3), 3);
        assert_eq!(clamp_mx_concurrency(100), 16);
    }

    // A transient DNS failure is reused only for MX_ERROR_TTL; records and
    // "no MX" are kept for the run.
    #[tokio::test(start_paused = true)]
    async fn test_failed_lookup_expires_records_do_not() {
        let cache = MxCache::default();
        let token = CancellationToken::new();
        let calls = AtomicUsize::new(0);
        let failing = |_: String| {
            calls.fetch_add(1, Ordering::SeqCst);
            async { MxResolution::Failed("Resolve error: timeout".into()) }
        };
        cache.get_or_resolve("dead.test", failing, &token).await.unwrap();
        cache.get_or_resolve("dead.test", failing, &token).await.unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 1, "failure reused within TTL");
        tokio::time::advance(MX_ERROR_TTL + Duration::from_secs(1)).await;
        cache.get_or_resolve("dead.test", failing, &token).await.unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 2, "failure re-resolved after TTL");

        let ok_calls = AtomicUsize::new(0);
        let ok = |_: String| {
            ok_calls.fetch_add(1, Ordering::SeqCst);
            async { MxResolution::from_hosts(vec![test_host(10, "mx.ok.test.")]) }
        };
        cache.get_or_resolve("OK.test", ok, &token).await.unwrap();
        tokio::time::advance(Duration::from_secs(3600)).await;
        cache.get_or_resolve("ok.test", ok, &token).await.unwrap();
        assert_eq!(ok_calls.load(Ordering::SeqCst), 1, "records kept for the run, case-insensitive");
    }

    // Stop/Pause must not leave a task parked on a full MX slot.
    #[tokio::test]
    async fn test_host_limiter_wait_is_cancellable() {
        let limiter = MxHostLimiter::new(1);
        let token = CancellationToken::new();
        let host = test_host(10, "mx.test.");
        let _held = limiter.acquire(&host, &token).await.unwrap();
        let same_host = test_host(20, "MX.test");
        let waiter = limiter.acquire(&same_host, &token);
        token.cancel();
        assert!(waiter.await.is_none());
    }

    #[tokio::test]
    async fn test_cache_cancelled_returns_none() {
        let cache = MxCache::default();
        let token = CancellationToken::new();
        token.cancel();
        let got = cache
            .get_or_resolve("x.test", |_| async { MxResolution::NoRecords }, &token)
            .await;
        assert!(got.is_none());
    }
}

use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;
use std::future::Future;
use std::sync::Mutex;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering};
use tokio::sync::RwLock;
use tokio::time::sleep;
use chrono::Utc;
use std::time::{Instant, Duration};
use std::collections::HashMap;
use check_if_email_exists::{check_email, CheckEmailInputBuilder, CheckEmailInputProxy, Reachable};
use check_if_email_exists::syntax::check_syntax;
use check_if_email_exists::mx::check_mx;
use check_if_email_exists::misc::check_misc;
use check_if_email_exists::smtp::{SmtpDetails, SmtpError, SmtpErrorDesc};
use check_if_email_exists::smtp::verif_method::{
    VerifMethod,
    VerifMethodSmtpConfig,
    GmailVerifMethod,
    YahooVerifMethod,
    HotmailB2CVerifMethod,
    HotmailB2BVerifMethod,
    MimecastVerifMethod,
    ProofpointVerifMethod,
    EverythingElseVerifMethod,
};
use crate::settings::{ProxyConfig, RateLimiterConfig};
use crate::settings::proxy_pool::{unix_now, AllProxiesFailedState};
use crate::settings::settings_core::Settings;
#[cfg(test)]
use crate::settings::{ProxyPool, RotationMode};

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ProxyOutcome {
    /// The proxy carried a complete SMTP conversation for this email,
    /// regardless of the mailbox verdict (even "Invalid" proves the proxy
    /// round-tripped).
    Success,
    /// The proxy itself was at fault: the SOCKS5 hop failed, or the
    /// destination rejected the proxy's IP (blacklisted / needs rDNS).
    /// See `classify_smtp_error`.
    Failure,
    /// The proxy was not actually exercised for this email (quick mode,
    /// invalid syntax, no MX records, builder error), or the failure is as
    /// likely the destination's fault (timeout, I/O error, other SMTP error).
    Neutral,
}

impl Default for ProxyOutcome {
    fn default() -> Self {
        ProxyOutcome::Neutral
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ValidationResult {
    pub email: String,
    pub result: String,
    pub reason: String,
    pub logs: Vec<String>,
    pub domain: String,
    pub validation_duration: u64,
    pub mx_record_count: u32,
    pub is_disposable: bool,
    pub is_role_account: bool,
    pub is_catch_all: bool,
    pub is_deliverable: bool,
    pub is_disabled: bool,
    pub has_full_inbox: bool,
    pub can_connect_smtp: bool,
    pub is_valid_syntax: bool,
    pub is_b2c: bool,
    pub suggestion: Option<String>,
    pub gravatar_url: Option<String>,
    pub haveibeenpwned: Option<bool>,
    pub error_type: Option<String>,
    pub timestamp: String,
    pub validation_mode: String,
    pub risk_score: u32,
    /// The proxy ID used for this validation (if any)
    pub proxy_id: Option<String>,
    /// How the proxy fared for this email, for proxy-health accounting.
    /// Only meaningful when `proxy_id` is set. Defaults to Neutral so that
    /// older session files (without this field) deserialize cleanly.
    #[serde(default)]
    pub proxy_outcome: ProxyOutcome,
}

impl ValidationResult {
    /// Create a builder pre-populated with sensible defaults for all fields.
    /// Only fields that differ need to be overridden.
    fn builder(
        email: &str,
        domain: &str,
        result: &str,
        reason: &str,
        validation_mode: &str,
        validation_duration: u64,
        proxy_id: Option<String>,
    ) -> ValidationResult {
        ValidationResult {
            email: email.to_string(),
            result: result.to_string(),
            reason: reason.to_string(),
            logs: vec![],
            domain: domain.to_string(),
            validation_duration,
            mx_record_count: 0,
            is_disposable: false,
            is_role_account: false,
            is_catch_all: false,
            is_deliverable: false,
            is_disabled: false,
            has_full_inbox: false,
            can_connect_smtp: false,
            is_valid_syntax: false,
            is_b2c: false,
            suggestion: None,
            gravatar_url: None,
            haveibeenpwned: None,
            error_type: None,
            timestamp: Utc::now().to_rfc3339(),
            validation_mode: validation_mode.to_string(),
            risk_score: 0,
            proxy_id,
            proxy_outcome: ProxyOutcome::Neutral,
        }
    }

    fn with_mx_record_count(mut self, count: u32) -> Self {
        self.mx_record_count = count;
        self
    }
    fn with_disposable(mut self, val: bool) -> Self {
        self.is_disposable = val;
        self
    }
    fn with_role_account(mut self, val: bool) -> Self {
        self.is_role_account = val;
        self
    }
    fn with_catch_all(mut self, val: bool) -> Self {
        self.is_catch_all = val;
        self
    }
    fn with_deliverable(mut self, val: bool) -> Self {
        self.is_deliverable = val;
        self
    }
    fn with_disabled(mut self, val: bool) -> Self {
        self.is_disabled = val;
        self
    }
    fn with_full_inbox(mut self, val: bool) -> Self {
        self.has_full_inbox = val;
        self
    }
    fn with_can_connect_smtp(mut self, val: bool) -> Self {
        self.can_connect_smtp = val;
        self
    }
    fn with_valid_syntax(mut self, val: bool) -> Self {
        self.is_valid_syntax = val;
        self
    }
    fn with_b2c(mut self, val: bool) -> Self {
        self.is_b2c = val;
        self
    }
    fn with_suggestion(mut self, val: Option<String>) -> Self {
        self.suggestion = val;
        self
    }
    fn with_gravatar_url(mut self, val: Option<String>) -> Self {
        self.gravatar_url = val;
        self
    }
    fn with_haveibeenpwned(mut self, val: Option<bool>) -> Self {
        self.haveibeenpwned = val;
        self
    }
    fn with_error_type(mut self, val: &str) -> Self {
        self.error_type = Some(val.to_string());
        self
    }
    fn with_risk_score(mut self, val: u32) -> Self {
        self.risk_score = val;
        self
    }
    fn with_proxy_outcome(mut self, val: ProxyOutcome) -> Self {
        self.proxy_outcome = val;
        self
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RevalidationRequest {
    pub email: String,
}

pub struct ValidationState {
    pub token: Mutex<CancellationToken>,
    /// Monotonic id of the current run; stamped on run events so the
    /// frontend can drop events from a superseded run.
    run_counter: AtomicU64,
}

impl Default for ValidationState {
    fn default() -> Self {
        Self {
            token: Mutex::new(CancellationToken::new()),
            run_counter: AtomicU64::new(0),
        }
    }
}

impl ValidationState {
    pub fn cancel(&self) {
        let token = self.token.lock().unwrap();
        token.cancel();
    }

    /// Begin a new validation run. Cancels the previous run's token and
    /// returns a fresh, uncancelled token for this run.
    ///
    /// Cancelling the prior token means a new run can never leave an
    /// orphaned, unstoppable run behind (B6) — the "current" token is always
    /// the one `cancel()`/Stop acts on. Returning a *fresh* token means every
    /// run starts clean: a command that instead reused `get_token()` after a
    /// Stop/Pause would inherit an already-cancelled token and silently do
    /// nothing (B5 — this is what made "Retry unknowns" return [] after a
    /// Stop). Both run-starting commands must call this and use the returned
    /// token.
    pub fn begin_run(&self) -> CancellationToken {
        self.begin_run_with_id().1
    }

    /// `begin_run`, also returning the new run's id.
    pub fn begin_run_with_id(&self) -> (u64, CancellationToken) {
        let mut token = self.token.lock().unwrap();
        token.cancel();
        *token = CancellationToken::new();
        let run_id = self.run_counter.fetch_add(1, Ordering::SeqCst) + 1;
        (run_id, token.clone())
    }

    #[cfg(test)]
    pub fn get_token(&self) -> CancellationToken {
        self.token.lock().unwrap().clone()
    }
}

pub async fn validate_email(email: String, mode: String, proxy: Option<ProxyConfig>) -> ValidationResult {
    match mode.as_str() {
        "quick" => validate_email_quick(email, mode, proxy).await,
        "thorough" => validate_email_full(email, mode, proxy, Duration::from_secs(30), 2).await,
        _ => validate_email_full(email, mode, proxy, Duration::from_secs(10), 1).await,
    }
}

/// Quick mode: syntax check + MX lookup + misc only (skip SMTP handshake).
/// ~10x faster than full verification.
async fn validate_email_quick(email: String, mode: String, proxy: Option<ProxyConfig>) -> ValidationResult {
    let start_time = Instant::now();
    // Quick mode never performs an SMTP conversation, so the (rotated) proxy
    // is not actually exercised here. Do NOT attribute a proxy_id: doing so
    // both mislabels the result as "via proxy X" and — before the B3 fix —
    // fed quick-mode Unknowns into the proxy failure stats (B4).
    let _ = proxy;
    let proxy_id: Option<String> = None;

    // Step 1: Syntax check
    let syntax = check_syntax(&email);
    let domain = syntax.domain.clone();
    let is_valid_syntax = syntax.is_valid_syntax;
    let suggestion = syntax.suggestion.clone();

    if !is_valid_syntax {
        return ValidationResult::builder(
            &email,
            &domain,
            "Invalid",
            "Quick mode: Invalid syntax",
            &mode,
            start_time.elapsed().as_millis() as u64,
            proxy_id,
        )
        .with_suggestion(suggestion)
        .with_risk_score(100);
    }

    // Step 2: MX lookup
    let mx_result = check_mx(&syntax).await;
    let mx_record_count = match &mx_result {
        Ok(mx) => match &mx.lookup {
            Ok(lookup) => lookup.iter().count() as u32,
            Err(_) => 0,
        },
        Err(_) => 0,
    };

    // If MX lookup failed entirely, return Unknown
    let mx_failed = mx_result.is_err();
    if mx_failed {
        return ValidationResult::builder(
            &email,
            &domain,
            "Unknown",
            "Quick mode: MX lookup failed",
            &mode,
            start_time.elapsed().as_millis() as u64,
            proxy_id,
        )
        .with_valid_syntax(is_valid_syntax)
        .with_suggestion(suggestion)
        .with_error_type("MxLookupError")
        .with_risk_score(50);
    }

    // If no MX records found, email is Invalid
    let mx_ok = mx_result.as_ref().unwrap();
    if mx_ok.lookup.is_err() {
        return ValidationResult::builder(
            &email,
            &domain,
            "Invalid",
            "Quick mode: No MX records found",
            &mode,
            start_time.elapsed().as_millis() as u64,
            proxy_id,
        )
        .with_valid_syntax(is_valid_syntax)
        .with_suggestion(suggestion)
        .with_risk_score(100);
    }

    // Step 3: Misc checks (disposable, role account, b2c)
    let misc = check_misc(&syntax, false, None).await;

    // Determine result: since no SMTP, we classify based on what we know
    let result_str = if misc.is_disposable {
        "Risky"
    } else {
        // Has valid syntax + MX records -> likely reachable
        "Unknown" // Can't confirm Safe without SMTP
    };

    let risk_score = calculate_risk_score(result_str, misc.is_disposable, false, false, false);

    ValidationResult::builder(
        &email,
        &domain,
        result_str,
        "Quick mode: syntax + MX + misc (SMTP skipped)",
        &mode,
        start_time.elapsed().as_millis() as u64,
        proxy_id,
    )
    .with_mx_record_count(mx_record_count)
    .with_disposable(misc.is_disposable)
    .with_role_account(misc.is_role_account)
    .with_valid_syntax(is_valid_syntax)
    .with_b2c(misc.is_b2c)
    .with_suggestion(suggestion)
    .with_gravatar_url(misc.gravatar_url)
    .with_haveibeenpwned(misc.haveibeenpwned)
    .with_risk_score(risk_score)
}

/// Build a `VerifMethod` with the same SMTP config (proxy, port, timeout,
/// retries) applied to ALL seven provider fields.
///
/// Historically only gmail/yahoo/hotmailb2c received this config and the
/// rest fell through to `Default` (no proxy, no timeout, 1 retry), which
/// meant most domains validated over a direct connection. This helper is
/// the single source of truth so that can't regress — see
/// `test_verif_method_applies_config_to_all_providers`.
fn build_verif_method(
    proxies: HashMap<String, CheckEmailInputProxy>,
    proxy_ref: Option<String>,
    smtp_timeout: Duration,
    retries: usize,
) -> VerifMethod {
    let smtp_config = VerifMethodSmtpConfig {
        from_email: "verify@example.com".to_string(),
        hello_name: "example.com".to_string(),
        proxy: proxy_ref,
        smtp_port: 25,
        smtp_timeout: Some(smtp_timeout),
        retries,
    };

    VerifMethod {
        proxies,
        gmail: GmailVerifMethod::Smtp(smtp_config.clone()),
        hotmailb2b: HotmailB2BVerifMethod::Smtp(smtp_config.clone()),
        hotmailb2c: HotmailB2CVerifMethod::Smtp(smtp_config.clone()),
        mimecast: MimecastVerifMethod::Smtp(smtp_config.clone()),
        proofpoint: ProofpointVerifMethod::Smtp(smtp_config.clone()),
        yahoo: YahooVerifMethod::Smtp(smtp_config.clone()),
        everything_else: EverythingElseVerifMethod::Smtp(smtp_config),
    }
}

/// Full SMTP verification (Standard and Thorough modes).
/// Standard: default timeout (~10s), 1 retry.
/// Thorough: higher timeout (30s), 2 retries.
async fn validate_email_full(
    email: String,
    mode: String,
    proxy: Option<ProxyConfig>,
    smtp_timeout: Duration,
    retries: usize,
) -> ValidationResult {
    let start_time = Instant::now();

    // Track proxy ID for stats
    let proxy_id = proxy.as_ref().map(|p| p.id());

    // Build VerifMethod with optional proxy
    let (proxies, proxy_ref) = if let Some(ref p) = proxy {
        let mut proxy_map = HashMap::new();
        let proxy_name = "proxy1".to_string();
        proxy_map.insert(proxy_name.clone(), p.to_check_email_proxy());
        (proxy_map, Some(proxy_name))
    } else {
        (HashMap::new(), None)
    };

    let verif_method =
        build_verif_method(proxies, proxy_ref, smtp_timeout, retries);

    let mut builder = CheckEmailInputBuilder::default();
    builder.to_email(email.clone()).verif_method(verif_method).check_gravatar(true);

    let input = builder.build();

    let output = match input {
        Ok(input) => check_email(&input).await,
        Err(e) => {
            return ValidationResult::builder(
                &email,
                email.split('@').next_back().unwrap_or(""),
                "Unknown",
                &format!("Builder Error: {:?}", e),
                &mode,
                start_time.elapsed().as_millis() as u64,
                proxy_id,
            )
            .with_error_type("BuilderError")
            .with_risk_score(50);
        }
    };

    let result_str = match output.is_reachable {
        Reachable::Safe => "Safe",
        Reachable::Invalid => "Invalid",
        Reachable::Risky => "Risky",
        Reachable::Unknown => "Unknown",
    };

    let reason = format!(
        "Reachability: {:?}, Misc: {:?}, MX: {:?}, SMTP: {:?}",
        output.is_reachable,
        output.misc,
        output.mx,
        output.smtp
    );

    let domain = output.syntax.domain;
    let is_valid_syntax = output.syntax.is_valid_syntax;
    let suggestion = output.syntax.suggestion;

    let mx_record_count = match &output.mx {
        Ok(mx) => match &mx.lookup {
            Ok(lookup) => lookup.iter().count() as u32,
            Err(_) => 0,
        },
        Err(_) => 1,
    };

    let (is_disposable, is_role_account, is_b2c, gravatar_url, haveibeenpwned) = match &output.misc {
        Ok(misc) => (
            misc.is_disposable,
            misc.is_role_account,
            misc.is_b2c,
            misc.gravatar_url.clone(),
            misc.haveibeenpwned,
        ),
        Err(_) => (false, false, false, None, None),
    };

    let (is_catch_all, is_deliverable, is_disabled, has_full_inbox, can_connect_smtp) = match &output.smtp {
        Ok(smtp) => (
            smtp.is_catch_all,
            smtp.is_deliverable,
            smtp.is_disabled,
            smtp.has_full_inbox,
            smtp.can_connect_smtp,
        ),
        Err(_) => (false, false, false, false, false),
    };

    // Classify how the proxy fared for THIS email, based on transport outcome
    // rather than the mailbox verdict (B3). Previously any result other than
    // Safe/Risky — including Invalid (no such mailbox), Unknown and builder
    // errors — was counted as a proxy failure, so a healthy proxy died after
    // a handful of invalid addresses. A definitive RCPT verdict (even
    // "Invalid") means the proxy carried a full SMTP conversation = success.
    let proxy_outcome = proxy_outcome_for(proxy_id.is_some(), &output.smtp);

    let risk_score = calculate_risk_score(result_str, is_disposable, is_catch_all, is_disabled, has_full_inbox);

    ValidationResult::builder(
        &email,
        &domain,
        result_str,
        &reason,
        &mode,
        start_time.elapsed().as_millis() as u64,
        proxy_id,
    )
    .with_mx_record_count(mx_record_count)
    .with_disposable(is_disposable)
    .with_role_account(is_role_account)
    .with_catch_all(is_catch_all)
    .with_deliverable(is_deliverable)
    .with_disabled(is_disabled)
    .with_full_inbox(has_full_inbox)
    .with_can_connect_smtp(can_connect_smtp)
    .with_valid_syntax(is_valid_syntax)
    .with_b2c(is_b2c)
    .with_suggestion(suggestion)
    .with_gravatar_url(gravatar_url)
    .with_haveibeenpwned(haveibeenpwned)
    .with_risk_score(risk_score)
    .with_proxy_outcome(proxy_outcome)
}

/// Map the SMTP step's result to a proxy-health outcome.
fn proxy_outcome_for(
    proxy_used: bool,
    smtp: &Result<SmtpDetails, SmtpError>,
) -> ProxyOutcome {
    if !proxy_used {
        return ProxyOutcome::Neutral;
    }
    match smtp {
        Err(e) => classify_smtp_error(e),
        // SMTP completed: a real round trip happened through the proxy.
        Ok(details) if details.can_connect_smtp => ProxyOutcome::Success,
        // Ok but can_connect_smtp==false is the default output for the
        // early-return paths (invalid syntax, no MX) — the proxy was not
        // actually exercised, so it's neutral (no success, no failure).
        Ok(_) => ProxyOutcome::Neutral,
    }
}

/// Decide whether an SMTP error is the PROXY's fault.
///
/// Only two things are: the SOCKS5 hop itself failing, and the destination
/// rejecting the proxy's egress IP on reputation grounds (blacklisted /
/// missing rDNS). Everything else — timeouts, I/O errors, other SMTP
/// rejections — is just as likely a dead, tarpitting or greylisting MX, and
/// counting those against the proxy would drain a healthy pool on a list
/// with a few dead domains. Those are Neutral.
pub(crate) fn classify_smtp_error(err: &SmtpError) -> ProxyOutcome {
    match err {
        SmtpError::Socks5(_) => ProxyOutcome::Failure,
        SmtpError::AsyncSmtpError(_) => match err.get_description() {
            Some(SmtpErrorDesc::IpBlacklisted) | Some(SmtpErrorDesc::NeedsRDNS) => {
                ProxyOutcome::Failure
            }
            None => ProxyOutcome::Neutral,
        },
        _ => ProxyOutcome::Neutral,
    }
}

fn calculate_risk_score(result: &str, is_disposable: bool, is_catch_all: bool, is_disabled: bool, has_full_inbox: bool) -> u32 {
    let mut score = match result {
        "Safe" => 1,
        "Risky" => 30,
        "Invalid" => 100,
        "Unknown" => 50,
        _ => 50,
    };
    if is_disposable { score += 40; }
    if is_catch_all { score += 20; }
    if is_disabled { score = 100; }
    if has_full_inbox { score += 30; }
    if score > 100 { score = 100; }
    score
}

/// Unix-seconds clock used for cooldown decisions. Injectable so tests can
/// drive cooldown expiry without sleeping.
pub type Clock = Arc<dyn Fn() -> i64 + Send + Sync>;

pub fn system_clock() -> Clock {
    Arc::new(unix_now)
}

/// One dispatch through a proxy: which proxy, and the cooldown epoch it was
/// in when it was selected.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DispatchTag {
    pub proxy_id: String,
    pub epoch: u64,
}

/// What `ProxyRotationState::record` did with a result.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordOutcome {
    Recorded,
    /// Neutral outcome, or the result is not attributed to the tagged proxy.
    Skipped,
    /// Dispatched before the proxy's current cooldown began; ignored.
    Stale,
    /// The proxy was deleted from the pool mid-run; ignored.
    Removed,
}

/// Live proxy selection and health accounting for one run (B7).
///
/// Holds the SAME `Arc<RwLock<Settings>>` as `SettingsState` (the pool is a
/// field of Settings), so a cooldown or auto-disable caused by one email
/// steers the very next selection, and pool edits made mid-run (disable,
/// delete) take effect immediately. The lock is only held for the duration
/// of one select/record — never across a validation or a sleep.
pub struct ProxyRotationState {
    pub settings: Arc<RwLock<Settings>>,
    pub rotation_index: AtomicUsize,
    clock: Clock,
}

impl ProxyRotationState {
    pub fn new(settings: Arc<RwLock<Settings>>, clock: Clock) -> Self {
        Self {
            settings,
            rotation_index: AtomicUsize::new(0),
            clock,
        }
    }

    #[cfg(test)]
    pub fn from_pool(pool: ProxyPool) -> Self {
        let settings = Settings {
            proxy_pool: pool,
            ..Settings::default()
        };
        Self::new(Arc::new(RwLock::new(settings)), system_clock())
    }

    fn now(&self) -> i64 {
        (self.clock)()
    }

    /// Select a proxy for `email` from the live pool and tag the dispatch
    /// with that proxy's current cooldown epoch. None if the pool is
    /// disabled, empty, or has nothing available.
    pub async fn select(&self, email: &str) -> Option<(ProxyConfig, DispatchTag)> {
        let now = self.now();
        let settings = self.settings.read().await;
        let pool = &settings.proxy_pool;
        if !pool.enabled || pool.proxies.is_empty() {
            return None;
        }
        // Each selection claims its own counter slot, so concurrent tasks
        // round-robin without holding a lock.
        let mut index = self.rotation_index.fetch_add(1, Ordering::Relaxed);
        let proxy = pool.get_proxy_for_email_at(email, &mut index, now)?;
        let proxy_id = proxy.id();
        let epoch = pool.cooldown_epoch(&proxy_id);
        Some((proxy, DispatchTag { proxy_id, epoch }))
    }

    /// Get the proxy to use for a specific email
    /// Returns None if proxy is disabled or no proxies available
    #[cfg(test)]
    pub async fn get_proxy_for_email(&self, email: &str) -> Option<ProxyConfig> {
        self.select(email).await.map(|(proxy, _)| proxy)
    }

    /// Apply one completed email's proxy outcome to the live pool.
    pub async fn record(&self, tag: &DispatchTag, result: &ValidationResult) -> RecordOutcome {
        if result.proxy_id.as_deref() != Some(tag.proxy_id.as_str())
            || result.proxy_outcome == ProxyOutcome::Neutral
        {
            return RecordOutcome::Skipped;
        }
        let now = self.now();
        let mut settings = self.settings.write().await;
        let pool = &mut settings.proxy_pool;
        // get_stats_mut() would create orphan stats for a deleted proxy.
        if !pool.contains_proxy(&tag.proxy_id) {
            return RecordOutcome::Removed;
        }
        if tag.epoch < pool.cooldown_epoch(&tag.proxy_id) {
            return RecordOutcome::Stale;
        }
        match result.proxy_outcome {
            ProxyOutcome::Success => pool
                .record_success_with_duration(&tag.proxy_id, result.validation_duration as f64),
            ProxyOutcome::Failure => pool.record_failure_at(&tag.proxy_id, now),
            ProxyOutcome::Neutral => {}
        }
        RecordOutcome::Recorded
    }

    async fn drain_snapshot(&self) -> DrainSnapshot {
        let now = self.now();
        let settings = self.settings.read().await;
        let pool = &settings.proxy_pool;
        let state = pool.unavailable_state_at(now);
        // Waiting only helps if every proxy will come back on its own.
        let can_wait = pool.enabled
            && !state.failed_proxies.is_empty()
            && state
                .failed_proxies
                .iter()
                .all(|p| !p.auto_disabled && p.remaining_cooldown_secs > 0);
        DrainSnapshot { state, can_wait }
    }
}

struct DrainSnapshot {
    state: AllProxiesFailedState,
    can_wait: bool,
}

impl DrainSnapshot {
    fn no_pool() -> Self {
        Self {
            state: AllProxiesFailedState {
                failed_proxies: vec![],
                proxy_enabled: false,
                total_proxies: 0,
                bad_count: 0,
                cooldown_count: 0,
                nearest_cooldown_secs: 0,
            },
            can_wait: false,
        }
    }
}

/// Which proxies a run may use. Snapshotted at run start.
pub struct ProxyPolicy {
    pub state: Option<Arc<ProxyRotationState>>,
    /// `!session_bypass && pool.enabled` at run start. When set, an email
    /// is NEVER sent direct: if no proxy can be selected the run waits for a
    /// cooldown or pauses itself (B8). Only a bypass/disabled-at-start run
    /// may fall back to a direct connection.
    pub require_proxy: bool,
}

impl ProxyPolicy {
    #[cfg(test)]
    pub fn direct() -> Self {
        Self { state: None, require_proxy: false }
    }
}

/// Events a run reports while it executes.
#[derive(Debug, Clone)]
pub enum RunEvent {
    Progress(ValidationResult),
    /// Every proxy is in cooldown; the run is waiting in place for the
    /// nearest expiry.
    WaitingForProxy {
        proxy_ids: Vec<String>,
        nearest_cooldown_secs: u64,
    },
    /// The run can't dispatch through any proxy and has paused itself.
    AllProxiesFailed(AllProxiesFailedState),
}

pub const STOP_PAUSED_NO_PROXY: &str = "paused_no_proxy";
pub const STOP_CANCELLED: &str = "cancelled";

/// Result of a run. `stop_reason` is None only when every input was
/// validated; otherwise `results` is a partial subset of the inputs.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunOutcome {
    pub results: Vec<ValidationResult>,
    pub stop_reason: Option<String>,
}

/// How many times a run waits out a full-pool cooldown without a proxy
/// success in between before pausing for the user.
const MAX_PROXY_WAIT_CYCLES: u32 = 3;

/// Per-run drain bookkeeping shared by all of the run's email tasks.
#[derive(Default)]
struct DrainCoordinator {
    /// Serializes drain handling so 64 tasks that all see an empty pool
    /// produce one wait (or one pause), not 64.
    gate: tokio::sync::Mutex<()>,
    wait_cycles: AtomicU32,
    /// Set exactly once, by the task that pauses the run.
    paused: AtomicBool,
}

struct RunCtx<'a, V, S> {
    token: &'a CancellationToken,
    policy: &'a ProxyPolicy,
    validator: &'a V,
    sink: &'a S,
    drain: &'a DrainCoordinator,
}

async fn select_for<V, S>(email: &str, ctx: &RunCtx<'_, V, S>) -> Option<(ProxyConfig, DispatchTag)> {
    match &ctx.policy.state {
        Some(state) => state.select(email).await,
        None => None,
    }
}

/// Pick the connection for one email at dispatch time. Returns None if the
/// email must not be dispatched (run cancelled or paused for lack of proxy).
async fn acquire_dispatch<V, S>(
    email: &str,
    ctx: &RunCtx<'_, V, S>,
) -> Option<(Option<ProxyConfig>, Option<DispatchTag>)>
where
    S: Fn(RunEvent),
{
    loop {
        if let Some((proxy, tag)) = select_for(email, ctx).await {
            return Some((Some(proxy), Some(tag)));
        }
        if !ctx.policy.require_proxy {
            return Some((None, None));
        }

        // Fail closed: the pool is drained (or was disabled/emptied mid-run).
        let _gate = tokio::select! {
            biased;
            _ = ctx.token.cancelled() => return None,
            gate = ctx.drain.gate.lock() => gate,
        };
        if ctx.token.is_cancelled() {
            return None;
        }
        // Another task may have waited out the cooldown while we queued.
        if let Some((proxy, tag)) = select_for(email, ctx).await {
            return Some((Some(proxy), Some(tag)));
        }

        let snapshot = match &ctx.policy.state {
            Some(state) => state.drain_snapshot().await,
            None => DrainSnapshot::no_pool(),
        };
        if snapshot.can_wait
            && ctx.drain.wait_cycles.load(Ordering::SeqCst) < MAX_PROXY_WAIT_CYCLES
        {
            ctx.drain.wait_cycles.fetch_add(1, Ordering::SeqCst);
            let nearest = snapshot.state.nearest_cooldown_secs.max(1);
            (ctx.sink)(RunEvent::WaitingForProxy {
                proxy_ids: snapshot.state.failed_proxies.iter().map(|p| p.id.clone()).collect(),
                nearest_cooldown_secs: nearest,
            });
            tokio::select! {
                biased;
                _ = ctx.token.cancelled() => return None,
                _ = sleep(Duration::from_secs(nearest)) => {}
            }
            continue;
        }

        if !ctx.drain.paused.swap(true, Ordering::SeqCst) {
            (ctx.sink)(RunEvent::AllProxiesFailed(snapshot.state));
            // Cancel THIS run's token only. ValidationState::cancel() would
            // act on whatever run is current, which may not be us.
            ctx.token.cancel();
        }
        return None;
    }
}

async fn process_email<V, Fut, S>(email: String, ctx: &RunCtx<'_, V, S>) -> Option<ValidationResult>
where
    V: Fn(String, Option<ProxyConfig>) -> Fut,
    Fut: Future<Output = ValidationResult>,
    S: Fn(RunEvent),
{
    if ctx.token.is_cancelled() {
        return None;
    }
    let (proxy, tag) = acquire_dispatch(&email, ctx).await?;
    let result = (ctx.validator)(email, proxy).await;
    if let (Some(state), Some(tag)) = (&ctx.policy.state, &tag) {
        if state.record(tag, &result).await == RecordOutcome::Recorded
            && result.proxy_outcome == ProxyOutcome::Success
        {
            // A proxy proved itself again: reset the wait budget.
            ctx.drain.wait_cycles.store(0, Ordering::SeqCst);
        }
    }
    Some(result)
}

/// Calculate the minimum interval between dispatches based on rate limiter config.
/// Returns the minimum Duration between consecutive email validations.
pub fn calculate_rate_interval(config: &RateLimiterConfig) -> Duration {
    if config.max_per_second == 0 {
        return Duration::from_millis(0);
    }
    Duration::from_millis(1000 / config.max_per_second as u64)
}

/// Clamp the user-supplied concurrency to a safe range (B9).
/// 0 would make `buffer_unordered(0)` never poll its source stream (it waits
/// for items that can never be polled), hanging the run until Stop. Unbounded
/// values would open hundreds of simultaneous port-25 sessions from one IP.
pub fn clamp_concurrency(concurrency: usize) -> usize {
    concurrency.clamp(1, 64)
}

pub async fn validate_emails_bulk_core<V, Fut, S>(
    emails: Vec<String>,
    concurrency: usize,
    token: CancellationToken,
    policy: ProxyPolicy,
    validator: V,
    sink: S,
) -> RunOutcome
where
    V: Fn(String, Option<ProxyConfig>) -> Fut + Send + Sync,
    Fut: Future<Output = ValidationResult> + Send,
    S: Fn(RunEvent) + Send + Sync,
{
    validate_emails_bulk_with_rate_limit(emails, concurrency, token, policy, validator, sink, None)
        .await
}

/// Core validation with rate limiting support.
/// When `rate_config` is provided, dispatches strictly sequentially with the
/// minimum interval between dispatches (see AGENTS.md: deliberate v1
/// trade-off). Proxy selection, live health and drain handling are the same
/// either way.
pub async fn validate_emails_bulk_with_rate_limit<V, Fut, S>(
    emails: Vec<String>,
    concurrency: usize,
    token: CancellationToken,
    policy: ProxyPolicy,
    validator: V,
    sink: S,
    rate_config: Option<RateLimiterConfig>,
) -> RunOutcome
where
    V: Fn(String, Option<ProxyConfig>) -> Fut + Send + Sync,
    Fut: Future<Output = ValidationResult> + Send,
    S: Fn(RunEvent) + Send + Sync,
{
    use futures::stream::{self, StreamExt};

    let rate_interval = rate_config
        .as_ref()
        .map(calculate_rate_interval)
        .unwrap_or(Duration::ZERO);
    // Clamp concurrency: 0 hangs the run, huge values flood port 25 (B9).
    let concurrency = if rate_interval.is_zero() {
        clamp_concurrency(concurrency)
    } else {
        1
    };

    let total = emails.len();
    let mut results = Vec::with_capacity(total);
    let drain = DrainCoordinator::default();
    let ctx = RunCtx {
        token: &token,
        policy: &policy,
        validator: &validator,
        sink: &sink,
        drain: &drain,
    };

    {
        let mut stream = stream::iter(emails.into_iter().enumerate())
            .map(|(i, email)| {
                let ctx = &ctx;
                async move {
                    if i > 0 && !rate_interval.is_zero() {
                        tokio::select! {
                            biased;
                            _ = ctx.token.cancelled() => return None,
                            _ = sleep(rate_interval) => {}
                        }
                    }
                    process_email(email, ctx).await
                }
            })
            .buffer_unordered(concurrency);

        loop {
            // biased: once cancelled, stop emitting even if more results
            // are ready.
            tokio::select! {
                biased;
                _ = token.cancelled() => break,
                next = stream.next() => match next {
                    Some(Some(res)) => {
                        sink(RunEvent::Progress(res.clone()));
                        results.push(res);
                    }
                    Some(None) => {}
                    None => break,
                },
            }
        }
    }

    let stop_reason = if drain.paused.load(Ordering::SeqCst) {
        Some(STOP_PAUSED_NO_PROXY.to_string())
    } else if results.len() < total {
        Some(STOP_CANCELLED.to_string())
    } else {
        None
    };
    RunOutcome { results, stop_reason }
}

pub async fn revalidate_emails_bulk_core<V, Fut, S>(
    items: Vec<RevalidationRequest>,
    concurrency: usize,
    token: CancellationToken,
    policy: ProxyPolicy,
    validator: V,
    sink: S,
) -> RunOutcome
where
    V: Fn(String, Option<ProxyConfig>) -> Fut + Send + Sync,
    Fut: Future<Output = ValidationResult> + Send,
    S: Fn(RunEvent) + Send + Sync,
{
    let emails = items.into_iter().map(|item| item.email).collect();
    validate_emails_bulk_with_rate_limit(emails, concurrency, token, policy, validator, sink, None)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_validate_email_syntax_error() {
        let result = validate_email("invalid-email".to_string(), "standard".to_string(), None).await;
        assert!(result.result == "Invalid" || result.result == "Unknown");
    }

    #[tokio::test]
    async fn test_validate_email_reachable() {
        let result = validate_email("test@example.com".to_string(), "standard".to_string(), None).await;
        assert!(!result.timestamp.is_empty());
    }

    #[tokio::test]
    async fn test_validate_email_with_proxy() {
        // Test that validation works with a proxy config (won't actually connect)
        let proxy = ProxyConfig::new("192.168.1.1".to_string(), 8080);
        let result = validate_email("test@example.com".to_string(), "standard".to_string(), Some(proxy)).await;
        // The validation will likely fail due to proxy not being reachable, but should not panic
        assert!(!result.timestamp.is_empty());
    }

    #[tokio::test]
    async fn test_validate_email_with_proxy_auth() {
        // Test that validation works with authenticated proxy config
        let proxy = ProxyConfig::with_auth(
            "192.168.1.1".to_string(),
            8080,
            "user".to_string(),
            "pass".to_string(),
        );
        let result = validate_email("test@example.com".to_string(), "standard".to_string(), Some(proxy)).await;
        assert!(!result.timestamp.is_empty());
    }

    #[tokio::test]
    async fn test_proxy_rotation_state_new() {
        let mut pool = ProxyPool::new();
        pool.enabled = true;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();

        let state = ProxyRotationState::from_pool(pool);
        assert!(state.settings.read().await.proxy_pool.enabled);
        assert_eq!(state.rotation_index.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn test_proxy_rotation_state_disabled() {
        let mut pool = ProxyPool::new();
        pool.enabled = false;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();

        let state = ProxyRotationState::from_pool(pool);
        let proxy = state.get_proxy_for_email("test@example.com").await;
        assert!(proxy.is_none());
    }

    #[tokio::test]
    async fn test_proxy_rotation_state_no_proxies() {
        let mut pool = ProxyPool::new();
        pool.enabled = true;

        let state = ProxyRotationState::from_pool(pool);
        let proxy = state.get_proxy_for_email("test@example.com").await;
        assert!(proxy.is_none());
    }

    #[tokio::test]
    async fn test_proxy_rotation_state_automatic_rotation() {
        let mut pool = ProxyPool::new();
        pool.enabled = true;
        pool.rotation_mode = RotationMode::Automatic;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();

        let state = ProxyRotationState::from_pool(pool);

        // First email should use first proxy
        let proxy1 = state.get_proxy_for_email("test1@example.com").await.unwrap();
        assert_eq!(proxy1.host, "192.168.1.1");

        // Second email should use second proxy
        let proxy2 = state.get_proxy_for_email("test2@example.com").await.unwrap();
        assert_eq!(proxy2.host, "192.168.1.2");

        // Third email should wrap back to first proxy
        let proxy3 = state.get_proxy_for_email("test3@example.com").await.unwrap();
        assert_eq!(proxy3.host, "192.168.1.1");
    }

    #[tokio::test]
    async fn test_proxy_rotation_state_per_domain() {
        let mut pool = ProxyPool::new();
        pool.enabled = true;
        pool.rotation_mode = RotationMode::PerDomain;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        pool.assign_domain("gmail.com".to_string(), "192.168.1.1:8080".to_string()).unwrap();

        let state = ProxyRotationState::from_pool(pool);

        // Gmail should use proxy 1
        let gmail_proxy = state.get_proxy_for_email("user@gmail.com").await.unwrap();
        assert_eq!(gmail_proxy.host, "192.168.1.1");

        // Other domains should fall back to first proxy
        let other_proxy = state.get_proxy_for_email("user@other.com").await.unwrap();
        assert_eq!(other_proxy.host, "192.168.1.1");
    }

    #[tokio::test]
    async fn test_proxy_rotation_state_manual_mode() {
        let mut pool = ProxyPool::new();
        pool.enabled = true;
        pool.rotation_mode = RotationMode::Manual;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();

        let state = ProxyRotationState::from_pool(pool);

        // Manual mode should always use first proxy
        let proxy1 = state.get_proxy_for_email("test1@example.com").await.unwrap();
        assert_eq!(proxy1.host, "192.168.1.1");

        let proxy2 = state.get_proxy_for_email("test2@example.com").await.unwrap();
        assert_eq!(proxy2.host, "192.168.1.1");
    }

    // === Validation mode tests ===

    #[tokio::test]
    async fn test_quick_mode_invalid_syntax() {
        let result = validate_email("invalid-email".to_string(), "quick".to_string(), None).await;
        assert_eq!(result.result, "Invalid");
        assert_eq!(result.validation_mode, "quick");
        assert!(!result.is_valid_syntax);
        assert!(!result.can_connect_smtp);
        assert!(!result.is_catch_all);
        assert!(!result.is_deliverable);
        assert!(!result.is_disabled);
        assert!(!result.has_full_inbox);
    }

    #[tokio::test]
    async fn test_quick_mode_valid_email_skips_smtp() {
        let result = validate_email("test@gmail.com".to_string(), "quick".to_string(), None).await;
        assert_eq!(result.validation_mode, "quick");
        assert!(result.is_valid_syntax);
        // Quick mode never connects to SMTP
        assert!(!result.can_connect_smtp);
        assert!(!result.is_catch_all);
        assert!(!result.is_deliverable);
        assert!(!result.is_disabled);
        assert!(!result.has_full_inbox);
        // Reason should indicate SMTP was skipped
        assert!(result.reason.contains("SMTP skipped"));
    }

    #[tokio::test]
    async fn test_quick_mode_no_mx_records() {
        // For a domain with no MX records, the result depends on the syntax check.
        // mailchecker may reject certain domains as invalid syntax, so the result
        // could be either "Invalid" or "Unknown" depending on the domain.
        let result = validate_email("test@invalid.nonexistent.tld".to_string(), "quick".to_string(), None).await;
        assert_eq!(result.validation_mode, "quick");
        // Result should be Invalid (syntax) or Unknown (MX failure) - both are valid for bad domains
        assert!(result.result == "Invalid" || result.result == "Unknown");
    }

    #[tokio::test]
    async fn test_standard_mode_default_behavior() {
        let result = validate_email("test@example.com".to_string(), "standard".to_string(), None).await;
        assert_eq!(result.validation_mode, "standard");
        assert!(!result.timestamp.is_empty());
        // Standard mode should have attempted SMTP (may or may not succeed)
    }

    #[tokio::test]
    async fn test_thorough_mode_stores_mode() {
        let result = validate_email("test@example.com".to_string(), "thorough".to_string(), None).await;
        assert_eq!(result.validation_mode, "thorough");
        assert!(!result.timestamp.is_empty());
    }

    #[tokio::test]
    async fn test_mode_stored_in_result() {
        for mode in &["quick", "standard", "thorough"] {
            let result = validate_email("test@example.com".to_string(), mode.to_string(), None).await;
            assert_eq!(result.validation_mode, *mode);
        }
    }

    #[tokio::test]
    async fn test_quick_mode_faster_than_standard() {
        // Quick mode should complete significantly faster than standard
        // since it skips SMTP handshake entirely
        let start = Instant::now();
        let _ = validate_email("test@gmail.com".to_string(), "quick".to_string(), None).await;
        let quick_duration = start.elapsed();

        // Quick mode should complete in under 5 seconds (no SMTP)
        assert!(quick_duration.as_secs() < 5, "Quick mode took {:?}, expected < 5s", quick_duration);
    }

    #[tokio::test]
    async fn test_unknown_mode_defaults_to_standard() {
        // Unknown mode strings should fall through to standard behavior
        let result = validate_email("test@example.com".to_string(), "unknown".to_string(), None).await;
        assert_eq!(result.validation_mode, "unknown");
        assert!(!result.timestamp.is_empty());
    }

    #[tokio::test]
    async fn test_quick_mode_with_proxy() {
        let proxy = ProxyConfig::new("192.168.1.1".to_string(), 8080);
        let result = validate_email("test@gmail.com".to_string(), "quick".to_string(), Some(proxy)).await;
        assert_eq!(result.validation_mode, "quick");
        // B4: quick mode never performs an SMTP conversation, so it does not
        // actually exercise the (rotated) proxy. It must not attribute a
        // proxy_id — doing so mislabels the result and feeds quick-mode
        // Unknowns into proxy failure stats.
        assert!(result.proxy_id.is_none());
        assert_eq!(result.proxy_outcome, ProxyOutcome::Neutral);
    }

    #[test]
    fn test_calculate_risk_score_all_results() {
        assert_eq!(calculate_risk_score("Safe", false, false, false, false), 1);
        assert_eq!(calculate_risk_score("Risky", false, false, false, false), 30);
        assert_eq!(calculate_risk_score("Invalid", false, false, false, false), 100);
        assert_eq!(calculate_risk_score("Unknown", false, false, false, false), 50);
        // Disposable adds 40
        assert_eq!(calculate_risk_score("Safe", true, false, false, false), 41);
        // Catch-all adds 20
        assert_eq!(calculate_risk_score("Safe", false, true, false, false), 21);
        // Disabled sets to 100
        assert_eq!(calculate_risk_score("Safe", false, false, true, false), 100);
        // Full inbox adds 30
        assert_eq!(calculate_risk_score("Safe", false, false, false, true), 31);
    }

    // === Rate Limiting Tests ===

    #[test]
    fn test_rate_limiter_calculate_interval_max_per_second() {
        let config = RateLimiterConfig { max_per_second: 1, max_per_minute: 60 };
        let interval = calculate_rate_interval(&config);
        assert_eq!(interval, Duration::from_millis(1000));
    }

    #[test]
    fn test_rate_limiter_calculate_interval_high_rate() {
        let config = RateLimiterConfig { max_per_second: 10, max_per_minute: 60 };
        let interval = calculate_rate_interval(&config);
        assert_eq!(interval, Duration::from_millis(100));
    }

    #[test]
    fn test_rate_limiter_calculate_interval_zero() {
        let config = RateLimiterConfig { max_per_second: 0, max_per_minute: 60 };
        let interval = calculate_rate_interval(&config);
        assert_eq!(interval, Duration::from_millis(0));
    }

    /// Regression test: the proxy, timeout and retries must be applied to
    /// EVERY provider field — not just gmail/yahoo/hotmailb2c. Before this
    /// fix, hotmailb2b/mimecast/proofpoint/everything_else fell through to
    /// Default, validating over a direct connection with no SMTP timeout.
    #[test]
    fn test_verif_method_applies_config_to_all_providers() {
        let mut proxies = HashMap::new();
        proxies.insert(
            "proxy1".to_string(),
            CheckEmailInputProxy {
                host: "127.0.0.1".to_string(),
                port: 1080,
                username: None,
                password: None,
                timeout_ms: None,
            },
        );

        let vm = build_verif_method(
            proxies,
            Some("proxy1".to_string()),
            Duration::from_secs(30),
            2,
        );

        use check_if_email_exists::smtp::verif_method::EmailProvider;
        for (provider, name) in [
            (EmailProvider::Gmail, "gmail"),
            (EmailProvider::HotmailB2B, "hotmailb2b"),
            (EmailProvider::HotmailB2C, "hotmailb2c"),
            (EmailProvider::Mimecast, "mimecast"),
            (EmailProvider::Proofpoint, "proofpoint"),
            (EmailProvider::Yahoo, "yahoo"),
            (EmailProvider::EverythingElse, "everything_else"),
        ] {
            assert!(
                vm.get_proxy(provider).is_some(),
                "provider {} is not routed through the proxy",
                name
            );
        }

        // No proxy configured: every provider must cleanly resolve to None
        // (not a dangling proxy id).
        let vm_no_proxy = build_verif_method(
            HashMap::new(),
            None,
            Duration::from_secs(10),
            1,
        );
        assert!(vm_no_proxy
            .get_proxy(check_if_email_exists::smtp::verif_method::EmailProvider::EverythingElse)
            .is_none());
    }

    // B5/B6: begin_run must hand out a fresh, uncancelled token every time,
    // so a run that starts after a Stop/Pause (which cancels the current
    // token) is not born already-cancelled.
    #[test]
    fn test_begin_run_returns_fresh_uncancelled_token() {
        let state = ValidationState::default();

        // Simulate a Stop: cancel the current run.
        state.cancel();

        // A new run gets a token that is NOT cancelled (B5) and is a
        // distinct token from the one Stop acted on (B6).
        let token = state.begin_run();
        assert!(!token.is_cancelled());

        // Stop again; the next begin_run is still fresh.
        state.cancel();
        assert!(token.is_cancelled());
        let token2 = state.begin_run();
        assert!(!token2.is_cancelled());
    }

    // B9: concurrency must be clamped to [1, 64].
    #[test]
    fn test_clamp_concurrency() {
        assert_eq!(clamp_concurrency(0), 1);
        assert_eq!(clamp_concurrency(1), 1);
        assert_eq!(clamp_concurrency(10), 10);
        assert_eq!(clamp_concurrency(64), 64);
        assert_eq!(clamp_concurrency(1000), 64);
    }

    fn smtp_response(severity: async_smtp::response::Severity, msg: &str) -> async_smtp::response::Response {
        use async_smtp::response::{Category, Code, Detail, Response};
        Response::new(
            Code::new(severity, Category::MailSystem, Detail::Zero),
            vec![msg.to_string()],
        )
    }

    // Only SOCKS failures and IP-reputation rejections are the proxy's fault;
    // timeouts, I/O and other SMTP errors are as likely a dead/greylisting MX.
    #[test]
    fn test_classify_smtp_error_table() {
        use async_smtp::error::Error as AsyncSmtpError;
        use async_smtp::response::Severity;
        use std::io;

        let table: Vec<(&str, SmtpError, ProxyOutcome)> = vec![
            (
                "socks5 io (proxy refused)",
                SmtpError::Socks5(fast_socks5::SocksError::Io(io::Error::new(
                    io::ErrorKind::ConnectionRefused,
                    "refused",
                ))),
                ProxyOutcome::Failure,
            ),
            (
                "socks5 auth failed",
                SmtpError::Socks5(fast_socks5::SocksError::AuthenticationFailed("bad creds".into())),
                ProxyOutcome::Failure,
            ),
            (
                "ip blacklisted (permanent)",
                SmtpError::AsyncSmtpError(AsyncSmtpError::Permanent(smtp_response(
                    Severity::PermanentNegativeCompletion,
                    "5.7.1 Client host [1.2.3.4] is blacklisted",
                ))),
                ProxyOutcome::Failure,
            ),
            (
                "ip on spamhaus (transient)",
                SmtpError::AsyncSmtpError(AsyncSmtpError::Transient(smtp_response(
                    Severity::TransientNegativeCompletion,
                    "host 1.2.3.4 is listed on zen.spamhaus.org",
                ))),
                ProxyOutcome::Failure,
            ),
            (
                "needs rdns",
                SmtpError::AsyncSmtpError(AsyncSmtpError::Permanent(smtp_response(
                    Severity::PermanentNegativeCompletion,
                    "Client host rejected: cannot find your reverse hostname",
                ))),
                ProxyOutcome::Failure,
            ),
            (
                "greylisting (transient, no reputation desc)",
                SmtpError::AsyncSmtpError(AsyncSmtpError::Transient(smtp_response(
                    Severity::TransientNegativeCompletion,
                    "4.7.1 Greylisted, please try again later",
                ))),
                ProxyOutcome::Neutral,
            ),
            (
                "async-smtp io",
                SmtpError::AsyncSmtpError(AsyncSmtpError::Io(io::Error::new(
                    io::ErrorKind::ConnectionReset,
                    "reset",
                ))),
                ProxyOutcome::Neutral,
            ),
            ("async-smtp resolution", SmtpError::AsyncSmtpError(AsyncSmtpError::Resolution), ProxyOutcome::Neutral),
            ("timeout (tarpit / dead MX)", SmtpError::Timeout(Duration::from_secs(10)), ProxyOutcome::Neutral),
            (
                "io error",
                SmtpError::IOError(io::Error::new(io::ErrorKind::TimedOut, "timed out")),
                ProxyOutcome::Neutral,
            ),
            ("anyhow", SmtpError::AnyhowError(anyhow::anyhow!("other")), ProxyOutcome::Neutral),
        ];

        for (name, err, expected) in table {
            assert_eq!(classify_smtp_error(&err), expected, "case: {}", name);
            // The full mapping (proxy used, smtp Err) agrees with the classifier.
            assert_eq!(proxy_outcome_for(true, &Err(err)), expected, "case (full): {}", name);
        }

        // Ok paths and no-proxy paths are unchanged.
        let connected = SmtpDetails { can_connect_smtp: true, ..Default::default() };
        assert_eq!(proxy_outcome_for(true, &Ok(connected)), ProxyOutcome::Success);
        assert_eq!(proxy_outcome_for(true, &Ok(SmtpDetails::default())), ProxyOutcome::Neutral);
        assert_eq!(
            proxy_outcome_for(false, &Err(SmtpError::Socks5(fast_socks5::SocksError::ArgumentInputError("x")))),
            ProxyOutcome::Neutral
        );
    }
}

/// Run-core tests (B7/B8). No network: every test injects a scripted
/// validator, a clock and an event sink.
#[cfg(test)]
mod run_tests {
    use super::*;
    use std::collections::HashSet;
    use std::pin::Pin;
    use std::sync::atomic::AtomicI64;
    use std::sync::Mutex as StdMutex;

    const T0: i64 = 1_000_000;

    fn proxy_id(i: u8) -> String {
        format!("10.0.0.{}:1080", i)
    }

    fn test_settings(n: u8) -> Arc<RwLock<Settings>> {
        let mut pool = ProxyPool::new();
        pool.enabled = true;
        pool.rotation_mode = RotationMode::Automatic;
        for i in 1..=n {
            pool.add_proxy(ProxyConfig::new(format!("10.0.0.{}", i), 1080)).unwrap();
        }
        Arc::new(RwLock::new(Settings { proxy_pool: pool, ..Settings::default() }))
    }

    /// A clock frozen at T0 until the test moves it.
    fn manual_clock() -> (Arc<AtomicI64>, Clock) {
        let now = Arc::new(AtomicI64::new(T0));
        let reader = now.clone();
        (now, Arc::new(move || reader.load(Ordering::SeqCst)))
    }

    /// A clock that follows tokio's (paused, auto-advancing) virtual time.
    fn tokio_clock() -> Clock {
        let start = tokio::time::Instant::now();
        Arc::new(move || T0 + start.elapsed().as_secs() as i64)
    }

    fn policy(settings: &Arc<RwLock<Settings>>, clock: Clock, require_proxy: bool) -> ProxyPolicy {
        ProxyPolicy {
            state: Some(Arc::new(ProxyRotationState::new(settings.clone(), clock))),
            require_proxy,
        }
    }

    fn emails(n: usize) -> Vec<String> {
        (0..n).map(|i| format!("user{}@example.com", i)).collect()
    }

    fn fake_result(email: &str, proxy: &Option<ProxyConfig>, outcome: ProxyOutcome) -> ValidationResult {
        let result = ValidationResult::builder(
            email,
            "example.com",
            "Unknown",
            "scripted",
            "standard",
            5,
            proxy.as_ref().map(|p| p.id()),
        );
        if proxy.is_some() {
            result.with_proxy_outcome(outcome)
        } else {
            result
        }
    }

    #[derive(Default)]
    struct EventLog {
        progress: AtomicUsize,
        waiting: AtomicUsize,
        failed: StdMutex<Vec<AllProxiesFailedState>>,
    }

    impl EventLog {
        fn failed_count(&self) -> usize {
            self.failed.lock().unwrap().len()
        }
        fn waiting_count(&self) -> usize {
            self.waiting.load(Ordering::SeqCst)
        }
    }

    fn sink(log: &Arc<EventLog>) -> impl Fn(RunEvent) + Send + Sync {
        let log = log.clone();
        move |event| match event {
            RunEvent::Progress(_) => {
                log.progress.fetch_add(1, Ordering::SeqCst);
            }
            RunEvent::WaitingForProxy { .. } => {
                log.waiting.fetch_add(1, Ordering::SeqCst);
            }
            RunEvent::AllProxiesFailed(state) => log.failed.lock().unwrap().push(state),
        }
    }

    type Calls = Arc<StdMutex<Vec<Option<String>>>>;
    type BoxFut = Pin<Box<dyn Future<Output = ValidationResult> + Send>>;

    /// Validator that records the proxy it was called with (at call time,
    /// i.e. right at dispatch) and returns `outcome(call_index, proxy)`.
    fn scripted<F>(
        calls: &Calls,
        delay_ms: u64,
        outcome: F,
    ) -> impl Fn(String, Option<ProxyConfig>) -> BoxFut + Send + Sync
    where
        F: Fn(usize, &Option<ProxyConfig>) -> ProxyOutcome + Send + Sync + 'static,
    {
        let calls = calls.clone();
        move |email, proxy| {
            let n = {
                let mut calls = calls.lock().unwrap();
                calls.push(proxy.as_ref().map(|p| p.id()));
                calls.len() - 1
            };
            let outcome = outcome(n, &proxy);
            Box::pin(async move {
                if delay_ms > 0 {
                    sleep(Duration::from_millis(delay_ms)).await;
                } else {
                    tokio::task::yield_now().await;
                }
                fake_result(&email, &proxy, outcome)
            })
        }
    }

    fn count_for(calls: &Calls, id: &str) -> usize {
        calls.lock().unwrap().iter().filter(|c| c.as_deref() == Some(id)).count()
    }

    fn assert_subset_no_dupes(outcome: &RunOutcome, inputs: &[String]) {
        let inputs: HashSet<&String> = inputs.iter().collect();
        let mut seen = HashSet::new();
        for r in &outcome.results {
            assert!(inputs.contains(&r.email), "result for unknown email {}", r.email);
            assert!(seen.insert(r.email.clone()), "duplicate result for {}", r.email);
        }
    }

    // 1. With require_proxy, an email is never dispatched direct — even as
    //    the pool drains under a validator whose every proxy attempt fails.
    #[tokio::test(start_paused = true)]
    async fn test_fail_closed_never_dispatches_direct() {
        for concurrency in [1usize, 10, 64] {
            let settings = test_settings(2);
            let (_now, clock) = manual_clock();
            let calls: Calls = Default::default();
            let log = Arc::new(EventLog::default());
            let inputs = emails(300);

            let outcome = validate_emails_bulk_core(
                inputs.clone(),
                concurrency,
                CancellationToken::new(),
                policy(&settings, clock, true),
                scripted(&calls, 1, |_, _| ProxyOutcome::Failure),
                sink(&log),
            )
            .await;

            let calls = calls.lock().unwrap();
            assert!(!calls.is_empty());
            assert!(
                calls.iter().all(|c| c.is_some()),
                "concurrency {}: validator was called with proxy=None",
                concurrency
            );
            assert_eq!(outcome.stop_reason.as_deref(), Some(STOP_PAUSED_NO_PROXY));
            assert!(outcome.results.len() < inputs.len());
            assert_eq!(log.failed_count(), 1);
            assert_subset_no_dupes(&outcome, &inputs);
        }

        // Pool emptied before the run dispatches anything: still never direct.
        let settings = test_settings(0);
        let calls: Calls = Default::default();
        let log = Arc::new(EventLog::default());
        let outcome = validate_emails_bulk_core(
            emails(10),
            4,
            CancellationToken::new(),
            policy(&settings, system_clock(), true),
            scripted(&calls, 0, |_, _| ProxyOutcome::Success),
            sink(&log),
        )
        .await;
        assert!(calls.lock().unwrap().is_empty());
        assert_eq!(outcome.stop_reason.as_deref(), Some(STOP_PAUSED_NO_PROXY));
        assert_eq!(log.failed_count(), 1);
    }

    // 2. Health is live: a failing proxy is cooled down mid-run and the
    //    healthy one carries the rest; stale in-flight failures don't count.
    #[tokio::test(start_paused = true)]
    async fn test_live_health_steers_away_from_failing_proxy() {
        for concurrency in [1usize, 8, 32] {
            let settings = test_settings(2);
            let (a, b) = (proxy_id(1), proxy_id(2));
            let (_now, clock) = manual_clock();
            let calls: Calls = Default::default();
            let log = Arc::new(EventLog::default());
            let a_for_validator = a.clone();

            let outcome = validate_emails_bulk_core(
                emails(200),
                concurrency,
                CancellationToken::new(),
                policy(&settings, clock, true),
                scripted(&calls, 2, move |_, p| {
                    if p.as_ref().map(|p| p.id()) == Some(a_for_validator.clone()) {
                        ProxyOutcome::Failure
                    } else {
                        ProxyOutcome::Success
                    }
                }),
                sink(&log),
            )
            .await;

            assert_eq!(outcome.stop_reason, None);
            assert_eq!(outcome.results.len(), 200);
            let a_dispatches = count_for(&calls, &a);
            let b_dispatches = count_for(&calls, &b);
            assert!(
                a_dispatches <= 3 + concurrency,
                "concurrency {}: A got {} dispatches",
                concurrency,
                a_dispatches
            );
            assert_eq!(a_dispatches + b_dispatches, 200);

            let s = settings.read().await;
            let a_stats = s.proxy_pool.get_stats(&a);
            let b_stats = s.proxy_pool.get_stats(&b);
            // Only failures dispatched before A's cooldown epoch moved on
            // are recorded: at most the 3 that put it in cooldown.
            assert_eq!(a_stats.failures as usize, a_dispatches.min(3));
            assert_eq!(a_stats.attempts, a_stats.failures);
            assert!(!a_stats.auto_disabled);
            assert_eq!(b_stats.successes as usize, b_dispatches);
            assert_eq!(b_stats.attempts as usize, b_dispatches);
        }
    }

    // 3. A burst of stale failures (all dispatched before the cooldown) must
    //    not extend the cooldown or auto-disable; a stale success must not
    //    clear a newer cooldown.
    #[tokio::test]
    async fn test_cooldown_epoch_ignores_stale_burst() {
        let settings = test_settings(1);
        let a = proxy_id(1);
        let (now, clock) = manual_clock();
        let state = ProxyRotationState::new(settings.clone(), clock);

        let mut tags = Vec::new();
        for i in 0..64 {
            let (proxy, tag) = state.select(&format!("u{}@x.com", i)).await.unwrap();
            assert_eq!(tag.epoch, 0);
            tags.push((Some(proxy), tag));
        }

        let mut recorded = 0;
        let mut stale = 0;
        for (i, (proxy, tag)) in tags.iter().enumerate() {
            // Time moves during the burst (so an extension would show), but
            // stays inside the 60s cooldown.
            if i < 10 {
                now.fetch_add(1, Ordering::SeqCst);
            }
            match state.record(tag, &fake_result("x@x.com", proxy, ProxyOutcome::Failure)).await {
                RecordOutcome::Recorded => recorded += 1,
                RecordOutcome::Stale => stale += 1,
                other => panic!("unexpected {:?}", other),
            }
        }
        assert_eq!((recorded, stale), (3, 61));

        {
            let s = settings.read().await;
            let stats = s.proxy_pool.get_stats(&a);
            assert_eq!(stats.attempts, 3);
            assert_eq!(stats.cooldown_epoch, 1);
            assert!(!stats.auto_disabled);
            // Entered at the 3rd failure (T0+3) and never extended.
            assert_eq!(stats.cooldown_until, Some(T0 + 3 + 60));
        }

        // Stale success (dispatched at epoch 0) does not clear the cooldown.
        let (proxy, tag) = &tags[0];
        assert_eq!(
            state.record(tag, &fake_result("x@x.com", proxy, ProxyOutcome::Success)).await,
            RecordOutcome::Stale
        );
        assert_eq!(settings.read().await.proxy_pool.get_stats(&a).cooldown_until, Some(T0 + 63));
        assert!(state.select("y@x.com").await.is_none());

        // After expiry, a fresh dispatch carries the new epoch and counts.
        now.store(T0 + 63, Ordering::SeqCst);
        let (proxy, tag) = state.select("z@x.com").await.unwrap();
        assert_eq!(tag.epoch, 1);
        assert_eq!(
            state.record(&tag, &fake_result("z@x.com", &Some(proxy), ProxyOutcome::Failure)).await,
            RecordOutcome::Recorded
        );
        let stats = settings.read().await.proxy_pool.get_stats(&a);
        assert_eq!(stats.attempts, 4);
        assert_eq!(stats.cooldown_epoch, 2);

        // Control: without the epoch filter the same burst auto-disables.
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("10.0.0.1".to_string(), 1080)).unwrap();
        for _ in 0..64 {
            pool.record_failure_at(&a, T0);
        }
        assert!(pool.get_stats(&a).auto_disabled);
    }

    // 4. A full drain at concurrency 64 produces exactly one pause event
    //    and one self-cancel, a typed stop reason, and a partial subset.
    #[tokio::test(start_paused = true)]
    async fn test_drain_single_event_at_high_concurrency() {
        // (a) Proxies get auto-disabled: pause immediately, no waiting.
        let settings = test_settings(3);
        {
            let mut s = settings.write().await;
            s.proxy_pool.auto_disable_threshold.min_attempts = 1;
            s.proxy_pool.auto_disable_threshold.success_rate_percent = 50;
        }
        let (_now, clock) = manual_clock();
        let calls: Calls = Default::default();
        let log = Arc::new(EventLog::default());
        let token = CancellationToken::new();
        let inputs = emails(500);

        let outcome = validate_emails_bulk_core(
            inputs.clone(),
            64,
            token.clone(),
            policy(&settings, clock, true),
            scripted(&calls, 3, |_, _| ProxyOutcome::Failure),
            sink(&log),
        )
        .await;

        assert_eq!(log.failed_count(), 1);
        assert_eq!(log.waiting_count(), 0);
        assert!(token.is_cancelled());
        assert_eq!(outcome.stop_reason.as_deref(), Some(STOP_PAUSED_NO_PROXY));
        assert!(outcome.results.len() < inputs.len());
        assert_eq!(log.progress.load(Ordering::SeqCst), outcome.results.len());
        assert_subset_no_dupes(&outcome, &inputs);
        let event = &log.failed.lock().unwrap()[0];
        assert!(event.failed_proxies.iter().all(|p| p.auto_disabled));

        // (b) Cooldown only, but the clock never moves: wait cycles, then
        //     exactly one final pause.
        let settings = test_settings(3);
        let (_now, clock) = manual_clock();
        let calls: Calls = Default::default();
        let log = Arc::new(EventLog::default());
        let token = CancellationToken::new();

        let outcome = validate_emails_bulk_core(
            inputs.clone(),
            64,
            token.clone(),
            policy(&settings, clock, true),
            scripted(&calls, 3, |_, _| ProxyOutcome::Failure),
            sink(&log),
        )
        .await;

        assert_eq!(log.waiting_count(), MAX_PROXY_WAIT_CYCLES as usize);
        assert_eq!(log.failed_count(), 1);
        assert!(token.is_cancelled());
        assert_eq!(outcome.stop_reason.as_deref(), Some(STOP_PAUSED_NO_PROXY));
        assert_subset_no_dupes(&outcome, &inputs);
    }

    // 5. Destination-side timeouts on every proxy are Neutral and must not
    //    drain the pool.
    #[tokio::test(start_paused = true)]
    async fn test_dead_domain_timeouts_do_not_drain_pool() {
        let timeout_outcome = proxy_outcome_for(true, &Err(SmtpError::Timeout(Duration::from_secs(10))));
        assert_eq!(timeout_outcome, ProxyOutcome::Neutral);

        let settings = test_settings(2);
        let calls: Calls = Default::default();
        let log = Arc::new(EventLog::default());
        let outcome = validate_emails_bulk_core(
            emails(200),
            16,
            CancellationToken::new(),
            policy(&settings, system_clock(), true),
            scripted(&calls, 2, move |_, _| timeout_outcome.clone()),
            sink(&log),
        )
        .await;

        assert_eq!(outcome.stop_reason, None);
        assert_eq!(outcome.results.len(), 200);
        assert_eq!(log.failed_count(), 0);
        assert_eq!(log.waiting_count(), 0);
        let s = settings.read().await;
        assert!(s.proxy_pool.has_available_proxies());
        assert_eq!(s.proxy_pool.get_stats(&proxy_id(1)).attempts, 0);
        assert_eq!(s.proxy_pool.get_stats(&proxy_id(2)).attempts, 0);
    }

    fn draining_settings() -> Arc<RwLock<Settings>> {
        let settings = test_settings(1);
        {
            let mut s = settings.try_write().unwrap();
            s.proxy_pool.auto_disable_threshold.min_attempts = 1;
            s.proxy_pool.auto_disable_threshold.success_rate_percent = 50;
        }
        settings
    }

    // 6. A run pausing itself cancels only its own token.
    #[tokio::test(start_paused = true)]
    async fn test_self_pause_does_not_cancel_other_run() {
        // Sequential: A pauses itself, then B begins clean on the same state.
        let state = ValidationState::default();
        let (id_a, token_a) = state.begin_run_with_id();
        let log_a = Arc::new(EventLog::default());
        let outcome_a = validate_emails_bulk_core(
            emails(50),
            8,
            token_a.clone(),
            policy(&draining_settings(), system_clock(), true),
            scripted(&Default::default(), 1, |_, _| ProxyOutcome::Failure),
            sink(&log_a),
        )
        .await;
        assert_eq!(outcome_a.stop_reason.as_deref(), Some(STOP_PAUSED_NO_PROXY));
        assert!(token_a.is_cancelled());

        let (id_b, token_b) = state.begin_run_with_id();
        assert!(id_b > id_a);
        assert!(!token_b.is_cancelled());
        assert!(!state.get_token().is_cancelled());
        let outcome_b = validate_emails_bulk_core(
            emails(50),
            8,
            token_b.clone(),
            policy(&test_settings(2), system_clock(), true),
            scripted(&Default::default(), 1, |_, _| ProxyOutcome::Success),
            sink(&Arc::new(EventLog::default())),
        )
        .await;
        assert_eq!(outcome_b.stop_reason, None);
        assert!(!token_b.is_cancelled());

        // Concurrent: A drains and pauses while B is still running.
        let state_a = ValidationState::default();
        let state_b = ValidationState::default();
        let token_a = state_a.begin_run();
        let token_b = state_b.begin_run();
        let (outcome_a, outcome_b) = tokio::join!(
            validate_emails_bulk_core(
                emails(50),
                8,
                token_a.clone(),
                policy(&draining_settings(), system_clock(), true),
                scripted(&Default::default(), 1, |_, _| ProxyOutcome::Failure),
                sink(&Arc::new(EventLog::default())),
            ),
            validate_emails_bulk_core(
                emails(100),
                4,
                token_b.clone(),
                policy(&test_settings(2), system_clock(), true),
                scripted(&Default::default(), 5, |_, _| ProxyOutcome::Success),
                sink(&Arc::new(EventLog::default())),
            )
        );
        assert_eq!(outcome_a.stop_reason.as_deref(), Some(STOP_PAUSED_NO_PROXY));
        assert!(token_a.is_cancelled());
        assert_eq!(outcome_b.stop_reason, None);
        assert_eq!(outcome_b.results.len(), 100);
        assert!(!token_b.is_cancelled());
        assert!(!state_b.get_token().is_cancelled());
    }

    // 7. Every non-Neutral result with a known proxy is recorded exactly
    //    once (no post-run double counting).
    #[tokio::test(start_paused = true)]
    async fn test_no_double_counting() {
        // concurrency 1 can't produce stale results, so every non-Neutral
        // outcome must be recorded; concurrency 10 with no failures likewise.
        let cases: Vec<(usize, fn(usize) -> ProxyOutcome)> = vec![
            (1, |n| match n % 4 {
                0 => ProxyOutcome::Neutral,
                3 => ProxyOutcome::Failure,
                _ => ProxyOutcome::Success,
            }),
            (10, |n| if n % 3 == 0 { ProxyOutcome::Neutral } else { ProxyOutcome::Success }),
        ];
        for (concurrency, script) in cases {
            let settings = test_settings(2);
            let (_now, clock) = manual_clock();
            let outcome = validate_emails_bulk_core(
                emails(120),
                concurrency,
                CancellationToken::new(),
                policy(&settings, clock, true),
                scripted(&Default::default(), 1, move |n, _| script(n)),
                sink(&Arc::new(EventLog::default())),
            )
            .await;

            let counted = |want: ProxyOutcome| {
                outcome
                    .results
                    .iter()
                    .filter(|r| r.proxy_id.is_some() && r.proxy_outcome == want)
                    .count() as u32
            };
            let s = settings.read().await;
            let (mut attempts, mut successes, mut failures) = (0, 0, 0);
            for id in [proxy_id(1), proxy_id(2)] {
                let stats = s.proxy_pool.get_stats(&id);
                attempts += stats.attempts;
                successes += stats.successes;
                failures += stats.failures;
            }
            assert_eq!(successes, counted(ProxyOutcome::Success), "concurrency {}", concurrency);
            assert_eq!(failures, counted(ProxyOutcome::Failure), "concurrency {}", concurrency);
            assert_eq!(attempts, successes + failures);
        }
    }

    // 8a. Disabling the pool mid-run pauses the run; it never goes direct.
    #[tokio::test(start_paused = true)]
    async fn test_mid_run_disable_pauses_instead_of_direct() {
        let settings = test_settings(2);
        let calls: Calls = Default::default();
        let log = Arc::new(EventLog::default());
        let settings_for_validator = settings.clone();
        let calls_for_validator = calls.clone();
        let validator = move |email: String, proxy: Option<ProxyConfig>| -> BoxFut {
            let n = {
                let mut c = calls_for_validator.lock().unwrap();
                c.push(proxy.as_ref().map(|p| p.id()));
                c.len()
            };
            let settings = settings_for_validator.clone();
            Box::pin(async move {
                if n == 20 {
                    settings.write().await.proxy_pool.enabled = false;
                }
                sleep(Duration::from_millis(2)).await;
                fake_result(&email, &proxy, ProxyOutcome::Success)
            })
        };

        let outcome = validate_emails_bulk_core(
            emails(200),
            8,
            CancellationToken::new(),
            policy(&settings, system_clock(), true),
            validator,
            sink(&log),
        )
        .await;

        assert!(calls.lock().unwrap().iter().all(|c| c.is_some()));
        assert_eq!(outcome.stop_reason.as_deref(), Some(STOP_PAUSED_NO_PROXY));
        assert!(outcome.results.len() < 200);
        assert_eq!(log.failed_count(), 1);
        assert!(!log.failed.lock().unwrap()[0].proxy_enabled);
    }

    // 8b. Deleting a proxy mid-run: it is never selected afterwards, and
    //     its in-flight results don't resurrect orphan stats.
    #[tokio::test(start_paused = true)]
    async fn test_mid_run_delete_proxy() {
        let settings = test_settings(2);
        let a = proxy_id(1);
        let deleted = Arc::new(AtomicBool::new(false));
        let used_after_delete = Arc::new(AtomicBool::new(false));
        let calls = Arc::new(AtomicUsize::new(0));

        let validator = {
            let (settings, deleted, used_after_delete, calls, a) =
                (settings.clone(), deleted.clone(), used_after_delete.clone(), calls.clone(), a.clone());
            move |email: String, proxy: Option<ProxyConfig>| -> BoxFut {
                let n = calls.fetch_add(1, Ordering::SeqCst) + 1;
                let is_a = proxy.as_ref().map(|p| p.id()) == Some(a.clone());
                if is_a && deleted.load(Ordering::SeqCst) {
                    used_after_delete.store(true, Ordering::SeqCst);
                }
                let (settings, deleted, a) = (settings.clone(), deleted.clone(), a.clone());
                Box::pin(async move {
                    if n == 10 {
                        settings.write().await.proxy_pool.remove_proxy(&a);
                        deleted.store(true, Ordering::SeqCst);
                    }
                    sleep(Duration::from_millis(5)).await;
                    fake_result(&email, &proxy, ProxyOutcome::Success)
                })
            }
        };

        let outcome = validate_emails_bulk_core(
            emails(100),
            8,
            CancellationToken::new(),
            policy(&settings, system_clock(), true),
            validator,
            sink(&Arc::new(EventLog::default())),
        )
        .await;

        assert_eq!(outcome.stop_reason, None);
        assert_eq!(outcome.results.len(), 100);
        assert!(deleted.load(Ordering::SeqCst));
        assert!(!used_after_delete.load(Ordering::SeqCst));
        // In-flight A results finished after the delete; none recreated stats.
        assert!(outcome.results.iter().any(|r| r.proxy_id.as_deref() == Some(a.as_str())));
        assert!(!settings.read().await.proxy_pool.proxy_stats.contains_key(&a));
    }

    // 8c. With the session bypass on (require_proxy=false), direct is allowed.
    #[tokio::test(start_paused = true)]
    async fn test_bypass_allows_direct() {
        // No pool at all.
        let calls: Calls = Default::default();
        let outcome = validate_emails_bulk_core(
            emails(20),
            4,
            CancellationToken::new(),
            ProxyPolicy::direct(),
            scripted(&calls, 1, |_, _| ProxyOutcome::Success),
            sink(&Arc::new(EventLog::default())),
        )
        .await;
        assert_eq!(outcome.stop_reason, None);
        assert!(calls.lock().unwrap().iter().all(|c| c.is_none()));

        // A pool that is unavailable: falls back to direct, no pause.
        let settings = test_settings(1);
        settings.write().await.proxy_pool.enabled = false;
        let calls: Calls = Default::default();
        let log = Arc::new(EventLog::default());
        let outcome = validate_emails_bulk_core(
            emails(20),
            4,
            CancellationToken::new(),
            policy(&settings, system_clock(), false),
            scripted(&calls, 1, |_, _| ProxyOutcome::Success),
            sink(&log),
        )
        .await;
        assert_eq!(outcome.stop_reason, None);
        assert_eq!(outcome.results.len(), 20);
        assert!(calls.lock().unwrap().iter().all(|c| c.is_none()));
        assert_eq!(log.failed_count(), 0);
    }

    // 9. Cooldown expiry is clock-driven: after expiry the proxy is
    //    selectable again, and a run waits in place for it.
    #[tokio::test(start_paused = true)]
    async fn test_cooldown_expiry_makes_proxy_selectable() {
        let settings = test_settings(1);
        let (now, clock) = manual_clock();
        let state = ProxyRotationState::new(settings.clone(), clock);
        for i in 0..3 {
            let (proxy, tag) = state.select(&format!("u{}@x.com", i)).await.unwrap();
            state.record(&tag, &fake_result("x@x.com", &Some(proxy), ProxyOutcome::Failure)).await;
        }
        assert!(state.select("a@x.com").await.is_none());
        now.store(T0 + 59, Ordering::SeqCst);
        assert!(state.select("a@x.com").await.is_none());
        now.store(T0 + 60, Ordering::SeqCst);
        assert!(state.select("a@x.com").await.is_some());

        // In a run: the only proxy fails 3 times, the run waits out the
        // cooldown (virtual time), then finishes on the recovered proxy.
        let settings = test_settings(1);
        let calls: Calls = Default::default();
        let log = Arc::new(EventLog::default());
        let outcome = validate_emails_bulk_core(
            emails(20),
            1,
            CancellationToken::new(),
            policy(&settings, tokio_clock(), true),
            scripted(&calls, 1, |n, _| if n < 3 { ProxyOutcome::Failure } else { ProxyOutcome::Success }),
            sink(&log),
        )
        .await;
        assert_eq!(outcome.stop_reason, None);
        assert_eq!(outcome.results.len(), 20);
        assert_eq!(log.waiting_count(), 1);
        assert_eq!(log.failed_count(), 0);
        assert!(calls.lock().unwrap().iter().all(|c| c.is_some()));
    }

    // 10. Settings commands take the write lock while a run is selecting
    //     and recording; nothing may deadlock.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn test_settings_writes_during_run_do_not_deadlock() {
        let settings = test_settings(4);
        let writer = {
            let settings = settings.clone();
            tokio::spawn(async move {
                for i in 0..200 {
                    {
                        let mut s = settings.write().await;
                        s.timeout_ms += 1;
                        s.proxy_pool.set_cooldown_duration(30 + (i % 10));
                    }
                    sleep(Duration::from_millis(1)).await;
                }
            })
        };

        let run = validate_emails_bulk_core(
            emails(400),
            32,
            CancellationToken::new(),
            policy(&settings, system_clock(), true),
            scripted(&Default::default(), 1, |n, _| {
                if n % 7 == 0 { ProxyOutcome::Failure } else { ProxyOutcome::Success }
            }),
            sink(&Arc::new(EventLog::default())),
        );

        let outcome = tokio::time::timeout(Duration::from_secs(30), run)
            .await
            .expect("run deadlocked against settings writes");
        tokio::time::timeout(Duration::from_secs(30), writer)
            .await
            .expect("settings writer deadlocked")
            .unwrap();
        assert!(outcome.stop_reason.is_none() || outcome.stop_reason.as_deref() == Some(STOP_PAUSED_NO_PROXY));
        assert_eq!(settings.read().await.timeout_ms, Settings::default().timeout_ms + 200);
    }

    #[tokio::test]
    async fn test_external_cancel_reports_cancelled() {
        let token = CancellationToken::new();
        let calls: Calls = Default::default();
        let token_for_validator = token.clone();
        let calls_for_validator = calls.clone();
        let validator = move |email: String, proxy: Option<ProxyConfig>| -> BoxFut {
            calls_for_validator.lock().unwrap().push(None);
            if calls_for_validator.lock().unwrap().len() == 5 {
                token_for_validator.cancel();
            }
            Box::pin(async move { fake_result(&email, &proxy, ProxyOutcome::Neutral) })
        };
        let outcome = validate_emails_bulk_core(
            emails(50),
            1,
            token,
            ProxyPolicy::direct(),
            validator,
            sink(&Arc::new(EventLog::default())),
        )
        .await;
        assert_eq!(outcome.stop_reason.as_deref(), Some(STOP_CANCELLED));
        assert!(outcome.results.len() < 50);
    }

    #[test]
    fn test_run_outcome_serializes_camel_case() {
        let outcome = RunOutcome {
            results: vec![],
            stop_reason: Some(STOP_PAUSED_NO_PROXY.to_string()),
        };
        let json = serde_json::to_value(&outcome).unwrap();
        assert_eq!(json["stopReason"], "paused_no_proxy");
        assert!(json["results"].is_array());
    }

    // The rate-limited (sequential) branch shares the same fail-closed path.
    #[tokio::test(start_paused = true)]
    async fn test_rate_limited_branch_is_fail_closed() {
        let calls: Calls = Default::default();
        let log = Arc::new(EventLog::default());
        let outcome = validate_emails_bulk_with_rate_limit(
            emails(30),
            8,
            CancellationToken::new(),
            policy(&draining_settings(), system_clock(), true),
            scripted(&calls, 1, |_, _| ProxyOutcome::Failure),
            sink(&log),
            Some(RateLimiterConfig { max_per_second: 10, max_per_minute: 600 }),
        )
        .await;
        assert!(calls.lock().unwrap().iter().all(|c| c.is_some()));
        assert_eq!(outcome.stop_reason.as_deref(), Some(STOP_PAUSED_NO_PROXY));
        assert_eq!(log.failed_count(), 1);
    }
}

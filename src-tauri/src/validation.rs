use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;
use std::sync::Mutex;
use std::sync::Arc;
use chrono::Utc;
use std::time::{Instant, Duration};
use std::collections::HashMap;
use check_if_email_exists::{check_email, CheckEmailInputBuilder, CheckEmailInputProxy, Reachable};
use check_if_email_exists::syntax::check_syntax;
use check_if_email_exists::mx::check_mx;
use check_if_email_exists::misc::check_misc;
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
use crate::settings::{ProxyConfig, ProxyPool, RateLimiterConfig};
#[cfg(test)]
use crate::settings::RotationMode;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ProxyOutcome {
    /// The proxy carried a complete SMTP conversation for this email,
    /// regardless of the mailbox verdict (even "Invalid" proves the proxy
    /// round-tripped).
    Success,
    /// The transport itself failed while going through the proxy
    /// (SOCKS error, I/O error, timeout, IP blacklisted, needs rDNS).
    Failure,
    /// The proxy was not actually exercised for this email (quick mode,
    /// invalid syntax, no MX records, builder error).
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
}

impl Default for ValidationState {
    fn default() -> Self {
        Self {
            token: Mutex::new(CancellationToken::new()),
        }
    }
}

impl ValidationState {
    pub fn cancel(&self) {
        let token = self.token.lock().unwrap();
        token.cancel();
    }

    pub fn reset(&self) {
        let mut token = self.token.lock().unwrap();
        *token = CancellationToken::new();
    }

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
    let proxy_outcome = if proxy_id.is_some() {
        match &output.smtp {
            // A transport error (SOCKS/IO/timeout) or an IP-reputation
            // rejection (blacklisted / needs rDNS) = the proxy path failed.
            Err(_) => ProxyOutcome::Failure,
            // SMTP completed: a real round trip happened through the proxy.
            Ok(details) if details.can_connect_smtp => ProxyOutcome::Success,
            // Ok but can_connect_smtp==false is the default output for the
            // early-return paths (invalid syntax, no MX) — the proxy was not
            // actually exercised, so it's neutral (no success, no failure).
            Ok(_) => ProxyOutcome::Neutral,
        }
    } else {
        ProxyOutcome::Neutral
    };

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

/// Proxy rotation state shared across validation tasks
pub struct ProxyRotationState {
    pub pool: ProxyPool,
    pub rotation_index: Mutex<usize>,
}

impl ProxyRotationState {
    pub fn new(pool: ProxyPool) -> Self {
        Self {
            pool,
            rotation_index: Mutex::new(0),
        }
    }

    /// Get the proxy to use for a specific email
    /// Returns None if proxy is disabled or no proxies available
    pub fn get_proxy_for_email(&self, email: &str) -> Option<ProxyConfig> {
        if !self.pool.enabled || self.pool.proxies.is_empty() {
            return None;
        }

        let mut index = self.rotation_index.lock().unwrap();
        let mut pool_clone = self.pool.clone();
        pool_clone.get_proxy_for_email(email, &mut index)
    }
}

/// Calculate the minimum interval between dispatches based on rate limiter config.
/// Returns the minimum Duration between consecutive email validations.
pub fn calculate_rate_interval(config: &RateLimiterConfig) -> Duration {
    if config.max_per_second == 0 {
        return Duration::from_millis(0);
    }
    Duration::from_millis(1000 / config.max_per_second as u64)
}

pub async fn validate_emails_bulk_core<F>(
    emails: Vec<String>,
    concurrency: usize,
    token: CancellationToken,
    mode: String,
    proxy_state: Option<Arc<ProxyRotationState>>,
    on_progress: F,
) -> Vec<ValidationResult>
where
    F: Fn(ValidationResult) + Send + Sync,
{
    validate_emails_bulk_with_rate_limit(
        emails,
        concurrency,
        token,
        mode,
        proxy_state,
        on_progress,
        None,
    ).await
}

/// Core validation with rate limiting support.
/// When `rate_config` is provided, enforces minimum interval between dispatches.
/// When `max_emails_per_session` > 0, rejects oversized batches.
pub async fn validate_emails_bulk_with_rate_limit<F>(
    emails: Vec<String>,
    concurrency: usize,
    token: CancellationToken,
    mode: String,
    proxy_state: Option<Arc<ProxyRotationState>>,
    on_progress: F,
    rate_config: Option<RateLimiterConfig>,
) -> Vec<ValidationResult>
where
    F: Fn(ValidationResult) + Send + Sync,
{
    use futures::stream::{self, StreamExt};
    use tokio::time::sleep;

    let mut results = Vec::with_capacity(emails.len());
    let mode_clone = mode.clone();

    // Calculate rate limit interval
    let rate_interval = rate_config
        .as_ref()
        .map(|c| calculate_rate_interval(c))
        .unwrap_or(Duration::from_millis(0));

    // When rate limiting is active, we process emails sequentially with intervals.
    // Otherwise, we use the existing concurrent approach.
    if rate_interval > Duration::from_millis(0) {
        // Rate-limited sequential processing
        let mut iter = emails.iter().peekable();
        while let Some(email) = iter.next() {
            if token.is_cancelled() {
                break;
            }

            let mode = mode_clone.clone();
            let proxy = proxy_state.as_ref().and_then(|state| state.get_proxy_for_email(email));
            let result = validate_email(email.clone(), mode, proxy).await;
            on_progress(result.clone());
            results.push(result);

            if iter.peek().is_some() {
                sleep(rate_interval).await;
            }
        }
    } else {
        // Original concurrent processing (no rate limiting)
        let mut stream = stream::iter(emails)
            .map(|email| {
                let mode = mode_clone.clone();
                let proxy = proxy_state.as_ref().and_then(|state| state.get_proxy_for_email(&email));
                async move {
                    validate_email(email, mode, proxy).await
                }
            })
            .buffer_unordered(concurrency);

        loop {
            tokio::select! {
                result = stream.next() => {
                    match result {
                        Some(res) => {
                            on_progress(res.clone());
                            results.push(res);
                        }
                        None => break,
                    }
                }
                _ = token.cancelled() => {
                    break;
                }
            }
        }
    }

    results
}

pub async fn revalidate_emails_bulk_core<F>(
    items: Vec<RevalidationRequest>,
    concurrency: usize,
    token: CancellationToken,
    mode: String,
    proxy_state: Option<Arc<ProxyRotationState>>,
    on_progress: F,
) -> Vec<ValidationResult>
where
    F: Fn(ValidationResult) + Send + Sync,
{
    use futures::stream::{self, StreamExt};

    let mut results = Vec::with_capacity(items.len());
    let mode_clone = mode.clone();

    let mut stream = stream::iter(items)
        .map(|item| {
            let mode = mode_clone.clone();
            let proxy = proxy_state.as_ref().and_then(|state| state.get_proxy_for_email(&item.email));
            async move {
                validate_email(item.email, mode, proxy).await
            }
        })
        .buffer_unordered(concurrency);

    loop {
        tokio::select! {
            result = stream.next() => {
                match result {
                    Some(res) => {
                        on_progress(res.clone());
                        results.push(res);
                    }
                    None => break,
                }
            }
            _ = token.cancelled() => {
                break;
            }
        }
    }

    results
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

    #[test]
    fn test_proxy_rotation_state_new() {
        let mut pool = ProxyPool::new();
        pool.enabled = true;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();

        let state = ProxyRotationState::new(pool);
        assert!(state.pool.enabled);
        assert_eq!(*state.rotation_index.lock().unwrap(), 0);
    }

    #[test]
    fn test_proxy_rotation_state_disabled() {
        let mut pool = ProxyPool::new();
        pool.enabled = false;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();

        let state = ProxyRotationState::new(pool);
        let proxy = state.get_proxy_for_email("test@example.com");
        assert!(proxy.is_none());
    }

    #[test]
    fn test_proxy_rotation_state_no_proxies() {
        let mut pool = ProxyPool::new();
        pool.enabled = true;

        let state = ProxyRotationState::new(pool);
        let proxy = state.get_proxy_for_email("test@example.com");
        assert!(proxy.is_none());
    }

    #[test]
    fn test_proxy_rotation_state_automatic_rotation() {
        let mut pool = ProxyPool::new();
        pool.enabled = true;
        pool.rotation_mode = RotationMode::Automatic;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();

        let state = ProxyRotationState::new(pool);

        // First email should use first proxy
        let proxy1 = state.get_proxy_for_email("test1@example.com").unwrap();
        assert_eq!(proxy1.host, "192.168.1.1");

        // Second email should use second proxy
        let proxy2 = state.get_proxy_for_email("test2@example.com").unwrap();
        assert_eq!(proxy2.host, "192.168.1.2");

        // Third email should wrap back to first proxy
        let proxy3 = state.get_proxy_for_email("test3@example.com").unwrap();
        assert_eq!(proxy3.host, "192.168.1.1");
    }

    #[test]
    fn test_proxy_rotation_state_per_domain() {
        let mut pool = ProxyPool::new();
        pool.enabled = true;
        pool.rotation_mode = RotationMode::PerDomain;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        pool.assign_domain("gmail.com".to_string(), "192.168.1.1:8080".to_string()).unwrap();

        let state = ProxyRotationState::new(pool);

        // Gmail should use proxy 1
        let gmail_proxy = state.get_proxy_for_email("user@gmail.com").unwrap();
        assert_eq!(gmail_proxy.host, "192.168.1.1");

        // Other domains should fall back to first proxy
        let other_proxy = state.get_proxy_for_email("user@other.com").unwrap();
        assert_eq!(other_proxy.host, "192.168.1.1");
    }

    #[test]
    fn test_proxy_rotation_state_manual_mode() {
        let mut pool = ProxyPool::new();
        pool.enabled = true;
        pool.rotation_mode = RotationMode::Manual;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();

        let state = ProxyRotationState::new(pool);

        // Manual mode should always use first proxy
        let proxy1 = state.get_proxy_for_email("test1@example.com").unwrap();
        assert_eq!(proxy1.host, "192.168.1.1");

        let proxy2 = state.get_proxy_for_email("test2@example.com").unwrap();
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
        // Quick mode doesn't use proxy for SMTP (no SMTP)
        assert!(result.proxy_id.is_some());
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
}

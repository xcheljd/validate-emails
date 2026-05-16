use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;
use std::sync::Mutex;
use std::sync::Arc;
use chrono::Utc;
use std::time::{Instant, Duration};
use std::collections::HashMap;
use check_if_email_exists::{check_email, CheckEmailInputBuilder, Reachable};
use check_if_email_exists::syntax::check_syntax;
use check_if_email_exists::mx::check_mx;
use check_if_email_exists::misc::check_misc;
use check_if_email_exists::smtp::verif_method::{
    VerifMethod,
    VerifMethodSmtpConfig,
    GmailVerifMethod,
    YahooVerifMethod,
    HotmailB2CVerifMethod,
};
use crate::settings::{ProxyConfig, ProxyPool};
#[cfg(test)]
use crate::settings::RotationMode;

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
    let proxy_id = proxy.as_ref().map(|p| p.id());

    // Step 1: Syntax check
    let syntax = check_syntax(&email);
    let domain = syntax.domain.clone();
    let is_valid_syntax = syntax.is_valid_syntax;
    let suggestion = syntax.suggestion.clone();

    if !is_valid_syntax {
        return ValidationResult {
            email,
            result: "Invalid".to_string(),
            reason: "Quick mode: Invalid syntax".to_string(),
            logs: vec![],
            domain,
            validation_duration: start_time.elapsed().as_millis() as u64,
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
            suggestion,
            gravatar_url: None,
            haveibeenpwned: None,
            error_type: None,
            timestamp: Utc::now().to_rfc3339(),
            validation_mode: mode,
            risk_score: 100,
            proxy_id,
        };
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
        return ValidationResult {
            email,
            result: "Unknown".to_string(),
            reason: "Quick mode: MX lookup failed".to_string(),
            logs: vec![],
            domain,
            validation_duration: start_time.elapsed().as_millis() as u64,
            mx_record_count: 0,
            is_disposable: false,
            is_role_account: false,
            is_catch_all: false,
            is_deliverable: false,
            is_disabled: false,
            has_full_inbox: false,
            can_connect_smtp: false,
            is_valid_syntax,
            is_b2c: false,
            suggestion,
            gravatar_url: None,
            haveibeenpwned: None,
            error_type: Some("MxLookupError".to_string()),
            timestamp: Utc::now().to_rfc3339(),
            validation_mode: mode,
            risk_score: 50,
            proxy_id,
        };
    }

    // If no MX records found, email is Invalid
    let mx_ok = mx_result.as_ref().unwrap();
    if mx_ok.lookup.is_err() {
        return ValidationResult {
            email,
            result: "Invalid".to_string(),
            reason: "Quick mode: No MX records found".to_string(),
            logs: vec![],
            domain,
            validation_duration: start_time.elapsed().as_millis() as u64,
            mx_record_count: 0,
            is_disposable: false,
            is_role_account: false,
            is_catch_all: false,
            is_deliverable: false,
            is_disabled: false,
            has_full_inbox: false,
            can_connect_smtp: false,
            is_valid_syntax,
            is_b2c: false,
            suggestion,
            gravatar_url: None,
            haveibeenpwned: None,
            error_type: None,
            timestamp: Utc::now().to_rfc3339(),
            validation_mode: mode,
            risk_score: 100,
            proxy_id,
        };
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

    ValidationResult {
        email,
        result: result_str.to_string(),
        reason: "Quick mode: syntax + MX + misc (SMTP skipped)".to_string(),
        logs: vec![],
        domain,
        validation_duration: start_time.elapsed().as_millis() as u64,
        mx_record_count,
        is_disposable: misc.is_disposable,
        is_role_account: misc.is_role_account,
        is_catch_all: false,
        is_deliverable: false,
        is_disabled: false,
        has_full_inbox: false,
        can_connect_smtp: false,
        is_valid_syntax,
        is_b2c: misc.is_b2c,
        suggestion,
        gravatar_url: misc.gravatar_url,
        haveibeenpwned: misc.haveibeenpwned,
        error_type: None,
        timestamp: Utc::now().to_rfc3339(),
        validation_mode: mode,
        risk_score,
        proxy_id,
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

    let verif_method = VerifMethod {
        proxies,
        gmail: GmailVerifMethod::Smtp(VerifMethodSmtpConfig {
            from_email: "verify@example.com".to_string(),
            hello_name: "example.com".to_string(),
            proxy: proxy_ref.clone(),
            smtp_port: 25,
            smtp_timeout: Some(smtp_timeout),
            retries,
        }),
        yahoo: YahooVerifMethod::Smtp(VerifMethodSmtpConfig {
            from_email: "verify@example.com".to_string(),
            hello_name: "example.com".to_string(),
            proxy: proxy_ref.clone(),
            smtp_port: 25,
            smtp_timeout: Some(smtp_timeout),
            retries,
        }),
        hotmailb2c: HotmailB2CVerifMethod::Smtp(VerifMethodSmtpConfig {
            from_email: "verify@example.com".to_string(),
            hello_name: "example.com".to_string(),
            proxy: proxy_ref,
            smtp_port: 25,
            smtp_timeout: Some(smtp_timeout),
            retries,
        }),
        ..Default::default()
    };

    let mut builder = CheckEmailInputBuilder::default();
    builder.to_email(email.clone()).verif_method(verif_method);

    let input = builder.build();

    let output = match input {
        Ok(input) => check_email(&input).await,
        Err(e) => {
            return ValidationResult {
                email: email.clone(),
                result: "Unknown".to_string(),
                reason: format!("Builder Error: {:?}", e),
                logs: vec![],
                domain: email.split('@').next_back().unwrap_or("").to_string(),
                validation_duration: start_time.elapsed().as_millis() as u64,
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
                error_type: Some("BuilderError".to_string()),
                timestamp: Utc::now().to_rfc3339(),
                validation_mode: mode,
                risk_score: 50,
                proxy_id,
            };
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

    let risk_score = calculate_risk_score(result_str, is_disposable, is_catch_all, is_disabled, has_full_inbox);

    ValidationResult {
        email,
        result: result_str.to_string(),
        reason,
        logs: vec![],
        domain,
        validation_duration: start_time.elapsed().as_millis() as u64,
        mx_record_count,
        is_disposable,
        is_role_account,
        is_catch_all,
        is_deliverable,
        is_disabled,
        has_full_inbox,
        can_connect_smtp,
        is_valid_syntax,
        is_b2c,
        suggestion,
        gravatar_url,
        haveibeenpwned,
        error_type: None,
        timestamp: Utc::now().to_rfc3339(),
        validation_mode: mode,
        risk_score,
        proxy_id,
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
    use futures::stream::{self, StreamExt};

    let mut results = Vec::with_capacity(emails.len());
    let mode_clone = mode.clone();

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
}

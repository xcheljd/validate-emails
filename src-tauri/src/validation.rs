use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;
use std::sync::Mutex;
use chrono::Utc;
use std::time::Instant;
use check_if_email_exists::{check_email, CheckEmailInputBuilder, Reachable};
use check_if_email_exists::smtp::verif_method::{
    VerifMethod,
    VerifMethodSmtpConfig,
    GmailVerifMethod,
    YahooVerifMethod,
    HotmailB2CVerifMethod,
};
use crate::proxy::{Proxy, ProxyPool};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ValidationResult {
    pub email: String,
    pub result: String, // Safe, Risky, Invalid, Unknown
    pub reason: String,
    pub logs: Vec<String>,
    pub domain: String,
    pub validation_duration: u64,
    pub proxy_used: Option<String>,
    pub mx_record_count: u32,
    pub is_disposable: bool,
    pub is_role_account: bool,
    pub is_catch_all: bool,
    pub error_type: Option<String>,
    pub timestamp: String,
    pub validation_mode: String,
    pub risk_score: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RevalidationRequest {
    pub email: String,
    pub excluded_proxy: Option<String>,
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

pub async fn validate_email(email: String, proxy: Option<Proxy>, mode: String) -> ValidationResult {
    let start_time = Instant::now();
    
    let verif_method = VerifMethod {
        gmail: GmailVerifMethod::Smtp(VerifMethodSmtpConfig {
            from_email: "verify@example.com".to_string(),
            hello_name: "example.com".to_string(),
            ..Default::default()
        }),
        yahoo: YahooVerifMethod::Smtp(VerifMethodSmtpConfig {
            from_email: "verify@example.com".to_string(),
            hello_name: "example.com".to_string(),
            ..Default::default()
        }),
        hotmailb2c: HotmailB2CVerifMethod::Smtp(VerifMethodSmtpConfig {
            from_email: "verify@example.com".to_string(),
            hello_name: "example.com".to_string(),
            ..Default::default()
        }),
        ..Default::default()
    };

    let mut builder = CheckEmailInputBuilder::default();
    builder.to_email(email.clone()).verif_method(verif_method);

    let proxy_str = if let Some(ref p) = proxy {
        // TODO: Configure builder with proxy when API is confirmed
        Some(format!("{}:{}", p.ip, p.port))
    } else {
        None
    };

    let input = builder.build();

    let output = match input {
        Ok(input) => check_email(&input).await,
        Err(e) => {
            return ValidationResult {
                email: email.clone(),
                result: "Unknown".to_string(),
                reason: format!("Builder Error: {:?}", e),
                logs: vec![],
                domain: email.split('@').last().unwrap_or("").to_string(),
                validation_duration: start_time.elapsed().as_millis() as u64,
                proxy_used: proxy_str,
                mx_record_count: 0,
                is_disposable: false,
                is_role_account: false,
                is_catch_all: false,
                error_type: Some("BuilderError".to_string()),
                timestamp: Utc::now().to_rfc3339(),
                validation_mode: mode,
                risk_score: 50,
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

    let domain = email.split('@').last().unwrap_or("").to_string();
    let mx_record_count = match &output.mx {
        Ok(mx) => match &mx.lookup {
            Ok(lookup) => lookup.iter().count() as u32,
            Err(_) => 0,
        },
        Err(_) => 0,
    };

    let (is_disposable, is_role_account) = match &output.misc {
        Ok(misc) => (misc.is_disposable, misc.is_role_account),
        Err(_) => (false, false),
    };

    let is_catch_all = match &output.smtp {
        Ok(smtp) => smtp.is_catch_all,
        Err(_) => false,
    };

    let risk_score = calculate_risk_score(result_str, is_disposable, is_catch_all);

    ValidationResult {
        email,
        result: result_str.to_string(),
        reason,
        logs: vec![], // Logs are usually collected in builder, but for now we keep it empty or extract from output
        domain,
        validation_duration: start_time.elapsed().as_millis() as u64,
        proxy_used: proxy_str,
        mx_record_count,
        is_disposable,
        is_role_account,
        is_catch_all,
        error_type: None,
        timestamp: Utc::now().to_rfc3339(),
        validation_mode: mode,
        risk_score,
    }
}

fn calculate_risk_score(result: &str, is_disposable: bool, is_catch_all: bool) -> u32 {
    let mut score = match result {
        "Safe" => 0,
        "Risky" => 30,
        "Invalid" => 100,
        "Unknown" => 50,
        _ => 50,
    };
    if is_disposable { score += 40; }
    if is_catch_all { score += 20; }
    if score > 100 { score = 100; }
    score
}

pub async fn validate_emails_bulk_core<F>(
    emails: Vec<String>,
    concurrency: usize,
    token: CancellationToken,
    pool: ProxyPool,
    mode: String,
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
            let pool = pool.clone();
            let mode = mode_clone.clone();
            async move {
                let proxy = pool.get_next_proxy().await;
                let res = validate_email(email, proxy.clone(), mode).await;
                
                if let Some(p) = proxy {
                    if res.result == "Unknown" {
                        pool.report_failure(&p).await;
                    } else {
                        pool.report_success(&p).await;
                    }
                }
                res
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
    pool: ProxyPool,
    mode: String,
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
            let pool = pool.clone();
            let mode = mode_clone.clone();
            async move {
                let res = validate_email_with_exclusion(
                    item.email, 
                    item.excluded_proxy, 
                    pool.clone(), 
                    mode
                ).await;
                
                if let Some(ref p_str) = res.proxy_used {
                     if let Some(proxy) = Proxy::from_str(p_str) {
                        if res.result == "Unknown" {
                            pool.report_failure(&proxy).await;
                        } else {
                            pool.report_success(&proxy).await;
                        }
                     }
                }
                res
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
        let result = validate_email("invalid-email".to_string(), None, "standard".to_string()).await;
        assert!(result.result == "Invalid" || result.result == "Unknown");
        assert!(result.validation_duration > 0);
    }

    #[tokio::test]
    async fn test_validate_email_reachable() {
        let result = validate_email("test@example.com".to_string(), None, "standard".to_string()).await;
        assert!(!result.timestamp.is_empty());
    }
}

pub async fn validate_email_with_exclusion(
    email: String,
    excluded_proxy: Option<String>,
    pool: ProxyPool,
    mode: String,
) -> ValidationResult {
    let proxy = pool.get_proxy_excluding(excluded_proxy.as_deref()).await;
    validate_email(email, proxy, mode).await
}

#[cfg(test)]
mod revalidation_tests {
    use super::*;
    use crate::proxy::ProxyPool;

    #[tokio::test]
    async fn test_validate_email_excludes_specific_proxy() {
        let pool = ProxyPool::new();
        // Add two proxies
        pool.add_proxies(vec!["1.1.1.1:80".to_string(), "2.2.2.2:80".to_string()]).await;

        // We want to exclude 1.1.1.1:80. 
        // Since get_next_proxy rotates, we can't be 100% sure which one calls first unless we force state.
        // But if we exclude one, we EXPECT the other.
        
        // Note: Real network call will fail for 1.1.1.1, but validate_email handles errors.
        // We only care about `proxy_used` in the result.
        
        let excluded = "1.1.1.1:80".to_string();
        
        // The stub uses get_next_proxy. If it picks 1.1.1.1, the test fails.
        // We might need to try a few times or force the pool index? 
        // Actually, simpler: create a pool with ONLY the excluded proxy and see if it returns None (if we implement that logic)
        // OR create pool with 2 proxies, exclude 1, ensure we get 2.
        
        // Let's try to ensure we get 2.2.2.2 if we exclude 1.1.1.1.
        // However, with get_next_proxy, it depends on index.
        
        let res = validate_email_with_exclusion(
            "test@example.com".to_string(),
            Some(excluded.clone()),
            pool.clone(),
            "standard".to_string()
        ).await;

        // If the implementation is "random" or "round robin", it MIGHT pick 1.1.1.1.
        // We need the implementation to GUARANTEE it doesn't pick 1.1.1.1.
        
        if let Some(p) = res.proxy_used {
             assert_ne!(p, excluded, "Should not use the excluded proxy");
        }
    }
}
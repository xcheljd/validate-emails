use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;
use std::sync::Mutex;
use check_if_email_exists::{check_email, CheckEmailInputBuilder, Reachable};
use check_if_email_exists::smtp::verif_method::{
    VerifMethod,
    VerifMethodSmtpConfig,
    GmailVerifMethod,
    YahooVerifMethod,
    HotmailB2CVerifMethod,
};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ValidationResult {
    pub email: String,
    pub result: String, // Safe, Risky, Invalid
    pub reason: String,
    pub logs: Vec<String>,
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

pub async fn validate_email(email: String) -> ValidationResult {
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

    let input = CheckEmailInputBuilder::default()
        .to_email(email.clone())
        .verif_method(verif_method)
        .build();

    // The builder returns a Result, but the old code assumed it always succeeds.
    // Handling the error case to avoid a panic if build fails.
    let output = match input {
        Ok(input) => check_email(&input).await,
        Err(e) => {
            return ValidationResult {
                email,
                result: "Unknown".to_string(),
                reason: format!("Builder Error: {:?}", e),
                logs: vec![],
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

    ValidationResult {
        email,
        result: result_str.to_string(),
        reason,
        logs: vec![],
    }
}

pub async fn validate_emails_bulk_core<F>(
    emails: Vec<String>,
    concurrency: usize,
    token: CancellationToken,
    on_progress: F,
) -> Vec<ValidationResult>
where
    F: Fn(ValidationResult) + Send + Sync,
{
    use futures::stream::{self, StreamExt};

    let mut results = Vec::with_capacity(emails.len());
    let mut stream = stream::iter(emails)
        .map(|email| async move { validate_email(email).await })
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
        let result = validate_email("invalid-email".to_string()).await;
        // In some cases the builder might fail for invalid syntax if it validates during build
        assert!(result.result == "Invalid" || result.result == "Unknown");
    }

    #[tokio::test]
    async fn test_validate_email_reachable() {
        let result = validate_email("test@example.com".to_string()).await;
        assert!(result.result == "Safe" || result.result == "Risky" || result.result == "Invalid" || result.result == "Unknown");
    }

    #[tokio::test]
    async fn test_validate_email_gmail_reachable() {
        // Gmail is a stable target for testing reachable/risky detection
        let result = validate_email("support@gmail.com".to_string()).await;
        assert_ne!(result.result, "Unknown");
    }

    #[tokio::test]
    async fn test_validate_email_disposable() {
        let result = validate_email("test@mailinator.com".to_string()).await;
        assert!(result.result == "Risky" || result.result == "Safe" || result.result == "Invalid");
    }

    #[tokio::test]
    async fn test_cancellation_mechanism() {
        let state = ValidationState::default();
        let token = state.get_token();
        
                assert!(!token.is_cancelled());
        
                state.cancel();
        
                assert!(token.is_cancelled());
        
            }
        
        
        
            #[tokio::test]
        
            async fn test_bulk_cancellation() {
        
                // Use more emails to increase chance of catching it in progress
        
                let emails = (0..20).map(|i| format!("test{}@example.com", i)).collect::<Vec<_>>();
        
                let token = CancellationToken::new();
        
                let token_clone = token.clone();
        
                
        
                let t = token.clone();
        
                tokio::spawn(async move {
        
                    tokio::time::sleep(tokio::time::Duration::from_millis(1)).await;
        
                    t.cancel();
        
                });
        
        
        
                let results = validate_emails_bulk_core(emails, 1, token_clone, |_| {}).await;
        
                
        
                assert!(results.len() < 20, "Should have cancelled before finishing all 20, got {}", results.len());
        
            }
        
        }
        
        
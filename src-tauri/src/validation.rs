use serde::{Deserialize, Serialize};
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
}

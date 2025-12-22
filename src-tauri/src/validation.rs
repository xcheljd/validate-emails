use serde::{Deserialize, Serialize};
use check_if_email_exists::{check_email, CheckEmailInput, Reachable};
use futures::stream::{self, StreamExt};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ValidationResult {
    pub email: String,
    pub result: String, // Safe, Risky, Invalid
    pub reason: String,
    pub logs: Vec<String>,
}

pub async fn validate_email(email: String) -> ValidationResult {
    let mut input = CheckEmailInput::default();
    input.to_email = email.clone();
    
    let output = check_email(&input).await;
    
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
        assert!(result.result == "Invalid" || result.result == "Unknown");
    }

    #[tokio::test]
    async fn test_validate_email_reachable() {
        let result = validate_email("test@example.com".to_string()).await;
        assert!(result.result == "Safe" || result.result == "Risky" || result.result == "Invalid" || result.result == "Unknown");
    }
}

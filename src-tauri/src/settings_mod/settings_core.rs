use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use std::sync::Arc;
use std::path::PathBuf;
use std::fs;

use super::proxy_pool::ProxyPool;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimiterConfig {
    pub max_per_second: u32,
    pub max_per_minute: u32,
}

impl Default for RateLimiterConfig {
    fn default() -> Self {
        Self {
            max_per_second: 1,
            max_per_minute: 60,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub validation_mode: String,
    pub timeout_ms: u64,
    pub concurrency: usize,
    pub max_retries: usize,
    pub auto_save_interval: usize,
    pub history_retention_days: u32,
    pub rate_limiter: RateLimiterConfig,
    #[serde(default)]
    pub proxy_pool: ProxyPool,
    /// Maximum emails per validation session. 0 = unlimited. Default: 0.
    #[serde(default)]
    pub max_emails_per_session: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            validation_mode: "standard".to_string(),
            timeout_ms: 30000,
            concurrency: 5,
            max_retries: 3,
            auto_save_interval: 10,
            history_retention_days: 90,
            rate_limiter: RateLimiterConfig::default(),
            proxy_pool: ProxyPool::default(),
            max_emails_per_session: 0,
        }
    }
}

pub struct SettingsState {
    pub settings: Arc<RwLock<Settings>>,
    pub settings_path: PathBuf,
    /// Temporary bypass flag for the current session - allows continuing without proxy
    /// without permanently disabling proxy in settings
    pub proxy_bypass_for_session: Arc<RwLock<bool>>,
}

impl Default for SettingsState {
    fn default() -> Self {
        let settings_dir = std::env::var("HOME")
            .map(|home| {
                let mut path = PathBuf::from(home);
                path.push(".local");
                path.push("share");
                path.push("com.yourcompany.emailvalidator");
                path
            })
            .unwrap_or_else(|_| PathBuf::from("."));

        let settings_path = settings_dir.join("settings.json");

        let settings = if settings_path.exists() {
            fs::read_to_string(&settings_path)
                .ok()
                .and_then(|content| serde_json::from_str(&content).ok())
                .unwrap_or_default()
        } else {
            Settings::default()
        };

        Self {
            settings: Arc::new(RwLock::new(settings)),
            settings_path,
            proxy_bypass_for_session: Arc::new(RwLock::new(false)),
        }
    }
}

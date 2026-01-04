use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub validation_mode: String,
    pub timeout_ms: u64,
    pub concurrency: usize,
    pub max_retries: usize,
    pub proxy_enabled: bool,
    pub proxy_rotation_strategy: String,
    pub max_emails_per_proxy: usize,
    pub proxy_protocol: String,
    pub min_proxy_uptime: f32,
    pub auto_save_interval: usize,
    pub history_retention_days: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            validation_mode: "standard".to_string(),
            timeout_ms: 30000,
            concurrency: 5,
            max_retries: 3,
            proxy_enabled: false,
            proxy_rotation_strategy: "on-failure".to_string(),
            max_emails_per_proxy: 50,
            proxy_protocol: "any".to_string(),
            min_proxy_uptime: 80.0,
            auto_save_interval: 10,
            history_retention_days: 90,
        }
    }
}

#[tauri::command]
pub async fn load_settings() -> Result<Settings, String> {
    Ok(Settings::default())
}

#[tauri::command]
pub async fn save_settings(_settings: Settings) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn reset_settings() -> Result<Settings, String> {
    Ok(Settings::default())
}

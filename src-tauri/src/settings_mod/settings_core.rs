use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use std::sync::Arc;
use std::path::{Path, PathBuf};
use std::fs;
use std::io::ErrorKind;

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

/// Describes a settings file that could not be loaded at startup. The bad
/// file is moved aside (not deleted, not overwritten) so the proxy pool in it
/// can be recovered; the app then runs on defaults (B13).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CorruptSettingsInfo {
    pub original_path: PathBuf,
    /// Where the bad file was moved (or copied, if the move failed). If
    /// `preserved` is false this is only the intended location.
    pub backup_path: PathBuf,
    /// The read or parse error.
    pub reason: String,
    /// True if the original bytes now exist at `backup_path`.
    pub preserved: bool,
    /// Human-readable warning for the UI.
    pub message: String,
}

pub struct SettingsState {
    pub settings: Arc<RwLock<Settings>>,
    pub settings_path: PathBuf,
    /// Temporary bypass flag for the current session - allows continuing without proxy
    /// without permanently disabling proxy in settings
    pub proxy_bypass_for_session: Arc<RwLock<bool>>,
    /// Set when settings.json existed but was unreadable/unparseable at startup.
    pub corrupt_settings: Option<CorruptSettingsInfo>,
}

impl SettingsState {
    pub fn default_settings_path() -> PathBuf {
        let settings_dir = std::env::var("HOME")
            .map(|home| {
                let mut path = PathBuf::from(home);
                path.push(".local");
                path.push("share");
                path.push("com.yourcompany.emailvalidator");
                path
            })
            .unwrap_or_else(|_| PathBuf::from("."));

        settings_dir.join("settings.json")
    }

    pub fn from_path(settings_path: PathBuf) -> Self {
        let (settings, corrupt_settings) = load_settings_file(&settings_path);
        if let Some(info) = &corrupt_settings {
            eprintln!("[settings] {}", info.message);
        }

        Self {
            settings: Arc::new(RwLock::new(settings)),
            settings_path,
            proxy_bypass_for_session: Arc::new(RwLock::new(false)),
            corrupt_settings,
        }
    }

    pub fn corrupt_settings_warning(&self) -> Option<CorruptSettingsInfo> {
        self.corrupt_settings.clone()
    }
}

impl Default for SettingsState {
    fn default() -> Self {
        Self::from_path(Self::default_settings_path())
    }
}

/// Load settings from `path`.
///
/// - missing file → defaults, no warning (first run)
/// - unreadable or unparseable file → moved aside to
///   `<name>.corrupt-<YYYYmmdd-HHMMSS>[-N]`, defaults returned with a warning
///
/// Never fails: the app must still start.
pub fn load_settings_file(path: &Path) -> (Settings, Option<CorruptSettingsInfo>) {
    let timestamp = chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string();
    load_settings_file_at(path, &timestamp)
}

pub(crate) fn load_settings_file_at(path: &Path, timestamp: &str) -> (Settings, Option<CorruptSettingsInfo>) {
    let reason = match fs::read_to_string(path) {
        Err(e) if e.kind() == ErrorKind::NotFound => return (Settings::default(), None),
        Err(e) => format!("could not be read: {}", e),
        Ok(content) => match serde_json::from_str(&content) {
            Ok(settings) => return (settings, None),
            Err(e) => format!("could not be parsed: {}", e),
        },
    };

    (Settings::default(), Some(quarantine_corrupt_file(path, timestamp, reason)))
}

/// First free `<name>.corrupt-<timestamp>`, `…-1`, `…-2`, … next to `path`.
fn corrupt_backup_path(path: &Path, timestamp: &str) -> PathBuf {
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "settings.json".to_string());
    let base = format!("{}.corrupt-{}", file_name, timestamp);

    let mut candidate = path.with_file_name(&base);
    let mut counter = 1u32;
    while candidate.exists() {
        candidate = path.with_file_name(format!("{}-{}", base, counter));
        counter += 1;
    }
    candidate
}

fn quarantine_corrupt_file(path: &Path, timestamp: &str, reason: String) -> CorruptSettingsInfo {
    let backup_path = corrupt_backup_path(path, timestamp);

    // Prefer a rename so the next save can't overwrite the bad file. If that
    // fails, at least try to keep a copy before the original gets replaced.
    let (preserved, message) = match fs::rename(path, &backup_path) {
        Ok(()) => (
            true,
            format!(
                "Your settings file {} was corrupt ({}). It was moved to {} and default settings are being used. Any proxies you had configured can be recovered from that file.",
                path.display(), reason, backup_path.display()
            ),
        ),
        Err(rename_err) => match fs::copy(path, &backup_path) {
            Ok(_) => (
                true,
                format!(
                    "Your settings file {} was corrupt ({}). It could not be moved ({}), so it was copied to {} and default settings are being used. The original will be overwritten the next time settings are saved.",
                    path.display(), reason, rename_err, backup_path.display()
                ),
            ),
            Err(copy_err) => (
                false,
                format!(
                    "Your settings file {} was corrupt ({}) and could NOT be backed up (move failed: {}; copy failed: {}). Default settings are being used. Back up {} manually before changing any settings, or it will be overwritten.",
                    path.display(), reason, rename_err, copy_err, path.display()
                ),
            ),
        },
    };

    CorruptSettingsInfo {
        original_path: path.to_path_buf(),
        backup_path,
        reason,
        preserved,
        message,
    }
}

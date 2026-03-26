use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use std::sync::Arc;
use std::path::PathBuf;
use std::fs;
use std::net::{Ipv4Addr, Ipv6Addr};

/// Rotation mode for proxy selection
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum RotationMode {
    /// User manually selects which proxy to use
    #[default]
    Manual,
    /// Proxies are automatically rotated in round-robin or weighted fashion
    Automatic,
    /// Different proxies are assigned to specific email domains
    PerDomain,
}

/// Configuration for a single SOCKS5 proxy
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct ProxyConfig {
    /// Proxy host (IP address or hostname)
    pub host: String,
    /// Proxy port (1-65535)
    pub port: u16,
    /// Optional username for authentication
    pub username: Option<String>,
    /// Optional password for authentication
    pub password: Option<String>,
}

impl ProxyConfig {
    /// Create a new proxy config with host and port
    pub fn new(host: String, port: u16) -> Self {
        Self {
            host,
            port,
            username: None,
            password: None,
        }
    }

    /// Create a proxy config with authentication
    pub fn with_auth(host: String, port: u16, username: String, password: String) -> Self {
        Self {
            host,
            port,
            username: Some(username),
            password: Some(password),
        }
    }

    /// Parse from a string format: "host:port" or "socks5://user:pass@host:port"
    pub fn parse(input: &str) -> Result<Self, String> {
        let input = input.trim();

        // Handle socks5:// prefix
        let (auth_part, host_port) = if let Some(rest) = input.strip_prefix("socks5://") {
            // Check for user:pass@ prefix
            if let Some(at_pos) = rest.find('@') {
                let auth = &rest[..at_pos];
                let host_port = &rest[at_pos + 1..];
                (Some(auth), host_port)
            } else {
                (None, rest)
            }
        } else {
            (None, input)
        };

        // Parse host:port
        let (host, port) = if host_port.starts_with('[') {
            // IPv6 format: [::1]:1080
            let closing_bracket = host_port.find(']')
                .ok_or_else(|| "Invalid IPv6 format: missing closing bracket".to_string())?;
            let host = &host_port[1..closing_bracket];
            let rest = &host_port[closing_bracket + 1..];
            let port_str = rest.strip_prefix(':')
                .ok_or_else(|| "Invalid format: missing port after IPv6 address".to_string())?;
            (host.to_string(), port_str)
        } else {
            // IPv4 or hostname: host:port
            let colon_pos = host_port.rfind(':')
                .ok_or_else(|| "Invalid format: missing port. Expected host:port".to_string())?;
            let host = &host_port[..colon_pos];
            let port_str = &host_port[colon_pos + 1..];
            (host.to_string(), port_str)
        };

        // Validate and parse port
        let port: u16 = port.parse()
            .map_err(|_| format!("Invalid port number: {}", port))?;

        if port == 0 {
            return Err("Port cannot be 0".to_string());
        }

        // Validate host
        if host.is_empty() {
            return Err("Host cannot be empty".to_string());
        }

        // Parse authentication if present
        let (username, password) = if let Some(auth) = auth_part {
            let colon_pos = auth.find(':')
                .ok_or_else(|| "Invalid auth format: expected user:pass".to_string())?;
            let username = auth[..colon_pos].to_string();
            let password = auth[colon_pos + 1..].to_string();
            if username.is_empty() || password.is_empty() {
                return Err("Username and password cannot be empty".to_string());
            }
            (Some(username), Some(password))
        } else {
            (None, None)
        };

        Ok(Self {
            host,
            port,
            username,
            password,
        })
    }

    /// Validate the proxy configuration
    pub fn validate(&self) -> Result<(), String> {
        if self.host.is_empty() {
            return Err("Host cannot be empty".to_string());
        }

        if self.port == 0 {
            return Err("Port cannot be 0".to_string());
        }

        // Validate host is a valid IP or hostname
        if !self.host.contains(':') {
            // Not IPv6, try to parse as IPv4
            if self.host.parse::<Ipv4Addr>().is_err() {
                // Not a valid IPv4, check if it's a valid hostname
                if !Self::is_valid_hostname(&self.host) {
                    return Err(format!("Invalid host: {}", self.host));
                }
            }
        } else {
            // Try to parse as IPv6
            if self.host.parse::<Ipv6Addr>().is_err() {
                return Err(format!("Invalid IPv6 address: {}", self.host));
            }
        }

        // Validate auth consistency
        match (&self.username, &self.password) {
            (Some(_), None) => return Err("Password required when username is provided".to_string()),
            (None, Some(_)) => return Err("Username required when password is provided".to_string()),
            _ => {}
        }

        Ok(())
    }

    /// Check if a string is a valid hostname
    fn is_valid_hostname(host: &str) -> bool {
        if host.is_empty() || host.len() > 253 {
            return false;
        }

        // Hostname labels can contain alphanumeric characters and hyphens
        // but cannot start or end with a hyphen
        for label in host.split('.') {
            if label.is_empty() || label.len() > 63 {
                return false;
            }
            if label.starts_with('-') || label.ends_with('-') {
                return false;
            }
            if !label.chars().all(|c| c.is_alphanumeric() || c == '-') {
                return false;
            }
        }
        true
    }

    /// Convert to the format expected by check-if-email-exists library
    pub fn to_check_email_proxy(&self) -> check_if_email_exists::CheckEmailInputProxy {
        check_if_email_exists::CheckEmailInputProxy {
            host: self.host.clone(),
            port: self.port,
            username: self.username.clone(),
            password: self.password.clone(),
            // Use default timeout from library
            timeout_ms: None,
        }
    }

    /// Get a unique identifier for this proxy (host:port)
    pub fn id(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}

/// Pool of proxies with configuration for rotation and management
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProxyPool {
    /// List of configured proxies
    pub proxies: Vec<ProxyConfig>,
    /// Whether proxy support is enabled
    pub enabled: bool,
    /// Current rotation mode
    pub rotation_mode: RotationMode,
    /// Per-domain proxy assignments (domain -> proxy host:port)
    #[serde(default)]
    pub domain_assignments: std::collections::HashMap<String, String>,
}

impl ProxyPool {
    /// Create a new empty proxy pool
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a proxy to the pool
    pub fn add_proxy(&mut self, proxy: ProxyConfig) -> Result<(), String> {
        proxy.validate()?;

        // Check for duplicates
        if self.proxies.iter().any(|p| p.id() == proxy.id()) {
            return Err(format!("Proxy {} already exists in pool", proxy.id()));
        }

        self.proxies.push(proxy);
        Ok(())
    }

    /// Remove a proxy from the pool by host:port
    pub fn remove_proxy(&mut self, id: &str) -> bool {
        let initial_len = self.proxies.len();
        self.proxies.retain(|p| p.id() != id);
        // Also remove from domain assignments
        self.domain_assignments.retain(|_, v| v != id);
        self.proxies.len() != initial_len
    }

    /// Update a proxy in the pool
    pub fn update_proxy(&mut self, old_id: &str, new_proxy: ProxyConfig) -> Result<(), String> {
        new_proxy.validate()?;

        // Check if the old proxy exists
        let exists = self.proxies.iter().any(|p| p.id() == old_id);
        if !exists {
            return Err(format!("Proxy {} not found in pool", old_id));
        }

        let new_id = new_proxy.id();

        // If the new ID differs and already exists, that's an error
        if old_id != new_id && self.proxies.iter().any(|p| p.id() == new_id) {
            return Err(format!("Proxy {} already exists in pool", new_id));
        }

        // Find and update the proxy
        if let Some(proxy) = self.proxies.iter_mut().find(|p| p.id() == old_id) {
            // Update domain assignments if ID changed
            if old_id != new_id {
                if let Some(assignment) = self.domain_assignments.iter_mut().find(|(_, v)| *v == old_id) {
                    *assignment.1 = new_id.clone();
                }
            }

            *proxy = new_proxy;
            Ok(())
        } else {
            Err(format!("Proxy {} not found in pool", old_id))
        }
    }

    /// Get a proxy by ID
    pub fn get_proxy(&self, id: &str) -> Option<&ProxyConfig> {
        self.proxies.iter().find(|p| p.id() == id)
    }

    /// Get all proxy IDs
    pub fn get_proxy_ids(&self) -> Vec<String> {
        self.proxies.iter().map(|p| p.id()).collect()
    }

    /// Check if the pool has any available proxies
    pub fn has_proxies(&self) -> bool {
        !self.proxies.is_empty()
    }

    /// Get the number of proxies in the pool
    pub fn len(&self) -> usize {
        self.proxies.len()
    }

    /// Check if the pool is empty
    pub fn is_empty(&self) -> bool {
        self.proxies.is_empty()
    }

    /// Clear all proxies from the pool
    pub fn clear(&mut self) {
        self.proxies.clear();
        self.domain_assignments.clear();
    }

    /// Assign a proxy to a specific domain
    pub fn assign_domain(&mut self, domain: String, proxy_id: String) -> Result<(), String> {
        if !self.proxies.iter().any(|p| p.id() == proxy_id) {
            return Err(format!("Proxy {} not found in pool", proxy_id));
        }
        self.domain_assignments.insert(domain.to_lowercase(), proxy_id);
        Ok(())
    }

    /// Get the proxy assigned to a domain
    pub fn get_domain_proxy(&self, domain: &str) -> Option<&ProxyConfig> {
        self.domain_assignments
            .get(&domain.to_lowercase())
            .and_then(|id| self.get_proxy(id))
    }

    /// Remove a domain assignment
    pub fn unassign_domain(&mut self, domain: &str) -> bool {
        self.domain_assignments.remove(&domain.to_lowercase()).is_some()
    }
}

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
        }
    }
}

pub struct SettingsState {
    pub settings: Arc<RwLock<Settings>>,
    pub settings_path: PathBuf,
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
        }
    }
}

#[tauri::command]
pub async fn load_settings(
    state: tauri::State<'_, SettingsState>,
) -> Result<Settings, String> {
    let settings = state.settings.read().await;
    Ok(settings.clone())
}

#[tauri::command]
pub async fn save_settings(
    state: tauri::State<'_, SettingsState>,
    settings: Settings,
) -> Result<(), String> {
    let mut current = state.settings.write().await;
    *current = settings.clone();

    if let Some(parent) = state.settings_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create settings directory: {}", e))?;
    }

    let json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    fs::write(&state.settings_path, json)
        .map_err(|e| format!("Failed to write settings: {}", e))
}

#[tauri::command]
pub async fn reset_settings(
    state: tauri::State<'_, SettingsState>,
) -> Result<Settings, String> {
    let mut settings = state.settings.write().await;
    *settings = Settings::default();
    Ok(settings.clone())
}

#[tauri::command]
pub async fn update_validator_config(
    state: tauri::State<'_, SettingsState>,
    rate_limiter: RateLimiterConfig,
) -> Result<(), String> {
    let mut settings = state.settings.write().await;
    settings.rate_limiter = rate_limiter;
    Ok(())
}

#[tauri::command]
pub async fn get_validator_config(
    state: tauri::State<'_, SettingsState>,
) -> Result<RateLimiterConfig, String> {
    let settings = state.settings.read().await;
    Ok(settings.rate_limiter.clone())
}

// =====================
// Proxy Management Commands
// =====================

/// Add a proxy to the pool
#[tauri::command]
pub async fn add_proxy(
    state: tauri::State<'_, SettingsState>,
    proxy: ProxyConfig,
) -> Result<(), String> {
    let mut settings = state.settings.write().await;
    settings.proxy_pool.add_proxy(proxy)
}

/// Update an existing proxy in the pool
#[tauri::command]
pub async fn update_proxy(
    state: tauri::State<'_, SettingsState>,
    old_id: String,
    proxy: ProxyConfig,
) -> Result<(), String> {
    let mut settings = state.settings.write().await;
    settings.proxy_pool.update_proxy(&old_id, proxy)
}

/// Delete a proxy from the pool
#[tauri::command]
pub async fn delete_proxy(
    state: tauri::State<'_, SettingsState>,
    id: String,
) -> Result<bool, String> {
    let mut settings = state.settings.write().await;
    Ok(settings.proxy_pool.remove_proxy(&id))
}

/// Get all proxies from the pool
#[tauri::command]
pub async fn get_proxies(
    state: tauri::State<'_, SettingsState>,
) -> Result<Vec<ProxyConfig>, String> {
    let settings = state.settings.read().await;
    Ok(settings.proxy_pool.proxies.clone())
}

/// Clear all proxies from the pool
#[tauri::command]
pub async fn clear_proxies(
    state: tauri::State<'_, SettingsState>,
) -> Result<(), String> {
    let mut settings = state.settings.write().await;
    settings.proxy_pool.clear();
    Ok(())
}

/// Get the entire proxy pool configuration
#[tauri::command]
pub async fn get_proxy_pool(
    state: tauri::State<'_, SettingsState>,
) -> Result<ProxyPool, String> {
    let settings = state.settings.read().await;
    Ok(settings.proxy_pool.clone())
}

/// Update proxy pool configuration (enabled, rotation_mode)
#[tauri::command]
pub async fn update_proxy_pool_config(
    state: tauri::State<'_, SettingsState>,
    enabled: Option<bool>,
    rotation_mode: Option<RotationMode>,
) -> Result<(), String> {
    let mut settings = state.settings.write().await;
    if let Some(e) = enabled {
        settings.proxy_pool.enabled = e;
    }
    if let Some(rm) = rotation_mode {
        settings.proxy_pool.rotation_mode = rm;
    }
    Ok(())
}

/// Assign a proxy to a specific domain
#[tauri::command]
pub async fn assign_domain_proxy(
    state: tauri::State<'_, SettingsState>,
    domain: String,
    proxy_id: String,
) -> Result<(), String> {
    let mut settings = state.settings.write().await;
    settings.proxy_pool.assign_domain(domain, proxy_id)
}

/// Remove a domain proxy assignment
#[tauri::command]
pub async fn unassign_domain_proxy(
    state: tauri::State<'_, SettingsState>,
    domain: String,
) -> Result<bool, String> {
    let mut settings = state.settings.write().await;
    Ok(settings.proxy_pool.unassign_domain(&domain))
}

#[cfg(test)]
mod tests {
    use super::*;

    // =====================
    // ProxyConfig Tests
    // =====================

    #[test]
    fn test_proxy_config_new() {
        let proxy = ProxyConfig::new("192.168.1.1".to_string(), 8080);
        assert_eq!(proxy.host, "192.168.1.1");
        assert_eq!(proxy.port, 8080);
        assert_eq!(proxy.username, None);
        assert_eq!(proxy.password, None);
    }

    #[test]
    fn test_proxy_config_with_auth() {
        let proxy = ProxyConfig::with_auth(
            "proxy.example.com".to_string(),
            1080,
            "user".to_string(),
            "pass".to_string(),
        );
        assert_eq!(proxy.host, "proxy.example.com");
        assert_eq!(proxy.port, 1080);
        assert_eq!(proxy.username, Some("user".to_string()));
        assert_eq!(proxy.password, Some("pass".to_string()));
    }

    #[test]
    fn test_proxy_config_id() {
        let proxy = ProxyConfig::new("192.168.1.1".to_string(), 8080);
        assert_eq!(proxy.id(), "192.168.1.1:8080");
    }

    #[test]
    fn test_proxy_config_parse_host_port() {
        let proxy = ProxyConfig::parse("192.168.1.1:8080").unwrap();
        assert_eq!(proxy.host, "192.168.1.1");
        assert_eq!(proxy.port, 8080);
        assert_eq!(proxy.username, None);
        assert_eq!(proxy.password, None);
    }

    #[test]
    fn test_proxy_config_parse_hostname_port() {
        let proxy = ProxyConfig::parse("proxy.example.com:1080").unwrap();
        assert_eq!(proxy.host, "proxy.example.com");
        assert_eq!(proxy.port, 1080);
        assert_eq!(proxy.username, None);
        assert_eq!(proxy.password, None);
    }

    #[test]
    fn test_proxy_config_parse_with_auth() {
        let proxy = ProxyConfig::parse("socks5://user:pass@1.2.3.4:1080").unwrap();
        assert_eq!(proxy.host, "1.2.3.4");
        assert_eq!(proxy.port, 1080);
        assert_eq!(proxy.username, Some("user".to_string()));
        assert_eq!(proxy.password, Some("pass".to_string()));
    }

    #[test]
    fn test_proxy_config_parse_socks5_without_auth() {
        let proxy = ProxyConfig::parse("socks5://192.168.1.1:8080").unwrap();
        assert_eq!(proxy.host, "192.168.1.1");
        assert_eq!(proxy.port, 8080);
        assert_eq!(proxy.username, None);
        assert_eq!(proxy.password, None);
    }

    #[test]
    fn test_proxy_config_parse_ipv6() {
        let proxy = ProxyConfig::parse("[::1]:1080").unwrap();
        assert_eq!(proxy.host, "::1");
        assert_eq!(proxy.port, 1080);
    }

    #[test]
    fn test_proxy_config_parse_ipv6_with_auth() {
        let proxy = ProxyConfig::parse("socks5://user:pass@[::1]:1080").unwrap();
        assert_eq!(proxy.host, "::1");
        assert_eq!(proxy.port, 1080);
        assert_eq!(proxy.username, Some("user".to_string()));
        assert_eq!(proxy.password, Some("pass".to_string()));
    }

    #[test]
    fn test_proxy_config_parse_invalid_missing_port() {
        let result = ProxyConfig::parse("192.168.1.1");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("missing port"));
    }

    #[test]
    fn test_proxy_config_parse_invalid_port() {
        let result = ProxyConfig::parse("192.168.1.1:abc");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid port"));
    }

    #[test]
    fn test_proxy_config_parse_port_zero() {
        let result = ProxyConfig::parse("192.168.1.1:0");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Port cannot be 0"));
    }

    #[test]
    fn test_proxy_config_parse_empty_host() {
        let result = ProxyConfig::parse(":8080");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Host cannot be empty"));
    }

    #[test]
    fn test_proxy_config_parse_invalid_auth_format() {
        let result = ProxyConfig::parse("socks5://user@192.168.1.1:8080");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("user:pass"));
    }

    #[test]
    fn test_proxy_config_parse_empty_credentials() {
        let result = ProxyConfig::parse("socks5://:pass@192.168.1.1:8080");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("empty"));
    }

    #[test]
    fn test_proxy_config_parse_whitespace() {
        let proxy = ProxyConfig::parse("  192.168.1.1:8080  ").unwrap();
        assert_eq!(proxy.host, "192.168.1.1");
        assert_eq!(proxy.port, 8080);
    }

    #[test]
    fn test_proxy_config_validate_valid_ipv4() {
        let proxy = ProxyConfig::new("192.168.1.1".to_string(), 8080);
        assert!(proxy.validate().is_ok());
    }

    #[test]
    fn test_proxy_config_validate_valid_hostname() {
        let proxy = ProxyConfig::new("proxy.example.com".to_string(), 1080);
        assert!(proxy.validate().is_ok());
    }

    #[test]
    fn test_proxy_config_validate_valid_ipv6() {
        let mut proxy = ProxyConfig::new("::1".to_string(), 1080);
        assert!(proxy.validate().is_ok());

        proxy.host = "2001:db8::1".to_string();
        assert!(proxy.validate().is_ok());
    }

    #[test]
    fn test_proxy_config_validate_empty_host() {
        let proxy = ProxyConfig {
            host: "".to_string(),
            port: 8080,
            username: None,
            password: None,
        };
        let result = proxy.validate();
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Host cannot be empty"));
    }

    #[test]
    fn test_proxy_config_validate_port_zero() {
        let proxy = ProxyConfig {
            host: "192.168.1.1".to_string(),
            port: 0,
            username: None,
            password: None,
        };
        let result = proxy.validate();
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Port cannot be 0"));
    }

    #[test]
    fn test_proxy_config_validate_username_without_password() {
        let proxy = ProxyConfig {
            host: "192.168.1.1".to_string(),
            port: 8080,
            username: Some("user".to_string()),
            password: None,
        };
        let result = proxy.validate();
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Password required"));
    }

    #[test]
    fn test_proxy_config_validate_password_without_username() {
        let proxy = ProxyConfig {
            host: "192.168.1.1".to_string(),
            port: 8080,
            username: None,
            password: Some("pass".to_string()),
        };
        let result = proxy.validate();
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Username required"));
    }

    #[test]
    fn test_proxy_config_validate_invalid_hostname() {
        let proxy = ProxyConfig {
            host: "-invalid-host".to_string(),
            port: 8080,
            username: None,
            password: None,
        };
        let result = proxy.validate();
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid host"));
    }

    #[test]
    fn test_proxy_config_serialize_deserialize() {
        let proxy = ProxyConfig::with_auth(
            "proxy.example.com".to_string(),
            1080,
            "user".to_string(),
            "pass".to_string(),
        );

        let json = serde_json::to_string(&proxy).unwrap();
        let deserialized: ProxyConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(proxy, deserialized);
    }

    #[test]
    fn test_proxy_config_serialize_camel_case() {
        let proxy = ProxyConfig::new("192.168.1.1".to_string(), 8080);
        let json = serde_json::to_string(&proxy).unwrap();

        // Verify camelCase field names
        assert!(json.contains("\"host\""));
        assert!(json.contains("\"port\""));
        assert!(json.contains("\"username\""));
        assert!(json.contains("\"password\""));
    }

    // =====================
    // RotationMode Tests
    // =====================

    #[test]
    fn test_rotation_mode_default() {
        let mode = RotationMode::default();
        assert_eq!(mode, RotationMode::Manual);
    }

    #[test]
    fn test_rotation_mode_serialize() {
        let mode = RotationMode::Automatic;
        let json = serde_json::to_string(&mode).unwrap();
        assert_eq!(json, "\"automatic\"");
    }

    #[test]
    fn test_rotation_mode_deserialize() {
        let mode: RotationMode = serde_json::from_str("\"perDomain\"").unwrap();
        assert_eq!(mode, RotationMode::PerDomain);
    }

    // =====================
    // ProxyPool Tests
    // =====================

    #[test]
    fn test_proxy_pool_new() {
        let pool = ProxyPool::new();
        assert!(pool.is_empty());
        assert_eq!(pool.len(), 0);
        assert!(!pool.enabled);
        assert_eq!(pool.rotation_mode, RotationMode::Manual);
    }

    #[test]
    fn test_proxy_pool_add_proxy() {
        let mut pool = ProxyPool::new();
        let proxy = ProxyConfig::new("192.168.1.1".to_string(), 8080);

        assert!(pool.add_proxy(proxy).is_ok());
        assert_eq!(pool.len(), 1);
        assert!(pool.has_proxies());
    }

    #[test]
    fn test_proxy_pool_add_duplicate_proxy() {
        let mut pool = ProxyPool::new();
        let proxy1 = ProxyConfig::new("192.168.1.1".to_string(), 8080);
        let proxy2 = ProxyConfig::new("192.168.1.1".to_string(), 8080);

        assert!(pool.add_proxy(proxy1).is_ok());
        let result = pool.add_proxy(proxy2);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already exists"));
    }

    #[test]
    fn test_proxy_pool_add_invalid_proxy() {
        let mut pool = ProxyPool::new();
        let proxy = ProxyConfig {
            host: "".to_string(),
            port: 8080,
            username: None,
            password: None,
        };

        let result = pool.add_proxy(proxy);
        assert!(result.is_err());
    }

    #[test]
    fn test_proxy_pool_remove_proxy() {
        let mut pool = ProxyPool::new();
        let proxy = ProxyConfig::new("192.168.1.1".to_string(), 8080);
        pool.add_proxy(proxy).unwrap();

        assert!(pool.remove_proxy("192.168.1.1:8080"));
        assert!(pool.is_empty());
    }

    #[test]
    fn test_proxy_pool_remove_nonexistent() {
        let mut pool = ProxyPool::new();
        assert!(!pool.remove_proxy("192.168.1.1:8080"));
    }

    #[test]
    fn test_proxy_pool_get_proxy() {
        let mut pool = ProxyPool::new();
        let proxy = ProxyConfig::new("192.168.1.1".to_string(), 8080);
        pool.add_proxy(proxy).unwrap();

        let retrieved = pool.get_proxy("192.168.1.1:8080");
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().host, "192.168.1.1");
    }

    #[test]
    fn test_proxy_pool_get_proxy_ids() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();

        let ids = pool.get_proxy_ids();
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&"192.168.1.1:8080".to_string()));
        assert!(ids.contains(&"192.168.1.2:8080".to_string()));
    }

    #[test]
    fn test_proxy_pool_update_proxy() {
        let mut pool = ProxyPool::new();
        let proxy = ProxyConfig::new("192.168.1.1".to_string(), 8080);
        pool.add_proxy(proxy).unwrap();

        let updated = ProxyConfig::new("192.168.1.1".to_string(), 9090);
        assert!(pool.update_proxy("192.168.1.1:8080", updated).is_ok());

        let retrieved = pool.get_proxy("192.168.1.1:9090");
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().port, 9090);
    }

    #[test]
    fn test_proxy_pool_update_nonexistent() {
        let mut pool = ProxyPool::new();
        let updated = ProxyConfig::new("192.168.1.1".to_string(), 9090);

        let result = pool.update_proxy("192.168.1.1:8080", updated);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn test_proxy_pool_clear() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();

        pool.clear();
        assert!(pool.is_empty());
    }

    #[test]
    fn test_proxy_pool_domain_assignment() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();

        // Assign proxy to gmail.com
        assert!(pool.assign_domain("gmail.com".to_string(), "192.168.1.1:8080".to_string()).is_ok());

        // Get assigned proxy
        let gmail_proxy = pool.get_domain_proxy("gmail.com");
        assert!(gmail_proxy.is_some());
        assert_eq!(gmail_proxy.unwrap().host, "192.168.1.1");

        // Unassigned domain returns None
        assert!(pool.get_domain_proxy("yahoo.com").is_none());
    }

    #[test]
    fn test_proxy_pool_domain_assignment_case_insensitive() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();

        pool.assign_domain("GMAIL.COM".to_string(), "192.168.1.1:8080".to_string()).unwrap();

        // Should work with lowercase lookup
        let proxy = pool.get_domain_proxy("gmail.com");
        assert!(proxy.is_some());
    }

    #[test]
    fn test_proxy_pool_assign_nonexistent_proxy() {
        let mut pool = ProxyPool::new();

        let result = pool.assign_domain("gmail.com".to_string(), "192.168.1.1:8080".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn test_proxy_pool_unassign_domain() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.assign_domain("gmail.com".to_string(), "192.168.1.1:8080".to_string()).unwrap();

        assert!(pool.unassign_domain("gmail.com"));
        assert!(pool.get_domain_proxy("gmail.com").is_none());
    }

    #[test]
    fn test_proxy_pool_remove_proxy_clears_assignments() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.assign_domain("gmail.com".to_string(), "192.168.1.1:8080".to_string()).unwrap();

        pool.remove_proxy("192.168.1.1:8080");

        // Assignment should be removed
        assert!(pool.get_domain_proxy("gmail.com").is_none());
    }

    #[test]
    fn test_proxy_pool_update_proxy_updates_assignments() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        pool.assign_domain("gmail.com".to_string(), "192.168.1.1:8080".to_string()).unwrap();

        // Update proxy to new port
        let updated = ProxyConfig::new("192.168.1.1".to_string(), 9090);
        pool.update_proxy("192.168.1.1:8080", updated).unwrap();

        // Assignment should be updated
        let gmail_proxy = pool.get_domain_proxy("gmail.com");
        assert!(gmail_proxy.is_some());
        assert_eq!(gmail_proxy.unwrap().id(), "192.168.1.1:9090");
    }

    #[test]
    fn test_proxy_pool_serialize_deserialize() {
        let mut pool = ProxyPool::new();
        pool.enabled = true;
        pool.rotation_mode = RotationMode::Automatic;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();

        let json = serde_json::to_string(&pool).unwrap();
        let deserialized: ProxyPool = serde_json::from_str(&json).unwrap();

        assert_eq!(pool.enabled, deserialized.enabled);
        assert_eq!(pool.rotation_mode, deserialized.rotation_mode);
        assert_eq!(pool.len(), deserialized.len());
    }

    #[test]
    fn test_proxy_pool_default_domain_assignments() {
        // Test that deserialization works without domainAssignments field
        let json = r#"{"proxies":[{"host":"192.168.1.1","port":8080,"username":null,"password":null}],"enabled":true,"rotationMode":"manual"}"#;
        let pool: ProxyPool = serde_json::from_str(json).unwrap();

        assert_eq!(pool.len(), 1);
        assert!(pool.domain_assignments.is_empty());
    }

    // =====================
    // Settings with ProxyPool Tests
    // =====================

    #[test]
    fn test_settings_default_has_proxy_pool() {
        let settings = Settings::default();
        assert!(!settings.proxy_pool.enabled);
        assert_eq!(settings.proxy_pool.rotation_mode, RotationMode::Manual);
        assert!(settings.proxy_pool.proxies.is_empty());
    }

    #[test]
    fn test_settings_serialize_with_proxy_pool() {
        let settings = Settings::default();
        let json = serde_json::to_string(&settings).unwrap();

        // Verify proxy_pool is in the JSON (uses snake_case in backend Settings)
        assert!(json.contains("proxy_pool"));
        // ProxyPool fields use camelCase due to #[serde(rename_all = "camelCase")]
        assert!(json.contains("proxies"));
        assert!(json.contains("enabled"));
        assert!(json.contains("rotationMode"));
    }

    #[test]
    fn test_settings_deserialize_with_proxy_pool() {
        // Settings uses snake_case, but ProxyPool uses camelCase
        let json = r#"{
            "validation_mode": "standard",
            "timeout_ms": 30000,
            "concurrency": 5,
            "max_retries": 3,
            "auto_save_interval": 10,
            "history_retention_days": 90,
            "rate_limiter": {"max_per_second": 1, "max_per_minute": 60},
            "proxy_pool": {
                "proxies": [{"host": "192.168.1.1", "port": 8080, "username": null, "password": null}],
                "enabled": true,
                "rotationMode": "automatic",
                "domainAssignments": {}
            }
        }"#;
        let settings: Settings = serde_json::from_str(json).unwrap();

        assert!(settings.proxy_pool.enabled);
        assert_eq!(settings.proxy_pool.rotation_mode, RotationMode::Automatic);
        assert_eq!(settings.proxy_pool.proxies.len(), 1);
        assert_eq!(settings.proxy_pool.proxies[0].host, "192.168.1.1");
        assert_eq!(settings.proxy_pool.proxies[0].port, 8080);
    }

    #[test]
    fn test_settings_deserialize_without_proxy_pool() {
        // Test that settings deserialize correctly even without proxyPool field
        let json = r#"{
            "validation_mode": "standard",
            "timeout_ms": 30000,
            "concurrency": 5,
            "max_retries": 3,
            "auto_save_interval": 10,
            "history_retention_days": 90,
            "rate_limiter": {"max_per_second": 1, "max_per_minute": 60}
        }"#;
        let settings: Settings = serde_json::from_str(json).unwrap();

        // proxyPool should use default
        assert!(!settings.proxy_pool.enabled);
        assert!(settings.proxy_pool.proxies.is_empty());
    }

    // =====================
    // Proxy Command Logic Tests
    // =====================

    #[test]
    fn test_add_proxy_command_logic() {
        let mut settings = Settings::default();
        let proxy = ProxyConfig::new("192.168.1.1".to_string(), 8080);

        // Simulate add_proxy command
        let result = settings.proxy_pool.add_proxy(proxy);
        assert!(result.is_ok());
        assert_eq!(settings.proxy_pool.proxies.len(), 1);
    }

    #[test]
    fn test_add_proxy_duplicate_command_logic() {
        let mut settings = Settings::default();
        let proxy1 = ProxyConfig::new("192.168.1.1".to_string(), 8080);
        let proxy2 = ProxyConfig::new("192.168.1.1".to_string(), 8080);

        settings.proxy_pool.add_proxy(proxy1).unwrap();
        let result = settings.proxy_pool.add_proxy(proxy2);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already exists"));
    }

    #[test]
    fn test_update_proxy_command_logic() {
        let mut settings = Settings::default();
        settings.proxy_pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();

        let updated = ProxyConfig::new("192.168.1.1".to_string(), 9090);
        let result = settings.proxy_pool.update_proxy("192.168.1.1:8080", updated);
        assert!(result.is_ok());

        // Verify update
        let proxy = settings.proxy_pool.get_proxy("192.168.1.1:9090");
        assert!(proxy.is_some());
        assert_eq!(proxy.unwrap().port, 9090);
    }

    #[test]
    fn test_update_proxy_not_found_command_logic() {
        let mut settings = Settings::default();
        let updated = ProxyConfig::new("192.168.1.1".to_string(), 9090);

        let result = settings.proxy_pool.update_proxy("192.168.1.1:8080", updated);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn test_delete_proxy_command_logic() {
        let mut settings = Settings::default();
        settings.proxy_pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();

        // Simulate delete_proxy command
        let removed = settings.proxy_pool.remove_proxy("192.168.1.1:8080");
        assert!(removed);
        assert!(settings.proxy_pool.proxies.is_empty());
    }

    #[test]
    fn test_delete_proxy_not_found_command_logic() {
        let mut settings = Settings::default();

        let removed = settings.proxy_pool.remove_proxy("192.168.1.1:8080");
        assert!(!removed);
    }

    #[test]
    fn test_get_proxies_command_logic() {
        let mut settings = Settings::default();
        settings.proxy_pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        settings.proxy_pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();

        // Simulate get_proxies command
        let proxies = settings.proxy_pool.proxies.clone();
        assert_eq!(proxies.len(), 2);
    }

    #[test]
    fn test_clear_proxies_command_logic() {
        let mut settings = Settings::default();
        settings.proxy_pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        settings.proxy_pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        settings.proxy_pool.assign_domain("gmail.com".to_string(), "192.168.1.1:8080".to_string()).unwrap();

        // Simulate clear_proxies command
        settings.proxy_pool.clear();

        assert!(settings.proxy_pool.proxies.is_empty());
        assert!(settings.proxy_pool.domain_assignments.is_empty());
    }

    #[test]
    fn test_get_proxy_pool_command_logic() {
        let mut settings = Settings::default();
        settings.proxy_pool.enabled = true;
        settings.proxy_pool.rotation_mode = RotationMode::Automatic;
        settings.proxy_pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();

        // Simulate get_proxy_pool command
        let pool = settings.proxy_pool.clone();
        assert!(pool.enabled);
        assert_eq!(pool.rotation_mode, RotationMode::Automatic);
        assert_eq!(pool.proxies.len(), 1);
    }

    #[test]
    fn test_update_proxy_pool_config_command_logic() {
        let mut settings = Settings::default();

        // Simulate update_proxy_pool_config command - enable proxy
        settings.proxy_pool.enabled = true;
        settings.proxy_pool.rotation_mode = RotationMode::Automatic;

        assert!(settings.proxy_pool.enabled);
        assert_eq!(settings.proxy_pool.rotation_mode, RotationMode::Automatic);
    }

    #[test]
    fn test_assign_domain_proxy_command_logic() {
        let mut settings = Settings::default();
        settings.proxy_pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();

        // Simulate assign_domain_proxy command
        let result = settings.proxy_pool.assign_domain("gmail.com".to_string(), "192.168.1.1:8080".to_string());
        assert!(result.is_ok());

        let assigned = settings.proxy_pool.get_domain_proxy("gmail.com");
        assert!(assigned.is_some());
        assert_eq!(assigned.unwrap().host, "192.168.1.1");
    }

    #[test]
    fn test_unassign_domain_proxy_command_logic() {
        let mut settings = Settings::default();
        settings.proxy_pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        settings.proxy_pool.assign_domain("gmail.com".to_string(), "192.168.1.1:8080".to_string()).unwrap();

        // Simulate unassign_domain_proxy command
        let removed = settings.proxy_pool.unassign_domain("gmail.com");
        assert!(removed);

        let assigned = settings.proxy_pool.get_domain_proxy("gmail.com");
        assert!(assigned.is_none());
    }
}

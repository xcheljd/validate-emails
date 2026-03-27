use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use std::sync::Arc;
use std::path::PathBuf;
use std::fs;
use std::net::{Ipv4Addr, Ipv6Addr};

/// Generate a pseudo-random number in range [0, max) using system time.
/// This is a simple deterministic "random" function for weighted selection
/// that doesn't require the rand crate.
fn pseudo_random(max: u32) -> u32 {
    if max == 0 {
        return 0;
    }
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
    nanos % max
}

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
#[allow(dead_code)]
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

/// Health status of a proxy based on success rate
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum HealthStatus {
    /// Proxy is healthy with >90% success rate
    #[default]
    Healthy,
    /// Proxy is degraded with 50-90% success rate
    Degraded,
    /// Proxy has failed with <50% success rate
    Failed,
}

/// Statistics tracking for a single proxy
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct ProxyStats {
    /// Total number of validation attempts through this proxy
    pub attempts: u32,
    /// Number of successful validations
    pub successes: u32,
    /// Number of failed validations
    pub failures: u32,
    /// Number of consecutive failures (resets on success)
    pub consecutive_failures: u32,
    /// Timestamp (Unix epoch seconds) when cooldown ends. None if not in cooldown.
    #[serde(default)]
    pub cooldown_until: Option<i64>,
}

impl ProxyStats {
    /// Create new empty stats
    pub fn new() -> Self {
        Self::default()
    }

    /// Record a successful validation
    pub fn record_success(&mut self) {
        self.attempts += 1;
        self.successes += 1;
        self.consecutive_failures = 0;
    }

    /// Record a failed validation
    pub fn record_failure(&mut self) {
        self.attempts += 1;
        self.failures += 1;
        self.consecutive_failures += 1;
    }

    /// Calculate success rate as a percentage (0-100)
    /// Returns 100 if no attempts have been made (neutral for new proxies)
    pub fn success_rate(&self) -> u32 {
        if self.attempts == 0 {
            return 100; // New proxies start with neutral/healthy status
        }
        (self.successes * 100) / self.attempts
    }

    /// Get the health status based on success rate
    /// - Healthy: >90%
    /// - Degraded: 50-90%
    /// - Failed: <50%
    pub fn health_status(&self) -> HealthStatus {
        let rate = self.success_rate();
        if rate >= 90 {
            HealthStatus::Healthy
        } else if rate >= 50 {
            HealthStatus::Degraded
        } else {
            HealthStatus::Failed
        }
    }

    /// Check if proxy is "bad" (3 consecutive failures)
    pub fn is_bad(&self) -> bool {
        self.consecutive_failures >= 3
    }

    /// Enter cooldown mode for the specified duration (in seconds)
    pub fn enter_cooldown(&mut self, duration_secs: u64) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        self.cooldown_until = Some(now + duration_secs as i64);
    }

    /// Check if proxy is currently in cooldown
    pub fn is_in_cooldown(&self) -> bool {
        if let Some(cooldown_until) = self.cooldown_until {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;
            return now < cooldown_until;
        }
        false
    }

    /// Get remaining cooldown time in seconds. Returns 0 if not in cooldown.
    pub fn remaining_cooldown_secs(&self) -> u64 {
        if let Some(cooldown_until) = self.cooldown_until {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;
            let remaining = cooldown_until - now;
            if remaining > 0 {
                return remaining as u64;
            }
        }
        0
    }

    /// Clear cooldown (manual bypass)
    pub fn clear_cooldown(&mut self) {
        self.cooldown_until = None;
    }

    /// Reset all stats
    pub fn reset(&mut self) {
        *self = Self::default();
    }

    /// Get the weight for weighted rotation selection.
    /// - Returns 0 if in cooldown (proxy should not be selected)
    /// - Returns 50 for new proxies (no attempts) - neutral weight
    /// - Returns success_rate (0-100) for proxies with data
    pub fn get_weight(&self) -> u32 {
        if self.is_in_cooldown() {
            return 0;
        }
        if self.attempts == 0 {
            return 50; // Neutral weight for new proxies
        }
        self.success_rate()
    }
}

/// Pool of proxies with configuration for rotation and management
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
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
    /// Statistics per proxy (proxy ID -> stats)
    #[serde(default)]
    pub proxy_stats: std::collections::HashMap<String, ProxyStats>,
    /// Cooldown duration in seconds when proxy fails (default: 60, range: 30-300)
    #[serde(default = "default_cooldown_duration")]
    pub cooldown_duration_secs: u64,
}

impl Default for ProxyPool {
    fn default() -> Self {
        Self {
            proxies: Vec::new(),
            enabled: false,
            rotation_mode: RotationMode::default(),
            domain_assignments: std::collections::HashMap::new(),
            proxy_stats: std::collections::HashMap::new(),
            cooldown_duration_secs: default_cooldown_duration(),
        }
    }
}

/// Default cooldown duration (60 seconds)
fn default_cooldown_duration() -> u64 {
    60
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
        // Also remove stats
        self.proxy_stats.remove(id);
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
        self.proxy_stats.clear();
    }

    /// Get stats for a specific proxy (returns owned value)
    pub fn get_stats(&self, proxy_id: &str) -> ProxyStats {
        self.proxy_stats.get(proxy_id).cloned().unwrap_or_default()
    }

    /// Get mutable stats for a specific proxy
    pub fn get_stats_mut(&mut self, proxy_id: &str) -> &mut ProxyStats {
        self.proxy_stats.entry(proxy_id.to_string()).or_default()
    }

    /// Record a successful validation for a proxy
    /// Also clears cooldown if proxy was in cooldown
    pub fn record_success(&mut self, proxy_id: &str) {
        let stats = self.get_stats_mut(proxy_id);
        stats.record_success();
        stats.clear_cooldown();  // Clear cooldown on success
    }

    /// Record a failed validation for a proxy
    /// Automatically enters cooldown if proxy becomes "bad" (3 consecutive failures)
    pub fn record_failure(&mut self, proxy_id: &str) {
        // Get cooldown duration first to avoid borrow issues
        let cooldown_duration = self.cooldown_duration_secs;
        let stats = self.get_stats_mut(proxy_id);
        stats.record_failure();
        // Enter cooldown if this failure made the proxy "bad"
        if stats.is_bad() {
            stats.enter_cooldown(cooldown_duration);
        }
    }

    /// Get all proxy stats
    pub fn get_all_stats(&self) -> &std::collections::HashMap<String, ProxyStats> {
        &self.proxy_stats
    }

    /// Reset stats for a specific proxy
    pub fn reset_stats(&mut self, proxy_id: &str) {
        if let Some(stats) = self.proxy_stats.get_mut(proxy_id) {
            stats.reset();
        }
    }

    /// Reset all proxy stats
    pub fn reset_all_stats(&mut self) {
        self.proxy_stats.clear();
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

    /// Check if a proxy is "bad" (3 consecutive failures)
    pub fn is_proxy_bad(&self, proxy_id: &str) -> bool {
        self.proxy_stats
            .get(proxy_id)
            .map(|stats| stats.is_bad())
            .unwrap_or(false)
    }

    /// Check if a proxy is currently in cooldown
    pub fn is_proxy_in_cooldown(&self, proxy_id: &str) -> bool {
        self.proxy_stats
            .get(proxy_id)
            .map(|stats| stats.is_in_cooldown())
            .unwrap_or(false)
    }

    /// Check if a proxy is available (not bad AND not in cooldown)
    pub fn is_proxy_available(&self, proxy_id: &str) -> bool {
        !self.is_proxy_bad(proxy_id) && !self.is_proxy_in_cooldown(proxy_id)
    }

    /// Get remaining cooldown time for a proxy in seconds
    pub fn get_remaining_cooldown(&self, proxy_id: &str) -> u64 {
        self.proxy_stats
            .get(proxy_id)
            .map(|stats| stats.remaining_cooldown_secs())
            .unwrap_or(0)
    }

    /// Manually bypass cooldown for a proxy (Retry Now button)
    pub fn bypass_cooldown(&mut self, proxy_id: &str) {
        if let Some(stats) = self.proxy_stats.get_mut(proxy_id) {
            stats.clear_cooldown();
            // Also reset consecutive failures to give the proxy a fresh start
            stats.consecutive_failures = 0;
        }
    }

    /// Set the cooldown duration (clamped to 30-300 seconds)
    pub fn set_cooldown_duration(&mut self, duration_secs: u64) {
        self.cooldown_duration_secs = duration_secs.clamp(30, 300);
    }

    /// Get list of available (non-bad, not in cooldown) proxies
    /// Bad proxies (3+ consecutive failures) and proxies in cooldown are excluded from this list
    pub fn get_available_proxies(&self) -> Vec<ProxyConfig> {
        self.proxies
            .iter()
            .filter(|p| self.is_proxy_available(&p.id()))
            .cloned()
            .collect()
    }

    /// Check if there are any available (non-bad, not in cooldown) proxies
    pub fn has_available_proxies(&self) -> bool {
        self.proxies.iter().any(|p| self.is_proxy_available(&p.id()))
    }

    /// Get the weight for a specific proxy (used for weighted rotation)
    /// - Returns 0 if proxy is in cooldown
    /// - Returns 50 for new proxies (no attempts)
    /// - Returns success_rate (0-100) for proxies with data
    pub fn get_proxy_weight(&self, proxy_id: &str) -> u32 {
        self.proxy_stats
            .get(proxy_id)
            .map(|stats| stats.get_weight())
            .unwrap_or(50) // New proxy - neutral weight
    }

    /// Check if all available proxies have equal weights
    fn all_weights_equal(&self, available: &[ProxyConfig]) -> bool {
        if available.len() <= 1 {
            return true;
        }
        let first_weight = self.get_proxy_weight(&available[0].id());
        available.iter().all(|p| self.get_proxy_weight(&p.id()) == first_weight)
    }

    /// Get the next available proxy for automatic rotation
    /// Uses weighted selection based on success rates when weights differ.
    /// Falls back to round-robin when all weights are equal.
    /// Bad proxies (3+ consecutive failures) and proxies in cooldown are excluded.
    /// Returns None if no proxies are available.
    pub fn get_next_proxy(&mut self, rotation_index: &mut usize) -> Option<ProxyConfig> {
        let available = self.get_available_proxies();
        if available.is_empty() {
            return None;
        }

        // Check if all weights are equal - if so, use round-robin
        if self.all_weights_equal(&available) {
            let proxy = available[*rotation_index % available.len()].clone();
            *rotation_index = (*rotation_index + 1) % available.len();
            return Some(proxy);
        }

        // Use weighted selection
        self.select_weighted_proxy(&available)
    }

    /// Select a proxy using weighted random selection.
    /// Proxies with higher success rates are selected more frequently.
    /// Selection probability is proportional to weight.
    fn select_weighted_proxy(&self, available: &[ProxyConfig]) -> Option<ProxyConfig> {
        if available.is_empty() {
            return None;
        }

        // Calculate total weight
        let weights: Vec<u32> = available.iter()
            .map(|p| self.get_proxy_weight(&p.id()))
            .collect();
        let total_weight: u32 = weights.iter().sum();

        // If total weight is 0, fall back to first proxy
        if total_weight == 0 {
            return Some(available[0].clone());
        }

        // Generate a pseudo-random number using system time nanos
        let random_value = pseudo_random(total_weight);

        // Find the selected proxy based on cumulative weight
        let mut cumulative = 0u32;
        for (i, weight) in weights.iter().enumerate() {
            cumulative += weight;
            if random_value < cumulative {
                return Some(available[i].clone());
            }
        }

        // Fallback to last proxy (shouldn't happen if logic is correct)
        Some(available.last().unwrap().clone())
    }

    /// Get the proxy to use for a specific email based on rotation mode
    /// - Manual: returns the first available (non-bad, not in cooldown) proxy
    /// - Automatic: rotates through available proxies using the rotation_index
    /// - PerDomain: uses domain assignment if available and proxy is available, falls back to first available proxy
    ///
    /// Bad proxies (3+ consecutive failures) and proxies in cooldown are excluded from rotation
    /// Returns None if no proxies are available
    pub fn get_proxy_for_email(
        &mut self,
        email: &str,
        rotation_index: &mut usize,
    ) -> Option<ProxyConfig> {
        if self.proxies.is_empty() {
            return None;
        }

        match self.rotation_mode {
            RotationMode::Manual => {
                // In manual mode, use the first available proxy (skip bad/cooldown ones)
                self.proxies
                    .iter()
                    .find(|p| self.is_proxy_available(&p.id()))
                    .cloned()
            }
            RotationMode::Automatic => {
                // In automatic mode, rotate through available proxies (skip bad/cooldown ones)
                self.get_next_proxy(rotation_index)
            }
            RotationMode::PerDomain => {
                // Extract domain from email
                let domain = email.split('@').next_back().unwrap_or("");
                
                // Check for domain assignment (only if proxy is available)
                if let Some(proxy) = self.get_domain_proxy(domain) {
                    if self.is_proxy_available(&proxy.id()) {
                        return Some(proxy.clone());
                    }
                }

                // Fall back to first available proxy for unassigned domains
                self.proxies
                    .iter()
                    .find(|p| self.is_proxy_available(&p.id()))
                    .cloned()
            }
        }
    }

    /// Get the proxy for a specific domain in PerDomain mode
    /// Returns None if not in PerDomain mode, domain not assigned, proxy is bad/in cooldown, or no proxies
    pub fn get_proxy_by_domain(&self, domain: &str) -> Option<ProxyConfig> {
        if self.rotation_mode != RotationMode::PerDomain {
            return None;
        }
        let proxy = self.get_domain_proxy(domain)?;
        // Don't return bad or cooling down proxies
        if !self.is_proxy_available(&proxy.id()) {
            return None;
        }
        Some(proxy.clone())
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

// =====================
// Proxy Stats Commands
// =====================

/// Get stats for a specific proxy
#[tauri::command]
pub async fn get_proxy_stats(
    state: tauri::State<'_, SettingsState>,
    proxy_id: String,
) -> Result<ProxyStats, String> {
    let settings = state.settings.read().await;
    Ok(settings.proxy_pool.get_stats(&proxy_id))
}

/// Get all proxy stats
#[tauri::command]
pub async fn get_all_proxy_stats(
    state: tauri::State<'_, SettingsState>,
) -> Result<std::collections::HashMap<String, ProxyStats>, String> {
    let settings = state.settings.read().await;
    Ok(settings.proxy_pool.proxy_stats.clone())
}

/// Record a successful validation for a proxy
#[tauri::command]
pub async fn record_proxy_success(
    state: tauri::State<'_, SettingsState>,
    proxy_id: String,
) -> Result<(), String> {
    let mut settings = state.settings.write().await;
    settings.proxy_pool.record_success(&proxy_id);
    Ok(())
}

/// Record a failed validation for a proxy
#[tauri::command]
pub async fn record_proxy_failure(
    state: tauri::State<'_, SettingsState>,
    proxy_id: String,
) -> Result<(), String> {
    let mut settings = state.settings.write().await;
    settings.proxy_pool.record_failure(&proxy_id);
    Ok(())
}

/// Reset stats for a specific proxy
#[tauri::command]
pub async fn reset_proxy_stats(
    state: tauri::State<'_, SettingsState>,
    proxy_id: String,
) -> Result<(), String> {
    let mut settings = state.settings.write().await;
    settings.proxy_pool.reset_stats(&proxy_id);
    Ok(())
}

/// Reset all proxy stats
#[tauri::command]
pub async fn reset_all_proxy_stats(
    state: tauri::State<'_, SettingsState>,
) -> Result<(), String> {
    let mut settings = state.settings.write().await;
    settings.proxy_pool.reset_all_stats();
    Ok(())
}

// =====================
// Cooldown Commands
// =====================

/// Check if a proxy is currently in cooldown
#[tauri::command]
pub async fn is_proxy_in_cooldown(
    state: tauri::State<'_, SettingsState>,
    proxy_id: String,
) -> Result<bool, String> {
    let settings = state.settings.read().await;
    Ok(settings.proxy_pool.is_proxy_in_cooldown(&proxy_id))
}

/// Get remaining cooldown time for a proxy in seconds
#[tauri::command]
pub async fn get_remaining_cooldown(
    state: tauri::State<'_, SettingsState>,
    proxy_id: String,
) -> Result<u64, String> {
    let settings = state.settings.read().await;
    Ok(settings.proxy_pool.get_remaining_cooldown(&proxy_id))
}

/// Manually bypass cooldown for a proxy (Retry Now button)
#[tauri::command]
pub async fn bypass_proxy_cooldown(
    state: tauri::State<'_, SettingsState>,
    proxy_id: String,
) -> Result<(), String> {
    let mut settings = state.settings.write().await;
    settings.proxy_pool.bypass_cooldown(&proxy_id);
    Ok(())
}

/// Get the current cooldown duration setting
#[tauri::command]
pub async fn get_cooldown_duration(
    state: tauri::State<'_, SettingsState>,
) -> Result<u64, String> {
    let settings = state.settings.read().await;
    Ok(settings.proxy_pool.cooldown_duration_secs)
}

/// Set the cooldown duration (clamped to 30-300 seconds)
#[tauri::command]
pub async fn set_cooldown_duration(
    state: tauri::State<'_, SettingsState>,
    duration_secs: u64,
) -> Result<(), String> {
    let mut settings = state.settings.write().await;
    settings.proxy_pool.set_cooldown_duration(duration_secs);
    Ok(())
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
    // Proxy Selection Tests
    // =====================

    #[test]
    fn test_get_next_proxy_empty_pool() {
        let mut pool = ProxyPool::new();
        let mut index = 0;

        let proxy = pool.get_next_proxy(&mut index);
        assert!(proxy.is_none());
    }

    #[test]
    fn test_get_next_proxy_single_proxy() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        let mut index = 0;

        // Should always return the same proxy
        let proxy1 = pool.get_next_proxy(&mut index).unwrap();
        assert_eq!(proxy1.host, "192.168.1.1");

        let proxy2 = pool.get_next_proxy(&mut index).unwrap();
        assert_eq!(proxy2.host, "192.168.1.1");
    }

    #[test]
    fn test_get_next_proxy_rotation() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.3".to_string(), 8080)).unwrap();
        let mut index = 0;

        // Should rotate through proxies in order
        let proxy1 = pool.get_next_proxy(&mut index).unwrap();
        assert_eq!(proxy1.host, "192.168.1.1");

        let proxy2 = pool.get_next_proxy(&mut index).unwrap();
        assert_eq!(proxy2.host, "192.168.1.2");

        let proxy3 = pool.get_next_proxy(&mut index).unwrap();
        assert_eq!(proxy3.host, "192.168.1.3");

        // Should wrap around
        let proxy4 = pool.get_next_proxy(&mut index).unwrap();
        assert_eq!(proxy4.host, "192.168.1.1");
    }

    #[test]
    fn test_get_proxy_for_email_manual_mode() {
        let mut pool = ProxyPool::new();
        pool.rotation_mode = RotationMode::Manual;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        let mut index = 0;

        // Should always return first proxy in manual mode
        let proxy1 = pool.get_proxy_for_email("test@gmail.com", &mut index).unwrap();
        assert_eq!(proxy1.host, "192.168.1.1");

        let proxy2 = pool.get_proxy_for_email("test@yahoo.com", &mut index).unwrap();
        assert_eq!(proxy2.host, "192.168.1.1");

        // Index should not change in manual mode
        assert_eq!(index, 0);
    }

    #[test]
    fn test_get_proxy_for_email_automatic_mode() {
        let mut pool = ProxyPool::new();
        pool.rotation_mode = RotationMode::Automatic;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        let mut index = 0;

        // Should rotate through proxies
        let proxy1 = pool.get_proxy_for_email("test1@example.com", &mut index).unwrap();
        assert_eq!(proxy1.host, "192.168.1.1");

        let proxy2 = pool.get_proxy_for_email("test2@example.com", &mut index).unwrap();
        assert_eq!(proxy2.host, "192.168.1.2");

        let proxy3 = pool.get_proxy_for_email("test3@example.com", &mut index).unwrap();
        assert_eq!(proxy3.host, "192.168.1.1");
    }

    #[test]
    fn test_get_proxy_for_email_per_domain_mode() {
        let mut pool = ProxyPool::new();
        pool.rotation_mode = RotationMode::PerDomain;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.3".to_string(), 8080)).unwrap();
        pool.assign_domain("gmail.com".to_string(), "192.168.1.1:8080".to_string()).unwrap();
        pool.assign_domain("yahoo.com".to_string(), "192.168.1.2:8080".to_string()).unwrap();
        let mut index = 0;

        // Gmail should use proxy 1
        let gmail_proxy = pool.get_proxy_for_email("user@gmail.com", &mut index).unwrap();
        assert_eq!(gmail_proxy.host, "192.168.1.1");

        // Yahoo should use proxy 2
        let yahoo_proxy = pool.get_proxy_for_email("user@yahoo.com", &mut index).unwrap();
        assert_eq!(yahoo_proxy.host, "192.168.1.2");

        // Unassigned domain should fall back to first proxy
        let unknown_proxy = pool.get_proxy_for_email("user@unknown.com", &mut index).unwrap();
        assert_eq!(unknown_proxy.host, "192.168.1.1");
    }

    #[test]
    fn test_get_proxy_for_email_empty_pool() {
        let mut pool = ProxyPool::new();
        let mut index = 0;

        let proxy = pool.get_proxy_for_email("test@example.com", &mut index);
        assert!(proxy.is_none());
    }

    #[test]
    fn test_get_proxy_for_email_disabled_pool() {
        let mut pool = ProxyPool::new();
        pool.enabled = false;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        let mut index = 0;

        // Even if disabled, get_proxy_for_email returns a proxy
        // (the enabled flag should be checked by the caller)
        let proxy = pool.get_proxy_for_email("test@example.com", &mut index);
        assert!(proxy.is_some());
    }

    #[test]
    fn test_get_proxy_by_domain_per_domain_mode() {
        let mut pool = ProxyPool::new();
        pool.rotation_mode = RotationMode::PerDomain;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.assign_domain("gmail.com".to_string(), "192.168.1.1:8080".to_string()).unwrap();

        let proxy = pool.get_proxy_by_domain("gmail.com");
        assert!(proxy.is_some());
        assert_eq!(proxy.unwrap().host, "192.168.1.1");

        let no_proxy = pool.get_proxy_by_domain("yahoo.com");
        assert!(no_proxy.is_none());
    }

    #[test]
    fn test_get_proxy_by_domain_wrong_mode() {
        let mut pool = ProxyPool::new();
        pool.rotation_mode = RotationMode::Automatic;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.assign_domain("gmail.com".to_string(), "192.168.1.1:8080".to_string()).unwrap();

        // Should return None when not in PerDomain mode
        let proxy = pool.get_proxy_by_domain("gmail.com");
        assert!(proxy.is_none());
    }

    #[test]
    fn test_rotation_index_wrapping() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        
        // Start with index at max value that could overflow
        let mut index = usize::MAX - 1;
        pool.rotation_mode = RotationMode::Automatic;

        // Should not panic on overflow
        let proxy1 = pool.get_proxy_for_email("test1@example.com", &mut index).unwrap();
        let proxy2 = pool.get_proxy_for_email("test2@example.com", &mut index).unwrap();
        
        // Just verify it doesn't panic and returns valid proxies
        assert!(proxy1.host.starts_with("192.168.1"));
        assert!(proxy2.host.starts_with("192.168.1"));
    }

    // =====================
    // Bad Proxy Detection Tests
    // =====================

    #[test]
    fn test_is_proxy_bad_no_stats() {
        let pool = ProxyPool::new();
        // Proxy with no stats should not be considered bad
        assert!(!pool.is_proxy_bad("192.168.1.1:8080"));
    }

    #[test]
    fn test_is_proxy_bad_below_threshold() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        
        // 2 consecutive failures - not bad yet
        pool.record_failure("192.168.1.1:8080");
        pool.record_failure("192.168.1.1:8080");
        
        assert!(!pool.is_proxy_bad("192.168.1.1:8080"));
    }

    #[test]
    fn test_is_proxy_bad_at_threshold() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        
        // 3 consecutive failures - now bad
        pool.record_failure("192.168.1.1:8080");
        pool.record_failure("192.168.1.1:8080");
        pool.record_failure("192.168.1.1:8080");
        
        assert!(pool.is_proxy_bad("192.168.1.1:8080"));
    }

    #[test]
    fn test_is_proxy_bad_resets_on_success() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        
        // 3 consecutive failures - now bad
        pool.record_failure("192.168.1.1:8080");
        pool.record_failure("192.168.1.1:8080");
        pool.record_failure("192.168.1.1:8080");
        assert!(pool.is_proxy_bad("192.168.1.1:8080"));
        
        // Success resets consecutive failures
        pool.record_success("192.168.1.1:8080");
        assert!(!pool.is_proxy_bad("192.168.1.1:8080"));
    }

    #[test]
    fn test_get_available_proxies_empty_pool() {
        let pool = ProxyPool::new();
        assert!(pool.get_available_proxies().is_empty());
    }

    #[test]
    fn test_get_available_proxies_all_healthy() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        
        let available = pool.get_available_proxies();
        assert_eq!(available.len(), 2);
    }

    #[test]
    fn test_get_available_proxies_excludes_bad() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.3".to_string(), 8080)).unwrap();
        
        // Mark second proxy as bad (3 failures)
        for _ in 0..3 {
            pool.record_failure("192.168.1.2:8080");
        }
        
        let available = pool.get_available_proxies();
        assert_eq!(available.len(), 2);
        assert!(available.iter().all(|p| p.host != "192.168.1.2"));
    }

    #[test]
    fn test_get_available_proxies_all_bad() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        
        // Mark all proxies as bad
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
            pool.record_failure("192.168.1.2:8080");
        }
        
        let available = pool.get_available_proxies();
        assert!(available.is_empty());
    }

    #[test]
    fn test_has_available_proxies_with_healthy() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        
        assert!(pool.has_available_proxies());
    }

    #[test]
    fn test_has_available_proxies_all_bad() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        
        // Mark as bad
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        
        assert!(!pool.has_available_proxies());
    }

    #[test]
    fn test_get_next_proxy_excludes_bad() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.3".to_string(), 8080)).unwrap();
        
        // Mark second proxy as bad
        for _ in 0..3 {
            pool.record_failure("192.168.1.2:8080");
        }
        
        let mut index = 0;
        
        // Get multiple proxies and verify we never get the bad one
        for _ in 0..10 {
            let proxy = pool.get_next_proxy(&mut index).unwrap();
            assert_ne!(proxy.host, "192.168.1.2");
        }
    }

    #[test]
    fn test_get_next_proxy_all_bad_returns_none() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        
        // Mark all as bad
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
            pool.record_failure("192.168.1.2:8080");
        }
        
        let mut index = 0;
        let proxy = pool.get_next_proxy(&mut index);
        assert!(proxy.is_none());
    }

    #[test]
    fn test_get_proxy_for_email_manual_mode_excludes_bad() {
        let mut pool = ProxyPool::new();
        pool.rotation_mode = RotationMode::Manual;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        
        // Mark first proxy as bad
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        
        let mut index = 0;
        let proxy = pool.get_proxy_for_email("test@example.com", &mut index).unwrap();
        
        // Should return second proxy (first available non-bad)
        assert_eq!(proxy.host, "192.168.1.2");
    }

    #[test]
    fn test_get_proxy_for_email_automatic_mode_excludes_bad() {
        let mut pool = ProxyPool::new();
        pool.rotation_mode = RotationMode::Automatic;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.3".to_string(), 8080)).unwrap();
        
        // Mark second proxy as bad
        for _ in 0..3 {
            pool.record_failure("192.168.1.2:8080");
        }
        
        let mut index = 0;
        
        // All returned proxies should skip the bad one
        for _ in 0..10 {
            let proxy = pool.get_proxy_for_email("test@example.com", &mut index).unwrap();
            assert_ne!(proxy.host, "192.168.1.2");
        }
    }

    #[test]
    fn test_get_proxy_for_email_per_domain_excludes_bad_assigned() {
        let mut pool = ProxyPool::new();
        pool.rotation_mode = RotationMode::PerDomain;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        pool.assign_domain("gmail.com".to_string(), "192.168.1.1:8080".to_string()).unwrap();
        
        // Mark assigned proxy as bad
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        
        let mut index = 0;
        let proxy = pool.get_proxy_for_email("user@gmail.com", &mut index).unwrap();
        
        // Should fall back to second proxy since assigned one is bad
        assert_eq!(proxy.host, "192.168.1.2");
    }

    #[test]
    fn test_get_proxy_for_email_all_bad_returns_none() {
        let mut pool = ProxyPool::new();
        pool.rotation_mode = RotationMode::Automatic;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        
        // Mark all as bad
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
            pool.record_failure("192.168.1.2:8080");
        }
        
        let mut index = 0;
        let proxy = pool.get_proxy_for_email("test@example.com", &mut index);
        assert!(proxy.is_none());
    }

    #[test]
    fn test_get_proxy_by_domain_excludes_bad() {
        let mut pool = ProxyPool::new();
        pool.rotation_mode = RotationMode::PerDomain;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        pool.assign_domain("gmail.com".to_string(), "192.168.1.1:8080".to_string()).unwrap();
        
        // Mark assigned proxy as bad
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        
        let proxy = pool.get_proxy_by_domain("gmail.com");
        assert!(proxy.is_none());
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

    // =====================
    // ProxyStats Tests
    // =====================

    #[test]
    fn test_proxy_stats_new() {
        let stats = ProxyStats::new();
        assert_eq!(stats.attempts, 0);
        assert_eq!(stats.successes, 0);
        assert_eq!(stats.failures, 0);
        assert_eq!(stats.consecutive_failures, 0);
    }

    #[test]
    fn test_proxy_stats_record_success() {
        let mut stats = ProxyStats::new();
        stats.record_success();
        
        assert_eq!(stats.attempts, 1);
        assert_eq!(stats.successes, 1);
        assert_eq!(stats.failures, 0);
        assert_eq!(stats.consecutive_failures, 0);
    }

    #[test]
    fn test_proxy_stats_record_failure() {
        let mut stats = ProxyStats::new();
        stats.record_failure();
        
        assert_eq!(stats.attempts, 1);
        assert_eq!(stats.successes, 0);
        assert_eq!(stats.failures, 1);
        assert_eq!(stats.consecutive_failures, 1);
    }

    #[test]
    fn test_proxy_stats_consecutive_failures_reset_on_success() {
        let mut stats = ProxyStats::new();
        stats.record_failure();
        stats.record_failure();
        stats.record_failure();
        
        assert_eq!(stats.consecutive_failures, 3);
        
        stats.record_success();
        assert_eq!(stats.consecutive_failures, 0);
        assert_eq!(stats.successes, 1);
        assert_eq!(stats.failures, 3);
    }

    #[test]
    fn test_proxy_stats_success_rate_no_attempts() {
        let stats = ProxyStats::new();
        // No attempts should return 100 (neutral/healthy)
        assert_eq!(stats.success_rate(), 100);
    }

    #[test]
    fn test_proxy_stats_success_rate_all_success() {
        let mut stats = ProxyStats::new();
        stats.record_success();
        stats.record_success();
        stats.record_success();
        
        assert_eq!(stats.success_rate(), 100);
    }

    #[test]
    fn test_proxy_stats_success_rate_all_failures() {
        let mut stats = ProxyStats::new();
        stats.record_failure();
        stats.record_failure();
        stats.record_failure();
        
        assert_eq!(stats.success_rate(), 0);
    }

    #[test]
    fn test_proxy_stats_success_rate_mixed() {
        let mut stats = ProxyStats::new();
        // 3 successes, 2 failures = 60%
        stats.record_success();
        stats.record_success();
        stats.record_success();
        stats.record_failure();
        stats.record_failure();
        
        assert_eq!(stats.success_rate(), 60);
    }

    #[test]
    fn test_proxy_stats_health_status_healthy() {
        let mut stats = ProxyStats::new();
        // 95% success rate
        for _ in 0..95 {
            stats.record_success();
        }
        for _ in 0..5 {
            stats.record_failure();
        }
        
        assert_eq!(stats.health_status(), HealthStatus::Healthy);
    }

    #[test]
    fn test_proxy_stats_health_status_degraded() {
        let mut stats = ProxyStats::new();
        // 70% success rate
        for _ in 0..70 {
            stats.record_success();
        }
        for _ in 0..30 {
            stats.record_failure();
        }
        
        assert_eq!(stats.health_status(), HealthStatus::Degraded);
    }

    #[test]
    fn test_proxy_stats_health_status_failed() {
        let mut stats = ProxyStats::new();
        // 40% success rate
        for _ in 0..40 {
            stats.record_success();
        }
        for _ in 0..60 {
            stats.record_failure();
        }
        
        assert_eq!(stats.health_status(), HealthStatus::Failed);
    }

    #[test]
    fn test_proxy_stats_health_status_new_proxy() {
        let stats = ProxyStats::new();
        // No attempts = 100% = Healthy
        assert_eq!(stats.health_status(), HealthStatus::Healthy);
    }

    #[test]
    fn test_proxy_stats_is_bad() {
        let mut stats = ProxyStats::new();
        
        // 2 failures - not bad yet
        stats.record_failure();
        stats.record_failure();
        assert!(!stats.is_bad());
        
        // 3 failures - now bad
        stats.record_failure();
        assert!(stats.is_bad());
        
        // Success resets consecutive failures
        stats.record_success();
        assert!(!stats.is_bad());
    }

    #[test]
    fn test_proxy_stats_reset() {
        let mut stats = ProxyStats::new();
        stats.record_success();
        stats.record_failure();
        stats.record_failure();
        
        stats.reset();
        
        assert_eq!(stats.attempts, 0);
        assert_eq!(stats.successes, 0);
        assert_eq!(stats.failures, 0);
        assert_eq!(stats.consecutive_failures, 0);
    }

    #[test]
    fn test_proxy_stats_serialize_deserialize() {
        let mut stats = ProxyStats::new();
        stats.record_success();
        stats.record_failure();
        
        let json = serde_json::to_string(&stats).unwrap();
        let deserialized: ProxyStats = serde_json::from_str(&json).unwrap();
        
        assert_eq!(stats, deserialized);
    }

    #[test]
    fn test_proxy_stats_serialize_camel_case() {
        let mut stats = ProxyStats::new();
        stats.record_success();
        stats.record_failure();
        
        let json = serde_json::to_string(&stats).unwrap();
        
        // Verify camelCase field names
        assert!(json.contains("\"attempts\""));
        assert!(json.contains("\"successes\""));
        assert!(json.contains("\"failures\""));
        assert!(json.contains("\"consecutiveFailures\""));
    }

    #[test]
    fn test_health_status_serialize() {
        assert_eq!(serde_json::to_string(&HealthStatus::Healthy).unwrap(), "\"healthy\"");
        assert_eq!(serde_json::to_string(&HealthStatus::Degraded).unwrap(), "\"degraded\"");
        assert_eq!(serde_json::to_string(&HealthStatus::Failed).unwrap(), "\"failed\"");
    }

    #[test]
    fn test_health_status_deserialize() {
        assert_eq!(serde_json::from_str::<HealthStatus>("\"healthy\"").unwrap(), HealthStatus::Healthy);
        assert_eq!(serde_json::from_str::<HealthStatus>("\"degraded\"").unwrap(), HealthStatus::Degraded);
        assert_eq!(serde_json::from_str::<HealthStatus>("\"failed\"").unwrap(), HealthStatus::Failed);
    }

    // =====================
    // Cooldown Tests
    // =====================

    #[test]
    fn test_proxy_stats_enter_cooldown() {
        let mut stats = ProxyStats::new();
        assert!(!stats.is_in_cooldown());
        
        stats.enter_cooldown(60);
        assert!(stats.is_in_cooldown());
        assert!(stats.remaining_cooldown_secs() > 0);
        assert!(stats.remaining_cooldown_secs() <= 60);
    }

    #[test]
    fn test_proxy_stats_cooldown_expiry() {
        let mut stats = ProxyStats::new();
        
        // Enter cooldown for 1 second
        stats.enter_cooldown(1);
        assert!(stats.is_in_cooldown());
        
        // Wait for cooldown to expire
        std::thread::sleep(std::time::Duration::from_secs(2));
        
        assert!(!stats.is_in_cooldown());
        assert_eq!(stats.remaining_cooldown_secs(), 0);
    }

    #[test]
    fn test_proxy_stats_clear_cooldown() {
        let mut stats = ProxyStats::new();
        stats.enter_cooldown(60);
        assert!(stats.is_in_cooldown());
        
        stats.clear_cooldown();
        assert!(!stats.is_in_cooldown());
        assert_eq!(stats.remaining_cooldown_secs(), 0);
    }

    #[test]
    fn test_proxy_stats_cooldown_persists_in_json() {
        let mut stats = ProxyStats::new();
        stats.enter_cooldown(60);
        
        let json = serde_json::to_string(&stats).unwrap();
        assert!(json.contains("\"cooldownUntil\""));
        
        let deserialized: ProxyStats = serde_json::from_str(&json).unwrap();
        assert!(deserialized.is_in_cooldown());
    }

    #[test]
    fn test_proxy_pool_default_cooldown_duration() {
        let pool = ProxyPool::new();
        assert_eq!(pool.cooldown_duration_secs, 60);
    }

    #[test]
    fn test_proxy_pool_set_cooldown_duration() {
        let mut pool = ProxyPool::new();
        
        // Test clamping to minimum
        pool.set_cooldown_duration(10);
        assert_eq!(pool.cooldown_duration_secs, 30);
        
        // Test clamping to maximum
        pool.set_cooldown_duration(500);
        assert_eq!(pool.cooldown_duration_secs, 300);
        
        // Test valid value
        pool.set_cooldown_duration(120);
        assert_eq!(pool.cooldown_duration_secs, 120);
    }

    #[test]
    fn test_proxy_pool_is_proxy_in_cooldown() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        
        // Not in cooldown initially
        assert!(!pool.is_proxy_in_cooldown("192.168.1.1:8080"));
        
        // Make it bad (3 failures)
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        
        // Should now be in cooldown
        assert!(pool.is_proxy_in_cooldown("192.168.1.1:8080"));
    }

    #[test]
    fn test_proxy_pool_bypass_cooldown() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        
        // Make it bad (3 failures) - enters cooldown
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        assert!(pool.is_proxy_in_cooldown("192.168.1.1:8080"));
        assert!(pool.is_proxy_bad("192.168.1.1:8080"));
        
        // Bypass cooldown
        pool.bypass_cooldown("192.168.1.1:8080");
        
        // Should no longer be in cooldown or bad
        assert!(!pool.is_proxy_in_cooldown("192.168.1.1:8080"));
        assert!(!pool.is_proxy_bad("192.168.1.1:8080"));
    }

    #[test]
    fn test_proxy_pool_record_success_clears_cooldown() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        
        // Make it bad (3 failures) - enters cooldown
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        assert!(pool.is_proxy_in_cooldown("192.168.1.1:8080"));
        
        // Record success - should clear cooldown
        pool.record_success("192.168.1.1:8080");
        assert!(!pool.is_proxy_in_cooldown("192.168.1.1:8080"));
    }

    #[test]
    fn test_proxy_pool_get_available_proxies_excludes_cooldown() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        
        // Make first proxy bad (enters cooldown)
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        
        let available = pool.get_available_proxies();
        assert_eq!(available.len(), 1);
        assert_eq!(available[0].host, "192.168.1.2");
    }

    #[test]
    fn test_proxy_pool_is_proxy_available() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        
        // Available initially
        assert!(pool.is_proxy_available("192.168.1.1:8080"));
        
        // 2 failures - still available
        pool.record_failure("192.168.1.1:8080");
        pool.record_failure("192.168.1.1:8080");
        assert!(pool.is_proxy_available("192.168.1.1:8080"));
        
        // 3 failures - now bad and in cooldown
        pool.record_failure("192.168.1.1:8080");
        assert!(!pool.is_proxy_available("192.168.1.1:8080"));
    }

    #[test]
    fn test_proxy_pool_get_remaining_cooldown() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        
        // No cooldown initially
        assert_eq!(pool.get_remaining_cooldown("192.168.1.1:8080"), 0);
        
        // Make it bad (enters cooldown with default 60s)
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        
        let remaining = pool.get_remaining_cooldown("192.168.1.1:8080");
        assert!(remaining > 0);
        assert!(remaining <= 60);
    }

    #[test]
    fn test_proxy_pool_cooldown_persists_in_json() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        
        // Make it bad (enters cooldown)
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        
        let json = serde_json::to_string(&pool).unwrap();
        let deserialized: ProxyPool = serde_json::from_str(&json).unwrap();
        
        // Should still be in cooldown after deserialization
        assert!(deserialized.is_proxy_in_cooldown("192.168.1.1:8080"));
    }

    #[test]
    fn test_proxy_pool_cooldown_duration_in_json() {
        let mut pool = ProxyPool::new();
        pool.set_cooldown_duration(120);
        
        let json = serde_json::to_string(&pool).unwrap();
        assert!(json.contains("\"cooldownDurationSecs\":120"));
        
        let deserialized: ProxyPool = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.cooldown_duration_secs, 120);
    }

    // =====================
    // ProxyPool Stats Tests
    // =====================

    #[test]
    fn test_proxy_pool_get_stats_new_proxy() {
        let pool = ProxyPool::new();
        let stats = pool.get_stats("192.168.1.1:8080");
        
        // Should return default stats for non-existent proxy
        assert_eq!(stats.attempts, 0);
    }

    #[test]
    fn test_proxy_pool_record_success() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        
        pool.record_success("192.168.1.1:8080");
        
        let stats = pool.get_stats("192.168.1.1:8080");
        assert_eq!(stats.successes, 1);
        assert_eq!(stats.attempts, 1);
    }

    #[test]
    fn test_proxy_pool_record_failure() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        
        pool.record_failure("192.168.1.1:8080");
        
        let stats = pool.get_stats("192.168.1.1:8080");
        assert_eq!(stats.failures, 1);
        assert_eq!(stats.attempts, 1);
    }

    #[test]
    fn test_proxy_pool_remove_proxy_clears_stats() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.record_success("192.168.1.1:8080");
        
        pool.remove_proxy("192.168.1.1:8080");
        
        // Stats should be removed
        assert!(!pool.proxy_stats.contains_key("192.168.1.1:8080"));
    }

    #[test]
    fn test_proxy_pool_clear_clears_stats() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.record_success("192.168.1.1:8080");
        
        pool.clear();
        
        assert!(pool.proxy_stats.is_empty());
    }

    #[test]
    fn test_proxy_pool_reset_stats() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.record_success("192.168.1.1:8080");
        
        pool.reset_stats("192.168.1.1:8080");
        
        let stats = pool.get_stats("192.168.1.1:8080");
        assert_eq!(stats.attempts, 0);
    }

    #[test]
    fn test_proxy_pool_reset_all_stats() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        pool.record_success("192.168.1.1:8080");
        pool.record_failure("192.168.1.2:8080");
        
        pool.reset_all_stats();
        
        assert!(pool.proxy_stats.is_empty());
    }

    #[test]
    fn test_proxy_pool_stats_persist_in_json() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.record_success("192.168.1.1:8080");
        pool.record_failure("192.168.1.1:8080");
        
        let json = serde_json::to_string(&pool).unwrap();
        let deserialized: ProxyPool = serde_json::from_str(&json).unwrap();
        
        let stats = deserialized.get_stats("192.168.1.1:8080");
        assert_eq!(stats.successes, 1);
        assert_eq!(stats.failures, 1);
    }

    // =====================
    // Weighted Rotation Tests
    // =====================

    #[test]
    fn test_proxy_stats_get_weight_new_proxy() {
        // New proxies (no attempts) get neutral weight of 50
        let stats = ProxyStats::new();
        assert_eq!(stats.get_weight(), 50);
    }

    #[test]
    fn test_proxy_stats_get_weight_full_success() {
        let mut stats = ProxyStats::new();
        // 100% success rate
        stats.record_success();
        stats.record_success();
        stats.record_success();
        
        assert_eq!(stats.get_weight(), 100);
    }

    #[test]
    fn test_proxy_stats_get_weight_full_failure() {
        let mut stats = ProxyStats::new();
        // 0% success rate
        stats.record_failure();
        stats.record_failure();
        stats.record_failure();
        
        assert_eq!(stats.get_weight(), 0);
    }

    #[test]
    fn test_proxy_stats_get_weight_mixed() {
        let mut stats = ProxyStats::new();
        // 70% success rate
        for _ in 0..7 {
            stats.record_success();
        }
        for _ in 0..3 {
            stats.record_failure();
        }
        
        assert_eq!(stats.get_weight(), 70);
    }

    #[test]
    fn test_proxy_stats_get_weight_cooldown() {
        let mut stats = ProxyStats::new();
        // 100% success rate
        stats.record_success();
        stats.record_success();
        stats.record_success();
        assert_eq!(stats.get_weight(), 100);
        
        // Enter cooldown - weight should be 0
        stats.enter_cooldown(60);
        assert_eq!(stats.get_weight(), 0);
        
        // Clear cooldown - weight should be back
        stats.clear_cooldown();
        assert_eq!(stats.get_weight(), 100);
    }

    #[test]
    fn test_proxy_pool_get_proxy_weight_new_proxy() {
        let pool = ProxyPool::new();
        // New proxy (not in stats) gets neutral weight of 50
        assert_eq!(pool.get_proxy_weight("192.168.1.1:8080"), 50);
    }

    #[test]
    fn test_proxy_pool_get_proxy_weight_with_stats() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        
        // Record 80% success rate
        for _ in 0..8 {
            pool.record_success("192.168.1.1:8080");
        }
        for _ in 0..2 {
            pool.record_failure("192.168.1.1:8080");
        }
        
        assert_eq!(pool.get_proxy_weight("192.168.1.1:8080"), 80);
    }

    #[test]
    fn test_proxy_pool_get_proxy_weight_cooldown() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        
        // Record some successes
        pool.record_success("192.168.1.1:8080");
        pool.record_success("192.168.1.1:8080");
        assert_eq!(pool.get_proxy_weight("192.168.1.1:8080"), 100);
        
        // Make it bad (enters cooldown)
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        
        // Weight should be 0 when in cooldown
        assert_eq!(pool.get_proxy_weight("192.168.1.1:8080"), 0);
    }

    #[test]
    fn test_proxy_pool_all_weights_equal_single_proxy() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        
        let available = pool.get_available_proxies();
        assert!(pool.all_weights_equal(&available));
    }

    #[test]
    fn test_proxy_pool_all_weights_equal_new_proxies() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.3".to_string(), 8080)).unwrap();
        
        // All new proxies have weight 50
        let available = pool.get_available_proxies();
        assert!(pool.all_weights_equal(&available));
    }

    #[test]
    fn test_proxy_pool_all_weights_equal_same_success_rate() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        
        // Both get 100% success rate
        pool.record_success("192.168.1.1:8080");
        pool.record_success("192.168.1.2:8080");
        
        let available = pool.get_available_proxies();
        assert!(pool.all_weights_equal(&available));
    }

    #[test]
    fn test_proxy_pool_all_weights_not_equal() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        
        // Different success rates
        pool.record_success("192.168.1.1:8080"); // 100%
        pool.record_failure("192.168.1.2:8080"); // 0%
        
        let available = pool.get_available_proxies();
        assert!(!pool.all_weights_equal(&available));
    }

    #[test]
    fn test_proxy_pool_weighted_selection_returns_proxy() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        
        // Set different weights
        pool.record_success("192.168.1.1:8080"); // 100%
        pool.record_failure("192.168.1.2:8080"); // 0%
        
        let available = pool.get_available_proxies();
        
        // Select many times - should always return a valid proxy
        for _ in 0..100 {
            let proxy = pool.select_weighted_proxy(&available);
            assert!(proxy.is_some());
            let host = proxy.unwrap().host;
            assert!(host == "192.168.1.1" || host == "192.168.1.2");
        }
    }

    #[test]
    fn test_proxy_pool_weighted_selection_favors_higher_weight() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        
        // Proxy 1: 100% success, Proxy 2: 10% success
        for _ in 0..10 {
            pool.record_success("192.168.1.1:8080");
        }
        for _ in 0..9 {
            pool.record_failure("192.168.1.2:8080");
        }
        pool.record_success("192.168.1.2:8080");
        
        let available = pool.get_available_proxies();
        
        // Count selections over many iterations
        let mut proxy1_count = 0;
        let mut proxy2_count = 0;
        
        for _ in 0..1000 {
            let proxy = pool.select_weighted_proxy(&available).unwrap();
            if proxy.host == "192.168.1.1" {
                proxy1_count += 1;
            } else {
                proxy2_count += 1;
            }
        }
        
        // Proxy 1 should be selected much more often (weight 100 vs weight 10)
        // Expected ratio is roughly 100:10 = 10:1
        // So proxy1_count should be much higher than proxy2_count
        assert!(proxy1_count > proxy2_count * 5, 
            "Expected proxy1 to be selected much more often. Got proxy1: {}, proxy2: {}", 
            proxy1_count, proxy2_count);
    }

    #[test]
    fn test_proxy_pool_weighted_selection_empty() {
        let pool = ProxyPool::new();
        let available: Vec<ProxyConfig> = vec![];
        
        let proxy = pool.select_weighted_proxy(&available);
        assert!(proxy.is_none());
    }

    #[test]
    fn test_proxy_pool_weighted_selection_zero_total_weight() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        
        // Both proxies have 0% success rate
        pool.record_failure("192.168.1.1:8080");
        pool.record_failure("192.168.1.2:8080");
        
        let available = pool.get_available_proxies();
        
        // Should still return a proxy (fallback to first)
        let proxy = pool.select_weighted_proxy(&available);
        assert!(proxy.is_some());
    }

    #[test]
    fn test_proxy_pool_get_next_proxy_uses_round_robin_when_equal() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.3".to_string(), 8080)).unwrap();
        
        // All proxies have equal weight (50 - new proxies)
        let mut index = 0;
        
        // Should rotate in order (round-robin)
        let p1 = pool.get_next_proxy(&mut index).unwrap();
        assert_eq!(p1.host, "192.168.1.1");
        
        let p2 = pool.get_next_proxy(&mut index).unwrap();
        assert_eq!(p2.host, "192.168.1.2");
        
        let p3 = pool.get_next_proxy(&mut index).unwrap();
        assert_eq!(p3.host, "192.168.1.3");
        
        let p4 = pool.get_next_proxy(&mut index).unwrap();
        assert_eq!(p4.host, "192.168.1.1");
    }

    #[test]
    fn test_proxy_pool_get_next_proxy_uses_weighted_when_different() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        
        // Proxy 1: 100% success, Proxy 2: 20% success
        for _ in 0..10 {
            pool.record_success("192.168.1.1:8080");
        }
        for _ in 0..8 {
            pool.record_failure("192.168.1.2:8080");
        }
        for _ in 0..2 {
            pool.record_success("192.168.1.2:8080");
        }
        
        let mut index = 0;
        
        // Count how often each proxy is selected
        let mut proxy1_count = 0;
        let mut proxy2_count = 0;
        
        for _ in 0..100 {
            let proxy = pool.get_next_proxy(&mut index).unwrap();
            if proxy.host == "192.168.1.1" {
                proxy1_count += 1;
            } else {
                proxy2_count += 1;
            }
        }
        
        // Proxy 1 should be selected more often due to higher weight
        assert!(proxy1_count > proxy2_count, 
            "Expected proxy1 to be selected more often. Got proxy1: {}, proxy2: {}", 
            proxy1_count, proxy2_count);
    }

    #[test]
    fn test_proxy_pool_weighted_excludes_cooldown() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        
        // Proxy 1 in cooldown (3 failures)
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        // Proxy 2 healthy
        pool.record_success("192.168.1.2:8080");
        
        let available = pool.get_available_proxies();
        
        // Only proxy 2 should be available
        assert_eq!(available.len(), 1);
        assert_eq!(available[0].host, "192.168.1.2");
    }

    #[test]
    fn test_proxy_pool_weighted_distribution() {
        // Test that weights are correctly calculated and used
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap(); // Will have 80%
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap(); // Will have 50%
        pool.add_proxy(ProxyConfig::new("192.168.1.3".to_string(), 8080)).unwrap(); // Will have 30%
        
        // Proxy 1: 80% success rate (8 success, 2 failure - alternating to avoid consecutive failures)
        pool.record_success("192.168.1.1:8080");
        pool.record_success("192.168.1.1:8080");
        pool.record_success("192.168.1.1:8080");
        pool.record_success("192.168.1.1:8080");
        pool.record_failure("192.168.1.1:8080");
        pool.record_success("192.168.1.1:8080");
        pool.record_success("192.168.1.1:8080");
        pool.record_success("192.168.1.1:8080");
        pool.record_success("192.168.1.1:8080");
        pool.record_failure("192.168.1.1:8080");
        
        // Proxy 2: 50% success rate (5 success, 5 failure - alternating)
        pool.record_success("192.168.1.2:8080");
        pool.record_failure("192.168.1.2:8080");
        pool.record_success("192.168.1.2:8080");
        pool.record_failure("192.168.1.2:8080");
        pool.record_success("192.168.1.2:8080");
        pool.record_failure("192.168.1.2:8080");
        pool.record_success("192.168.1.2:8080");
        pool.record_failure("192.168.1.2:8080");
        pool.record_success("192.168.1.2:8080");
        pool.record_failure("192.168.1.2:8080");
        
        // Proxy 3: 30% success rate (3 success, 7 failure - but ensure no 3 consecutive failures)
        pool.record_failure("192.168.1.3:8080");
        pool.record_success("192.168.1.3:8080");
        pool.record_failure("192.168.1.3:8080");
        pool.record_failure("192.168.1.3:8080");
        pool.record_success("192.168.1.3:8080"); // Reset consecutive failures
        pool.record_failure("192.168.1.3:8080");
        pool.record_failure("192.168.1.3:8080");
        pool.record_success("192.168.1.3:8080"); // Reset consecutive failures
        pool.record_failure("192.168.1.3:8080");
        pool.record_failure("192.168.1.3:8080");
        
        // Verify weights
        assert_eq!(pool.get_proxy_weight("192.168.1.1:8080"), 80);
        assert_eq!(pool.get_proxy_weight("192.168.1.2:8080"), 50);
        assert_eq!(pool.get_proxy_weight("192.168.1.3:8080"), 30);
        
        // Verify all proxies are available (not in cooldown, not bad)
        let available = pool.get_available_proxies();
        assert_eq!(available.len(), 3);
        
        // Verify that proxies with different weights use weighted selection
        assert!(!pool.all_weights_equal(&available));
        
        // Verify that select_weighted_proxy returns a valid proxy
        for _ in 0..100 {
            let proxy = pool.select_weighted_proxy(&available);
            assert!(proxy.is_some());
            let host = proxy.unwrap().host.clone();
            assert!(host == "192.168.1.1" || host == "192.168.1.2" || host == "192.168.1.3");
        }
    }
}

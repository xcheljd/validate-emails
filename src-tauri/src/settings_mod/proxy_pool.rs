use serde::{Deserialize, Serialize};

use super::proxy_config::{ProxyConfig, RotationMode, pseudo_random};

/// Health status of a proxy based on success rate.
/// Health status of a proxy based on success rate
#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum HealthStatus {
    #[default]
    Healthy,
    Degraded,
    Failed,
}

/// Statistics tracking for a single proxy
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
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
    /// Rolling average validation duration in milliseconds (only updated on success)
    #[serde(default)]
    pub avg_duration_ms: f64,
    /// Whether this proxy has been auto-disabled due to low success rate
    #[serde(default)]
    pub auto_disabled: bool,
}

impl PartialEq for ProxyStats {
    fn eq(&self, other: &Self) -> bool {
        self.attempts == other.attempts
            && self.successes == other.successes
            && self.failures == other.failures
            && self.consecutive_failures == other.consecutive_failures
            && self.cooldown_until == other.cooldown_until
            && (self.avg_duration_ms - other.avg_duration_ms).abs() < f64::EPSILON
            && self.auto_disabled == other.auto_disabled
    }
}

impl Eq for ProxyStats {}

impl ProxyStats {
    #[cfg(test)]
    pub fn new() -> Self {
        Self::default()
    }

    /// Record a successful validation
    pub fn record_success(&mut self) {
        self.record_success_with_duration(0.0);
    }

    /// Record a successful validation with duration tracking
    pub fn record_success_with_duration(&mut self, duration_ms: f64) {
        self.attempts += 1;
        self.successes += 1;
        self.consecutive_failures = 0;

        // Update rolling average duration
        if self.successes == 1 {
            self.avg_duration_ms = duration_ms;
        } else {
            let old_avg = self.avg_duration_ms;
            let n = self.successes as f64;
            self.avg_duration_ms = ((old_avg * (n - 1.0)) + duration_ms) / n;
        }
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
    #[cfg(test)]
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
    /// Auto-disable threshold configuration
    #[serde(default)]
    pub auto_disable_threshold: AutoDisableThreshold,
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
            auto_disable_threshold: AutoDisableThreshold::default(),
        }
    }
}

/// Default cooldown duration (60 seconds)
fn default_cooldown_duration() -> u64 {
    60
}

/// Configuration for auto-disabling proxies based on success rate
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutoDisableThreshold {
    /// Success rate percentage below which a proxy is auto-disabled (default: 20)
    pub success_rate_percent: u32,
    /// Minimum number of attempts before auto-disable kicks in (default: 10)
    pub min_attempts: u32,
}

impl Default for AutoDisableThreshold {
    fn default() -> Self {
        Self {
            success_rate_percent: 20,
            min_attempts: 10,
        }
    }
}

/// Information about a failed proxy for the all-proxies-failed state
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FailedProxyInfo {
    /// Proxy ID (host:port)
    pub id: String,
    /// Whether the proxy is marked as "bad" (3 consecutive failures)
    pub is_bad: bool,
    /// Remaining cooldown time in seconds (0 if not in cooldown)
    pub remaining_cooldown_secs: u64,
    /// Number of consecutive failures
    pub consecutive_failures: u32,
    /// Success rate percentage (0-100)
    pub success_rate: u32,
}

/// State returned when all proxies are unavailable
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AllProxiesFailedState {
    /// List of all proxies with their failure status
    pub failed_proxies: Vec<FailedProxyInfo>,
    /// Whether proxy support is enabled
    pub proxy_enabled: bool,
    /// Total number of proxies configured
    pub total_proxies: usize,
    /// Number of proxies that are bad (3+ consecutive failures)
    pub bad_count: usize,
    /// Number of proxies in cooldown
    pub cooldown_count: usize,
    /// The nearest cooldown expiry time in seconds (0 if none in cooldown)
    pub nearest_cooldown_secs: u64,
}

impl ProxyPool {
    /// Create a new empty proxy pool
    #[cfg(test)]
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a proxy to the pool
    pub fn add_proxy(&mut self, proxy: ProxyConfig) -> Result<(), String> {
        proxy.validate()?;

        let id = proxy.id();
        if self.proxies.iter().any(|p| p.id() == id) {
            return Err(format!("Proxy {} already exists in pool", id));
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
                for v in self.domain_assignments.values_mut() {
                    if *v == old_id {
                        *v = new_id.clone();
                    }
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
    #[cfg(test)]
    pub fn get_proxy_ids(&self) -> Vec<String> {
        self.proxies.iter().map(|p| p.id()).collect()
    }

    /// Check if the pool has any proxies
    #[cfg(test)]
    pub fn has_proxies(&self) -> bool {
        !self.proxies.is_empty()
    }

    /// Get the number of proxies in the pool
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.proxies.len()
    }

    /// Check if the pool is empty
    #[cfg(test)]
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

    /// Record a successful validation for a proxy with duration tracking
    /// Also clears cooldown if proxy was in cooldown
    pub fn record_success_with_duration(&mut self, proxy_id: &str, duration_ms: f64) {
        let stats = self.get_stats_mut(proxy_id);
        stats.record_success_with_duration(duration_ms);
        stats.clear_cooldown();  // Clear cooldown on success
    }

    /// Record a failed validation for a proxy
    /// Automatically enters cooldown if proxy becomes "bad" (3 consecutive failures)
    /// Checks auto-disable threshold after recording failure
    pub fn record_failure(&mut self, proxy_id: &str) {
        // Get cooldown duration first to avoid borrow issues
        let cooldown_duration = self.cooldown_duration_secs;
        let stats = self.get_stats_mut(proxy_id);
        stats.record_failure();
        // Enter cooldown if this failure made the proxy "bad"
        if stats.is_bad() {
            stats.enter_cooldown(cooldown_duration);
        }

        // Check auto-disable threshold
        self.check_auto_disable(proxy_id);
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
    #[cfg(test)]
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

    /// Check if a proxy is available for use.
    /// A proxy is unavailable if in cooldown or auto-disabled.
    /// After cooldown expires, the proxy is given another chance to succeed,
    /// even if its consecutive failure count is still high. If it fails again,
    /// it will re-enter cooldown automatically via record_failure.
    pub fn is_proxy_available(&self, proxy_id: &str) -> bool {
        if self.is_proxy_in_cooldown(proxy_id) {
            return false;
        }
        // Auto-disabled proxies are excluded from rotation
        if let Some(stats) = self.proxy_stats.get(proxy_id) {
            if stats.auto_disabled {
                return false;
            }
        }
        true
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

    /// Check if a proxy should be auto-disabled based on threshold
    fn check_auto_disable(&mut self, proxy_id: &str) {
        let threshold = self.auto_disable_threshold.clone();
        if let Some(stats) = self.proxy_stats.get_mut(proxy_id) {
            if stats.auto_disabled || stats.attempts < threshold.min_attempts {
                return;
            }
            let success_rate = (stats.successes as f64 / stats.attempts as f64) * 100.0;
            if success_rate < threshold.success_rate_percent as f64 {
                stats.auto_disabled = true;
            }
        }
    }

    /// Re-enable an auto-disabled proxy
    /// Clears the auto_disabled flag and resets consecutive failures
    pub fn re_enable_proxy(&mut self, proxy_id: &str) {
        if let Some(stats) = self.proxy_stats.get_mut(proxy_id) {
            stats.auto_disabled = false;
            stats.consecutive_failures = 0;
            stats.clear_cooldown();
        }
    }

    /// Update the auto-disable threshold configuration
    pub fn set_auto_disable_threshold(&mut self, threshold: AutoDisableThreshold) {
        self.auto_disable_threshold = threshold;
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

    /// Check if all proxies have failed (all are either bad or in cooldown)
    /// Returns true if proxy is enabled, has proxies configured, but none are available
    pub fn all_proxies_failed(&self) -> bool {
        self.enabled && !self.proxies.is_empty() && !self.has_available_proxies()
    }

    /// Get the detailed state for when all proxies have failed
    /// Returns None if not in all-proxies-failed state
    pub fn get_all_proxies_failed_state(&self) -> Option<AllProxiesFailedState> {
        if !self.all_proxies_failed() {
            return None;
        }

        let failed_proxies: Vec<FailedProxyInfo> = self.proxies
            .iter()
            .map(|p| {
                let id = p.id();
                let stats = self.get_stats(&id);
                FailedProxyInfo {
                    id: id.clone(),
                    is_bad: stats.is_bad(),
                    remaining_cooldown_secs: stats.remaining_cooldown_secs(),
                    consecutive_failures: stats.consecutive_failures,
                    success_rate: stats.success_rate(),
                }
            })
            .collect();

        let bad_count = failed_proxies.iter().filter(|p| p.is_bad).count();
        let cooldown_count = failed_proxies.iter().filter(|p| p.remaining_cooldown_secs > 0).count();
        
        // Find the nearest cooldown expiry
        let nearest_cooldown_secs = failed_proxies
            .iter()
            .filter(|p| p.remaining_cooldown_secs > 0)
            .map(|p| p.remaining_cooldown_secs)
            .min()
            .unwrap_or(0);

        Some(AllProxiesFailedState {
            failed_proxies,
            proxy_enabled: self.enabled,
            total_proxies: self.proxies.len(),
            bad_count,
            cooldown_count,
            nearest_cooldown_secs,
        })
    }

    /// Check if proxy is enabled but no proxies are configured
    pub fn no_proxies_configured(&self) -> bool {
        self.enabled && self.proxies.is_empty()
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
    pub(crate) fn all_weights_equal(&self, available: &[ProxyConfig]) -> bool {
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
    pub(crate) fn select_weighted_proxy(&self, available: &[ProxyConfig]) -> Option<ProxyConfig> {
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
    #[cfg(test)]
    pub fn get_proxy_by_domain(&self, domain: &str) -> Option<ProxyConfig> {
        if self.rotation_mode != RotationMode::PerDomain {
            return None;
        }
        let proxy = self.get_domain_proxy(domain)?;
        if !self.is_proxy_available(&proxy.id()) {
            return None;
        }
        Some(proxy.clone())
    }
}


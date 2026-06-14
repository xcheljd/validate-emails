use serde::{Deserialize, Serialize};
use std::net::{Ipv4Addr, Ipv6Addr};
use std::sync::atomic::{AtomicU64, Ordering};

/// Atomic counter for deterministic round-robin fairness in weighted selection.
/// This avoids the poor distribution of system-time nanos (which may not change
/// between rapid successive calls) and provides even distribution across proxies.
static WEIGHTED_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Generate a pseudo-random number in range [0, max) using an atomic counter.
/// Uses a simple xorshift to avoid sequential clustering while remaining
/// deterministic and lock-free.
pub(super) fn pseudo_random(max: u32) -> u32 {
    if max == 0 {
        return 0;
    }
    let prev = WEIGHTED_COUNTER.fetch_add(1, Ordering::Relaxed);
    // xorshift64 for good distribution
    let mut x = prev.wrapping_add(0x9E3779B97F4A7C15);
    x ^= x >> 30;
    x = x.wrapping_mul(0xBF58476D1CE4E5B9);
    x ^= x >> 27;
    x = x.wrapping_mul(0x94D049BB133111EB);
    x ^= x >> 31;
    (x as u32) % max
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
pub struct ProxyConfig {
    /// Proxy host (IP address or hostname)
    pub host: String,
    /// Proxy port (1-65535)
    pub port: u16,
    /// Optional username for authentication
    pub username: Option<String>,
    /// Optional password for authentication
    pub password: Option<String>,
    /// Optional proxy connection timeout in milliseconds. None uses library default.
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

impl ProxyConfig {
    /// Create a new proxy config with host and port
    #[cfg(test)]
    pub fn new(host: String, port: u16) -> Self {
        Self {
            host,
            port,
            username: None,
            password: None,
            timeout_ms: None,
        }
    }

    /// Create a proxy config with authentication
    #[cfg(test)]
    pub fn with_auth(host: String, port: u16, username: String, password: String) -> Self {
        Self {
            host,
            port,
            username: Some(username),
            password: Some(password),
            timeout_ms: None,
        }
    }

    /// Parse from a string format: "host:port" or "socks5://user:pass@host:port"
    #[cfg(test)]
    pub fn parse(input: &str) -> Result<Self, String> {
        let input = input.trim();

        let (auth_part, host_port) = if let Some(rest) = input.strip_prefix("socks5://") {
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

        let (host, port) = if host_port.starts_with('[') {
            let closing_bracket = host_port.find(']')
                .ok_or_else(|| "Invalid IPv6 format: missing closing bracket".to_string())?;
            let host = &host_port[1..closing_bracket];
            let rest = &host_port[closing_bracket + 1..];
            let port_str = rest.strip_prefix(':')
                .ok_or_else(|| "Invalid format: missing port after IPv6 address".to_string())?;
            (host.to_string(), port_str)
        } else {
            let colon_pos = host_port.rfind(':')
                .ok_or_else(|| "Invalid format: missing port. Expected host:port".to_string())?;
            let host = &host_port[..colon_pos];
            let port_str = &host_port[colon_pos + 1..];
            (host.to_string(), port_str)
        };

        let port: u16 = port.parse()
            .map_err(|_| format!("Invalid port number: {}", port))?;

        if port == 0 {
            return Err("Port cannot be 0".to_string());
        }

        if host.is_empty() {
            return Err("Host cannot be empty".to_string());
        }

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
            timeout_ms: None,
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
            timeout_ms: self.timeout_ms,
        }
    }

    /// Get a unique identifier for this proxy (host:port)
    pub fn id(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}

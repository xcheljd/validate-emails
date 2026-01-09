use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Proxy {
    pub ip: String,
    pub port: u16,
    pub protocol: String, // "http", "socks5"
    pub username: Option<String>,
    pub password: Option<String>,
}

impl Proxy {
    pub fn to_string(&self) -> String {
        let auth = match (&self.username, &self.password) {
            (Some(u), Some(p)) => format!("{}:{}@", u, p),
            _ => "".to_string(),
        };
        format!("{}://{}{}:{}", self.protocol, auth, self.ip, self.port)
    }

    pub fn from_str(s: &str) -> Option<Self> {
        // Simple parser for "protocol://user:pass@ip:port" or "ip:port" (defaults to socks5)
        // This is a basic implementation.
        let parts: Vec<&str> = s.split("://").collect();
        let (protocol, rest) = if parts.len() == 2 {
            (parts[0], parts[1])
        } else {
            ("socks5", s) // Default to socks5 if not specified
        };

        let (auth_part, addr_part) = if let Some(idx) = rest.find('@') {
            (&rest[..idx], &rest[idx+1..])
        } else {
            ("", rest)
        };

        let (username, password) = if !auth_part.is_empty() {
            if let Some((u, p)) = auth_part.split_once(':') {
                (Some(u.to_string()), Some(p.to_string()))
            } else {
                (Some(auth_part.to_string()), None)
            }
        } else {
            (None, None)
        };

        let addr_parts: Vec<&str> = addr_part.split(':').collect();
        if addr_parts.len() != 2 {
            return None;
        }

        let ip = addr_parts[0].to_string();
        let port = addr_parts[1].parse().ok()?;

        Some(Proxy {
            ip,
            port,
            protocol: protocol.to_string(),
            username,
            password,
        })
    }
}

#[derive(Debug, Clone, Default)]
pub struct ProxyStats {
    pub attempts: u32,
    pub successes: u32,
    pub failures: u32,
}

#[derive(Clone)]
pub struct ProxyPool {
    proxies: Arc<Mutex<Vec<(Proxy, ProxyStats)>>>,
    current_index: Arc<Mutex<usize>>,
    // We track global usage or per-session usage? 
    // For simplicity, let's track a simple rotation index.
}

impl ProxyPool {
    pub fn new() -> Self {
        Self {
            proxies: Arc::new(Mutex::new(Vec::new())),
            current_index: Arc::new(Mutex::new(0)),
        }
    }

    pub async fn add_proxies(&self, proxy_list: Vec<String>) -> usize {
        let mut proxies = self.proxies.lock().await;
        let mut count = 0;
        for p_str in proxy_list {
            if let Some(proxy) = Proxy::from_str(&p_str) {
                // Avoid duplicates based on IP:Port
                if !proxies.iter().any(|(p, _)| p.ip == proxy.ip && p.port == proxy.port) {
                    proxies.push((proxy, ProxyStats::default()));
                    count += 1;
                }
            }
        }
        count
    }

    pub async fn get_next_proxy(&self) -> Option<Proxy> {
        self.get_proxy_excluding(None).await
    }

    pub async fn get_proxy_excluding(&self, excluded_opt: Option<&str>) -> Option<Proxy> {
        let proxies = self.proxies.lock().await;
        if proxies.is_empty() {
            return None;
        }

        let mut idx = self.current_index.lock().await;
        let start_idx = *idx;
        let count = proxies.len();

        // First pass: try to find a non-excluded proxy
        for i in 0..count {
            let curr = (start_idx + i) % count;
            if let Some((proxy, _)) = proxies.get(curr) {
                 let proxy_str = format!("{}:{}", proxy.ip, proxy.port);
                 let is_excluded = excluded_opt.map_or(false, |ex| proxy_str == ex);

                 if !is_excluded {
                     *idx = (curr + 1) % count;
                     return Some(proxy.clone());
                 }
            }
        }

        // If all are excluded (e.g. only 1 proxy and it matches), fallback to just taking the next one
        // consistent with "get_next_proxy" behavior (round robin)
        let proxy = proxies.get(*idx).map(|(p, _)| p.clone())?;
        *idx = (*idx + 1) % count;
        Some(proxy)
    }

    pub async fn report_success(&self, proxy: &Proxy) {
        let mut proxies = self.proxies.lock().await;
        if let Some(idx) = proxies.iter().position(|(p, _)| p.ip == proxy.ip && p.port == proxy.port) {
            proxies[idx].1.attempts += 1;
            proxies[idx].1.successes += 1;
        }
    }

    pub async fn report_failure(&self, proxy: &Proxy) {
        let mut proxies = self.proxies.lock().await;
        if let Some(idx) = proxies.iter().position(|(p, _)| p.ip == proxy.ip && p.port == proxy.port) {
            proxies[idx].1.attempts += 1;
            proxies[idx].1.failures += 1;
        }
    }

    pub async fn get_stats(&self) -> ProxyPoolStatus {
        let proxies = self.proxies.lock().await;
        let total_proxies = proxies.len();
        
        let total_attempts: u32 = proxies.iter().map(|(_, s)| s.attempts).sum();
        let total_successes: u32 = proxies.iter().map(|(_, s)| s.successes).sum();
        
        let success_rate = if total_attempts > 0 {
            (total_successes as f32 / total_attempts as f32) * 100.0
        } else {
            0.0
        };

        // Just show the last used one as "active" if we want, or just generic stats
        let idx = *self.current_index.lock().await;
        let active_proxy = if !proxies.is_empty() {
             let show_idx = if idx == 0 { proxies.len() - 1 } else { idx - 1 };
             proxies.get(show_idx).map(|(p, _)| format!("{}:{}", p.ip, p.port))
        } else {
            None
        };

        ProxyPoolStatus {
            total_proxies,
            active_proxy,
            success_rate,
            average_speed: 0.0, // Removed for now
        }
    }
    
    pub async fn clear(&self) {
        let mut proxies = self.proxies.lock().await;
        proxies.clear();
        let mut idx = self.current_index.lock().await;
        *idx = 0;
    }
}

pub struct ProxyState {
    pub pool: ProxyPool,
}

impl Default for ProxyState {
    fn default() -> Self {
        Self {
            pool: ProxyPool::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ProxyPoolStatus {
    pub total_proxies: usize,
    pub active_proxy: Option<String>,
    pub success_rate: f32,
    pub average_speed: f32,
}

#[tauri::command]
pub async fn add_proxies(
    state: tauri::State<'_, ProxyState>,
    proxies: Vec<String>
) -> Result<String, String> {
    let count = state.pool.add_proxies(proxies).await;
    Ok(format!("Added {} proxies", count))
}

#[tauri::command]
pub async fn get_proxy_status(state: tauri::State<'_, ProxyState>) -> Result<ProxyPoolStatus, String> {
    Ok(state.pool.get_stats().await)
}

#[tauri::command]
pub async fn clear_proxies(state: tauri::State<'_, ProxyState>) -> Result<String, String> {
    state.pool.clear().await;
    Ok("Proxies cleared".to_string())
}

// Deprecated/Stub commands to maintain signature if needed, or we can just remove them 
// and update frontend. Let's update frontend to match new commands.
// Actually, let's keep `fetch_proxies` but rename/repurpose it or just remove it.
// I'll leave the old command names but make them use the state to avoid breaking frontend immediately,
// though I plan to update frontend.

#[tauri::command]
pub async fn fetch_proxies(
    _max_per_proxy: usize,
    _rotation_strategy: String,
    _protocol: String,
    _min_uptime: f32
) -> Result<String, String> {
    // This was the old "fetch from API" command. 
    // For now, we return a message saying it's not implemented or just "Ok".
    Ok("Auto-fetch not implemented. Please add proxies manually.".to_string())
}

#[tauri::command]
pub async fn refresh_proxies() -> Result<String, String> {
    Ok("Refreshed".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_proxy_from_str_basic() {
        let p = Proxy::from_str("1.2.3.4:8080").unwrap();
        assert_eq!(p.ip, "1.2.3.4");
        assert_eq!(p.port, 8080);
        assert_eq!(p.protocol, "socks5");
        assert_eq!(p.username, None);
        assert_eq!(p.password, None);
    }

    #[test]
    fn test_proxy_from_str_with_protocol() {
        let p = Proxy::from_str("http://1.2.3.4:8080").unwrap();
        assert_eq!(p.protocol, "http");
        assert_eq!(p.ip, "1.2.3.4");
        assert_eq!(p.port, 8080);
    }

    #[test]
    fn test_proxy_from_str_with_auth() {
        let p = Proxy::from_str("socks5://user:pass@1.2.3.4:1080").unwrap();
        assert_eq!(p.protocol, "socks5");
        assert_eq!(p.username, Some("user".to_string()));
        assert_eq!(p.password, Some("pass".to_string()));
        assert_eq!(p.ip, "1.2.3.4");
        assert_eq!(p.port, 1080);
    }

    #[test]
    fn test_proxy_from_str_invalid() {
        assert!(Proxy::from_str("not_an_ip").is_none());
        assert!(Proxy::from_str("1.2.3.4").is_none()); // Missing port
        assert!(Proxy::from_str("1.2.3.4:abc").is_none()); // Invalid port
    }

    #[test]
    fn test_proxy_from_str_complex_auth() {
        // Many proxy providers use colons in passwords
        let p = Proxy::from_str("http://user:pass:with:colons@1.2.3.4:8080").unwrap();
        assert_eq!(p.username, Some("user".to_string()));
        assert_eq!(p.password, Some("pass:with:colons".to_string()));
    }
}

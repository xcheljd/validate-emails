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
            let auth_parts: Vec<&str> = auth_part.split(':').collect();
            (Some(auth_parts[0].to_string()), auth_parts.get(1).map(|s| s.to_string()))
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
        let proxies = self.proxies.lock().await;
        if proxies.is_empty() {
            return None;
        }

        let mut idx = self.current_index.lock().await;
        let proxy = proxies.get(*idx).map(|(p, _)| p.clone())?;
        
        *idx = (*idx + 1) % proxies.len();
        
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

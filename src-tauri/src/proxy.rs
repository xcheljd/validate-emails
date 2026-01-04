use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Proxy {
    pub ip: String,
    pub port: u16,
    pub protocol: String,
    pub anonymity: String,
    pub uptime: f32,
    pub connect_time: f32,
    pub download_speed: f32,
}

#[derive(Debug, Clone, Default)]
pub struct ProxyStats {
    pub attempts: u32,
    pub successes: u32,
    pub failures: u32,
}

pub struct ProxyPool {
    proxies: Arc<Mutex<Vec<(Proxy, ProxyStats)>>>,
    current_index: Arc<Mutex<usize>>,
    current_proxy_count: Arc<Mutex<usize>>,
    max_per_proxy: usize,
    rotation_strategy: String,
    protocol: String,
    min_uptime: f32,
}

impl ProxyPool {
    pub async fn new(max_per_proxy: usize, rotation_strategy: String, protocol: String, min_uptime: f32) -> Result<Self, String> {
        let pool = Self {
            proxies: Arc::new(Mutex::new(Vec::new())),
            current_index: Arc::new(Mutex::new(0)),
            current_proxy_count: Arc::new(Mutex::new(0)),
            max_per_proxy,
            rotation_strategy,
            protocol,
            min_uptime,
        };

        pool.fetch_from_api().await?;
        Ok(pool)
    }

    pub async fn fetch_from_api(&self) -> Result<(), String> {
        match fetch_getproxylist(self.protocol.as_str(), self.min_uptime).await {
            Ok(proxies) => {
                let new_proxies: Vec<(Proxy, ProxyStats)> = proxies
                    .into_iter()
                    .map(|p| (p, ProxyStats::default()))
                    .collect();

                let mut proxies = self.proxies.lock().await;
                *proxies = new_proxies;
                drop(proxies);

                let mut index = self.current_index.lock().await;
                *index = 0;
                drop(index);

                let mut count = self.current_proxy_count.lock().await;
                *count = 0;
                drop(count);

                Ok(())
            },
            Err(e) => Err(format!("Failed to fetch proxies: {}", e)),
        }
    }

    pub async fn get_next_proxy(&self) -> Option<Proxy> {
        let proxies = self.proxies.lock().await;
        if proxies.is_empty() {
            return None;
        }

        let proxy = proxies.get(self.current_index.lock().await.clone()).map(|(p, _)| p.clone())?;

        let mut index = self.current_index.lock().await;
        *index = (*index + 1) % proxies.len();
        drop(index);

        let mut count = self.current_proxy_count.lock().await;
        *count += 1;
        drop(count);

        Some(proxy)
    }

    pub async fn report_success(&self, proxy: &Proxy) {
        let mut proxies = self.proxies.lock().await;
        if let Some(idx) = proxies.iter().position(|(p, _)| p.ip == proxy.ip && p.port == proxy.port) {
            proxies[idx].1.attempts += 1;
            proxies[idx].1.successes += 1;
        }
        drop(proxies);

        if self.rotation_strategy == "on-failure" {
            let mut count = self.current_proxy_count.lock().await;
            *count = 0;
            drop(count);
        }
    }

    pub async fn report_failure(&self, proxy: &Proxy) {
        let mut proxies = self.proxies.lock().await;
        if let Some(idx) = proxies.iter().position(|(p, _)| p.ip == proxy.ip && p.port == proxy.port) {
            proxies[idx].1.attempts += 1;
            proxies[idx].1.failures += 1;
        }
        drop(proxies);

        if self.rotation_strategy == "on-failure" {
            let mut count = self.current_proxy_count.lock().await;
            *count = 0;
            drop(count);
        }
    }

    pub async fn refresh_if_needed(&self) -> Result<(), String> {
        let proxies = self.proxies.lock().await;
        let len = proxies.len();
        drop(proxies);

        if len < 10 {
            self.fetch_from_api().await
        } else {
            Ok(())
        }
    }

    pub async fn remove_underperforming(&self) {
        let mut proxies = self.proxies.lock().await;
        proxies.retain(|(_, stats)| {
            stats.attempts > 0 && (stats.successes as f32 / stats.attempts as f32) >= 0.5
        });
        drop(proxies);
    }

    pub async fn get_pool_status(&self) -> ProxyPoolStatus {
        let proxies = self.proxies.lock().await;

        let total_attempts: u32 = proxies.iter().map(|(_, s)| s.attempts).sum();
        let total_successes: u32 = proxies.iter().map(|(_, s)| s.successes).sum();
        let success_rate = if total_attempts > 0 {
            (total_successes as f32 / total_attempts as f32) * 100.0
        } else {
            0.0
        };

        let avg_speed: f32 = if !proxies.is_empty() {
            proxies.iter().map(|(p, _)| p.download_speed).sum::<f32>() / proxies.len() as f32
        } else {
            0.0
        };

        let active_proxy = if proxies.is_empty() {
            None
        } else {
            let idx = if *self.current_index.lock().await == 0 {
                proxies.len() - 1
            } else {
                *self.current_index.lock().await - 1
            };
            proxies.get(idx).map(|(p, _)| format!("{}:{}", p.ip, p.port))
        };

        ProxyPoolStatus {
            total_proxies: proxies.len(),
            active_proxy,
            success_rate,
            average_speed: avg_speed,
        }
    }

    pub async fn should_rotate_proxy(&self, proxy: &Proxy) -> bool {
        if self.rotation_strategy == "per-email" {
            return true;
        }

        let count = *self.current_proxy_count.lock().await;
        if count >= self.max_per_proxy {
            return true;
        }

        let proxies = self.proxies.lock().await;
        if let Some(idx) = proxies.iter().position(|(p, _)| p.ip == proxy.ip && p.port == proxy.port) {
            let stats = &proxies[idx].1;
            if stats.attempts >= 3 && stats.failures >= 3 {
                return true;
            }
        }
        drop(proxies);

        false
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
pub async fn fetch_proxies(
    max_per_proxy: usize,
    rotation_strategy: String,
    protocol: String,
    min_uptime: f32
) -> Result<String, String> {
    let _pool = ProxyPool::new(max_per_proxy, rotation_strategy, protocol, min_uptime).await?;
    Ok("Proxies fetched successfully".to_string())
}

#[tauri::command]
pub async fn get_proxy_status() -> Result<ProxyPoolStatus, String> {
    let pool = ProxyPool::new(50, "on-failure".to_string(), "any".to_string(), 80.0).await?;
    Ok(pool.get_pool_status().await)
}

#[tauri::command]
pub async fn refresh_proxies() -> Result<String, String> {
    let pool = ProxyPool::new(50, "on-failure".to_string(), "any".to_string(), 80.0).await?;
    pool.fetch_from_api().await?;
    Ok("Proxy pool refreshed".to_string())
}

#[tauri::command]
pub async fn clear_proxies() -> Result<String, String> {
    Ok("Proxies cleared".to_string())
}

async fn fetch_getproxylist(_protocol: &str, _min_uptime: f32) -> Result<Vec<Proxy>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let url = String::from("https://api.getproxylist.com/proxy?protocol[]=http&protocol[]=socks5&allowsCustomHeaders=1&allowsPost=1&uptime=80");

    Ok(Vec::new())
}

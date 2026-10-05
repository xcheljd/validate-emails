use super::settings_core::{validate_smtp_identity, CorruptSettingsInfo, Settings, SettingsState, RateLimiterConfig};
use super::proxy_config::{ProxyConfig, RotationMode};
use super::proxy_pool::{ProxyPool, ProxyStats, AutoDisableThreshold, AllProxiesFailedState};
use std::path::Path;
use std::sync::Arc;
use tokio::sync::RwLock;

#[tauri::command]
pub async fn load_settings(
    state: tauri::State<'_, SettingsState>,
) -> Result<Settings, String> {
    let settings = state.settings.read().await;
    Ok(settings.clone())
}

/// Startup warning if settings.json was corrupt and had to be moved aside
/// (B13). `None` on a clean or first-run load.
#[tauri::command]
pub fn get_corrupt_settings_warning(
    state: tauri::State<'_, SettingsState>,
) -> Option<CorruptSettingsInfo> {
    state.corrupt_settings_warning()
}

#[tauri::command]
pub async fn save_settings(
    state: tauri::State<'_, SettingsState>,
    settings: Settings,
) -> Result<(), String> {
    {
        let mut current = state.settings.write().await;
        apply_general_settings(&mut current, settings)?;
    } // write lock released before I/O
    persist_settings(state).await
}

/// Copy the general (frontend-edited) fields of `incoming` into `current`,
/// after validating them. Nothing is changed if validation fails.
///
/// `proxy_pool` is managed by the dedicated proxy commands and is NOT
/// round-tripped by the frontend, so the incoming value is always the serde
/// default. Overwriting it would wipe the live pool (proxies, domain
/// assignments, stats, cooldowns, enabled flag) on every general-settings
/// save, silently falling back to a direct connection (B2).
pub fn apply_general_settings(current: &mut Settings, incoming: Settings) -> Result<(), String> {
    validate_smtp_identity(&incoming.from_email, &incoming.hello_name)?;

    current.validation_mode = incoming.validation_mode;
    current.timeout_ms = incoming.timeout_ms;
    current.concurrency = incoming.concurrency;
    current.max_retries = incoming.max_retries;
    current.auto_save_interval = incoming.auto_save_interval;
    current.history_retention_days = incoming.history_retention_days;
    current.rate_limiter = incoming.rate_limiter;
    current.max_emails_per_session = incoming.max_emails_per_session;
    current.from_email = incoming.from_email;
    current.hello_name = incoming.hello_name;
    current.check_gravatar = incoming.check_gravatar;
    current.mx_concurrency = crate::mx::clamp_mx_concurrency(incoming.mx_concurrency) as u32;
    Ok(())
}

/// Serialize the current settings — including the live proxy pool — to disk.
/// The proxy-mutating commands call this so the pool survives a restart;
/// previously only `save_settings` wrote to disk (and it wiped the pool),
/// leaving proxies effectively memory-only (B10).
pub async fn persist_settings(
    state: tauri::State<'_, SettingsState>,
) -> Result<(), String> {
    persist_settings_to(&state.settings, &state.settings_path).await
}

/// `persist_settings` without a Tauri `State`, for callers (e.g. the end of
/// a validation run) that hold the settings Arc directly.
pub async fn persist_settings_to(
    settings: &Arc<RwLock<Settings>>,
    settings_path: &Path,
) -> Result<(), String> {
    let (json, path) = {
        let current = settings.read().await;
        let json = serde_json::to_string_pretty(&*current)
            .map_err(|e| format!("Failed to serialize settings: {}", e))?;
        (json, settings_path.to_path_buf())
    }; // read lock released before I/O

    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create settings directory: {}", e))?;
    }

    // Blocking temp-write + fsync + rename (B12), off the async runtime.
    tokio::task::spawn_blocking(move || crate::atomic_write::atomic_write(&path, json.as_bytes()))
        .await
        .map_err(|e| format!("Failed to write settings: {}", e))?
        .map_err(|e| format!("Failed to write settings: {}", e))
}

#[tauri::command]
pub async fn reset_settings(
    state: tauri::State<'_, SettingsState>,
) -> Result<Settings, String> {
    let settings = {
        let mut settings = state.settings.write().await;
        *settings = Settings::default();
        settings.clone()
    };
    persist_settings(state).await?;
    Ok(settings)
}

#[tauri::command]
pub async fn update_validator_config(
    state: tauri::State<'_, SettingsState>,
    rate_limiter: RateLimiterConfig,
) -> Result<(), String> {
    {
        let mut settings = state.settings.write().await;
        settings.rate_limiter = rate_limiter;
    }
    persist_settings(state).await
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
    {
        let mut settings = state.settings.write().await;
        settings.proxy_pool.add_proxy(proxy)?;
    }
    persist_settings(state).await
}

/// Update an existing proxy in the pool
#[tauri::command]
pub async fn update_proxy(
    state: tauri::State<'_, SettingsState>,
    old_id: String,
    proxy: ProxyConfig,
) -> Result<(), String> {
    {
        let mut settings = state.settings.write().await;
        settings.proxy_pool.update_proxy(&old_id, proxy)?;
    }
    persist_settings(state).await
}

/// Delete a proxy from the pool
#[tauri::command]
pub async fn delete_proxy(
    state: tauri::State<'_, SettingsState>,
    id: String,
) -> Result<bool, String> {
    let removed = {
        let mut settings = state.settings.write().await;
        settings.proxy_pool.remove_proxy(&id)
    };
    if removed {
        persist_settings(state).await?;
    }
    Ok(removed)
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
    {
        let mut settings = state.settings.write().await;
        settings.proxy_pool.clear();
    }
    persist_settings(state).await
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
    {
        let mut settings = state.settings.write().await;
        if let Some(e) = enabled {
            settings.proxy_pool.enabled = e;
        }
        if let Some(rm) = rotation_mode {
            settings.proxy_pool.rotation_mode = rm;
        }
    }
    persist_settings(state).await
}

/// Assign a proxy to a specific domain
#[tauri::command]
pub async fn assign_domain_proxy(
    state: tauri::State<'_, SettingsState>,
    domain: String,
    proxy_id: String,
) -> Result<(), String> {
    {
        let mut settings = state.settings.write().await;
        settings.proxy_pool.assign_domain(domain, proxy_id)?;
    }
    persist_settings(state).await
}

/// Remove a domain proxy assignment
#[tauri::command]
pub async fn unassign_domain_proxy(
    state: tauri::State<'_, SettingsState>,
    domain: String,
) -> Result<bool, String> {
    let removed = {
        let mut settings = state.settings.write().await;
        settings.proxy_pool.unassign_domain(&domain)
    };
    if removed {
        persist_settings(state).await?;
    }
    Ok(removed)
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
// Auto-Disable Commands
// =====================

/// Get the auto-disable threshold configuration
#[tauri::command]
pub async fn get_auto_disable_threshold(
    state: tauri::State<'_, SettingsState>,
) -> Result<AutoDisableThreshold, String> {
    let settings = state.settings.read().await;
    Ok(settings.proxy_pool.auto_disable_threshold.clone())
}

/// Update the auto-disable threshold configuration
#[tauri::command]
pub async fn set_auto_disable_threshold(
    state: tauri::State<'_, SettingsState>,
    threshold: AutoDisableThreshold,
) -> Result<(), String> {
    {
        let mut settings = state.settings.write().await;
        settings.proxy_pool.set_auto_disable_threshold(threshold);
    }
    persist_settings(state).await
}

/// Re-enable an auto-disabled proxy
#[tauri::command]
pub async fn re_enable_proxy(
    state: tauri::State<'_, SettingsState>,
    proxy_id: String,
) -> Result<(), String> {
    {
        let mut settings = state.settings.write().await;
        settings.proxy_pool.re_enable_proxy(&proxy_id);
    }
    persist_settings(state).await
}

/// Record a successful validation for a proxy with duration tracking
#[tauri::command]
pub async fn record_proxy_success_with_duration(
    state: tauri::State<'_, SettingsState>,
    proxy_id: String,
    duration_ms: f64,
) -> Result<(), String> {
    let mut settings = state.settings.write().await;
    settings.proxy_pool.record_success_with_duration(&proxy_id, duration_ms);
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
    {
        let mut settings = state.settings.write().await;
        settings.proxy_pool.set_cooldown_duration(duration_secs);
    }
    persist_settings(state).await
}

// =====================
// All Proxies Failed Detection Commands
// =====================

/// Check if all proxies have failed (all are either bad or in cooldown)
#[tauri::command]
pub async fn check_all_proxies_failed(
    state: tauri::State<'_, SettingsState>,
) -> Result<bool, String> {
    let settings = state.settings.read().await;
    Ok(settings.proxy_pool.all_proxies_failed())
}

/// Get detailed state when all proxies have failed
/// Returns None if not in all-proxies-failed state
#[tauri::command]
pub async fn get_all_proxies_failed_state(
    state: tauri::State<'_, SettingsState>,
) -> Result<Option<AllProxiesFailedState>, String> {
    let settings = state.settings.read().await;
    Ok(settings.proxy_pool.get_all_proxies_failed_state())
}

/// Check if proxy is enabled but no proxies are configured
#[tauri::command]
pub async fn check_no_proxies_configured(
    state: tauri::State<'_, SettingsState>,
) -> Result<bool, String> {
    let settings = state.settings.read().await;
    Ok(settings.proxy_pool.no_proxies_configured())
}

/// Check proxy availability before starting validation
/// Returns Ok(true) if validation can proceed, Err with message if blocked
#[tauri::command]
pub async fn check_proxy_availability(
    state: tauri::State<'_, SettingsState>,
) -> Result<Result<(), String>, String> {
    let settings = state.settings.read().await;
    
    // Check if proxy is enabled but no proxies configured
    if settings.proxy_pool.no_proxies_configured() {
        return Ok(Err("No proxies configured. Please add at least one proxy or disable proxy support.".to_string()));
    }
    
    // Check if all proxies have failed
    if settings.proxy_pool.all_proxies_failed() {
        let state = settings.proxy_pool.get_all_proxies_failed_state();
        if let Some(failed_state) = state {
            return Ok(Err(format!(
                "All {} proxy(ies) are unavailable. {} bad, {} in cooldown. Nearest cooldown expires in {}s.",
                failed_state.total_proxies,
                failed_state.bad_count,
                failed_state.cooldown_count,
                failed_state.nearest_cooldown_secs
            )));
        }
    }
    
    Ok(Ok(()))
}

// =====================
// Session-Level Proxy Bypass Commands
// =====================

/// Set or clear the session-level proxy bypass flag
/// When bypass is true, validation will use direct connection even if proxy is enabled
/// This does NOT modify the permanent proxy settings
#[tauri::command]
pub async fn set_proxy_bypass_for_session(
    state: tauri::State<'_, SettingsState>,
    bypass: bool,
) -> Result<(), String> {
    let mut proxy_bypass = state.proxy_bypass_for_session.write().await;
    *proxy_bypass = bypass;
    Ok(())
}

/// Get the current session-level proxy bypass flag
#[tauri::command]
pub async fn get_proxy_bypass_for_session(
    state: tauri::State<'_, SettingsState>,
) -> Result<bool, String> {
    let proxy_bypass = state.proxy_bypass_for_session.read().await;
    Ok(*proxy_bypass)
}

/// Clear the session-level proxy bypass flag (equivalent to set_proxy_bypass_for_session(false))
#[tauri::command]
pub async fn clear_proxy_bypass_for_session(
    state: tauri::State<'_, SettingsState>,
) -> Result<(), String> {
    let mut proxy_bypass = state.proxy_bypass_for_session.write().await;
    *proxy_bypass = false;
    Ok(())
}

// =====================
// Rate Limiting Commands
// =====================

/// Get the max emails per session setting (0 = unlimited)
#[tauri::command]
pub async fn get_max_emails_per_session(
    state: tauri::State<'_, SettingsState>,
) -> Result<u32, String> {
    let settings = state.settings.read().await;
    Ok(settings.max_emails_per_session)
}

/// Set the max emails per session setting (0 = unlimited)
#[tauri::command]
pub async fn set_max_emails_per_session(
    state: tauri::State<'_, SettingsState>,
    max_emails: u32,
) -> Result<(), String> {
    let mut settings = state.settings.write().await;
    settings.max_emails_per_session = max_emails;
    Ok(())
}

/// Check if an email count exceeds the max_emails_per_session limit.
/// Returns Ok(true) if within limits, Ok(false) if exceeded (not an error per se),
/// with the current max_emails_per_session value.
#[tauri::command]
pub async fn check_email_count_limit(
    state: tauri::State<'_, SettingsState>,
    email_count: u32,
) -> Result<(bool, u32), String> {
    let settings = state.settings.read().await;
    let max = settings.max_emails_per_session;
    if max > 0 && email_count > max {
        Ok((false, max))
    } else {
        Ok((true, max))
    }
}


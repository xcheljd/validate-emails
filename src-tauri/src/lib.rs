mod validation;
mod settings;
mod session;

use tauri::Emitter;
use std::sync::Arc;

/// Event payload for all-proxies-failed event
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AllProxiesFailedPayload {
    pub failed_proxies: Vec<settings::FailedProxyInfo>,
    pub proxy_enabled: bool,
    pub total_proxies: usize,
    pub bad_count: usize,
    pub cooldown_count: usize,
    pub nearest_cooldown_secs: u64,
}

/// Event payload for no-proxies-configured event  
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoProxiesConfiguredPayload {
    pub message: String,
}

#[tauri::command]
async fn validate_emails_bulk(
    window: tauri::Window,
    validation_state: tauri::State<'_, validation::ValidationState>,
    settings_state: tauri::State<'_, settings::SettingsState>,
    emails: Vec<String>,
    concurrency: usize,
    mode: String,
) -> Result<Vec<validation::ValidationResult>, String> {
    // Get the current proxy pool configuration and bypass flag
    let settings = settings_state.settings.read().await;
    let proxy_pool = settings.proxy_pool.clone();
    drop(settings);
    
    let proxy_bypass = *settings_state.proxy_bypass_for_session.read().await;

    // Check for no proxies configured (if proxy is enabled and not bypassed)
    if !proxy_bypass && proxy_pool.no_proxies_configured() {
        let _ = window.emit("no-proxies-configured", NoProxiesConfiguredPayload {
            message: "No proxies configured. Please add at least one proxy or disable proxy support.".to_string(),
        });
        return Err("No proxies configured".to_string());
    }

    // Check for all proxies failed (if proxy is enabled and not bypassed)
    if !proxy_bypass && proxy_pool.all_proxies_failed() {
        if let Some(failed_state) = proxy_pool.get_all_proxies_failed_state() {
            let payload = AllProxiesFailedPayload {
                failed_proxies: failed_state.failed_proxies.clone(),
                proxy_enabled: failed_state.proxy_enabled,
                total_proxies: failed_state.total_proxies,
                bad_count: failed_state.bad_count,
                cooldown_count: failed_state.cooldown_count,
                nearest_cooldown_secs: failed_state.nearest_cooldown_secs,
            };
            let _ = window.emit("all-proxies-failed", payload);
            return Err("All proxies are unavailable".to_string());
        }
    }

    // Create proxy rotation state if proxy is enabled, has proxies, and is not bypassed
    let proxy_state = if !proxy_bypass && proxy_pool.enabled && !proxy_pool.proxies.is_empty() {
        Some(Arc::new(validation::ProxyRotationState::new(proxy_pool)))
    } else {
        None
    };

    // Clone window for use in the progress callback
    let window_for_progress = window.clone();
    let window_for_completion = window.clone();

    let results = validation::validate_emails_bulk_core(
        emails,
        concurrency,
        validation_state.get_token(),
        mode,
        proxy_state,
        move |res| {
            let _ = window_for_progress.emit("validation-progress", res);
        },
    ).await;

    // Update proxy stats based on results (only if proxy was used)
    if !proxy_bypass {
        let mut settings = settings_state.settings.write().await;
        for result in &results {
            if let Some(ref proxy_id) = result.proxy_id {
                // Consider "Safe" and "Risky" as success, "Invalid" and "Unknown" as failure
                if result.result == "Safe" || result.result == "Risky" {
                    settings.proxy_pool.record_success_with_duration(proxy_id, result.validation_duration as f64);
                } else {
                    settings.proxy_pool.record_failure(proxy_id);
                }
            }
        }

        // Check if all proxies have become unavailable during validation
        if settings.proxy_pool.all_proxies_failed() {
            if let Some(failed_state) = settings.proxy_pool.get_all_proxies_failed_state() {
                let payload = AllProxiesFailedPayload {
                    failed_proxies: failed_state.failed_proxies.clone(),
                    proxy_enabled: failed_state.proxy_enabled,
                    total_proxies: failed_state.total_proxies,
                    bad_count: failed_state.bad_count,
                    cooldown_count: failed_state.cooldown_count,
                    nearest_cooldown_secs: failed_state.nearest_cooldown_secs,
                };
                let _ = window_for_completion.emit("all-proxies-failed", payload);
            }
        }
    }

    Ok(results)
}

#[tauri::command]
async fn revalidate_emails_bulk(
    window: tauri::Window,
    validation_state: tauri::State<'_, validation::ValidationState>,
    settings_state: tauri::State<'_, settings::SettingsState>,
    items: Vec<validation::RevalidationRequest>,
    concurrency: usize,
    mode: String,
) -> Result<Vec<validation::ValidationResult>, String> {
    // Get the current proxy pool configuration and bypass flag
    let settings = settings_state.settings.read().await;
    let proxy_pool = settings.proxy_pool.clone();
    drop(settings);
    
    let proxy_bypass = *settings_state.proxy_bypass_for_session.read().await;

    // Check for no proxies configured (if proxy is enabled and not bypassed)
    if !proxy_bypass && proxy_pool.no_proxies_configured() {
        let _ = window.emit("no-proxies-configured", NoProxiesConfiguredPayload {
            message: "No proxies configured. Please add at least one proxy or disable proxy support.".to_string(),
        });
        return Err("No proxies configured".to_string());
    }

    // Check for all proxies failed (if proxy is enabled and not bypassed)
    if !proxy_bypass && proxy_pool.all_proxies_failed() {
        if let Some(failed_state) = proxy_pool.get_all_proxies_failed_state() {
            let payload = AllProxiesFailedPayload {
                failed_proxies: failed_state.failed_proxies.clone(),
                proxy_enabled: failed_state.proxy_enabled,
                total_proxies: failed_state.total_proxies,
                bad_count: failed_state.bad_count,
                cooldown_count: failed_state.cooldown_count,
                nearest_cooldown_secs: failed_state.nearest_cooldown_secs,
            };
            let _ = window.emit("all-proxies-failed", payload);
            return Err("All proxies are unavailable".to_string());
        }
    }

    // Create proxy rotation state if proxy is enabled, has proxies, and is not bypassed
    let proxy_state = if !proxy_bypass && proxy_pool.enabled && !proxy_pool.proxies.is_empty() {
        Some(Arc::new(validation::ProxyRotationState::new(proxy_pool)))
    } else {
        None
    };

    // Clone window for use in the progress callback
    let window_for_progress = window.clone();
    let window_for_completion = window.clone();

    let results = validation::revalidate_emails_bulk_core(
        items,
        concurrency,
        validation_state.get_token(),
        mode,
        proxy_state,
        move |res| {
            let _ = window_for_progress.emit("validation-progress", res);
        },
    ).await;

    // Update proxy stats based on results (only if proxy was used)
    if !proxy_bypass {
        let mut settings = settings_state.settings.write().await;
        for result in &results {
            if let Some(ref proxy_id) = result.proxy_id {
                // Consider "Safe" and "Risky" as success, "Invalid" and "Unknown" as failure
                if result.result == "Safe" || result.result == "Risky" {
                    settings.proxy_pool.record_success_with_duration(proxy_id, result.validation_duration as f64);
                } else {
                    settings.proxy_pool.record_failure(proxy_id);
                }
            }
        }

        // Check if all proxies have become unavailable during validation
        if settings.proxy_pool.all_proxies_failed() {
            if let Some(failed_state) = settings.proxy_pool.get_all_proxies_failed_state() {
                let payload = AllProxiesFailedPayload {
                    failed_proxies: failed_state.failed_proxies.clone(),
                    proxy_enabled: failed_state.proxy_enabled,
                    total_proxies: failed_state.total_proxies,
                    bad_count: failed_state.bad_count,
                    cooldown_count: failed_state.cooldown_count,
                    nearest_cooldown_secs: failed_state.nearest_cooldown_secs,
                };
                let _ = window_for_completion.emit("all-proxies-failed", payload);
            }
        }
    }

    Ok(results)
}

#[tauri::command]
fn pause_validation(state: tauri::State<'_, validation::ValidationState>) {
    state.cancel();
}

#[tauri::command]
fn resume_validation(state: tauri::State<'_, validation::ValidationState>) {
    state.reset();
}

#[tauri::command]
fn stop_validation(state: tauri::State<'_, validation::ValidationState>) {
    state.cancel();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let settings_state = settings::SettingsState::default();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(validation::ValidationState::default())
        .manage(settings_state)
        .invoke_handler(tauri::generate_handler![
            validate_emails_bulk,
            revalidate_emails_bulk,
            pause_validation,
            resume_validation,
            stop_validation,
            settings::load_settings,
            settings::save_settings,
            settings::reset_settings,
            settings::update_validator_config,
            settings::get_validator_config,
            settings::add_proxy,
            settings::update_proxy,
            settings::delete_proxy,
            settings::get_proxies,
            settings::clear_proxies,
            settings::get_proxy_pool,
            settings::update_proxy_pool_config,
            settings::assign_domain_proxy,
            settings::unassign_domain_proxy,
            settings::get_proxy_stats,
            settings::get_all_proxy_stats,
            settings::record_proxy_success,
            settings::record_proxy_failure,
            settings::reset_proxy_stats,
            settings::reset_all_proxy_stats,
            settings::is_proxy_in_cooldown,
            settings::get_remaining_cooldown,
            settings::bypass_proxy_cooldown,
            settings::get_cooldown_duration,
            settings::set_cooldown_duration,
            settings::check_all_proxies_failed,
            settings::get_all_proxies_failed_state,
            settings::check_no_proxies_configured,
            settings::check_proxy_availability,
            settings::set_proxy_bypass_for_session,
            settings::get_proxy_bypass_for_session,
            settings::clear_proxy_bypass_for_session,
            settings::get_max_emails_per_session,
            settings::set_max_emails_per_session,
            settings::check_email_count_limit,
            settings::get_auto_disable_threshold,
            settings::set_auto_disable_threshold,
            settings::re_enable_proxy,
            settings::record_proxy_success_with_duration,
            session::create_validation_session,
            session::update_validation_session,
            session::load_validation_session,
            session::list_validation_sessions,
            session::delete_validation_session,
            session::cleanup_old_sessions
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

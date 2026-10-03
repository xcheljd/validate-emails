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

/// Check proxy preconditions and create a proxy rotation state if applicable.
/// Emits the appropriate event and returns `Err` if validation should abort.
async fn prepare_proxy_state(
    window: &tauri::Window,
    settings_state: &tauri::State<'_, settings::SettingsState>,
) -> Result<Option<Arc<validation::ProxyRotationState>>, String> {
    let settings = settings_state.settings.read().await;
    let proxy_pool = settings.proxy_pool.clone();
    drop(settings);

    let proxy_bypass = *settings_state.proxy_bypass_for_session.read().await;

    if !proxy_bypass && proxy_pool.no_proxies_configured() {
        let _ = window.emit(
            "no-proxies-configured",
            NoProxiesConfiguredPayload {
                message: "No proxies configured. Please add at least one proxy or disable proxy support.".to_string(),
            },
        );
        return Err("No proxies configured".to_string());
    }

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

    let proxy_state = if !proxy_bypass && proxy_pool.enabled && !proxy_pool.proxies.is_empty() {
        Some(Arc::new(validation::ProxyRotationState::new(proxy_pool)))
    } else {
        None
    };

    Ok(proxy_state)
}

/// Update proxy pool stats after validation completes.
/// Also emits `all-proxies-failed` if proxies became unavailable during validation.
async fn update_proxy_stats(
    window: &tauri::Window,
    settings_state: &tauri::State<'_, settings::SettingsState>,
    results: &[validation::ValidationResult],
) {
    let proxy_bypass = *settings_state.proxy_bypass_for_session.read().await;
    if proxy_bypass {
        return;
    }

    let mut settings = settings_state.settings.write().await;
    for result in results {
        if let Some(ref proxy_id) = result.proxy_id {
            // Classify by transport outcome, not the mailbox verdict (B3).
            // Invalid/Unknown/builder-error are NOT proxy failures — a proxy
            // that round-tripped a definitive "no such mailbox" RCPT is
            // working fine. Only actual transport failures (SOCKS/IO/timeout
            // /IP-rejection) mark the proxy as failing; Neutral results
            // (quick mode, bad syntax, no MX) don't touch the stats at all.
            match result.proxy_outcome {
                validation::ProxyOutcome::Success => settings
                    .proxy_pool
                    .record_success_with_duration(proxy_id, result.validation_duration as f64),
                validation::ProxyOutcome::Failure => settings.proxy_pool.record_failure(proxy_id),
                validation::ProxyOutcome::Neutral => {}
            }
        }
    }

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
            let _ = window.emit("all-proxies-failed", payload);
        }
    }
}

/// Test-only: Emit a validation-progress event for E2E testing
#[cfg(feature = "e2e-testing")]
#[tauri::command]
async fn test_emit_validation_progress(
    window: tauri::Window,
    result: serde_json::Value,
) -> Result<(), String> {
    let validation_result: validation::ValidationResult = serde_json::from_value(result)
        .map_err(|e| format!("Failed to deserialize ValidationResult: {}", e))?;
    window.emit("validation-progress", validation_result).map_err(|e| e.to_string())
}

/// Test-only: Emit a validation-complete event for E2E testing
#[cfg(feature = "e2e-testing")]
#[tauri::command]
async fn test_emit_validation_complete(
    window: tauri::Window,
    total: usize,
    safe: usize,
    risky: usize,
    invalid: usize,
    unknown: usize,
    session_id: String,
) -> Result<(), String> {
    #[derive(serde::Serialize, Clone)]
    struct ValidationCompletePayload {
        total: usize,
        safe: usize,
        risky: usize,
        invalid: usize,
        unknown: usize,
        session_id: String,
    }
    window.emit("validation-complete", ValidationCompletePayload {
        total,
        safe,
        risky,
        invalid,
        unknown,
        session_id,
    }).map_err(|e| e.to_string())
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
    // Begin a new run: cancels any prior run and returns a fresh, uncancelled
    // token so this run starts clean even after a Stop/Pause.
    let token = validation_state.begin_run();

    let proxy_state = prepare_proxy_state(&window, &settings_state).await?;

    let window_for_progress = window.clone();
    let results = validation::validate_emails_bulk_core(
        emails,
        concurrency,
        token,
        mode,
        proxy_state,
        move |res| {
            let _ = window_for_progress.emit("validation-progress", res);
        },
    )
    .await;

    update_proxy_stats(&window, &settings_state, &results).await;

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
    // Begin a new run. Without this, a prior Stop/Pause would leave the
    // shared token cancelled, and revalidate would silently return [] (B5).
    let token = validation_state.begin_run();

    let proxy_state = prepare_proxy_state(&window, &settings_state).await?;

    let window_for_progress = window.clone();
    let results = validation::revalidate_emails_bulk_core(
        items,
        concurrency,
        token,
        mode,
        proxy_state,
        move |res| {
            let _ = window_for_progress.emit("validation-progress", res);
        },
    )
    .await;

    update_proxy_stats(&window, &settings_state, &results).await;

    Ok(results)
}

#[tauri::command]
fn pause_validation(state: tauri::State<'_, validation::ValidationState>) {
    state.cancel();
}

#[tauri::command]
fn resume_validation(state: tauri::State<'_, validation::ValidationState>) {
    state.begin_run();
}

#[tauri::command]
fn stop_validation(state: tauri::State<'_, validation::ValidationState>) {
    state.cancel();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let settings_state = settings::SettingsState::default();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(validation::ValidationState::default())
        .manage(settings_state);

    #[cfg(feature = "e2e-testing")]
    let builder = builder.plugin(tauri_plugin_playwright::init());

    builder
        .invoke_handler(tauri::generate_handler![
            validate_emails_bulk,
            revalidate_emails_bulk,
            pause_validation,
            resume_validation,
            stop_validation,
            #[cfg(feature = "e2e-testing")]
            test_emit_validation_progress,
            #[cfg(feature = "e2e-testing")]
            test_emit_validation_complete,
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

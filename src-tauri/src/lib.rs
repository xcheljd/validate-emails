mod app_paths;
mod atomic_write;
mod mx;
mod validation;
mod settings;
mod session;

use tauri::{Emitter, Manager};
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
    /// Run that emitted the event, so the UI can ignore superseded runs.
    pub run_id: u64,
}

impl AllProxiesFailedPayload {
    fn new(state: settings::proxy_pool::AllProxiesFailedState, run_id: u64) -> Self {
        Self {
            failed_proxies: state.failed_proxies,
            proxy_enabled: state.proxy_enabled,
            total_proxies: state.total_proxies,
            bad_count: state.bad_count,
            cooldown_count: state.cooldown_count,
            nearest_cooldown_secs: state.nearest_cooldown_secs,
            run_id,
        }
    }
}

/// Event payload for no-proxies-configured event  
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoProxiesConfiguredPayload {
    pub message: String,
}

/// `validation-progress` payload: the result plus the run that produced it.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressPayload {
    #[serde(flatten)]
    result: validation::ValidationResult,
    run_id: u64,
}

/// `waiting-for-proxy` payload: every proxy is cooling down and the run is
/// waiting in place (not paused) for the nearest expiry.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WaitingForProxyPayload {
    proxy_ids: Vec<String>,
    nearest_cooldown_secs: u64,
    run_id: u64,
}

/// `validation-run-started` payload, emitted before any other event of a run.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RunStartedPayload {
    run_id: u64,
}

/// Check proxy preconditions and snapshot the run's proxy policy.
/// Emits the appropriate event and returns `Err` if validation should abort.
async fn prepare_proxy_policy(
    window: &tauri::Window,
    settings_state: &tauri::State<'_, settings::SettingsState>,
    run_id: u64,
) -> Result<validation::ProxyPolicy, String> {
    let (pool_enabled, no_proxies, failed_state) = {
        let settings = settings_state.settings.read().await;
        let pool = &settings.proxy_pool;
        (pool.enabled, pool.no_proxies_configured(), pool.get_all_proxies_failed_state())
    };

    let proxy_bypass = *settings_state.proxy_bypass_for_session.read().await;

    if !proxy_bypass && no_proxies {
        let _ = window.emit(
            "no-proxies-configured",
            NoProxiesConfiguredPayload {
                message: "No proxies configured. Please add at least one proxy or disable proxy support.".to_string(),
            },
        );
        return Err("No proxies configured".to_string());
    }

    if !proxy_bypass {
        if let Some(failed_state) = failed_state {
            let _ = window.emit("all-proxies-failed", AllProxiesFailedPayload::new(failed_state, run_id));
            return Err("All proxies are unavailable".to_string());
        }
    }

    // Snapshot policy: with proxies on, this run must never go direct, even
    // if the pool is disabled or emptied while it runs (B8).
    let require_proxy = !proxy_bypass && pool_enabled;
    let state = if require_proxy {
        Some(Arc::new(validation::ProxyRotationState::new(
            settings_state.settings.clone(),
            validation::system_clock(),
        )))
    } else {
        None
    };

    Ok(validation::ProxyPolicy { state, require_proxy })
}

/// Snapshot the per-email validation settings for one run.
async fn validation_config_snapshot(
    settings_state: &tauri::State<'_, settings::SettingsState>,
) -> validation::ValidationConfig {
    let settings = settings_state.settings.read().await;
    validation::ValidationConfig::from_settings(&settings)
}

/// The run's dispatch rate limit (I1), if enabled. Quick mode never opens an
/// SMTP session through the proxy, so it is paced on one global limiter
/// instead of per proxy.
fn run_rate_limit(config: &validation::ValidationConfig, mode: &str) -> Option<validation::RateLimit> {
    config.rate_limiter.clone().map(|config| validation::RateLimit {
        config,
        per_proxy: mode != "quick",
    })
}

/// The run's shared MX state (I5): one resolver, a per-domain MX cache and
/// the per-MX session cap, all dropped when the run ends. Bound to the run's
/// token so a wait on an MX slot ends on Stop/Pause, and to the run's rate
/// limiter so an MX fallback (I6) is paced like a dispatch.
fn run_mx(
    config: &validation::ValidationConfig,
    token: &tokio_util::sync::CancellationToken,
    limiter: &Option<Arc<validation::RunLimiter>>,
) -> Arc<mx::MxRun> {
    Arc::new(mx::MxRun::new(config.mx_concurrency, token.clone(), limiter.clone()))
}

/// Forward a run's events to the window, stamped with its run id.
fn run_event_sink(window: tauri::Window, run_id: u64) -> impl Fn(validation::RunEvent) + Send + Sync {
    move |event| match event {
        validation::RunEvent::Progress(result) => {
            let _ = window.emit("validation-progress", ProgressPayload { result, run_id });
        }
        validation::RunEvent::WaitingForProxy { proxy_ids, nearest_cooldown_secs } => {
            let _ = window.emit(
                "waiting-for-proxy",
                WaitingForProxyPayload { proxy_ids, nearest_cooldown_secs, run_id },
            );
        }
        validation::RunEvent::AllProxiesFailed(state) => {
            let _ = window.emit("all-proxies-failed", AllProxiesFailedPayload::new(state, run_id));
        }
    }
}

/// Persist proxy health once per run. Stats are recorded live during the
/// run (B7) and kept in memory only — persisting per email would be an I/O
/// storm — so this single write at run end (including a self-pause, which
/// also ends the run) is what makes them survive a restart.
async fn persist_run_stats(
    settings_state: &tauri::State<'_, settings::SettingsState>,
    used_pool: bool,
) {
    if !used_pool {
        return;
    }
    if let Err(e) =
        settings::persist_settings_to(&settings_state.settings, &settings_state.settings_path).await
    {
        eprintln!("Failed to persist proxy stats after run: {}", e);
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
) -> Result<validation::RunOutcome, String> {
    // Begin a new run: cancels any prior run and returns a fresh, uncancelled
    // token so this run starts clean even after a Stop/Pause.
    let (run_id, token) = validation_state.begin_run_with_id();
    let _ = window.emit("validation-run-started", RunStartedPayload { run_id });

    let policy = prepare_proxy_policy(&window, &settings_state, run_id).await?;
    let used_pool = policy.state.is_some();
    let config = validation_config_snapshot(&settings_state).await;
    let limiter = run_rate_limit(&config, &mode).map(|rate| Arc::new(validation::RunLimiter::new(rate)));
    let mx = run_mx(&config, &token, &limiter);

    let outcome = validation::validate_emails_bulk_with_limiter(
        emails,
        concurrency,
        token,
        policy,
        move |email, proxy| {
            validation::validate_email_in_run(email, mode.clone(), proxy, config.clone(), mx.clone())
        },
        run_event_sink(window.clone(), run_id),
        limiter,
    )
    .await;

    persist_run_stats(&settings_state, used_pool).await;

    Ok(outcome)
}

#[tauri::command]
async fn revalidate_emails_bulk(
    window: tauri::Window,
    validation_state: tauri::State<'_, validation::ValidationState>,
    settings_state: tauri::State<'_, settings::SettingsState>,
    items: Vec<validation::RevalidationRequest>,
    concurrency: usize,
    mode: String,
) -> Result<validation::RunOutcome, String> {
    // Begin a new run. Without this, a prior Stop/Pause would leave the
    // shared token cancelled, and revalidate would silently return [] (B5).
    let (run_id, token) = validation_state.begin_run_with_id();
    let _ = window.emit("validation-run-started", RunStartedPayload { run_id });

    let policy = prepare_proxy_policy(&window, &settings_state, run_id).await?;
    let used_pool = policy.state.is_some();
    let config = validation_config_snapshot(&settings_state).await;
    let limiter = run_rate_limit(&config, &mode).map(|rate| Arc::new(validation::RunLimiter::new(rate)));
    let mx = run_mx(&config, &token, &limiter);

    let outcome = validation::revalidate_emails_bulk_core(
        items,
        concurrency,
        token,
        policy,
        move |email, proxy| {
            validation::validate_email_in_run(email, mode.clone(), proxy, config.clone(), mx.clone())
        },
        run_event_sink(window.clone(), run_id),
        limiter,
    )
    .await;

    persist_run_stats(&settings_state, used_pool).await;

    Ok(outcome)
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
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(validation::ValidationState::default())
        .setup(|app| {
            // Data lives under the platform app data dir; legacy data is
            // copied over on first launch (I10).
            let paths = app_paths::resolve(app.handle());
            app.manage(settings::SettingsState::from_path(paths.settings_file));
            app.manage(session::SessionStore::new(paths.sessions_dir));
            Ok(())
        });

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
            settings::get_corrupt_settings_warning,
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

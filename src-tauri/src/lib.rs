mod validation;
mod settings;
mod session;

use tauri::Emitter;
use std::sync::Arc;

#[tauri::command]
async fn validate_emails_bulk(
    window: tauri::Window,
    validation_state: tauri::State<'_, validation::ValidationState>,
    settings_state: tauri::State<'_, settings::SettingsState>,
    emails: Vec<String>,
    concurrency: usize,
    mode: String,
) -> Result<Vec<validation::ValidationResult>, String> {
    // Get the current proxy pool configuration
    let settings = settings_state.settings.read().await;
    let proxy_pool = settings.proxy_pool.clone();
    drop(settings);

    // Create proxy rotation state if proxy is enabled and has proxies
    let proxy_state = if proxy_pool.enabled && !proxy_pool.proxies.is_empty() {
        Some(Arc::new(validation::ProxyRotationState::new(proxy_pool)))
    } else {
        None
    };

    let results = validation::validate_emails_bulk_core(
        emails,
        concurrency,
        validation_state.get_token(),
        mode,
        proxy_state,
        move |res| {
            let _ = window.emit("validation-progress", res);
        },
    ).await;

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
    // Get the current proxy pool configuration
    let settings = settings_state.settings.read().await;
    let proxy_pool = settings.proxy_pool.clone();
    drop(settings);

    // Create proxy rotation state if proxy is enabled and has proxies
    let proxy_state = if proxy_pool.enabled && !proxy_pool.proxies.is_empty() {
        Some(Arc::new(validation::ProxyRotationState::new(proxy_pool)))
    } else {
        None
    };

    let results = validation::revalidate_emails_bulk_core(
        items,
        concurrency,
        validation_state.get_token(),
        mode,
        proxy_state,
        move |res| {
            let _ = window.emit("validation-progress", res);
        },
    ).await;

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

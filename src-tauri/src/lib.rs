// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod validation;
mod proxy;
mod settings;
mod session;
use tauri::Emitter;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn validate_email(email: String) -> Result<validation::ValidationResult, String> {
    // For single email validation, we might skip proxy or use it if we want consistency.
    // For now, let's keep it simple and direct.
    Ok(validation::validate_email(email, None, "standard".to_string()).await)
}

#[tauri::command]
async fn validate_emails_bulk(
    window: tauri::Window,
    state: tauri::State<'_, validation::ValidationState>,
    proxy_state: tauri::State<'_, proxy::ProxyState>,
    emails: Vec<String>,
    concurrency: usize,
    mode: String,
) -> Result<Vec<validation::ValidationResult>, String> {
    let results = validation::validate_emails_bulk_core(
        emails,
        concurrency,
        state.get_token(),
        proxy_state.pool.clone(),
        mode,
        move |res| {
            let _ = window.emit("validation-progress", res);
        },
    ).await;

    Ok(results)
}

#[tauri::command]
async fn revalidate_emails_bulk(
    window: tauri::Window,
    state: tauri::State<'_, validation::ValidationState>,
    proxy_state: tauri::State<'_, proxy::ProxyState>,
    items: Vec<validation::RevalidationRequest>,
    concurrency: usize,
    mode: String,
) -> Result<Vec<validation::ValidationResult>, String> {
    let results = validation::revalidate_emails_bulk_core(
        items,
        concurrency,
        state.get_token(),
        proxy_state.pool.clone(),
        mode,
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
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(validation::ValidationState::default())
        .manage(proxy::ProxyState::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            validate_email,
            validate_emails_bulk,
            revalidate_emails_bulk,
            pause_validation,
            resume_validation,
            stop_validation,
            proxy::add_proxies,
            proxy::fetch_proxies,
            proxy::get_proxy_status,
            proxy::refresh_proxies,
            proxy::clear_proxies,
            settings::load_settings,
            settings::save_settings,
            settings::reset_settings,
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
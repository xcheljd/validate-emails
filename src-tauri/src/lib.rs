// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod validation;
use tauri::Emitter;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn validate_email(email: String) -> Result<validation::ValidationResult, String> {
    Ok(validation::validate_email(email).await)
}

#[tauri::command]
async fn validate_emails_bulk(
    window: tauri::Window,
    state: tauri::State<'_, validation::ValidationState>,
    emails: Vec<String>,
    concurrency: usize,
) -> Result<Vec<validation::ValidationResult>, String> {
    let results = validation::validate_emails_bulk_core(
        emails,
        concurrency,
        state.get_token(),
        move |res| {
            let _ = window.emit("validation-progress", res);
        },
    ).await;

    Ok(results)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(validation::ValidationState::default())
        .invoke_handler(tauri::generate_handler![
            greet, 
            validate_email, 
            validate_emails_bulk
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

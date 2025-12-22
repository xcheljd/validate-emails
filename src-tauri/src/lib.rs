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
    emails: Vec<String>,
    concurrency: usize,
) -> Result<Vec<validation::ValidationResult>, String> {
    use futures::stream::{self, StreamExt};

    let total = emails.len();
    let mut results = Vec::with_capacity(total);
    
    let mut stream = stream::iter(emails)
        .map(|email| async move {
            validation::validate_email(email).await
        })
        .buffer_unordered(concurrency);

    while let Some(result) = stream.next().await {
        results.push(result.clone());
        // Emit progress event
        let _ = window.emit("validation-progress", result);
    }

    Ok(results)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet, 
            validate_email, 
            validate_emails_bulk
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

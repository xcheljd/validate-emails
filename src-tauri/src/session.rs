use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::fs;
use chrono::{Utc, Duration};
use crate::validation::ValidationResult;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionSettings {
    pub validation_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationSession {
    pub id: String,
    pub name: String,
    pub emails: Vec<String>,
    pub results: Vec<ValidationResult>,
    pub status: String,
    pub current_index: usize,
    pub total: usize,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub settings: SessionSettings,
}

pub struct SessionManager {
    sessions_dir: PathBuf,
}

impl SessionManager {
    pub fn new() -> Result<Self, String> {
        let mut sessions_dir = std::env::var("HOME")
            .map(|home| std::path::PathBuf::from(home))
            .unwrap_or_else(|_| std::path::PathBuf::from("."));
        
        sessions_dir.push(".local");
        sessions_dir.push("share");
        sessions_dir.push("com.yourcompany.emailvalidator");
        sessions_dir.push("sessions");

        if !sessions_dir.exists() {
            fs::create_dir_all(&sessions_dir)
                .map_err(|e| format!("Failed to create sessions directory: {}", e))?;
        }

        Ok(Self { sessions_dir })
    }

    pub fn create_session(&self, name: String, emails: Vec<String>, settings: SessionSettings) -> Result<String, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let session = ValidationSession {
            id: id.clone(),
            name,
            emails: emails.clone(),
            results: Vec::new(),
            status: "pending".to_string(),
            current_index: 0,
            total: emails.len(),
            created_at: Utc::now().to_rfc3339(),
            completed_at: None,
            settings,
        };

        self.save_session(&id, &session)?;
        Ok(id)
    }

    pub fn update_session_progress(&self, id: &str, results: Vec<ValidationResult>, current_index: usize, backup: bool) -> Result<(), String> {
        let mut session = self.load_session(id)?;
        
        if backup {
            let backup_filename = format!("{}-{}.json", id, Utc::now().format("%Y%m%d-%H%M%S"));
            self.backup_session(id, &backup_filename)?;
        }

        session.results = results;
        session.current_index = current_index;
        
        if current_index >= session.total {
            session.status = "completed".to_string();
            session.completed_at = Some(Utc::now().to_rfc3339());
        } else if current_index > 0 {
            session.status = "in-progress".to_string();
        }
        
        self.save_session(&id, &session)
    }

    pub fn backup_session(&self, id: &str, backup_path: &str) -> Result<(), String> {
        let session = self.load_session(id)?;
        
        let backup_dir = self.sessions_dir.join("backups");
        if !backup_dir.exists() {
            fs::create_dir_all(&backup_dir)
                .map_err(|e| format!("Failed to create backup directory: {}", e))?;
        }
        
        let backup_path = backup_dir.join(&backup_path);
        let json = serde_json::to_string(&session)
            .map_err(|e| format!("Failed to serialize session for backup: {}", e))?;
        
        fs::write(&backup_path, json)
            .map_err(|e| format!("Failed to write backup: {}", e))
    }

    pub fn load_session(&self, id: &str) -> Result<ValidationSession, String> {
        let session_path = self.get_session_path(id);
        
        let content = fs::read_to_string(&session_path)
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    format!("Session not found: {}. The session may have been deleted or moved.", id)
                } else {
                    format!("Failed to read session file: {}", e)
                }
            })?;

        let session: ValidationSession = serde_json::from_str(&content)
            .map_err(|e| {
                if e.is_data() {
                    format!("Corrupted session data: {}. The session file contains invalid data. You may need to restore from a backup if available.", e)
                } else if e.is_syntax() {
                    format!("Invalid session file format: {}. The session file appears to be corrupted or was modified externally.", e)
                } else {
                    format!("Failed to parse session file: {}", e)
                }
            })?;

        Ok(session)
    }

    pub fn list_sessions(&self) -> Result<Vec<ValidationSession>, String> {
        let sessions_dir = &self.sessions_dir;
        let mut sessions = Vec::new();

        if let Ok(entries) = fs::read_dir(sessions_dir) {
            for entry in entries.flatten() {
                let path = entry.path();

                if path.extension().and_then(|s| s.to_str()) == Some("json") {
                    if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
                        if filename != "sessions.json" {
                            if let Ok(content) = fs::read_to_string(&path) {
                                if let Ok(session) = serde_json::from_str::<ValidationSession>(&content) {
                                    sessions.push(session);
                                }
                            }
                        }
                    }
                }
            }
        }

        sessions.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(sessions)
    }

    pub fn delete_session(&self, id: &str) -> Result<(), String> {
        let session_path = self.get_session_path(id);
        fs::remove_file(&session_path)
            .map_err(|e| format!("Failed to delete session file: {}", e))
    }

    pub fn cleanup_old_sessions(&self, days: u32) -> Result<usize, String> {
        let sessions_dir = &self.sessions_dir;
        let cutoff_time = Utc::now() - Duration::days(days as i64);
        let mut deleted_count = 0;

        if let Ok(entries) = fs::read_dir(sessions_dir) {
            for entry in entries.flatten() {
                let path = entry.path();

                if path.extension().and_then(|s| s.to_str()) == Some("json") {
                    if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
                        if filename != "sessions.json" {
                            if let Ok(content) = fs::read_to_string(&path) {
                                if let Ok(session) = serde_json::from_str::<ValidationSession>(&content) {
                                    if let Ok(created_at) = chrono::DateTime::parse_from_rfc3339(&session.created_at) {
                                        if created_at < cutoff_time {
                                            fs::remove_file(&path)
                                                .map_err(|e| format!("Failed to delete old session file: {}", e))?;
                                            deleted_count += 1;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        Ok(deleted_count)
    }

    fn save_session(&self, id: &str, session: &ValidationSession) -> Result<(), String> {
        let session_path = self.get_session_path(id);
        let json = serde_json::to_string(session)
            .map_err(|e| format!("Failed to serialize session: {}", e))?;

        fs::write(&session_path, json)
            .map_err(|e| format!("Failed to write session file: {}", e))
    }

    fn get_session_path(&self, id: &str) -> PathBuf {
        self.sessions_dir.join(format!("{}.json", id))
    }

    fn generate_session_name(&self) -> String {
        let now = Utc::now();
        now.format("%b %d, %Y %-I:%M %p").to_string()
    }
}

#[tauri::command]
pub async fn create_validation_session(emails: Vec<String>, settings: SessionSettings) -> Result<String, String> {
    let manager = SessionManager::new()?;
    let name = manager.generate_session_name();
    let id = manager.create_session(name, emails, settings)?;
    Ok(id)
}

#[tauri::command]
pub async fn update_validation_session(id: String, results: Vec<ValidationResult>, current_index: usize, backup: bool) -> Result<(), String> {
    let manager = SessionManager::new()?;
    manager.update_session_progress(&id, results, current_index, backup)
}

#[tauri::command]
pub async fn load_validation_session(id: String) -> Result<ValidationSession, String> {
    let manager = SessionManager::new()?;
    manager.load_session(&id)
}

#[tauri::command]
pub async fn list_validation_sessions() -> Result<Vec<ValidationSession>, String> {
    let manager = SessionManager::new()?;
    manager.list_sessions()
}

#[tauri::command]
pub async fn delete_validation_session(id: String) -> Result<(), String> {
    let manager = SessionManager::new()?;
    manager.delete_session(&id)
}

#[tauri::command]
pub async fn cleanup_old_sessions(days: u32) -> Result<usize, String> {
    let manager = SessionManager::new()?;
    manager.cleanup_old_sessions(days)
}
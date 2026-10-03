use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
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

        Self::with_dir(sessions_dir)
    }

    /// Creates a manager rooted at an explicit sessions directory (used by tests).
    pub fn with_dir(sessions_dir: PathBuf) -> Result<Self, String> {
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
            self.backup_session(id)?;
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

    pub fn backup_session(&self, id: &str) -> Result<(), String> {
        // Validate before touching the filesystem (load_session validates too,
        // but the backup filename is derived from the id as well).
        Self::validate_session_id(id)?;
        let session = self.load_session(id)?;
        
        let backup_dir = self.sessions_dir.join("backups");
        if !backup_dir.exists() {
            fs::create_dir_all(&backup_dir)
                .map_err(|e| format!("Failed to create backup directory: {}", e))?;
        }
        
        let backup_filename = format!("{}-{}.json", id, Utc::now().format("%Y%m%d-%H%M%S"));
        let backup_path = Self::contained_path(&backup_dir, &backup_filename)?;
        let json = serde_json::to_string(&session)
            .map_err(|e| format!("Failed to serialize session for backup: {}", e))?;
        
        fs::write(&backup_path, json)
            .map_err(|e| format!("Failed to write backup: {}", e))
    }

    pub fn load_session(&self, id: &str) -> Result<ValidationSession, String> {
        let session_path = self.validated_session_path(id)?;
        
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
        let session_path = self.validated_session_path(id)?;
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
        let session_path = self.validated_session_path(id)?;
        let json = serde_json::to_string(session)
            .map_err(|e| format!("Failed to serialize session: {}", e))?;

        fs::write(&session_path, json)
            .map_err(|e| format!("Failed to write session file: {}", e))
    }

    /// Session ids are `Uuid::new_v4()` strings (hex digits and '-'). Ids arrive
    /// from the frontend, so anything outside that alphabet is rejected before it
    /// can be joined into a path (e.g. "../settings", "a/b", "..\\x", "").
    fn validate_session_id(id: &str) -> Result<(), String> {
        let is_safe = !id.is_empty()
            && id.len() <= 64
            && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
        if is_safe {
            Ok(())
        } else {
            Err(format!("Invalid session id: {:?}", id))
        }
    }

    /// Joins `file_name` onto `dir` and verifies the result is a direct child of `dir`.
    fn contained_path(dir: &Path, file_name: &str) -> Result<PathBuf, String> {
        let path = dir.join(file_name);
        if path.parent() != Some(dir) || path.file_name().and_then(|n| n.to_str()) != Some(file_name) {
            return Err("Invalid session path".to_string());
        }
        Ok(path)
    }

    fn validated_session_path(&self, id: &str) -> Result<PathBuf, String> {
        Self::validate_session_id(id)?;
        Self::contained_path(&self.sessions_dir, &format!("{}.json", id))
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
#[cfg(test)]
mod tests {
    use super::*;

    /// Per-test temp root containing a `sessions/` dir and a sibling `settings.json`
    /// that a traversal id like "../settings" would target.
    struct Fixture {
        root: PathBuf,
        manager: SessionManager,
        outside_file: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("session-test-{}", uuid::Uuid::new_v4()));
            let sessions_dir = root.join("sessions");
            let manager = SessionManager::with_dir(sessions_dir).expect("create manager");
            let outside_file = root.join("settings.json");
            fs::write(&outside_file, r#"{"keep":"me"}"#).expect("write outside file");
            Self { root, manager, outside_file }
        }

        fn dir_entries(&self, dir: &Path) -> Vec<PathBuf> {
            let mut entries: Vec<PathBuf> = fs::read_dir(dir)
                .map(|rd| rd.flatten().map(|e| e.path()).collect())
                .unwrap_or_default();
            entries.sort();
            entries
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    const MALICIOUS_IDS: &[&str] = &[
        "../settings",
        "..",
        "a/../b",
        "",
        "..\\settings",
        "/etc/passwd",
        "C:\\Windows\\settings",
        "sessions/../../settings",
        "abc.json",
    ];

    fn settings() -> SessionSettings {
        SessionSettings { validation_mode: "standard".to_string() }
    }

    #[test]
    fn delete_rejects_traversal_and_outside_file_survives() {
        let fx = Fixture::new();
        // Also put a file inside the sessions dir to prove nothing in there is touched.
        let inside = fx.manager.sessions_dir.join("settings.json");
        fs::write(&inside, "{}").unwrap();
        let before_root = fx.dir_entries(&fx.root);
        let before_sessions = fx.dir_entries(&fx.manager.sessions_dir);

        for id in MALICIOUS_IDS {
            let err = fx.manager.delete_session(id).expect_err(&format!("{:?} must be rejected", id));
            assert!(err.contains("Invalid session id"), "unexpected error for {:?}: {}", id, err);
        }

        assert!(fx.outside_file.exists(), "file outside sessions dir was deleted");
        assert_eq!(fs::read_to_string(&fx.outside_file).unwrap(), r#"{"keep":"me"}"#);
        assert!(inside.exists());
        assert_eq!(fx.dir_entries(&fx.root), before_root);
        assert_eq!(fx.dir_entries(&fx.manager.sessions_dir), before_sessions);
    }

    #[test]
    fn load_rejects_traversal() {
        let fx = Fixture::new();
        for id in MALICIOUS_IDS {
            let err = fx.manager.load_session(id).expect_err(&format!("{:?} must be rejected", id));
            assert!(err.contains("Invalid session id"), "unexpected error for {:?}: {}", id, err);
        }
        assert!(fx.outside_file.exists());
    }

    #[test]
    fn update_rejects_traversal_without_writing() {
        let fx = Fixture::new();
        let before_root = fx.dir_entries(&fx.root);
        let before_sessions = fx.dir_entries(&fx.manager.sessions_dir);

        for id in MALICIOUS_IDS {
            let err = fx
                .manager
                .update_session_progress(id, Vec::new(), 0, true)
                .expect_err(&format!("{:?} must be rejected", id));
            assert!(err.contains("Invalid session id"), "unexpected error for {:?}: {}", id, err);
        }

        assert_eq!(fs::read_to_string(&fx.outside_file).unwrap(), r#"{"keep":"me"}"#);
        assert_eq!(fx.dir_entries(&fx.root), before_root);
        assert_eq!(fx.dir_entries(&fx.manager.sessions_dir), before_sessions);
    }

    #[test]
    fn backup_rejects_traversal_and_writes_nothing() {
        let fx = Fixture::new();
        let before_root = fx.dir_entries(&fx.root);

        for id in MALICIOUS_IDS {
            let err = fx.manager.backup_session(id).expect_err(&format!("{:?} must be rejected", id));
            assert!(err.contains("Invalid session id"), "unexpected error for {:?}: {}", id, err);
        }

        assert_eq!(fx.dir_entries(&fx.root), before_root);
        assert!(!fx.manager.sessions_dir.join("backups").exists(), "backups dir should not be created");
        assert_eq!(fs::read_to_string(&fx.outside_file).unwrap(), r#"{"keep":"me"}"#);
    }

    #[test]
    fn valid_uuid_session_round_trips() {
        let fx = Fixture::new();
        let emails = vec!["a@example.com".to_string(), "b@example.com".to_string()];
        let id = fx.manager.create_session("test".to_string(), emails.clone(), settings()).unwrap();
        assert!(uuid::Uuid::parse_str(&id).is_ok());

        let loaded = fx.manager.load_session(&id).unwrap();
        assert_eq!(loaded.id, id);
        assert_eq!(loaded.emails, emails);
        assert_eq!(loaded.total, 2);

        fx.manager.update_session_progress(&id, Vec::new(), 1, true).unwrap();
        assert_eq!(fx.manager.load_session(&id).unwrap().status, "in-progress");
        let backups = fx.dir_entries(&fx.manager.sessions_dir.join("backups"));
        assert_eq!(backups.len(), 1);
        let backup_name = backups[0].file_name().unwrap().to_str().unwrap();
        assert!(backup_name.starts_with(&format!("{}-", id)) && backup_name.ends_with(".json"));

        fx.manager.delete_session(&id).unwrap();
        assert!(!fx.manager.sessions_dir.join(format!("{}.json", id)).exists());
        assert!(fx.manager.load_session(&id).unwrap_err().contains("Session not found"));
        assert!(fx.outside_file.exists());
    }

    #[test]
    fn validate_session_id_rules() {
        assert!(SessionManager::validate_session_id(&uuid::Uuid::new_v4().to_string()).is_ok());
        assert!(SessionManager::validate_session_id("abc-123").is_ok());
        for id in MALICIOUS_IDS {
            assert!(SessionManager::validate_session_id(id).is_err(), "{:?} should be invalid", id);
        }
        assert!(SessionManager::validate_session_id(&"a".repeat(65)).is_err());
    }
}

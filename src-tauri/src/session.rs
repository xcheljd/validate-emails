use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::fs;
use chrono::{DateTime, NaiveDateTime, Utc, Duration};
use crate::validation::ValidationResult;
use crate::atomic_write::atomic_write;

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

/// Newest backups kept per session id; older ones are pruned (B18).
const MAX_BACKUPS_PER_SESSION: usize = 5;
/// Timestamp part of a backup filename: `<id>-<YYYYmmdd-HHMMSS>.json`.
const BACKUP_TS_FORMAT: &str = "%Y%m%d-%H%M%S";
const BACKUP_TS_LEN: usize = 15;
/// Statuses the frontend may set explicitly; the rest are derived from
/// progress.
const CALLER_STATUSES: &[&str] = &["paused", "stopped"];

/// Result of a cleanup sweep. `skipped` counts entries that could not be
/// read, parsed or deleted; the sweep carries on past them.
#[derive(Debug, Default, PartialEq)]
struct SweepReport {
    deleted: usize,
    skipped: usize,
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

    /// Saves progress. `status` may be "paused" or "stopped" to record why
    /// the run halted; a finished session is "completed" regardless, and
    /// without a status any progress means "in-progress".
    pub fn update_session_progress(
        &self,
        id: &str,
        results: Vec<ValidationResult>,
        current_index: usize,
        backup: bool,
        status: Option<&str>,
    ) -> Result<(), String> {
        if let Some(status) = status {
            if !CALLER_STATUSES.contains(&status) {
                return Err(format!("Invalid session status: {:?}", status));
            }
        }
        let mut session = self.load_session(id)?;
        
        if backup {
            self.backup_session(id)?;
        }

        session.results = results;
        session.current_index = current_index;
        
        if current_index >= session.total {
            session.status = "completed".to_string();
            session.completed_at = Some(Utc::now().to_rfc3339());
        } else if let Some(status) = status {
            session.status = status.to_string();
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
        
        atomic_write(&backup_path, json.as_bytes())
            .map_err(|e| format!("Failed to write backup: {}", e))?;

        // Cap this session's backups now so a long run can't grow them
        // without bound between sweeps. Best effort: the backup itself
        // succeeded.
        let mut report = SweepReport::default();
        Self::prune_backups(&backup_dir, None, Some(id), &mut report);
        Ok(())
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

    /// Deletes sessions created more than `days` ago and prunes backups
    /// (older than `days`, or beyond the newest MAX_BACKUPS_PER_SESSION per
    /// session). Returns the number of files deleted.
    pub fn cleanup_old_sessions(&self, days: u32) -> Result<usize, String> {
        // Saturate instead of panicking on a huge `days`.
        let cutoff = Utc::now()
            .checked_sub_signed(Duration::days(days as i64))
            .unwrap_or(DateTime::<Utc>::MIN_UTC);
        let report = self.sweep(cutoff);
        if report.skipped > 0 {
            eprintln!(
                "[sessions] cleanup deleted {} file(s), skipped {} unreadable/undeletable entr(ies)",
                report.deleted, report.skipped
            );
        }
        Ok(report.deleted)
    }

    /// One sweep. Never aborts on a per-file error: it is logged, counted in
    /// `skipped`, and the sweep moves on.
    fn sweep(&self, cutoff: DateTime<Utc>) -> SweepReport {
        let mut report = SweepReport::default();

        match fs::read_dir(&self.sessions_dir) {
            Ok(entries) => {
                for entry in entries {
                    let path = match entry {
                        Ok(entry) => entry.path(),
                        Err(e) => {
                            eprintln!("[sessions] cleanup: unreadable entry: {}", e);
                            report.skipped += 1;
                            continue;
                        }
                    };
                    let filename = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                    if path.extension().and_then(|s| s.to_str()) != Some("json")
                        || filename == "sessions.json"
                    {
                        continue;
                    }
                    match Self::session_created_at(&path) {
                        Ok(created_at) if created_at < cutoff => Self::remove(&path, &mut report),
                        Ok(_) => {}
                        Err(e) => {
                            eprintln!("[sessions] cleanup: skipping {}: {}", path.display(), e);
                            report.skipped += 1;
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("[sessions] cleanup: cannot read sessions dir: {}", e);
                report.skipped += 1;
            }
        }

        Self::prune_backups(&self.sessions_dir.join("backups"), Some(cutoff), None, &mut report);
        report
    }

    fn session_created_at(path: &Path) -> Result<DateTime<Utc>, String> {
        let content = fs::read_to_string(path).map_err(|e| format!("read failed: {}", e))?;
        let session: ValidationSession =
            serde_json::from_str(&content).map_err(|e| format!("not a session: {}", e))?;
        DateTime::parse_from_rfc3339(&session.created_at)
            .map(|t| t.with_timezone(&Utc))
            .map_err(|e| format!("bad created_at: {}", e))
    }

    /// Splits a backup filename `<id>-<YYYYmmdd-HHMMSS>.json` into its id and
    /// timestamp. Anything else (temp files, foreign files) is None.
    fn parse_backup_name(name: &str) -> Option<(&str, DateTime<Utc>)> {
        let stem = name.strip_suffix(".json")?;
        if !stem.is_ascii() || stem.len() <= BACKUP_TS_LEN + 1 {
            return None;
        }
        let (id, ts) = stem.split_at(stem.len() - BACKUP_TS_LEN);
        let id = id.strip_suffix('-')?;
        Self::validate_session_id(id).ok()?;
        let ts = NaiveDateTime::parse_from_str(ts, BACKUP_TS_FORMAT).ok()?;
        Some((id, ts.and_utc()))
    }

    /// Deletes backups older than `cutoff` (if given) and all but the newest
    /// MAX_BACKUPS_PER_SESSION per id. `only_id` restricts this to one
    /// session's backups.
    fn prune_backups(
        backup_dir: &Path,
        cutoff: Option<DateTime<Utc>>,
        only_id: Option<&str>,
        report: &mut SweepReport,
    ) {
        let entries = match fs::read_dir(backup_dir) {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return,
            Err(e) => {
                eprintln!("[sessions] cleanup: cannot read backups dir: {}", e);
                report.skipped += 1;
                return;
            }
        };

        let mut by_id: HashMap<String, Vec<(DateTime<Utc>, PathBuf)>> = HashMap::new();
        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(e) => {
                    eprintln!("[sessions] cleanup: unreadable backup entry: {}", e);
                    report.skipped += 1;
                    continue;
                }
            };
            let file_name = entry.file_name();
            let Some((id, ts)) = file_name.to_str().and_then(Self::parse_backup_name) else {
                continue;
            };
            if only_id.is_some_and(|only| only != id) {
                continue;
            }
            by_id.entry(id.to_string()).or_default().push((ts, entry.path()));
        }

        for backups in by_id.values_mut() {
            backups.sort_by(|a, b| b.0.cmp(&a.0));
            for (i, (ts, path)) in backups.iter().enumerate() {
                let expired = cutoff.is_some_and(|cutoff| *ts < cutoff);
                if i >= MAX_BACKUPS_PER_SESSION || expired {
                    Self::remove(path, report);
                }
            }
        }
    }

    fn remove(path: &Path, report: &mut SweepReport) {
        match fs::remove_file(path) {
            Ok(()) => report.deleted += 1,
            // Already gone (e.g. a concurrent sweep): nothing to do.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                eprintln!("[sessions] cleanup: failed to delete {}: {}", path.display(), e);
                report.skipped += 1;
            }
        }
    }

    fn save_session(&self, id: &str, session: &ValidationSession) -> Result<(), String> {
        let session_path = self.validated_session_path(id)?;
        let json = serde_json::to_string(session)
            .map_err(|e| format!("Failed to serialize session: {}", e))?;

        atomic_write(&session_path, json.as_bytes())
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

/// Runs blocking session I/O off the async runtime's worker threads.
async fn run_blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| format!("Session task failed: {}", e))?
}

#[tauri::command]
pub async fn create_validation_session(emails: Vec<String>, settings: SessionSettings) -> Result<String, String> {
    run_blocking(move || {
        let manager = SessionManager::new()?;
        let name = manager.generate_session_name();
        manager.create_session(name, emails, settings)
    })
    .await
}

#[tauri::command]
pub async fn update_validation_session(
    id: String,
    results: Vec<ValidationResult>,
    current_index: usize,
    backup: bool,
    status: Option<String>,
) -> Result<(), String> {
    run_blocking(move || {
        SessionManager::new()?.update_session_progress(&id, results, current_index, backup, status.as_deref())
    })
    .await
}

#[tauri::command]
pub async fn load_validation_session(id: String) -> Result<ValidationSession, String> {
    run_blocking(move || SessionManager::new()?.load_session(&id)).await
}

#[tauri::command]
pub async fn list_validation_sessions() -> Result<Vec<ValidationSession>, String> {
    run_blocking(|| SessionManager::new()?.list_sessions()).await
}

#[tauri::command]
pub async fn delete_validation_session(id: String) -> Result<(), String> {
    run_blocking(move || SessionManager::new()?.delete_session(&id)).await
}

#[tauri::command]
pub async fn cleanup_old_sessions(days: u32) -> Result<usize, String> {
    run_blocking(move || SessionManager::new()?.cleanup_old_sessions(days)).await
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
                .update_session_progress(id, Vec::new(), 0, true, None)
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

        fx.manager.update_session_progress(&id, Vec::new(), 1, true, None).unwrap();
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

    fn temp_residue(dir: &Path) -> Vec<PathBuf> {
        fs::read_dir(dir)
            .map(|rd| rd.flatten().map(|e| e.path()).collect::<Vec<_>>())
            .unwrap_or_default()
            .into_iter()
            .filter(|p| p.file_name().and_then(|n| n.to_str()).map_or(false, |n| n.contains(".tmp.")))
            .collect()
    }

    #[test]
    fn save_session_is_atomic_and_round_trips() {
        let fx = Fixture::new();
        let emails: Vec<String> = (0..500).map(|i| format!("user{}@example.com", i)).collect();
        let id = fx.manager.create_session("atomic".to_string(), emails.clone(), settings()).unwrap();
        let mut session = fx.manager.load_session(&id).unwrap();
        session.status = "in-progress".to_string();
        session.current_index = 42;

        fx.manager.save_session(&id, &session).unwrap();
        fx.manager.backup_session(&id).unwrap();

        let loaded = fx.manager.load_session(&id).unwrap();
        assert_eq!(serde_json::to_value(&loaded).unwrap(), serde_json::to_value(&session).unwrap());
        assert_eq!(loaded.emails, emails);
        assert!(temp_residue(&fx.manager.sessions_dir).is_empty());
        let backup_dir = fx.manager.sessions_dir.join("backups");
        assert!(temp_residue(&backup_dir).is_empty());
        assert_eq!(fx.dir_entries(&backup_dir).len(), 1);
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

    fn backup_dir(fx: &Fixture) -> PathBuf {
        let dir = fx.manager.sessions_dir.join("backups");
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Writes a backup for `id` stamped `age` ago, named like backup_session's.
    fn fake_backup(fx: &Fixture, id: &str, age: Duration) -> PathBuf {
        let ts = (Utc::now() - age).format(BACKUP_TS_FORMAT);
        let path = backup_dir(fx).join(format!("{}-{}.json", id, ts));
        fs::write(&path, "{}").unwrap();
        path
    }

    /// Writes a session file whose created_at is `age` ago.
    fn fake_session(fx: &Fixture, age: Duration) -> PathBuf {
        let id = uuid::Uuid::new_v4().to_string();
        let session = ValidationSession {
            id: id.clone(),
            name: "old".to_string(),
            emails: vec![],
            results: vec![],
            status: "completed".to_string(),
            current_index: 0,
            total: 0,
            created_at: (Utc::now() - age).to_rfc3339(),
            completed_at: None,
            settings: settings(),
        };
        let path = fx.manager.sessions_dir.join(format!("{}.json", id));
        fs::write(&path, serde_json::to_string(&session).unwrap()).unwrap();
        path
    }

    #[test]
    fn parse_backup_name_rules() {
        let id = uuid::Uuid::new_v4().to_string();
        let name = format!("{}-20240102-030405.json", id);
        let (parsed_id, ts) = SessionManager::parse_backup_name(&name).unwrap();
        assert_eq!(parsed_id, id);
        assert_eq!(ts.format(BACKUP_TS_FORMAT).to_string(), "20240102-030405");
        let bad = [
            "20240102-030405.json".to_string(),
            format!("{}-20240102-030405.json.tmp.1.2.3", id),
            format!("{}-2024010-030405.json", id),
            format!("{}20240102-030405.json", id),
            "../x-20240102-030405.json".to_string(),
            "notes.txt".to_string(),
        ];
        for bad in &bad {
            assert!(SessionManager::parse_backup_name(bad).is_none(), "{:?}", bad);
        }
    }

    // B18: backups past the retention window are pruned, recent ones kept.
    #[test]
    fn cleanup_prunes_backups_older_than_cutoff() {
        let fx = Fixture::new();
        let id = uuid::Uuid::new_v4().to_string();
        let old = [fake_backup(&fx, &id, Duration::days(30)), fake_backup(&fx, &id, Duration::days(10))];
        let recent = [fake_backup(&fx, &id, Duration::days(1)), fake_backup(&fx, &id, Duration::hours(1))];
        let foreign = backup_dir(&fx).join("notes.txt");
        fs::write(&foreign, "keep").unwrap();

        assert_eq!(fx.manager.cleanup_old_sessions(7).unwrap(), 2);
        assert!(old.iter().all(|p| !p.exists()));
        assert!(recent.iter().all(|p| p.exists()));
        assert!(foreign.exists(), "files that aren't backups are left alone");
    }

    // B18: at most MAX_BACKUPS_PER_SESSION per id survive, newest first;
    // other ids are counted separately.
    #[test]
    fn cleanup_caps_backups_per_session() {
        let fx = Fixture::new();
        let id = uuid::Uuid::new_v4().to_string();
        let other = uuid::Uuid::new_v4().to_string();
        // Newest first: hours 1..=8 ago, all within the window.
        let mine: Vec<PathBuf> = (1..=8).map(|h| fake_backup(&fx, &id, Duration::hours(h))).collect();
        let theirs: Vec<PathBuf> = (1..=3).map(|h| fake_backup(&fx, &other, Duration::hours(h))).collect();

        assert_eq!(fx.manager.cleanup_old_sessions(30).unwrap(), 3);
        assert!(mine[..MAX_BACKUPS_PER_SESSION].iter().all(|p| p.exists()));
        assert!(mine[MAX_BACKUPS_PER_SESSION..].iter().all(|p| !p.exists()));
        assert!(theirs.iter().all(|p| p.exists()));
    }

    // B18: creating a backup caps that session's backups right away.
    #[test]
    fn backup_session_caps_its_own_backups() {
        let fx = Fixture::new();
        let id = fx.manager.create_session("cap".to_string(), vec!["a@example.com".to_string()], settings()).unwrap();
        let other = uuid::Uuid::new_v4().to_string();
        let mine: Vec<PathBuf> = (1..=7).map(|h| fake_backup(&fx, &id, Duration::hours(h))).collect();
        let theirs: Vec<PathBuf> = (1..=7).map(|h| fake_backup(&fx, &other, Duration::hours(h))).collect();

        fx.manager.backup_session(&id).unwrap();

        // The new backup plus the 4 newest older ones.
        assert!(mine[..MAX_BACKUPS_PER_SESSION - 1].iter().all(|p| p.exists()));
        assert!(mine[MAX_BACKUPS_PER_SESSION - 1..].iter().all(|p| !p.exists()));
        let mine_left = fx
            .dir_entries(&backup_dir(&fx))
            .iter()
            .filter(|p| p.file_name().unwrap().to_str().unwrap().starts_with(&id))
            .count();
        assert_eq!(mine_left, MAX_BACKUPS_PER_SESSION);
        assert!(theirs.iter().all(|p| p.exists()), "other sessions' backups are the sweep's job");
    }

    // B18: unreadable / unparseable entries are skipped, not fatal, and the
    // count covers exactly what was deleted.
    #[test]
    fn cleanup_skips_bad_entries_and_counts_deletions() {
        let fx = Fixture::new();
        let dir = &fx.manager.sessions_dir;
        let garbage = dir.join("garbage.json");
        fs::write(&garbage, "{not json").unwrap();
        let not_a_session = dir.join("other.json");
        fs::write(&not_a_session, r#"{"hello":"world"}"#).unwrap();
        // read_to_string fails on a directory on every platform.
        let dir_entry = dir.join("folder.json");
        fs::create_dir(&dir_entry).unwrap();
        let index = dir.join("sessions.json");
        fs::write(&index, "[]").unwrap();
        let old = [fake_session(&fx, Duration::days(100)), fake_session(&fx, Duration::days(91))];
        let recent = fake_session(&fx, Duration::days(3));
        let old_backup = fake_backup(&fx, &uuid::Uuid::new_v4().to_string(), Duration::days(200));

        let report = fx.manager.sweep(Utc::now() - Duration::days(90));
        assert_eq!(report, SweepReport { deleted: 3, skipped: 3 });
        assert!(old.iter().all(|p| !p.exists()));
        assert!(!old_backup.exists());
        for kept in [&garbage, &not_a_session, &dir_entry, &index, &recent] {
            assert!(kept.exists(), "{} should be kept", kept.display());
        }
        // Public API: nothing left to delete.
        assert_eq!(fx.manager.cleanup_old_sessions(90).unwrap(), 0);
    }

    // B18: a failed delete doesn't stop the sweep. Unix-only: needs a
    // read-only directory (and a non-root user, or deletes still succeed).
    #[cfg(unix)]
    #[test]
    fn cleanup_continues_past_failed_deletes() {
        use std::os::unix::fs::PermissionsExt;

        let fx = Fixture::new();
        let id = uuid::Uuid::new_v4().to_string();
        let stuck: Vec<PathBuf> = (0..3).map(|d| fake_backup(&fx, &id, Duration::days(30 + d))).collect();
        let old_session = fake_session(&fx, Duration::days(30));
        let backups = backup_dir(&fx);
        fs::set_permissions(&backups, fs::Permissions::from_mode(0o555)).unwrap();

        let report = fx.manager.sweep(Utc::now() - Duration::days(7));
        fs::set_permissions(&backups, fs::Permissions::from_mode(0o755)).unwrap();

        if stuck.iter().any(|p| !p.exists()) {
            eprintln!("skipping: read-only dir did not block deletes (running as root?)");
            return;
        }
        // Every stuck backup was attempted (not just the first), and the
        // session delete still happened.
        assert_eq!(report, SweepReport { deleted: 1, skipped: 3 });
        assert!(!old_session.exists());
    }

    #[test]
    fn cleanup_with_huge_days_does_not_panic() {
        let fx = Fixture::new();
        let recent = fake_session(&fx, Duration::days(1));
        assert_eq!(fx.manager.cleanup_old_sessions(u32::MAX).unwrap(), 0);
        assert!(recent.exists());
    }

    // Pause/Stop are recorded; completion and plain progress still win.
    #[test]
    fn update_records_paused_and_stopped_status() {
        let fx = Fixture::new();
        let emails = vec!["a@example.com".to_string(), "b@example.com".to_string()];
        let id = fx.manager.create_session("status".to_string(), emails, settings()).unwrap();
        let status = |fx: &Fixture| fx.manager.load_session(&id).unwrap().status;

        fx.manager.update_session_progress(&id, Vec::new(), 1, false, Some("paused")).unwrap();
        assert_eq!(status(&fx), "paused");
        fx.manager.update_session_progress(&id, Vec::new(), 1, false, None).unwrap();
        assert_eq!(status(&fx), "in-progress");
        fx.manager.update_session_progress(&id, Vec::new(), 0, false, Some("stopped")).unwrap();
        assert_eq!(status(&fx), "stopped");

        let err = fx.manager.update_session_progress(&id, Vec::new(), 1, false, Some("completed")).unwrap_err();
        assert!(err.contains("Invalid session status"), "{}", err);
        assert_eq!(status(&fx), "stopped", "rejected update must not write");

        fx.manager.update_session_progress(&id, Vec::new(), 2, false, Some("stopped")).unwrap();
        assert_eq!(status(&fx), "completed");
    }
}

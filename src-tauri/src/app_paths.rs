//! Where the app keeps its data.
//!
//! Sessions and settings live under Tauri's per-platform app data dir
//! (`<app_data_dir>/sessions/`, `<app_data_dir>/settings.json`). Earlier
//! builds hard-coded `$HOME/.local/share/com.yourcompany.emailvalidator` on
//! every platform; on first launch its data is copied (never moved) here.

use std::fs;
use std::path::{Path, PathBuf};
use chrono::Utc;
use tauri::Manager;
use crate::atomic_write::{atomic_copy, atomic_write};

/// Written into the legacy sessions dir once its contents were copied.
pub const MIGRATED_MARKER: &str = ".migrated";

pub struct AppPaths {
    pub sessions_dir: PathBuf,
    pub settings_file: PathBuf,
}

/// What a sessions migration did. Files already at the target are left
/// alone (`skipped`); `failed` copies are retried on the next launch.
#[derive(Debug, Default, PartialEq)]
pub struct MigrationReport {
    pub copied: usize,
    pub skipped: usize,
    pub failed: usize,
}

/// The pre-I10 data root, if HOME is set.
fn legacy_data_root() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(
        PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("com.yourcompany.emailvalidator"),
    )
}

/// Resolves the data paths and migrates legacy data into them. Never fails:
/// without an app data dir it falls back to the legacy root (the old
/// behaviour).
pub fn resolve(app: &tauri::AppHandle) -> AppPaths {
    let legacy = legacy_data_root();
    let root = match app.path().app_data_dir() {
        Ok(dir) => dir,
        Err(e) => {
            eprintln!("[paths] no app data dir ({}); using the legacy location", e);
            legacy.clone().unwrap_or_else(|| PathBuf::from("."))
        }
    };
    prepare(&root, legacy.as_deref())
}

/// Lays out the data paths under `root`, migrating from `legacy_root` first.
pub fn prepare(root: &Path, legacy_root: Option<&Path>) -> AppPaths {
    let paths = AppPaths {
        sessions_dir: root.join("sessions"),
        settings_file: root.join("settings.json"),
    };
    let Some(legacy) = legacy_root.filter(|legacy| !same_dir(legacy, root)) else {
        return paths;
    };

    let legacy_sessions = legacy.join("sessions");
    match migrate_sessions(&legacy_sessions, &paths.sessions_dir) {
        Ok(Some(report)) => eprintln!(
            "[paths] migrated legacy sessions {} -> {}: {:?}",
            legacy_sessions.display(),
            paths.sessions_dir.display(),
            report
        ),
        Ok(None) => {}
        Err(e) => eprintln!("[paths] legacy sessions migration failed: {}", e),
    }
    match migrate_settings(&legacy.join("settings.json"), &paths.settings_file) {
        Ok(true) => eprintln!(
            "[paths] copied legacy settings to {}",
            paths.settings_file.display()
        ),
        Ok(false) => {}
        Err(e) => eprintln!("[paths] legacy settings migration failed: {}", e),
    }
    paths
}

fn same_dir(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

/// Copies the legacy sessions dir (including `backups/`) into `target`,
/// then marks the legacy dir migrated. Returns None when there is nothing to
/// do (no legacy dir, or already marked). Never deletes or changes legacy
/// data except for writing the marker; never overwrites a target file. The
/// marker is only written when every copy succeeded, so a partial migration
/// resumes on the next launch.
pub fn migrate_sessions(legacy: &Path, target: &Path) -> Result<Option<MigrationReport>, String> {
    if !legacy.is_dir() || legacy.join(MIGRATED_MARKER).exists() {
        return Ok(None);
    }

    let mut report = MigrationReport::default();
    copy_tree(legacy, target, &mut report)?;

    if report.failed == 0 {
        let note = format!(
            "Sessions copied to {} at {}. This directory is no longer used.\n",
            target.display(),
            Utc::now().to_rfc3339()
        );
        atomic_write(&legacy.join(MIGRATED_MARKER), note.as_bytes())?;
    }
    Ok(Some(report))
}

fn copy_tree(from: &Path, to: &Path, report: &mut MigrationReport) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|e| format!("Failed to create {}: {}", to.display(), e))?;
    let entries = fs::read_dir(from).map_err(|e| format!("Failed to read {}: {}", from.display(), e))?;

    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(e) => {
                eprintln!("[paths] migration: unreadable entry in {}: {}", from.display(), e);
                report.failed += 1;
                continue;
            }
        };
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        // The marker, and temp files left by an interrupted atomic write.
        if name_str == MIGRATED_MARKER || name_str.contains(".tmp.") {
            continue;
        }
        let source = entry.path();
        let dest = to.join(&name);
        // Symlinks and other oddities are not ours: skip them.
        match entry.file_type() {
            Ok(kind) if kind.is_dir() => {
                if let Err(e) = copy_tree(&source, &dest, report) {
                    eprintln!("[paths] migration: {}", e);
                    report.failed += 1;
                }
            }
            Ok(kind) if kind.is_file() => {
                if dest.exists() {
                    report.skipped += 1;
                } else if let Err(e) = atomic_copy(&source, &dest) {
                    eprintln!("[paths] migration: {}", e);
                    report.failed += 1;
                } else {
                    report.copied += 1;
                }
            }
            Ok(_) => {}
            Err(e) => {
                eprintln!("[paths] migration: cannot stat {}: {}", source.display(), e);
                report.failed += 1;
            }
        }
    }
    Ok(())
}

/// Copies the legacy settings file to `target` unless `target` exists (so it
/// happens once, and never clobbers current settings). Returns whether it
/// copied.
pub fn migrate_settings(legacy: &Path, target: &Path) -> Result<bool, String> {
    if target.exists() || !legacy.is_file() {
        return Ok(false);
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {}", parent.display(), e))?;
    }
    atomic_copy(legacy, target)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::{SessionManager, SessionSettings};

    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!("app-paths-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// Every file under `dir`, relative, with its bytes.
    fn snapshot(dir: &Path) -> Vec<(PathBuf, Vec<u8>)> {
        fn walk(base: &Path, dir: &Path, out: &mut Vec<(PathBuf, Vec<u8>)>) {
            for entry in fs::read_dir(dir).unwrap().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    walk(base, &path, out);
                } else {
                    out.push((path.strip_prefix(base).unwrap().to_path_buf(), fs::read(&path).unwrap()));
                }
            }
        }
        let mut out = Vec::new();
        walk(dir, dir, &mut out);
        out.sort();
        out
    }

    fn settings() -> SessionSettings {
        SessionSettings { validation_mode: "standard".to_string() }
    }

    /// A legacy root with two sessions (one new-layout with results, one
    /// pre-I10 single file), a backup, settings and a stray temp file.
    fn legacy_root(tmp: &TempRoot) -> (PathBuf, Vec<String>) {
        let root = tmp.0.join("legacy");
        let sessions = root.join("sessions");
        let manager = SessionManager::with_dir(sessions.clone()).unwrap();
        let a = manager
            .create_session("a".to_string(), vec!["a@example.com".to_string()], settings())
            .unwrap();
        manager.update_session_progress(&a, Vec::new(), 0, false, Some("paused"), false).unwrap();
        manager.backup_session(&a).unwrap();
        let b = uuid::Uuid::new_v4().to_string();
        fs::write(
            sessions.join(format!("{}.json", b)),
            serde_json::json!({
                "id": b, "name": "b", "emails": ["b@example.com"],
                "results": [], "status": "stopped", "current_index": 0, "total": 1,
                "created_at": "2026-01-01T00:00:00+00:00", "completed_at": null,
                "settings": {"validation_mode": "quick"}
            })
            .to_string(),
        )
        .unwrap();
        fs::write(sessions.join(format!("{}.json.tmp.1.2.3", b)), "partial").unwrap();
        fs::write(root.join("settings.json"), r#"{"legacy":true}"#).unwrap();
        (root, vec![a, b])
    }

    // First launch: both sessions copied to the app data dir and loadable
    // there; legacy data byte-for-byte intact apart from the marker.
    #[test]
    fn first_launch_copies_legacy_sessions_and_marks_legacy_dir() {
        let tmp = TempRoot::new();
        let (legacy, ids) = legacy_root(&tmp);
        let before = snapshot(&legacy);
        let app_data = tmp.0.join("app-data");

        let paths = prepare(&app_data, Some(&legacy));

        assert_eq!(paths.sessions_dir, app_data.join("sessions"));
        assert_eq!(paths.settings_file, app_data.join("settings.json"));
        let manager = SessionManager::with_dir(paths.sessions_dir.clone()).unwrap();
        let listed = manager.list_sessions().unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(manager.load_session(&ids[0]).unwrap().status, "paused");
        assert_eq!(manager.load_session(&ids[1]).unwrap().settings.validation_mode, "quick");
        assert_eq!(
            fs::read_dir(paths.sessions_dir.join("backups")).unwrap().count(),
            1,
            "backups copied too"
        );
        assert!(
            !snapshot(&paths.sessions_dir).iter().any(|(p, _)| p.to_string_lossy().contains(".tmp.")),
            "temp files are not migrated"
        );

        let marker = legacy.join("sessions").join(MIGRATED_MARKER);
        assert!(marker.exists());
        let mut after = snapshot(&legacy);
        after.retain(|(p, _)| !p.ends_with(MIGRATED_MARKER));
        assert_eq!(after, before, "legacy data must not change");
        assert_eq!(fs::read_to_string(&paths.settings_file).unwrap(), r#"{"legacy":true}"#);
    }

    // Once marked, later launches don't copy again (deleted sessions stay
    // deleted), and existing settings are never overwritten.
    #[test]
    fn migration_runs_once_and_never_overwrites() {
        let tmp = TempRoot::new();
        let (legacy, ids) = legacy_root(&tmp);
        let app_data = tmp.0.join("app-data");
        let paths = prepare(&app_data, Some(&legacy));

        let manager = SessionManager::with_dir(paths.sessions_dir.clone()).unwrap();
        manager.delete_session(&ids[0]).unwrap();
        fs::write(&paths.settings_file, r#"{"current":true}"#).unwrap();

        let paths = prepare(&app_data, Some(&legacy));
        let manager = SessionManager::with_dir(paths.sessions_dir.clone()).unwrap();
        assert!(manager.load_session(&ids[0]).is_err(), "deleted session came back");
        assert_eq!(fs::read_to_string(&paths.settings_file).unwrap(), r#"{"current":true}"#);
        assert_eq!(migrate_sessions(&legacy.join("sessions"), &paths.sessions_dir).unwrap(), None);
    }

    // An interrupted migration (some files already copied, no marker)
    // resumes without overwriting what is there.
    #[test]
    fn unmarked_migration_resumes_and_skips_existing_files() {
        let tmp = TempRoot::new();
        let (legacy, ids) = legacy_root(&tmp);
        let target = tmp.0.join("app-data").join("sessions");
        fs::create_dir_all(&target).unwrap();
        let existing = target.join(format!("{}.json", ids[1]));
        fs::write(&existing, "newer").unwrap();

        let report = migrate_sessions(&legacy.join("sessions"), &target).unwrap().unwrap();

        assert_eq!(report.skipped, 1);
        assert_eq!(report.failed, 0);
        // a's metadata + backup metadata (no results files: a has none yet).
        assert_eq!(report.copied, 2);
        assert_eq!(fs::read_to_string(&existing).unwrap(), "newer");
        assert!(legacy.join("sessions").join(MIGRATED_MARKER).exists());
    }

    // A file that can't be copied leaves the legacy dir unmarked so the
    // next launch retries. Unix-only: needs an unreadable file (and a
    // non-root user).
    #[cfg(unix)]
    #[test]
    fn failed_copy_leaves_legacy_unmarked() {
        use std::os::unix::fs::PermissionsExt;

        let tmp = TempRoot::new();
        let (legacy, ids) = legacy_root(&tmp);
        let locked = legacy.join("sessions").join(format!("{}.json", ids[1]));
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
        if fs::read(&locked).is_ok() {
            eprintln!("skipping: file still readable (running as root?)");
            return;
        }
        let target = tmp.0.join("app-data").join("sessions");

        let report = migrate_sessions(&legacy.join("sessions"), &target).unwrap().unwrap();
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o644)).unwrap();

        assert_eq!(report.failed, 1);
        assert!(!legacy.join("sessions").join(MIGRATED_MARKER).exists());
        let retry = migrate_sessions(&legacy.join("sessions"), &target).unwrap().unwrap();
        assert_eq!((retry.copied, retry.failed), (1, 0));
        assert!(legacy.join("sessions").join(MIGRATED_MARKER).exists());
    }

    #[test]
    fn no_legacy_data_or_same_dir_is_a_no_op() {
        let tmp = TempRoot::new();
        let app_data = tmp.0.join("app-data");
        let paths = prepare(&app_data, Some(&tmp.0.join("missing")));
        assert!(!paths.sessions_dir.exists());
        assert!(!paths.settings_file.exists());
        let paths = prepare(&app_data, None);
        assert_eq!(paths.sessions_dir, app_data.join("sessions"));

        // Legacy root == app data dir: nothing copied, nothing marked.
        let (legacy, _) = legacy_root(&tmp);
        let before = snapshot(&legacy);
        prepare(&legacy, Some(&legacy));
        assert_eq!(snapshot(&legacy), before);
    }
}

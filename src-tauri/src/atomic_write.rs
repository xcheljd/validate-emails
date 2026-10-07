//! Crash-safe file replacement.
//!
//! `fs::write` truncates the target and then writes into it, so a crash,
//! force-quit or power loss mid-write leaves a truncated/partial file. Here the
//! content goes to a uniquely named temp file in the *same directory* (so the
//! rename stays on one volume), is fsynced, and is then renamed over the
//! target. Readers see either the old file or the complete new one, never a
//! torn write.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static TEMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// `<dir>/<name>.tmp.<nanos>.<pid>.<seq>` — a sibling of `target`, unique per
/// process and per call so concurrent writers never share a temp file.
fn temp_path_for(target: &Path) -> Result<PathBuf, String> {
    let file_name = target
        .file_name()
        .ok_or_else(|| format!("Invalid target path: {}", target.display()))?;
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seq = TEMP_SEQ.fetch_add(1, Ordering::Relaxed);

    let mut temp_name = file_name.to_os_string();
    temp_name.push(format!(".tmp.{}.{}.{}", nanos, std::process::id(), seq));
    Ok(target.with_file_name(temp_name))
}

/// Atomically replace `target` with `contents`.
///
/// Sequence: create temp sibling (`create_new`) → `write_all` → `sync_all` →
/// close → `rename(temp, target)` → best-effort fsync of the parent dir.
/// If anything fails after the temp file exists, the temp file is removed and
/// the original error is returned; `target` is left untouched.
pub fn atomic_write(target: &Path, contents: &[u8]) -> Result<(), String> {
    let temp = temp_path_for(target)?;

    // create_new: never clobber (or later delete) a file we didn't create.
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|e| format!("Failed to create temp file {}: {}", temp.display(), e))?;

    if let Err(e) = write_and_rename(file, &temp, target, contents) {
        let _ = fs::remove_file(&temp);
        return Err(e);
    }

    sync_parent_dir(target);
    Ok(())
}

/// Atomically replace `target` with a copy of `source`, with the same
/// crash-safety as `atomic_write` but streamed rather than read into memory.
pub fn atomic_copy(source: &Path, target: &Path) -> Result<(), String> {
    let mut src = File::open(source)
        .map_err(|e| format!("Failed to open {}: {}", source.display(), e))?;
    let temp = temp_path_for(target)?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|e| format!("Failed to create temp file {}: {}", temp.display(), e))?;

    let result = match std::io::copy(&mut src, &mut file) {
        Ok(_) => write_and_rename(file, &temp, target, &[]),
        Err(e) => {
            drop(file);
            Err(format!("Failed to copy {} to {}: {}", source.display(), temp.display(), e))
        }
    };
    if let Err(e) = result {
        let _ = fs::remove_file(&temp);
        return Err(e);
    }

    sync_parent_dir(target);
    Ok(())
}

fn write_and_rename(mut file: File, temp: &Path, target: &Path, contents: &[u8]) -> Result<(), String> {
    file.write_all(contents)
        .map_err(|e| format!("Failed to write temp file {}: {}", temp.display(), e))?;
    file.sync_all()
        .map_err(|e| format!("Failed to sync temp file {}: {}", temp.display(), e))?;
    drop(file);
    fs::rename(temp, target)
        .map_err(|e| format!("Failed to replace {}: {}", target.display(), e))
}

/// Persist the rename itself (the directory entry). Best-effort: the data is
/// already durable and the rename already visible, so a failure here is not
/// worth surfacing.
#[cfg(unix)]
pub(crate) fn sync_parent_dir(target: &Path) {
    if let Some(parent) = target.parent().filter(|p| !p.as_os_str().is_empty()) {
        if let Ok(dir) = File::open(parent) {
            let _ = dir.sync_all();
        }
    }
}

#[cfg(not(unix))]
pub(crate) fn sync_parent_dir(_target: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!("atomic-write-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        fn temp_residue(&self) -> Vec<String> {
            fs::read_dir(&self.0)
                .unwrap()
                .flatten()
                .filter_map(|e| e.file_name().to_str().map(str::to_string))
                .filter(|n| n.contains(".tmp."))
                .collect()
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn temp_path_is_unique_sibling_of_target() {
        let target = Path::new("/some/dir/settings.json");
        let a = temp_path_for(target).unwrap();
        let b = temp_path_for(target).unwrap();
        assert_eq!(a.parent(), target.parent());
        assert!(a.file_name().unwrap().to_str().unwrap().starts_with("settings.json.tmp."));
        assert_ne!(a, b);
    }

    #[test]
    fn writes_large_payload_and_leaves_no_temp_files() {
        let dir = TempDir::new();
        let target = dir.0.join("settings.json");
        let payload: Vec<u8> = (0..2_000_000u32).map(|i| (i % 251) as u8).collect();

        atomic_write(&target, &payload).unwrap();

        assert_eq!(fs::read(&target).unwrap(), payload);
        assert!(dir.temp_residue().is_empty(), "leftover temp files: {:?}", dir.temp_residue());
    }

    #[test]
    fn replaces_existing_file() {
        let dir = TempDir::new();
        let target = dir.0.join("settings.json");
        fs::write(&target, "old contents that are longer than the new ones").unwrap();

        atomic_write(&target, b"new").unwrap();

        assert_eq!(fs::read_to_string(&target).unwrap(), "new");
        assert!(dir.temp_residue().is_empty());
    }

    #[test]
    fn rename_failure_returns_error_and_removes_temp_file() {
        // A non-empty directory at the target path: the temp file is created,
        // written and synced, then the rename fails — exercising cleanup.
        let dir = TempDir::new();
        let target = dir.0.join("settings.json");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("keep"), "x").unwrap();

        let err = atomic_write(&target, b"payload").unwrap_err();

        assert!(err.contains("Failed to replace"), "unexpected error: {}", err);
        assert!(dir.temp_residue().is_empty(), "orphan temp files: {:?}", dir.temp_residue());
        assert_eq!(fs::read_to_string(target.join("keep")).unwrap(), "x");
    }

    #[test]
    fn parent_is_a_file_returns_error_and_writes_nothing() {
        let dir = TempDir::new();
        let not_a_dir = dir.0.join("file");
        fs::write(&not_a_dir, "x").unwrap();

        let err = atomic_write(&not_a_dir.join("settings.json"), b"payload").unwrap_err();

        assert!(err.contains("Failed to create temp file"), "unexpected error: {}", err);
        assert!(dir.temp_residue().is_empty());
        assert_eq!(fs::read_to_string(&not_a_dir).unwrap(), "x");
    }
}

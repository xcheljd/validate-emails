//! Validation session storage.
//!
//! Each session is two files in the sessions dir (I10):
//! - `<id>.json`: metadata — everything except the results. Small, rewritten
//!   atomically on every save, and all that `list_sessions` reads.
//! - `<id>.results.jsonl`: the results, one JSON object per line. Progress
//!   saves append only what changed, so a long run's save I/O stays linear
//!   instead of rewriting every result on every save.
//!
//! The results file is a log: a later line for an email replaces the earlier
//! one (a retry updates its result in place). A line that doesn't parse — a
//! torn append after a crash — is skipped on load, never fatal.
//!
//! Backups (`backups/<id>-<ts>.json` + `.results.jsonl`) are copies of both.
//! Pre-I10 sessions were a single `<id>.json` with the results inline; they
//! still load, and move their results to the results file on the next save.
//!
//! Field names are camelCase, on the wire and on disk, matching the frontend.
//! Files written before that were snake_case: each multi-word field keeps
//! its snake_case name as a serde alias so they still load, and are
//! rewritten in camelCase by their next save.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use chrono::{DateTime, NaiveDateTime, Utc, Duration};
use crate::validation::ValidationResult;
use crate::atomic_write::{atomic_copy, atomic_write, sync_parent_dir};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSettings {
    #[serde(alias = "validation_mode")]
    pub validation_mode: String,
}

/// A session as the frontend loads it: metadata plus every result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationSession {
    pub id: String,
    pub name: String,
    pub emails: Vec<String>,
    pub results: Vec<ValidationResult>,
    pub status: String,
    #[serde(alias = "current_index")]
    pub current_index: usize,
    pub total: usize,
    #[serde(alias = "created_at")]
    pub created_at: String,
    #[serde(alias = "completed_at")]
    pub completed_at: Option<String>,
    pub settings: SessionSettings,
    /// Unparseable lines skipped in the results file (a torn append from a
    /// crash). Omitted when there were none.
    #[serde(default, skip_serializing_if = "is_zero", alias = "skipped_result_lines")]
    pub skipped_result_lines: usize,
}

/// One row of the session list, read from the metadata file alone.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub name: String,
    pub status: String,
    #[serde(alias = "current_index")]
    pub current_index: usize,
    pub total: usize,
    #[serde(alias = "created_at")]
    pub created_at: String,
    #[serde(alias = "completed_at")]
    pub completed_at: Option<String>,
    pub settings: SessionSettings,
}

/// `<id>.json`: everything about a session except its results.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionMeta {
    id: String,
    name: String,
    emails: Vec<String>,
    status: String,
    #[serde(alias = "current_index")]
    current_index: usize,
    total: usize,
    #[serde(alias = "created_at")]
    created_at: String,
    #[serde(alias = "completed_at")]
    completed_at: Option<String>,
    settings: SessionSettings,
    /// When a progress save last backed this session up.
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "last_backup_at")]
    last_backup_at: Option<String>,
    /// Pre-I10 sessions kept their results here. Read so they still load;
    /// never written back (they move to the results file).
    #[serde(default, skip_serializing)]
    results: Option<Vec<ValidationResult>>,
}

impl SessionMeta {
    fn into_session(self, results: Vec<ValidationResult>, skipped_result_lines: usize) -> ValidationSession {
        ValidationSession {
            id: self.id,
            name: self.name,
            emails: self.emails,
            results,
            status: self.status,
            current_index: self.current_index,
            total: self.total,
            created_at: self.created_at,
            completed_at: self.completed_at,
            settings: self.settings,
            skipped_result_lines,
        }
    }
}

fn is_zero(n: &usize) -> bool {
    *n == 0
}

pub struct SessionManager {
    sessions_dir: PathBuf,
}

/// Newest backups kept per session id; older ones are pruned (B18).
const MAX_BACKUPS_PER_SESSION: usize = 5;
/// Timestamp part of a backup filename: `<id>-<YYYYmmdd-HHMMSS>.json`.
const BACKUP_TS_FORMAT: &str = "%Y%m%d-%H%M%S";
const BACKUP_TS_LEN: usize = 15;
/// Suffix of a results file (live or backup), after the id / backup stem.
const RESULTS_SUFFIX: &str = ".results.jsonl";
/// Progress saves back a session up at most this often. A backup copies the
/// whole results file, so backing up on every auto-save would make save I/O
/// quadratic again. An explicit `backup_session` always backs up.
const BACKUP_MIN_INTERVAL_SECS: i64 = 300;
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
    /// Creates a manager rooted at a sessions directory, creating it if needed.
    pub fn with_dir(sessions_dir: PathBuf) -> Result<Self, String> {
        if !sessions_dir.exists() {
            fs::create_dir_all(&sessions_dir)
                .map_err(|e| format!("Failed to create sessions directory: {}", e))?;
        }

        Ok(Self { sessions_dir })
    }

    pub fn create_session(&self, name: String, emails: Vec<String>, settings: SessionSettings) -> Result<String, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let meta = SessionMeta {
            id: id.clone(),
            name,
            total: emails.len(),
            emails,
            status: "pending".to_string(),
            current_index: 0,
            created_at: Utc::now().to_rfc3339(),
            completed_at: None,
            settings,
            last_backup_at: None,
            results: None,
        };

        // No results file yet: the first append creates it.
        self.write_meta(&id, &meta)?;
        Ok(id)
    }

    /// Saves progress. By default `results` is a batch of new or changed
    /// results, appended to the results file; with `replace` it is the full
    /// set and the file is rewritten (the caller's way to record deletions).
    ///
    /// `status` may be "paused" or "stopped" to record why the run halted; a
    /// finished session is "completed" regardless, and without a status any
    /// progress means "in-progress".
    pub fn update_session_progress(
        &self,
        id: &str,
        results: Vec<ValidationResult>,
        current_index: usize,
        backup: bool,
        status: Option<&str>,
        replace: bool,
    ) -> Result<(), String> {
        if let Some(status) = status {
            if !CALLER_STATUSES.contains(&status) {
                return Err(format!("Invalid session status: {:?}", status));
            }
        }
        let mut meta = self.read_meta(id)?;
        let results_path = self.validated_results_path(id)?;

        // A rewrite is destructive, so it is always backed up first.
        let now = Utc::now();
        if backup && (replace || Self::backup_due(&meta, now)) {
            self.backup_session(id)?;
            meta.last_backup_at = Some(now.to_rfc3339());
        }

        // Results first, then metadata: a crash in between leaves metadata
        // that merely lags the results, which the next save corrects.
        if replace {
            write_results(&results_path, &results)?;
        } else {
            self.upgrade_legacy(&results_path, &mut meta)?;
            append_results(&results_path, &results)?;
        }

        meta.current_index = current_index;
        if current_index >= meta.total {
            meta.status = "completed".to_string();
            meta.completed_at = Some(now.to_rfc3339());
        } else if let Some(status) = status {
            meta.status = status.to_string();
        } else if current_index > 0 {
            meta.status = "in-progress".to_string();
        }

        self.write_meta(id, &meta)
    }

    /// Moves a pre-I10 session's inline results into its results file, so
    /// appends land after them. No-op for current sessions.
    fn upgrade_legacy(&self, results_path: &Path, meta: &mut SessionMeta) -> Result<(), String> {
        if let Some(legacy) = meta.results.take() {
            if !results_path.exists() {
                write_results(results_path, &legacy)?;
            }
        }
        Ok(())
    }

    fn backup_due(meta: &SessionMeta, now: DateTime<Utc>) -> bool {
        let last = meta
            .last_backup_at
            .as_deref()
            .and_then(|t| DateTime::parse_from_rfc3339(t).ok());
        match last {
            // A clock that went backwards counts as due, not as "recent".
            Some(last) => !(Duration::zero()..Duration::seconds(BACKUP_MIN_INTERVAL_SECS))
                .contains(&now.signed_duration_since(last)),
            None => true,
        }
    }

    /// Snapshots the metadata and results files into `backups/`.
    pub fn backup_session(&self, id: &str) -> Result<(), String> {
        let meta_path = self.validated_session_path(id)?;
        let results_path = self.validated_results_path(id)?;
        if !meta_path.exists() {
            return Err(Self::not_found(id));
        }

        let backup_dir = self.sessions_dir.join("backups");
        if !backup_dir.exists() {
            fs::create_dir_all(&backup_dir)
                .map_err(|e| format!("Failed to create backup directory: {}", e))?;
        }

        let stem = format!("{}-{}", id, Utc::now().format(BACKUP_TS_FORMAT));
        if results_path.exists() {
            let backup_results = Self::contained_path(&backup_dir, &format!("{}{}", stem, RESULTS_SUFFIX))?;
            atomic_copy(&results_path, &backup_results)
                .map_err(|e| format!("Failed to write backup: {}", e))?;
        }
        let backup_meta = Self::contained_path(&backup_dir, &format!("{}.json", stem))?;
        atomic_copy(&meta_path, &backup_meta)
            .map_err(|e| format!("Failed to write backup: {}", e))?;

        // Cap this session's backups now so a long run can't grow them
        // without bound between sweeps. Best effort: the backup itself
        // succeeded.
        let mut report = SweepReport::default();
        Self::prune_backups(&backup_dir, None, Some(id), &mut report);
        Ok(())
    }

    pub fn load_session(&self, id: &str) -> Result<ValidationSession, String> {
        let mut meta = self.read_meta(id)?;
        let results_path = self.validated_results_path(id)?;

        let (results, skipped) = match read_results(&results_path) {
            Ok(read) => read,
            // No results file: nothing saved yet, or a pre-I10 session.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (meta.results.take().unwrap_or_default(), 0),
            Err(e) => return Err(format!("Failed to read session results: {}", e)),
        };
        if skipped > 0 {
            eprintln!(
                "[sessions] {}: skipped {} unreadable result line(s) (torn write?)",
                id, skipped
            );
        }

        Ok(meta.into_session(results, skipped))
    }

    /// Lists sessions newest first. Reads only metadata files, never results;
    /// files that aren't sessions are skipped.
    pub fn list_sessions(&self) -> Result<Vec<SessionSummary>, String> {
        let mut sessions = Vec::new();

        if let Ok(entries) = fs::read_dir(&self.sessions_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !Self::is_meta_file(&path) {
                    continue;
                }
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(session) = serde_json::from_str::<SessionSummary>(&content) {
                        sessions.push(session);
                    }
                }
            }
        }

        sessions.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(sessions)
    }

    pub fn delete_session(&self, id: &str) -> Result<(), String> {
        let session_path = self.validated_session_path(id)?;
        let results_path = self.validated_results_path(id)?;
        // Metadata first: once it is gone the session is gone, and a leftover
        // results file is an orphan the cleanup sweep removes.
        fs::remove_file(&session_path)
            .map_err(|e| format!("Failed to delete session file: {}", e))?;
        match fs::remove_file(&results_path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                Err(format!("Failed to delete session results file: {}", e))
            }
            _ => Ok(()),
        }
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
                    if let Some(meta_path) = Self::meta_path_for_results(&path) {
                        // Results whose session is gone (a delete interrupted
                        // between its two removals).
                        if !meta_path.exists() {
                            Self::remove(&path, &mut report);
                        }
                        continue;
                    }
                    if !Self::is_meta_file(&path) {
                        continue;
                    }
                    match Self::session_created_at(&path) {
                        Ok(created_at) if created_at < cutoff => {
                            Self::remove(&path, &mut report);
                            Self::remove(&Self::results_path_for_meta(&path), &mut report);
                        }
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
        let session: SessionSummary =
            serde_json::from_str(&content).map_err(|e| format!("not a session: {}", e))?;
        DateTime::parse_from_rfc3339(&session.created_at)
            .map(|t| t.with_timezone(&Utc))
            .map_err(|e| format!("bad created_at: {}", e))
    }

    /// A session metadata file: `*.json`, except the legacy `sessions.json`.
    fn is_meta_file(path: &Path) -> bool {
        path.extension().and_then(|s| s.to_str()) == Some("json")
            && path.file_name().and_then(|n| n.to_str()) != Some("sessions.json")
    }

    /// `<dir>/<id>.json` → `<dir>/<id>.results.jsonl`.
    fn results_path_for_meta(meta_path: &Path) -> PathBuf {
        let stem = meta_path.file_stem().and_then(|s| s.to_str()).unwrap_or_default();
        meta_path.with_file_name(format!("{}{}", stem, RESULTS_SUFFIX))
    }

    /// `<dir>/<id>.results.jsonl` → `<dir>/<id>.json`; None for other files.
    fn meta_path_for_results(path: &Path) -> Option<PathBuf> {
        let name = path.file_name()?.to_str()?;
        let stem = name.strip_suffix(RESULTS_SUFFIX).filter(|s| !s.is_empty())?;
        Some(path.with_file_name(format!("{}.json", stem)))
    }

    /// Splits a backup filename `<id>-<YYYYmmdd-HHMMSS>.json` (metadata) or
    /// `<id>-<YYYYmmdd-HHMMSS>.results.jsonl` into its id and timestamp.
    /// Anything else (temp files, foreign files) is None.
    fn parse_backup_name(name: &str) -> Option<(&str, DateTime<Utc>)> {
        let stem = name
            .strip_suffix(RESULTS_SUFFIX)
            .or_else(|| name.strip_suffix(".json"))?;
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
    /// MAX_BACKUPS_PER_SESSION per id. A backup is every file sharing an id
    /// and timestamp (metadata + results). `only_id` restricts this to one
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

        for files in by_id.values() {
            let mut stamps: Vec<DateTime<Utc>> = files.iter().map(|(ts, _)| *ts).collect();
            stamps.sort_by(|a, b| b.cmp(a));
            stamps.dedup();
            let kept = &stamps[..stamps.len().min(MAX_BACKUPS_PER_SESSION)];
            for (ts, path) in files {
                let expired = cutoff.is_some_and(|cutoff| *ts < cutoff);
                if expired || !kept.contains(ts) {
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

    /// Writes a whole session: results file (rewritten) and metadata.
    #[cfg(test)]
    fn save_session(&self, id: &str, session: &ValidationSession) -> Result<(), String> {
        write_results(&self.validated_results_path(id)?, &session.results)?;
        let meta = SessionMeta {
            id: session.id.clone(),
            name: session.name.clone(),
            emails: session.emails.clone(),
            status: session.status.clone(),
            current_index: session.current_index,
            total: session.total,
            created_at: session.created_at.clone(),
            completed_at: session.completed_at.clone(),
            settings: session.settings.clone(),
            last_backup_at: None,
            results: None,
        };
        self.write_meta(id, &meta)
    }

    fn read_meta(&self, id: &str) -> Result<SessionMeta, String> {
        let session_path = self.validated_session_path(id)?;

        let content = fs::read_to_string(&session_path)
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    Self::not_found(id)
                } else {
                    format!("Failed to read session file: {}", e)
                }
            })?;

        serde_json::from_str(&content)
            .map_err(|e| {
                if e.is_data() {
                    format!("Corrupted session data: {}. The session file contains invalid data. You may need to restore from a backup if available.", e)
                } else if e.is_syntax() {
                    format!("Invalid session file format: {}. The session file appears to be corrupted or was modified externally.", e)
                } else {
                    format!("Failed to parse session file: {}", e)
                }
            })
    }

    fn write_meta(&self, id: &str, meta: &SessionMeta) -> Result<(), String> {
        let session_path = self.validated_session_path(id)?;
        let json = serde_json::to_string(meta)
            .map_err(|e| format!("Failed to serialize session: {}", e))?;

        atomic_write(&session_path, json.as_bytes())
            .map_err(|e| format!("Failed to write session file: {}", e))
    }

    fn not_found(id: &str) -> String {
        format!("Session not found: {}. The session may have been deleted or moved.", id)
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

    fn validated_results_path(&self, id: &str) -> Result<PathBuf, String> {
        Self::validate_session_id(id)?;
        Self::contained_path(&self.sessions_dir, &format!("{}{}", id, RESULTS_SUFFIX))
    }

    fn generate_session_name(&self) -> String {
        let now = Utc::now();
        now.format("%b %d, %Y %-I:%M %p").to_string()
    }
}

/// Results as JSON lines, each newline-terminated.
fn encode_results(results: &[ValidationResult]) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    for result in results {
        serde_json::to_writer(&mut buf, result)
            .map_err(|e| format!("Failed to serialize result: {}", e))?;
        buf.push(b'\n');
    }
    Ok(buf)
}

/// Replaces a results file with exactly `results`, atomically.
fn write_results(path: &Path, results: &[ValidationResult]) -> Result<(), String> {
    atomic_write(path, &encode_results(results)?)
        .map_err(|e| format!("Failed to write session results: {}", e))
}

/// Appends `results` to a results file (creating it) and fsyncs. Returns the
/// bytes written. If the file doesn't end in a newline — an earlier append
/// was torn by a crash — one is written first, so the torn fragment stays a
/// line of its own (skipped on load) instead of swallowing this batch's first
/// record.
fn append_results(path: &Path, results: &[ValidationResult]) -> Result<usize, String> {
    if results.is_empty() {
        return Ok(0);
    }
    let io_err = |e: std::io::Error| format!("Failed to append session results: {}", e);
    let mut file = OpenOptions::new()
        .read(true)
        .append(true)
        .create(true)
        .open(path)
        .map_err(io_err)?;
    let len = file.metadata().map_err(io_err)?.len();

    let mut buf = Vec::new();
    if len > 0 {
        let mut last = [0u8; 1];
        file.seek(SeekFrom::Start(len - 1)).map_err(io_err)?;
        file.read_exact(&mut last).map_err(io_err)?;
        if last[0] != b'\n' {
            buf.push(b'\n');
        }
    }
    buf.extend(encode_results(results)?);

    // Append mode: the write goes to the end whatever the read position.
    file.write_all(&buf).map_err(io_err)?;
    file.sync_all().map_err(io_err)?;
    if len == 0 {
        // The file may be new: persist its directory entry too.
        sync_parent_dir(path);
    }
    Ok(buf.len())
}

/// Reads a results file. A later line for an email replaces the earlier one
/// in place; new emails keep first-seen order. Lines that don't parse are
/// skipped and counted (second value), never fatal.
fn read_results(path: &Path) -> std::io::Result<(Vec<ValidationResult>, usize)> {
    let content = fs::read(path)?;
    let mut results: Vec<ValidationResult> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut skipped = 0;

    for line in content.split(|&b| b == b'\n') {
        if line.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        match serde_json::from_slice::<ValidationResult>(line) {
            Ok(result) => match index.get(&result.email) {
                Some(&i) => results[i] = result,
                None => {
                    index.insert(result.email.clone(), results.len());
                    results.push(result);
                }
            },
            Err(_) => skipped += 1,
        }
    }
    Ok((results, skipped))
}

/// Where sessions live. Resolved once at startup (see `app_paths`) and
/// managed as Tauri state.
pub struct SessionStore {
    sessions_dir: PathBuf,
}

impl SessionStore {
    pub fn new(sessions_dir: PathBuf) -> Self {
        Self { sessions_dir }
    }
}

/// Serializes session writes across commands: a progress save is a
/// read-modify-write of the metadata plus an append, and two interleaved
/// saves could otherwise lose one's metadata.
static SESSION_WRITES: Mutex<()> = Mutex::new(());

/// Runs blocking session I/O off the async runtime's worker threads.
async fn run_blocking<T, F>(store: &SessionStore, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&SessionManager) -> Result<T, String> + Send + 'static,
{
    let dir = store.sessions_dir.clone();
    tokio::task::spawn_blocking(move || f(&SessionManager::with_dir(dir)?))
        .await
        .map_err(|e| format!("Session task failed: {}", e))?
}

/// `run_blocking` for operations that write, holding SESSION_WRITES.
async fn run_write<T, F>(store: &SessionStore, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&SessionManager) -> Result<T, String> + Send + 'static,
{
    run_blocking(store, move |manager| {
        let _guard = SESSION_WRITES.lock().unwrap_or_else(|e| e.into_inner());
        f(manager)
    })
    .await
}

#[tauri::command]
pub async fn create_validation_session(
    store: tauri::State<'_, SessionStore>,
    emails: Vec<String>,
    settings: SessionSettings,
) -> Result<String, String> {
    run_write(&store, move |manager| {
        let name = manager.generate_session_name();
        manager.create_session(name, emails, settings)
    })
    .await
}

/// `results` is a batch of new/changed results to append, or with
/// `replace: true` the full set (see `update_session_progress`).
#[tauri::command]
pub async fn update_validation_session(
    store: tauri::State<'_, SessionStore>,
    id: String,
    results: Vec<ValidationResult>,
    current_index: usize,
    backup: bool,
    status: Option<String>,
    replace: Option<bool>,
) -> Result<(), String> {
    run_write(&store, move |manager| {
        manager.update_session_progress(
            &id,
            results,
            current_index,
            backup,
            status.as_deref(),
            replace.unwrap_or(false),
        )
    })
    .await
}

#[tauri::command]
pub async fn load_validation_session(
    store: tauri::State<'_, SessionStore>,
    id: String,
) -> Result<ValidationSession, String> {
    run_blocking(&store, move |manager| manager.load_session(&id)).await
}

#[tauri::command]
pub async fn list_validation_sessions(
    store: tauri::State<'_, SessionStore>,
) -> Result<Vec<SessionSummary>, String> {
    run_blocking(&store, |manager| manager.list_sessions()).await
}

#[tauri::command]
pub async fn delete_validation_session(
    store: tauri::State<'_, SessionStore>,
    id: String,
) -> Result<(), String> {
    run_write(&store, move |manager| manager.delete_session(&id)).await
}

#[tauri::command]
pub async fn cleanup_old_sessions(
    store: tauri::State<'_, SessionStore>,
    days: u32,
) -> Result<usize, String> {
    run_write(&store, move |manager| manager.cleanup_old_sessions(days)).await
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
                .update_session_progress(id, Vec::new(), 0, true, None, false)
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

        fx.manager.update_session_progress(&id, Vec::new(), 1, true, None, false).unwrap();
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
        // One backup: a metadata copy plus a results copy, same stem.
        let names: Vec<String> = fx
            .dir_entries(&backup_dir)
            .iter()
            .map(|p| p.file_name().unwrap().to_str().unwrap().to_string())
            .collect();
        assert_eq!(names.len(), 2, "{:?}", names);
        let meta_name = names.iter().find(|n| n.ends_with(".json")).expect("metadata backup");
        let stem = meta_name.strip_suffix(".json").unwrap();
        assert!(names.contains(&format!("{}{}", stem, RESULTS_SUFFIX)), "{:?}", names);
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
            skipped_result_lines: 0,
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

        fx.manager.update_session_progress(&id, Vec::new(), 1, false, Some("paused"), false).unwrap();
        assert_eq!(status(&fx), "paused");
        fx.manager.update_session_progress(&id, Vec::new(), 1, false, None, false).unwrap();
        assert_eq!(status(&fx), "in-progress");
        fx.manager.update_session_progress(&id, Vec::new(), 0, false, Some("stopped"), false).unwrap();
        assert_eq!(status(&fx), "stopped");

        let err = fx.manager.update_session_progress(&id, Vec::new(), 1, false, Some("completed"), false).unwrap_err();
        assert!(err.contains("Invalid session status"), "{}", err);
        assert_eq!(status(&fx), "stopped", "rejected update must not write");

        fx.manager.update_session_progress(&id, Vec::new(), 2, false, Some("stopped"), false).unwrap();
        assert_eq!(status(&fx), "completed");
    }
    // ---- I10: metadata + append-only results ----

    fn result(email: &str, verdict: &str) -> ValidationResult {
        serde_json::from_value(serde_json::json!({
            "email": email,
            "result": verdict,
            "reason": format!("{} reason", verdict),
            "logs": [],
            "domain": "example.com",
            "validationDuration": 1,
            "mxRecordCount": 1,
            "isDisposable": false,
            "isRoleAccount": false,
            "isCatchAll": false,
            "isDeliverable": verdict == "Safe",
            "isDisabled": false,
            "hasFullInbox": false,
            "canConnectSmtp": true,
            "isValidSyntax": true,
            "isB2c": false,
            "timestamp": "2026-01-01T00:00:00Z",
            "validationMode": "standard",
            "riskScore": 0
        }))
        .expect("valid result json")
    }

    fn summary(results: &[ValidationResult]) -> Vec<(String, String)> {
        results.iter().map(|r| (r.email.clone(), r.result.clone())).collect()
    }

    fn emails(n: usize) -> Vec<String> {
        (0..n).map(|i| format!("user{}@example.com", i)).collect()
    }

    fn results_path(fx: &Fixture, id: &str) -> PathBuf {
        fx.manager.sessions_dir.join(format!("{}{}", id, RESULTS_SUFFIX))
    }

    fn meta_path(fx: &Fixture, id: &str) -> PathBuf {
        fx.manager.sessions_dir.join(format!("{}.json", id))
    }

    fn meta_json(fx: &Fixture, id: &str) -> serde_json::Value {
        serde_json::from_str(&fs::read_to_string(meta_path(fx, id)).unwrap()).unwrap()
    }

    // Ten incremental saves append exactly their batch each time: the bytes
    // already on disk are never rewritten, and load returns every result in
    // order.
    #[test]
    fn progress_saves_append_only_their_batch() {
        let fx = Fixture::new();
        let all = emails(30);
        let id = fx.manager.create_session("append".to_string(), all.clone(), settings()).unwrap();
        let path = results_path(&fx, &id);
        assert!(!path.exists(), "no results file until the first save");

        let mut before: Vec<u8> = Vec::new();
        for (i, chunk) in all.chunks(3).enumerate() {
            let batch: Vec<ValidationResult> = chunk.iter().map(|e| result(e, "Safe")).collect();
            let expected_growth = encode_results(&batch).unwrap();
            let done = (i + 1) * 3;
            fx.manager.update_session_progress(&id, batch, done, true, None, false).unwrap();

            let after = fs::read(&path).unwrap();
            assert_eq!(after.len(), before.len() + expected_growth.len(), "save {} grew by its batch only", i);
            assert_eq!(&after[..before.len()], &before[..], "save {} rewrote earlier bytes", i);
            assert_eq!(&after[before.len()..], &expected_growth[..]);
            before = after;
        }

        let content = fs::read_to_string(&path).unwrap();
        assert_eq!(content.lines().count(), 30);
        let loaded = fx.manager.load_session(&id).unwrap();
        assert_eq!(loaded.results.iter().map(|r| r.email.clone()).collect::<Vec<_>>(), all);
        assert_eq!(loaded.status, "completed");
        assert_eq!(loaded.current_index, 30);
        assert_eq!(loaded.skipped_result_lines, 0);
        // Metadata never carries the results.
        assert!(meta_json(&fx, &id).get("results").is_none());
        // Ten saves within the backup interval: one backup, not ten.
        let backups = fx.dir_entries(&fx.manager.sessions_dir.join("backups"));
        assert_eq!(backups.iter().filter(|p| p.extension().unwrap() == "json").count(), 1);
    }

    #[test]
    fn append_results_returns_bytes_written_and_skips_empty_batches() {
        let fx = Fixture::new();
        let path = fx.manager.sessions_dir.join("x.results.jsonl");
        assert_eq!(append_results(&path, &[]).unwrap(), 0);
        assert!(!path.exists(), "an empty batch doesn't create the file");
        let batch = vec![result("a@example.com", "Safe")];
        let n = append_results(&path, &batch).unwrap();
        assert_eq!(n, encode_results(&batch).unwrap().len());
        assert_eq!(fs::metadata(&path).unwrap().len() as usize, n);
    }

    // A retry appends the email again; the later line wins, in place.
    #[test]
    fn later_line_for_an_email_replaces_it_in_place() {
        let fx = Fixture::new();
        let id = fx.manager.create_session("retry".to_string(), emails(3), settings()).unwrap();
        let first = vec![
            result("user0@example.com", "Safe"),
            result("user1@example.com", "Unknown"),
            result("user2@example.com", "Safe"),
        ];
        fx.manager.update_session_progress(&id, first, 3, false, None, false).unwrap();
        fx.manager
            .update_session_progress(&id, vec![result("user1@example.com", "Invalid")], 3, false, None, false)
            .unwrap();

        assert_eq!(fs::read_to_string(results_path(&fx, &id)).unwrap().lines().count(), 4);
        let loaded = fx.manager.load_session(&id).unwrap();
        assert_eq!(
            summary(&loaded.results),
            vec![
                ("user0@example.com".to_string(), "Safe".to_string()),
                ("user1@example.com".to_string(), "Invalid".to_string()),
                ("user2@example.com".to_string(), "Safe".to_string()),
            ]
        );
    }

    // `replace` rewrites the file (how deletions are saved) and is always
    // backed up first, even inside the backup interval.
    #[test]
    fn replace_rewrites_results_and_backs_up_first() {
        let fx = Fixture::new();
        let id = fx.manager.create_session("replace".to_string(), emails(3), settings()).unwrap();
        let three: Vec<ValidationResult> = emails(3).iter().map(|e| result(e, "Safe")).collect();
        fx.manager.update_session_progress(&id, three, 3, true, None, false).unwrap();
        let backup_dir = fx.manager.sessions_dir.join("backups");
        let backup_metas = |fx: &Fixture| {
            fx.dir_entries(&backup_dir).iter().filter(|p| p.extension().unwrap() == "json").count()
        };
        assert_eq!(backup_metas(&fx), 1);

        // Sleep past the one-second backup timestamp so the forced backup is
        // a distinct snapshot.
        std::thread::sleep(std::time::Duration::from_millis(1100));
        let kept = vec![result("user0@example.com", "Safe"), result("user2@example.com", "Safe")];
        fx.manager.update_session_progress(&id, kept, 2, true, Some("stopped"), true).unwrap();

        let loaded = fx.manager.load_session(&id).unwrap();
        assert_eq!(
            loaded.results.iter().map(|r| r.email.as_str()).collect::<Vec<_>>(),
            vec!["user0@example.com", "user2@example.com"]
        );
        assert_eq!(fs::read_to_string(results_path(&fx, &id)).unwrap().lines().count(), 2);
        assert_eq!(loaded.status, "stopped");
        assert_eq!(backup_metas(&fx), 2, "replace forces a backup");
        // The newest backup holds the pre-replace results.
        let newest_results = fx
            .dir_entries(&backup_dir)
            .into_iter()
            .filter(|p| p.to_str().unwrap().ends_with(RESULTS_SUFFIX))
            .max()
            .unwrap();
        assert_eq!(read_results(&newest_results).unwrap().0.len(), 3);
        assert!(temp_residue(&fx.manager.sessions_dir).is_empty());
    }

    // After a crash mid-append: the torn last line is skipped and counted,
    // the valid prefix loads, and the next append isn't glued onto it.
    #[test]
    fn load_skips_torn_last_line_and_next_append_recovers() {
        let fx = Fixture::new();
        let id = fx.manager.create_session("torn".to_string(), emails(5), settings()).unwrap();
        let three: Vec<ValidationResult> = emails(3).iter().map(|e| result(e, "Safe")).collect();
        fx.manager.update_session_progress(&id, three, 3, false, None, false).unwrap();

        // Half of a fourth record, no newline (and a non-UTF-8 byte for good
        // measure: a torn write can split a multi-byte character).
        let path = results_path(&fx, &id);
        let line = String::from_utf8(encode_results(&[result("user3@example.com", "Safe")]).unwrap()).unwrap();
        let mut file = OpenOptions::new().append(true).open(&path).unwrap();
        file.write_all(&line.as_bytes()[..line.len() / 2]).unwrap();
        file.write_all(&[0xE2, 0x82]).unwrap();
        drop(file);

        let loaded = fx.manager.load_session(&id).unwrap();
        assert_eq!(loaded.results.len(), 3);
        assert_eq!(loaded.skipped_result_lines, 1);
        let wire = serde_json::to_value(&loaded).unwrap();
        assert_eq!(wire["skippedResultLines"], 1);

        // The next save starts on a fresh line, so its record survives.
        fx.manager
            .update_session_progress(&id, vec![result("user4@example.com", "Risky")], 4, false, None, false)
            .unwrap();
        let loaded = fx.manager.load_session(&id).unwrap();
        assert_eq!(
            loaded.results.iter().map(|r| r.email.as_str()).collect::<Vec<_>>(),
            vec!["user0@example.com", "user1@example.com", "user2@example.com", "user4@example.com"]
        );
        assert_eq!(loaded.skipped_result_lines, 1);

        // A clean session doesn't put the field on the wire at all.
        let clean = fx.manager.create_session("clean".to_string(), emails(1), settings()).unwrap();
        let wire = serde_json::to_value(fx.manager.load_session(&clean).unwrap()).unwrap();
        assert!(wire.get("skippedResultLines").is_none());
    }

    // Listing reads metadata only: every results file is garbage (and one is
    // large), yet all five sessions list, newest first, without results.
    #[test]
    fn list_sessions_reads_only_metadata() {
        let fx = Fixture::new();
        let mut ids = Vec::new();
        for i in 0..5 {
            let id = fx.manager.create_session(format!("s{}", i), emails(2), settings()).unwrap();
            fx.manager
                .update_session_progress(&id, vec![result("user0@example.com", "Safe")], 1, false, Some("paused"), false)
                .unwrap();
            ids.push(id);
        }
        // Distinct created_at so the order is deterministic.
        for (i, id) in ids.iter().enumerate() {
            let mut meta = fx.manager.read_meta(id).unwrap();
            meta.created_at = format!("2026-01-0{}T00:00:00+00:00", i + 1);
            fx.manager.write_meta(id, &meta).unwrap();
        }
        let big: Vec<ValidationResult> = (0..5_000).map(|i| result(&format!("big{}@example.com", i), "Safe")).collect();
        fx.manager.update_session_progress(&ids[2], big, 1, false, None, false).unwrap();
        assert!(fs::metadata(results_path(&fx, &ids[2])).unwrap().len() > 1_000_000);
        for id in &ids {
            fs::write(results_path(&fx, id), b"\x00\xFFgarbage{").unwrap();
        }

        let listed = fx.manager.list_sessions().unwrap();
        assert_eq!(listed.iter().map(|s| s.id.clone()).collect::<Vec<_>>(), ids.iter().rev().cloned().collect::<Vec<_>>());
        assert!(listed.iter().all(|s| s.status == "paused" || s.status == "in-progress"));
        assert_eq!(listed[0].total, 2);
        let wire = serde_json::to_value(&listed[0]).unwrap();
        assert!(wire.get("results").is_none() && wire.get("emails").is_none(), "{}", wire);
        // Results files are not mistaken for sessions.
        assert_eq!(listed.len(), 5);
    }

    // Pre-I10 single-file sessions load, list, and move their results into
    // the results file on the next save without losing any.
    #[test]
    fn legacy_single_file_session_loads_and_upgrades_on_save() {
        let fx = Fixture::new();
        let id = uuid::Uuid::new_v4().to_string();
        let legacy = ValidationSession {
            id: id.clone(),
            name: "legacy".to_string(),
            emails: emails(3),
            results: vec![result("user0@example.com", "Safe"), result("user1@example.com", "Unknown")],
            status: "paused".to_string(),
            current_index: 2,
            total: 3,
            created_at: Utc::now().to_rfc3339(),
            completed_at: None,
            settings: settings(),
            skipped_result_lines: 0,
        };
        fs::write(meta_path(&fx, &id), serde_json::to_string(&legacy).unwrap()).unwrap();

        let loaded = fx.manager.load_session(&id).unwrap();
        assert_eq!(summary(&loaded.results), summary(&legacy.results));
        assert_eq!(fx.manager.list_sessions().unwrap()[0].status, "paused");

        fx.manager
            .update_session_progress(&id, vec![result("user2@example.com", "Safe")], 3, false, None, false)
            .unwrap();
        assert!(meta_json(&fx, &id).get("results").is_none(), "results moved out of metadata");
        assert_eq!(fs::read_to_string(results_path(&fx, &id)).unwrap().lines().count(), 3);
        let loaded = fx.manager.load_session(&id).unwrap();
        assert_eq!(
            loaded.results.iter().map(|r| r.email.as_str()).collect::<Vec<_>>(),
            vec!["user0@example.com", "user1@example.com", "user2@example.com"]
        );
        assert_eq!(loaded.status, "completed");
    }

    #[test]
    fn delete_removes_metadata_and_results() {
        let fx = Fixture::new();
        let id = fx.manager.create_session("del".to_string(), emails(2), settings()).unwrap();
        fx.manager
            .update_session_progress(&id, vec![result("user0@example.com", "Safe")], 1, false, None, false)
            .unwrap();
        assert!(results_path(&fx, &id).exists());
        fx.manager.delete_session(&id).unwrap();
        assert!(!meta_path(&fx, &id).exists());
        assert!(!results_path(&fx, &id).exists());
        // A session that never saved results deletes cleanly too.
        let empty = fx.manager.create_session("empty".to_string(), emails(1), settings()).unwrap();
        fx.manager.delete_session(&empty).unwrap();
    }

    /// Writes a metadata + results backup pair for `id` stamped `age` ago.
    fn fake_backup_pair(fx: &Fixture, id: &str, age: Duration) -> [PathBuf; 2] {
        let meta = fake_backup(fx, id, age);
        let results = meta.with_file_name(format!(
            "{}{}",
            meta.file_stem().unwrap().to_str().unwrap(),
            RESULTS_SUFFIX
        ));
        fs::write(&results, "").unwrap();
        [meta, results]
    }

    // Backups are metadata + results pairs; the cap counts snapshots, and a
    // pruned snapshot loses both files.
    #[test]
    fn backup_pairs_prune_at_five_per_session() {
        let fx = Fixture::new();
        let id = uuid::Uuid::new_v4().to_string();
        let mine: Vec<[PathBuf; 2]> = (1..=8).map(|h| fake_backup_pair(&fx, &id, Duration::hours(h))).collect();
        // A metadata-only backup (pre-I10, or a session with no results yet).
        let lone = fake_backup(&fx, &id, Duration::hours(9));

        assert_eq!(fx.manager.cleanup_old_sessions(30).unwrap(), 3 * 2 + 1);
        assert!(mine[..MAX_BACKUPS_PER_SESSION].iter().flatten().all(|p| p.exists()));
        assert!(mine[MAX_BACKUPS_PER_SESSION..].iter().flatten().all(|p| !p.exists()));
        assert!(!lone.exists());
    }

    // The sweep deletes an old session's results with it, removes orphaned
    // results files, keeps live ones, and still skips entries it can't read.
    #[test]
    fn sweep_handles_results_files_and_skips_bad_entries() {
        let fx = Fixture::new();
        let dir = &fx.manager.sessions_dir;
        let old = fake_session(&fx, Duration::days(100));
        let old_results = SessionManager::results_path_for_meta(&old);
        fs::write(&old_results, "{}\n").unwrap();
        let live = fx.manager.create_session("live".to_string(), emails(1), settings()).unwrap();
        fx.manager
            .update_session_progress(&live, vec![result("user0@example.com", "Safe")], 0, false, None, false)
            .unwrap();
        let orphan = dir.join(format!("{}{}", uuid::Uuid::new_v4(), RESULTS_SUFFIX));
        fs::write(&orphan, "{}\n").unwrap();
        let garbage = dir.join("garbage.json");
        fs::write(&garbage, "{not json").unwrap();
        let odd = dir.join(RESULTS_SUFFIX.trim_start_matches('.'));
        fs::write(&odd, "").unwrap();

        let report = fx.manager.sweep(Utc::now() - Duration::days(90));
        assert_eq!(report, SweepReport { deleted: 3, skipped: 1 });
        assert!(!old.exists() && !old_results.exists() && !orphan.exists());
        assert!(results_path(&fx, &live).exists() && meta_path(&fx, &live).exists());
        assert!(garbage.exists() && odd.exists());
    }

    #[test]
    fn backup_due_respects_interval_and_backwards_clocks() {
        let now = Utc::now();
        let mut meta = SessionMeta {
            id: "x".to_string(),
            name: "x".to_string(),
            emails: vec![],
            status: "pending".to_string(),
            current_index: 0,
            total: 0,
            created_at: now.to_rfc3339(),
            completed_at: None,
            settings: settings(),
            last_backup_at: None,
            results: None,
        };
        assert!(SessionManager::backup_due(&meta, now));
        meta.last_backup_at = Some((now - Duration::seconds(10)).to_rfc3339());
        assert!(!SessionManager::backup_due(&meta, now));
        meta.last_backup_at = Some((now - Duration::seconds(BACKUP_MIN_INTERVAL_SECS)).to_rfc3339());
        assert!(SessionManager::backup_due(&meta, now));
        meta.last_backup_at = Some((now + Duration::hours(1)).to_rfc3339());
        assert!(SessionManager::backup_due(&meta, now), "clock went backwards");
        meta.last_backup_at = Some("garbage".to_string());
        assert!(SessionManager::backup_due(&meta, now));
    }

    // paused/stopped survive alongside appended results, in both load and list.
    #[test]
    fn halt_status_round_trips_with_results() {
        let fx = Fixture::new();
        let id = fx.manager.create_session("halt".to_string(), emails(3), settings()).unwrap();
        fx.manager
            .update_session_progress(&id, vec![result("user0@example.com", "Safe")], 1, true, Some("paused"), false)
            .unwrap();
        assert_eq!(fx.manager.load_session(&id).unwrap().status, "paused");
        assert_eq!(fx.manager.list_sessions().unwrap()[0].status, "paused");

        fx.manager
            .update_session_progress(&id, vec![result("user1@example.com", "Safe")], 2, true, Some("stopped"), false)
            .unwrap();
        let loaded = fx.manager.load_session(&id).unwrap();
        assert_eq!(loaded.status, "stopped");
        assert_eq!(loaded.results.len(), 2);
        assert_eq!(fx.manager.list_sessions().unwrap()[0].status, "stopped");

        let err = fx
            .manager
            .update_session_progress(&id, vec![result("user2@example.com", "Safe")], 3, false, Some("in-progress"), false)
            .unwrap_err();
        assert!(err.contains("Invalid session status"), "{}", err);
        assert_eq!(fx.manager.load_session(&id).unwrap().results.len(), 2, "rejected update appends nothing");
    }

    #[test]
    fn results_paths_reject_traversal() {
        let fx = Fixture::new();
        for id in MALICIOUS_IDS {
            assert!(fx.manager.validated_results_path(id).is_err(), "{:?}", id);
        }
        assert_eq!(
            SessionManager::meta_path_for_results(Path::new("/d/abc.results.jsonl")),
            Some(PathBuf::from("/d/abc.json"))
        );
        assert_eq!(SessionManager::meta_path_for_results(Path::new("/d/.results.jsonl")), None);
        assert_eq!(SessionManager::meta_path_for_results(Path::new("/d/abc.json")), None);
    }

    // ---- Wire format: camelCase out, snake_case (pre-fix files) still in ----

    /// Every object key anywhere in `v` that contains an underscore.
    fn snake_keys(v: &serde_json::Value) -> Vec<String> {
        let mut found = Vec::new();
        match v {
            serde_json::Value::Object(map) => {
                for (k, child) in map {
                    if k.contains('_') {
                        found.push(k.clone());
                    }
                    found.extend(snake_keys(child));
                }
            }
            serde_json::Value::Array(items) => items.iter().for_each(|i| found.extend(snake_keys(i))),
            _ => {}
        }
        found
    }

    fn keys(v: &serde_json::Value) -> Vec<String> {
        let mut keys: Vec<String> = v.as_object().expect("object").keys().cloned().collect();
        keys.sort();
        keys
    }

    /// A result line exactly as the I10 code wrote it. Hand-written rather
    /// than serialized, so it pins the on-disk shape independently of the
    /// struct.
    fn i10_result_line(email: &str, verdict: &str, proxy_id: Option<&str>, error_type: Option<&str>) -> String {
        serde_json::json!({
            "email": email, "result": verdict, "reason": "r", "logs": ["l"],
            "domain": "example.com", "validationDuration": 12, "mxRecordCount": 2,
            "isDisposable": false, "isRoleAccount": false, "isCatchAll": false,
            "isDeliverable": verdict == "Safe", "isDisabled": false, "hasFullInbox": false,
            "canConnectSmtp": true, "isValidSyntax": true, "isB2c": false,
            "suggestion": null, "gravatarUrl": null, "haveibeenpwned": null,
            "errorType": error_type, "timestamp": "2026-10-01T12:00:01Z",
            "validationMode": "thorough", "riskScore": 5, "proxyId": proxy_id
        })
        .to_string()
    }

    #[test]
    fn wire_format_is_camel_case_and_accepts_snake_case() {
        // What the frontend's createSession sends as `settings`.
        let from_frontend: SessionSettings =
            serde_json::from_value(serde_json::json!({"validationMode": "quick"})).expect("camelCase settings");
        assert_eq!(from_frontend.validation_mode, "quick");
        let from_legacy: SessionSettings =
            serde_json::from_value(serde_json::json!({"validation_mode": "standard"})).expect("snake_case settings");
        assert_eq!(from_legacy.validation_mode, "standard");
        assert_eq!(serde_json::to_value(&from_frontend).unwrap(), serde_json::json!({"validationMode": "quick"}));

        let session = ValidationSession {
            id: "abc".to_string(),
            name: "n".to_string(),
            emails: vec!["a@example.com".to_string()],
            results: vec![result("a@example.com", "Safe")],
            status: "completed".to_string(),
            current_index: 1,
            total: 1,
            created_at: "2026-10-01T12:00:00+00:00".to_string(),
            completed_at: Some("2026-10-01T12:05:00+00:00".to_string()),
            settings: settings(),
            skipped_result_lines: 2,
        };
        let wire = serde_json::to_value(&session).unwrap();
        assert_eq!(
            keys(&wire),
            ["completedAt", "createdAt", "currentIndex", "emails", "id", "name", "results", "settings", "skippedResultLines", "status", "total"]
        );
        assert!(snake_keys(&wire).is_empty(), "{:?}", snake_keys(&wire));
        let camel: ValidationSession = serde_json::from_value(wire.clone()).expect("camelCase session");
        assert_eq!(serde_json::to_value(&camel).unwrap(), wire);

        let snake_json = serde_json::json!({
            "id": "abc", "name": "n", "emails": ["a@example.com"],
            "results": [serde_json::from_str::<serde_json::Value>(&i10_result_line("a@example.com", "Safe", None, None)).unwrap()],
            "status": "completed", "current_index": 1, "total": 1,
            "created_at": "2026-10-01T12:00:00+00:00", "completed_at": "2026-10-01T12:05:00+00:00",
            "settings": {"validation_mode": "standard"}, "skipped_result_lines": 2
        });
        let snake: ValidationSession = serde_json::from_value(snake_json).expect("snake_case session");
        assert_eq!(snake.current_index, 1);
        assert_eq!(snake.created_at, "2026-10-01T12:00:00+00:00");
        assert_eq!(snake.completed_at.as_deref(), Some("2026-10-01T12:05:00+00:00"));
        assert_eq!(snake.settings.validation_mode, "standard");
        assert_eq!(snake.skipped_result_lines, 2);
        assert!(snake_keys(&serde_json::to_value(&snake).unwrap()).is_empty());

        let summary_snake: SessionSummary = serde_json::from_value(serde_json::json!({
            "id": "abc", "name": "n", "status": "paused", "current_index": 3, "total": 9,
            "created_at": "2026-10-01T12:00:00+00:00", "completed_at": null,
            "settings": {"validation_mode": "quick"}
        }))
        .expect("snake_case summary");
        assert_eq!((summary_snake.current_index, summary_snake.total), (3, 9));
        let summary_wire = serde_json::to_value(&summary_snake).unwrap();
        assert_eq!(
            keys(&summary_wire),
            ["completedAt", "createdAt", "currentIndex", "id", "name", "settings", "status", "total"]
        );
        let summary_camel: SessionSummary = serde_json::from_value(summary_wire.clone()).expect("camelCase summary");
        assert_eq!(serde_json::to_value(&summary_camel).unwrap(), summary_wire);

        let meta_snake: SessionMeta = serde_json::from_value(serde_json::json!({
            "id": "abc", "name": "n", "emails": [], "status": "paused", "current_index": 3, "total": 9,
            "created_at": "2026-10-01T12:00:00+00:00", "completed_at": null,
            "settings": {"validation_mode": "quick"}, "last_backup_at": "2026-10-01T12:01:00+00:00"
        }))
        .expect("snake_case metadata");
        assert_eq!(meta_snake.last_backup_at.as_deref(), Some("2026-10-01T12:01:00+00:00"));
        let meta_wire = serde_json::to_value(&meta_snake).unwrap();
        assert_eq!(
            keys(&meta_wire),
            ["completedAt", "createdAt", "currentIndex", "emails", "id", "lastBackupAt", "name", "settings", "status", "total"]
        );
        let meta_camel: SessionMeta = serde_json::from_value(meta_wire.clone()).expect("camelCase metadata");
        assert_eq!(serde_json::to_value(&meta_camel).unwrap(), meta_wire);
    }

    // The path the running app takes: settings as the frontend sends them,
    // results as the frontend sends them, and the load/list payloads as the
    // frontend receives them — every key it reads present, in camelCase.
    #[test]
    fn created_session_reaches_frontend_in_camel_case() {
        let fx = Fixture::new();
        let settings: SessionSettings =
            serde_json::from_value(serde_json::json!({"validationMode": "thorough"})).expect("frontend settings");
        let id = fx.manager.create_session("e2e".to_string(), emails(3), settings).unwrap();

        let mut proxied = result("user0@example.com", "Safe");
        proxied.proxy_id = Some("proxy-1".to_string());
        let mut errored = result("user1@example.com", "Unknown");
        errored.error_type = Some("timeout".to_string());
        fx.manager.update_session_progress(&id, vec![proxied, errored], 2, true, None, false).unwrap();

        let on_disk = meta_json(&fx, &id);
        assert!(snake_keys(&on_disk).is_empty(), "metadata written in camelCase: {:?}", snake_keys(&on_disk));
        assert!(on_disk.get("lastBackupAt").is_some());
        for line in fs::read_to_string(results_path(&fx, &id)).unwrap().lines() {
            let v: serde_json::Value = serde_json::from_str(line).unwrap();
            assert!(snake_keys(&v).is_empty(), "{}", line);
        }

        // load_validation_session's payload: what validateSession checks and
        // what the resume / history / diff views read.
        let wire = serde_json::to_value(fx.manager.load_session(&id).unwrap()).unwrap();
        assert!(snake_keys(&wire).is_empty(), "{:?}", snake_keys(&wire));
        assert_eq!(wire["id"], id.as_str());
        assert_eq!(wire["name"], "e2e");
        assert_eq!(wire["emails"].as_array().unwrap().len(), 3);
        assert_eq!(wire["status"], "in-progress");
        assert_eq!(wire["currentIndex"], 2);
        assert_eq!(wire["total"], 3);
        assert!(DateTime::parse_from_rfc3339(wire["createdAt"].as_str().unwrap()).is_ok());
        assert!(wire["completedAt"].is_null());
        assert_eq!(wire["settings"]["validationMode"], "thorough");
        let results = wire["results"].as_array().unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0]["proxyId"], "proxy-1");
        assert_eq!(results[0]["mxRecordCount"], 1);
        assert_eq!(results[0]["riskScore"], 0);
        assert_eq!(results[1]["errorType"], "timeout");

        // list_validation_sessions' payload: what the history list and the
        // crash-recovery dialog read.
        let listed = serde_json::to_value(fx.manager.list_sessions().unwrap()).unwrap();
        assert!(snake_keys(&listed).is_empty(), "{:?}", snake_keys(&listed));
        assert_eq!(listed[0]["currentIndex"], 2);
        assert_eq!(listed[0]["createdAt"], wire["createdAt"]);
        assert_eq!(listed[0]["settings"]["validationMode"], "thorough");
        assert_eq!(listed[0]["status"], "in-progress");

        fx.manager.update_session_progress(&id, vec![result("user2@example.com", "Safe")], 3, false, None, false).unwrap();
        let wire = serde_json::to_value(fx.manager.load_session(&id).unwrap()).unwrap();
        assert_eq!(wire["status"], "completed");
        assert!(DateTime::parse_from_rfc3339(wire["completedAt"].as_str().unwrap()).is_ok());
    }

    // An I10 session on disk (snake_case metadata + results file) loads and
    // lists; the next save rewrites the metadata in camelCase without losing
    // anything (lastBackupAt included), appends after the I10 lines without
    // touching them, and the old and new lines still merge by email.
    #[test]
    fn i10_snake_case_session_loads_and_resaves_as_camel_case() {
        let fx = Fixture::new();
        let id = uuid::Uuid::new_v4().to_string();
        let last_backup = Utc::now().to_rfc3339();
        let meta = serde_json::json!({
            "id": id, "name": "i10", "emails": emails(3), "status": "paused",
            "current_index": 2, "total": 3, "created_at": "2026-10-01T12:00:00+00:00",
            "completed_at": null, "settings": {"validation_mode": "thorough"},
            "last_backup_at": last_backup
        });
        fs::write(meta_path(&fx, &id), meta.to_string()).unwrap();
        let i10_lines = format!(
            "{}\n{}\n",
            i10_result_line("user0@example.com", "Safe", Some("proxy-1"), None),
            i10_result_line("user1@example.com", "Unknown", None, Some("timeout"))
        );
        fs::write(results_path(&fx, &id), &i10_lines).unwrap();

        let loaded = fx.manager.load_session(&id).unwrap();
        assert_eq!(loaded.name, "i10");
        assert_eq!(loaded.status, "paused");
        assert_eq!(loaded.current_index, 2);
        assert_eq!(loaded.created_at, "2026-10-01T12:00:00+00:00");
        assert_eq!(loaded.settings.validation_mode, "thorough");
        assert_eq!(loaded.skipped_result_lines, 0);
        assert_eq!(loaded.results[0].proxy_id.as_deref(), Some("proxy-1"));
        assert_eq!(loaded.results[1].error_type.as_deref(), Some("timeout"));
        let listed = fx.manager.list_sessions().unwrap();
        assert_eq!((listed.len(), listed[0].current_index), (1, 2));

        // A retry of user1 plus a new user2. lastBackupAt is recent, so a
        // backup-requesting save must not back up — only true if it was read.
        fx.manager
            .update_session_progress(
                &id,
                vec![result("user1@example.com", "Invalid"), result("user2@example.com", "Safe")],
                3,
                true,
                None,
                false,
            )
            .unwrap();
        assert!(fx.dir_entries(&fx.manager.sessions_dir.join("backups")).is_empty(), "last_backup_at was lost");

        let on_disk = meta_json(&fx, &id);
        assert!(snake_keys(&on_disk).is_empty(), "{:?}", snake_keys(&on_disk));
        assert_eq!(on_disk["lastBackupAt"], last_backup.as_str());
        assert_eq!(on_disk["createdAt"], "2026-10-01T12:00:00+00:00");
        assert_eq!(on_disk["settings"]["validationMode"], "thorough");
        assert_eq!(on_disk["emails"], serde_json::json!(emails(3)));
        assert_eq!(on_disk["currentIndex"], 3);
        let content = fs::read_to_string(results_path(&fx, &id)).unwrap();
        assert!(content.starts_with(&i10_lines), "I10 lines rewritten");
        assert_eq!(content.lines().count(), 4);

        let reloaded = fx.manager.load_session(&id).unwrap();
        assert_eq!(
            summary(&reloaded.results),
            vec![
                ("user0@example.com".to_string(), "Safe".to_string()),
                ("user1@example.com".to_string(), "Invalid".to_string()),
                ("user2@example.com".to_string(), "Safe".to_string()),
            ]
        );
        assert_eq!(reloaded.results[0].proxy_id.as_deref(), Some("proxy-1"));
        assert_eq!(reloaded.status, "completed");
        assert_eq!(reloaded.created_at, "2026-10-01T12:00:00+00:00");
        assert_eq!(reloaded.settings.validation_mode, "thorough");
    }

    // A pre-I10 single-file session in snake_case (results inline) loads,
    // lists, and survives its upgrading save with every result.
    #[test]
    fn legacy_snake_case_single_file_session_loads_and_upgrades() {
        let fx = Fixture::new();
        let id = uuid::Uuid::new_v4().to_string();
        let inline: Vec<serde_json::Value> = ["user0@example.com", "user1@example.com"]
            .iter()
            .map(|e| serde_json::from_str(&i10_result_line(e, "Safe", None, None)).unwrap())
            .collect();
        let legacy = serde_json::json!({
            "id": id, "name": "legacy", "emails": emails(3), "results": inline,
            "status": "paused", "current_index": 2, "total": 3,
            "created_at": "2026-01-10T09:00:00+00:00", "completed_at": null,
            "settings": {"validation_mode": "quick"}
        });
        fs::write(meta_path(&fx, &id), legacy.to_string()).unwrap();

        let loaded = fx.manager.load_session(&id).unwrap();
        assert_eq!(loaded.results.len(), 2);
        assert_eq!((loaded.current_index, loaded.settings.validation_mode.as_str()), (2, "quick"));
        assert_eq!(fx.manager.list_sessions().unwrap()[0].created_at, "2026-01-10T09:00:00+00:00");

        fx.manager
            .update_session_progress(&id, vec![result("user2@example.com", "Risky")], 3, false, None, false)
            .unwrap();
        let on_disk = meta_json(&fx, &id);
        assert!(snake_keys(&on_disk).is_empty(), "{:?}", snake_keys(&on_disk));
        assert!(on_disk.get("results").is_none());
        let reloaded = fx.manager.load_session(&id).unwrap();
        assert_eq!(
            reloaded.results.iter().map(|r| r.email.as_str()).collect::<Vec<_>>(),
            vec!["user0@example.com", "user1@example.com", "user2@example.com"]
        );
        assert_eq!(reloaded.name, "legacy");
        assert_eq!(reloaded.created_at, "2026-01-10T09:00:00+00:00");
        assert_eq!(reloaded.settings.validation_mode, "quick");
        assert_eq!(reloaded.status, "completed");
    }
}

//! Structured logging (Phase 14 · hardening). JSON lines in
//! `AppData/logs/kairo.log`, rotated at 1 MB to `kairo.log.1`. Any field whose
//! key looks secret-bearing (key/token/secret/password/authorization) is
//! redacted before it reaches disk. Logging is best-effort: failures never
//! propagate into command results.

use serde_json::{json, Map, Value};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const ROTATE_BYTES: u64 = 1024 * 1024;

static LOG_STATE: Mutex<Option<PathBuf>> = Mutex::new(None);
static WRITE_FAILURE_WARNED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Point the logger at `log_dir/kairo.log` and rotate an oversized file.
pub fn init(log_dir: &PathBuf) -> Result<(), String> {
    fs::create_dir_all(log_dir).map_err(|e| format!("cannot create log dir: {e}"))?;
    let path = log_dir.join("kairo.log");
    let mut rotation_error: Option<String> = None;
    if let Ok(meta) = fs::metadata(&path) {
        if meta.len() >= ROTATE_BYTES {
            let rotated = log_dir.join("kairo.log.1");
            if let Err(e) = fs::rename(&path, &rotated) {
                rotation_error = Some(format!("log rotation failed ({}): {e}", rotated.display()));
            }
        }
    }
    *LOG_STATE
        .lock()
        .map_err(|_| "log state poisoned".to_string())? = Some(path);
    // Surface rotation failure through the log itself — appending to an
    // unrotated file is degraded, not fatal.
    if let Some(error) = rotation_error {
        log_event("warn", "log_rotation_failed", &[("error", error)]);
    }
    Ok(())
}

/// Append one JSON line. Fields whose keys look secret-bearing are redacted.
/// No-op when logging has not been initialized (unit tests, browser dev).
pub fn log_event(level: &str, event: &str, fields: &[(&str, String)]) {
    let guard = match LOG_STATE.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };
    let Some(path) = guard.as_ref() else {
        return;
    };

    let mut record = Map::new();
    record.insert("ts".into(), json!(unix_millis()));
    record.insert("level".into(), json!(level));
    record.insert("event".into(), json!(event));
    for (key, value) in fields {
        record.insert((*key).into(), json!(redact(key, value)));
    }

    let line = Value::Object(record).to_string();
    match OpenOptions::new().create(true).append(true).open(path) {
        Ok(mut file) => {
            if let Err(e) = writeln!(file, "{line}") {
                warn_write_failure_once(&e);
            }
        }
        Err(e) => warn_write_failure_once(&e),
    }
}

/// Logging stays best-effort — a failed write never breaks the caller — but it
/// is not silent: warn on stderr once per session so a broken log location is
/// visible in dev consoles.
fn warn_write_failure_once(error: &std::io::Error) {
    if !WRITE_FAILURE_WARNED.swap(true, std::sync::atomic::Ordering::Relaxed) {
        eprintln!("[kairo] log write failed, log events are being dropped: {error}");
    }
}

pub fn redact<'a>(key: &str, value: &'a str) -> &'a str {
    const SENSITIVE: &[&str] = &["key", "token", "secret", "password", "authorization"];
    let key = key.to_ascii_lowercase();
    if SENSITIVE.iter().any(|word| key.contains(word)) {
        "[REDACTED]"
    } else {
        value
    }
}

fn unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_bearing_keys_are_redacted() {
        assert_eq!(redact("api_key", "sk-123"), "[REDACTED]");
        assert_eq!(redact("APIKey", "sk-123"), "[REDACTED]");
        assert_eq!(redact("auth_token", "abc"), "[REDACTED]");
        assert_eq!(redact("provider_password", "hunter2"), "[REDACTED]");
        assert_eq!(redact("Authorization", "Bearer x"), "[REDACTED]");
        assert_eq!(redact("job_id", "7"), "7");
        assert_eq!(redact("duration_ms", "120"), "120");
    }

    #[test]
    fn events_are_written_as_redacted_json_lines_and_rotate() {
        let dir = std::env::temp_dir().join(format!("kairo-log-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        init(&dir).unwrap();
        log_event(
            "info",
            "test_event",
            &[
                ("job_id", "7".into()),
                ("api_key", "sk-super-secret".into()),
            ],
        );
        log_event("error", "test_failure", &[("error", "boom".into())]);

        let text = fs::read_to_string(dir.join("kairo.log")).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].contains("\"event\":\"test_event\""));
        assert!(lines[0].contains("\"job_id\":\"7\""));
        assert!(lines[0].contains("[REDACTED]"));
        assert!(!lines[0].contains("sk-super-secret"));
        assert!(lines[1].contains("\"level\":\"error\""));

        // Force rotation: seed a full log, re-init, write, assert the rollover.
        fs::write(
            dir.join("kairo.log"),
            "x".repeat((ROTATE_BYTES + 1) as usize),
        )
        .unwrap();
        init(&dir).unwrap();
        log_event("info", "after_rotation", &[]);
        let current = fs::read_to_string(dir.join("kairo.log")).unwrap();
        assert!(current.contains("after_rotation"));
        assert_eq!(
            fs::read_to_string(dir.join("kairo.log.1")).unwrap().len() as u64,
            ROTATE_BYTES + 1
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}

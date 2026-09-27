//! Structured logging (Phase 14 · hardening). JSON lines in
//! `AppData/logs/kairo.log`, rotated at 1 MB keeping two generations
//! (`kairo.log.1` = previous, `kairo.log.2` = the one before). Rotation is
//! checked at startup and before every write. Any field whose key looks
//! secret-bearing (key/token/secret/password/authorization) is redacted
//! before it reaches disk. Logging is best-effort: failures never propagate
//! into command results.

use serde_json::{json, Map, Value};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const ROTATE_BYTES: u64 = 1024 * 1024;
/// How many rotated generations to keep. `kairo.log.1` is the previous
/// session, `kairo.log.2` the one before — enough to report a bug seen
/// "two sessions ago" without growing the log dir unboundedly.
const KEEP_GENERATIONS: u64 = 2;

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
            rotation_error = rotate(log_dir).err();
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

/// Shift the generations: `.1` → `.2` → (dropped), current → `.1`.
/// Called with the DB-style state lock already held or from `init`.
fn rotate(log_dir: &Path) -> Result<(), String> {
    let current = log_dir.join("kairo.log");
    for generation in (2..=KEEP_GENERATIONS).rev() {
        let from = log_dir.join(format!("kairo.log.{}", generation - 1));
        let to = log_dir.join(format!("kairo.log.{generation}"));
        if from.exists() {
            // fs::rename replaces an existing destination on every supported
            // platform, so the oldest generation is silently retired here.
            if let Err(e) = fs::rename(&from, &to) {
                return Err(format!("log rotation failed ({}): {e}", to.display()));
            }
        }
    }
    if current.exists() {
        let first = log_dir.join("kairo.log.1");
        fs::rename(&current, &first)
            .map_err(|e| format!("log rotation failed ({}): {e}", first.display()))?;
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

    // Mid-session rotation: a long session must not outgrow the cap just
    // because `init` only ran once at startup.
    if let Ok(meta) = fs::metadata(path) {
        if meta.len() >= ROTATE_BYTES {
            if let Some(dir) = path.parent() {
                if let Err(e) = rotate(dir) {
                    warn_write_failure_once(&std::io::Error::other(e));
                }
            }
        }
    }

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

    /// `LOG_STATE` is process-global; parallel tests would race on `init`.
    static LOG_TEST_LOCK: Mutex<()> = Mutex::new(());

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
        let _guard = LOG_TEST_LOCK.lock().unwrap();
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

    #[test]
    fn rotation_keeps_two_generations() {
        let _guard = LOG_TEST_LOCK.lock().unwrap();
        let dir = std::env::temp_dir().join(format!("kairo-log-gen-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        init(&dir).unwrap();

        // Session A: one event, then the log grows past the cap.
        log_event("info", "session_a", &[]);
        let oversized = "x".repeat(ROTATE_BYTES as usize);
        {
            use std::io::Write;
            let mut f = fs::OpenOptions::new()
                .append(true)
                .open(dir.join("kairo.log"))
                .unwrap();
            f.write_all(oversized.as_bytes()).unwrap();
        }
        init(&dir).unwrap(); // rotates A → .1

        // Session B: fills again.
        fs::write(dir.join("kairo.log"), &oversized).unwrap();
        init(&dir).unwrap(); // rotates B → .1, A → .2
        log_event("info", "session_b", &[]);

        assert!(fs::read_to_string(dir.join("kairo.log.2"))
            .unwrap()
            .contains("session_a"));
        assert_eq!(
            fs::read_to_string(dir.join("kairo.log.1")).unwrap().len() as u64,
            ROTATE_BYTES
        );
        assert!(fs::read_to_string(dir.join("kairo.log"))
            .unwrap()
            .contains("session_b"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn mid_session_write_rotates_oversized_log() {
        let _guard = LOG_TEST_LOCK.lock().unwrap();
        let dir = std::env::temp_dir().join(format!("kairo-log-mid-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        init(&dir).unwrap();
        // Fill the log without re-initializing — only `log_event` runs.
        fs::write(
            dir.join("kairo.log"),
            "x".repeat((ROTATE_BYTES + 1) as usize),
        )
        .unwrap();
        log_event("info", "after_mid_rotation", &[]);
        assert_eq!(
            fs::read_to_string(dir.join("kairo.log.1")).unwrap().len() as u64,
            ROTATE_BYTES + 1
        );
        assert!(fs::read_to_string(dir.join("kairo.log"))
            .unwrap()
            .contains("after_mid_rotation"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}

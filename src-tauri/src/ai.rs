//! AI provider abstraction (Phase 7). OpenAI-compatible chat completions over
//! ureq; the API key lives in the OS credential store (Windows Credential
//! Manager via keyring) — never in SQLite, logs, or plan files.

use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfig {
    /// OpenAI-compatible base URL, e.g. https://api.openai.com/v1
    pub base_url: String,
    pub model: String,
}

impl Default for AiConfig {
    fn default() -> Self {
        AiConfig {
            base_url: "https://api.openai.com/v1".to_string(),
            model: "gpt-4o-mini".to_string(),
        }
    }
}

const KEYRING_SERVICE: &str = "Kairo";
const KEYRING_USER: &str = "ai-api-key";

pub fn store_api_key(key: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| format!("credential store unavailable: {e}"))?;
    entry
        .set_password(key)
        .map_err(|e| format!("could not store API key: {e}"))
}

pub fn delete_api_key() -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| format!("credential store unavailable: {e}"))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("could not delete API key: {e}")),
    }
}

pub fn load_api_key() -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| format!("credential store unavailable: {e}"))?;
    match entry.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("could not read API key: {e}")),
    }
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Debug, Deserialize)]
struct ChatMessage {
    content: String,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

fn http_error(e: ureq::Error) -> String {
    match e {
        ureq::Error::Status(code, resp) => {
            let body = resp
                .into_string()
                .unwrap_or_default()
                .chars()
                .take(300)
                .collect::<String>();
            // Never echo request headers (the key is in there).
            format!("provider returned HTTP {code}: {body}")
        }
        other => format!("network error: {other}"),
    }
}

/// Calls POST {base_url}/chat/completions and returns the assistant text.
pub fn chat(config: &AiConfig, api_key: &str, system: &str, user: &str) -> Result<String, String> {
    if api_key.is_empty() {
        return Err("No API key configured — add one in Settings.".to_string());
    }
    let base = config.base_url.trim_end_matches('/');
    let url = format!("{base}/chat/completions");

    let body = serde_json::json!({
        "model": config.model,
        "temperature": 0.2,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user }
        ],
        "response_format": { "type": "json_object" }
    });

    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(90))
        .user_agent("kairo-tailor")
        .build();

    let response: ChatResponse = agent
        .post(&url)
        .set("Authorization", &format!("Bearer {api_key}"))
        .set("Content-Type", "application/json")
        .send_string(&body.to_string())
        .map_err(http_error)?
        .into_json()
        .map_err(|e| e.to_string())?;

    response
        .choices
        .first()
        .map(|c| c.message.content.clone())
        .ok_or_else(|| "Provider returned no choices".to_string())
}

/// Quick connectivity + auth check used by Settings.
pub fn test_connection(config: &AiConfig, api_key: &str) -> Result<String, String> {
    let answer = chat(config, api_key, "Reply with the single word: ok", "ping")?;
    Ok(answer.chars().take(80).collect())
}

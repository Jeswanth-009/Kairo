//! AI provider abstraction (Phase 7). OpenAI-compatible chat completions over
//! ureq; the API key lives in the OS credential store (Windows Credential
//! Manager via keyring) — never in SQLite, logs, or plan files.
//!
//! Local providers (Ollama, LM Studio, llama.cpp server) need no API key:
//! when no key is stored the Authorization header is simply omitted.

use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfig {
    /// OpenAI-compatible base URL, e.g. https://api.openai.com/v1 or
    /// http://localhost:11434/v1 for Ollama.
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

/// Local-model cold starts (first request loads the model into RAM) can take
/// minutes on CPU — generous by design.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(240);

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

#[derive(Debug, Deserialize)]
struct ModelsResponse {
    #[serde(default)]
    data: Vec<ModelsEntry>,
}

#[derive(Debug, Deserialize)]
struct ModelsEntry {
    id: String,
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

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(REQUEST_TIMEOUT)
        .user_agent("kairo-tailor")
        .build()
}

/// Short-timeout agent for cheap GETs (model listing) — a dead endpoint must
/// not occupy the caller for the full chat timeout.
fn quick_agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(15))
        .user_agent("kairo-tailor")
        .build()
}

/// Calls POST {base_url}/chat/completions and returns the assistant text.
/// `api_key` is optional: empty means a local provider without auth.
pub fn chat(config: &AiConfig, api_key: &str, system: &str, user: &str) -> Result<String, String> {
    let base = config.base_url.trim_end_matches('/');
    if base.is_empty() {
        return Err("No provider base URL configured — add one in Settings.".to_string());
    }
    if config.model.trim().is_empty() {
        return Err("No model configured — pick one in Settings.".to_string());
    }
    let url = format!("{base}/chat/completions");

    let base_body = serde_json::json!({
        "model": config.model,
        "temperature": 0.2,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user }
        ],
    });
    // Structured output when the provider supports it; several
    // OpenAI-compatible servers reject the field outright.
    let with_format = {
        let mut b = base_body.clone();
        b["response_format"] = serde_json::json!({ "type": "json_object" });
        b
    };

    let send = |body: &serde_json::Value| -> Result<ChatResponse, ureq::Error> {
        let mut request = agent().post(&url).set("Content-Type", "application/json");
        if !api_key.trim().is_empty() {
            request = request.set("Authorization", &format!("Bearer {}", api_key.trim()));
        }
        request
            .send_string(&body.to_string())?
            .into_json()
            .map_err(ureq::Error::from)
    };

    let response: ChatResponse = match send(&with_format) {
        Ok(r) => r,
        Err(ureq::Error::Status(400, _)) => {
            // Provider doesn't understand response_format — the prompt already
            // demands JSON, so retry without the field.
            send(&base_body).map_err(http_error)?
        }
        Err(e) => return Err(http_error(e)),
    };

    response
        .choices
        .first()
        .map(|c| c.message.content.clone())
        .ok_or_else(|| "Provider returned no choices".to_string())
}

/// Lists models from GET {base_url}/models (OpenAI-compatible; Ollama and
/// LM Studio both serve it) so Settings can offer a picker.
pub fn list_models(base_url: &str, api_key: &str) -> Result<Vec<String>, String> {
    let base = base_url.trim_end_matches('/');
    if base.is_empty() {
        return Err("No provider base URL configured.".to_string());
    }
    let mut request = quick_agent().get(&format!("{base}/models"));
    if !api_key.trim().is_empty() {
        request = request.set("Authorization", &format!("Bearer {}", api_key.trim()));
    }
    let response: ModelsResponse = request
        .call()
        .map_err(http_error)?
        .into_json()
        .map_err(|e| e.to_string())?;
    let mut ids: Vec<String> = response.data.into_iter().map(|m| m.id).collect();
    ids.sort();
    Ok(ids)
}

/// Quick connectivity + auth check used by Settings.
pub fn test_connection(config: &AiConfig, api_key: &str) -> Result<String, String> {
    let answer = chat(config, api_key, "Reply with the single word: ok", "ping")?;
    Ok(answer.chars().take(80).collect())
}

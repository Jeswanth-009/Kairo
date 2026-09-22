//! AI provider abstraction (Phase 7). OpenAI-compatible chat completions over
//! ureq; the API key lives in the OS credential store (Windows Credential
//! Manager via keyring) — never in SQLite, logs, or plan files.
//!
//! Local providers (Ollama, LM Studio, llama.cpp server) need no API key:
//! when no key is stored the Authorization header is simply omitted.
//!
//! Latency contract (v4 tailor revamp): generation is bounded by `max_tokens`,
//! plain decoding is the fast path and JSON-mode only a fallback, and every
//! call reports its duration + token usage so slowness is visible, not magic.

use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

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

/// Cold starts (first request loads a local model into RAM) can take a while —
/// but a hung provider must not occupy the caller forever. Batch calls get a
/// longer budget because one request covers the whole plan.
pub const SINGLE_CALL_TIMEOUT: Duration = Duration::from_secs(120);
pub const BATCH_CALL_TIMEOUT: Duration = Duration::from_secs(240);

#[derive(Debug, Clone)]
pub struct ChatOptions {
    /// Hard ceiling on generated tokens. The tailor contract is a ~25-word
    /// JSON object; an uncapped generation is what turned rewrites into
    /// multi-minute waits on thinking models.
    pub max_tokens: u32,
    pub timeout: Duration,
    /// Some providers only produce reliable JSON with response_format; plain
    /// decoding is the fast path, this is the fallback.
    pub force_json_mode: bool,
}

impl Default for ChatOptions {
    fn default() -> Self {
        ChatOptions {
            max_tokens: 200,
            timeout: SINGLE_CALL_TIMEOUT,
            force_json_mode: false,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ChatResult {
    pub content: String,
    /// "stop" | "length" | … — "length" means the cap truncated the output.
    pub finish_reason: Option<String>,
    pub prompt_tokens: Option<u32>,
    pub completion_tokens: Option<u32>,
    pub duration_ms: u128,
}

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
    #[serde(default)]
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ChatMessage {
    content: String,
}

#[derive(Debug, Deserialize)]
struct ChatUsage {
    #[serde(default)]
    prompt_tokens: Option<u32>,
    #[serde(default)]
    completion_tokens: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
    #[serde(default)]
    usage: Option<ChatUsage>,
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

/// Calls POST {base_url}/chat/completions and returns the assistant text plus
/// timing/token metadata. `api_key` is optional: empty means a local provider
/// without auth.
///
/// Decoding order: plain first (fast path — JSON-mode forces grammar sampling
/// on several providers and can be several times slower); if the provider
/// rejects the plain body with a 400, retry once with response_format.
pub fn chat(
    config: &AiConfig,
    api_key: &str,
    system: &str,
    user: &str,
    opts: &ChatOptions,
) -> Result<ChatResult, String> {
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
        "max_tokens": opts.max_tokens,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user }
        ],
    });
    let json_mode_body = {
        let mut b = base_body.clone();
        b["response_format"] = serde_json::json!({ "type": "json_object" });
        b
    };

    let send = |body: &serde_json::Value, timeout: Duration| -> Result<ChatResponse, ureq::Error> {
        let mut request = ureq::AgentBuilder::new()
            .timeout(timeout)
            .user_agent("kairo-tailor")
            .build()
            .post(&url)
            .set("Content-Type", "application/json");
        if !api_key.trim().is_empty() {
            request = request.set("Authorization", &format!("Bearer {}", api_key.trim()));
        }
        request
            .send_string(&body.to_string())?
            .into_json()
            .map_err(ureq::Error::from)
    };

    let started = Instant::now();
    let first_body = if opts.force_json_mode {
        &json_mode_body
    } else {
        &base_body
    };
    let fallback_body = if opts.force_json_mode {
        &base_body
    } else {
        &json_mode_body
    };

    let response: ChatResponse = match send(first_body, opts.timeout) {
        Ok(r) => r,
        Err(ureq::Error::Status(400, _)) => {
            // The provider rejected the body (usually response_format) — one
            // retry with the complementary shape.
            send(fallback_body, opts.timeout).map_err(http_error)?
        }
        Err(e) => return Err(http_error(e)),
    };
    let duration_ms = started.elapsed().as_millis();

    let choice = response
        .choices
        .first()
        .ok_or_else(|| "Provider returned no choices".to_string())?;
    Ok(ChatResult {
        content: choice.message.content.clone(),
        finish_reason: choice.finish_reason.clone(),
        prompt_tokens: response.usage.as_ref().and_then(|u| u.prompt_tokens),
        completion_tokens: response.usage.as_ref().and_then(|u| u.completion_tokens),
        duration_ms,
    })
}

/// Lists models from GET {base_url}/models (OpenAI-compatible; Ollama and
/// LM Studio both serve it) so Settings can offer a picker.
pub fn list_models(base_url: &str, api_key: &str) -> Result<Vec<String>, String> {
    let base = base_url.trim_end_matches('/');
    if base.is_empty() {
        return Err("No provider base URL configured.".to_string());
    }
    let mut request = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(15))
        .user_agent("kairo-tailor")
        .build()
        .get(&format!("{base}/models"));
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
    let result = chat(
        config,
        api_key,
        "Reply with the single word: ok",
        "ping",
        &ChatOptions::default(),
    )?;
    Ok(format!(
        "{} ({} ms)",
        result.content.chars().take(80).collect::<String>(),
        result.duration_ms
    ))
}

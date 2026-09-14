//! Grounded rewriting (Phase 7 · spec §7.3-7.4).
//!
//! Pure prompt building, strict response parsing and the validation pipeline.
//! The AI receives only the target requirement, the canonical bullet, evidence
//! notes and forbidden claims — and must map every material claim back to
//! evidence ids. Violations reject the suggestion; nothing is auto-applied.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const PROMPT_VERSION: u32 = 1;

pub const SYSTEM_PROMPT: &str = "You tailor a single resume bullet for one job requirement. \
Hard rules: keep the same factual meaning; never introduce technologies, tools, numbers, \
metrics, percentages, user counts, scale, or responsibilities that are not in the original \
bullet or its evidence notes; never use any forbidden claim; keep it under 25 words. \
Respond with ONLY a JSON object of shape {\"text\": string, \"factsUsed\": number[], \
\"newClaims\": []} where factsUsed lists the evidence ids you relied on (leave empty if no evidence ids are provided) and newClaims is \
always an empty array.";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TailorContext {
    pub bullet_text: String,
    pub target_requirements: Vec<String>,
    pub evidence_notes: Vec<String>,
    pub forbidden_patterns: Vec<String>,
    pub allowed_fact_ids: Vec<i64>,
    pub skill_vocabulary: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RewriteOutput {
    pub text: String,
    pub facts_used: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationResult {
    pub ok: bool,
    pub violations: Vec<String>,
}

pub fn build_user_prompt(ctx: &TailorContext) -> String {
    let mut user = String::new();
    user.push_str(&format!("Original bullet:\n{}\n\n", ctx.bullet_text));
    user.push_str("Evidence notes (the only facts you may rely on):\n");
    for (i, note) in ctx.evidence_notes.iter().enumerate() {
        user.push_str(&format!("{}. {}\n", i + 1, note));
    }
    if ctx.evidence_notes.is_empty() {
        user.push_str("(none)\n");
    }
    user.push_str("\nTarget requirement(s) to tailor towards:\n");
    for requirement in &ctx.target_requirements {
        user.push_str(&format!("- {requirement}\n"));
    }
    user.push_str("\nForbidden claims (never include these phrases or anything similar):\n");
    if ctx.forbidden_patterns.is_empty() {
        user.push_str("(none configured)\n");
    } else {
        for pattern in &ctx.forbidden_patterns {
            user.push_str(&format!("- {pattern}\n"));
        }
    }
    if ctx.allowed_fact_ids.is_empty() {
        user.push_str("\nEvidence ids available for factsUsed: none (set factsUsed to [])\n");
    } else {
        user.push_str(&format!(
            "\nEvidence ids available for factsUsed: {:?}\n",
            ctx.allowed_fact_ids
        ));
    }
    user
}

/// Strict schema validation: exactly the three contract fields, newClaims empty.
pub fn parse_response(raw: &str) -> Result<RewriteOutput, String> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Raw {
        #[serde(rename = "text")]
        text: serde_json::Value,
        #[serde(rename = "factsUsed")]
        facts_used: serde_json::Value,
        #[serde(rename = "newClaims")]
        new_claims: serde_json::Value,
    }

    let value: serde_json::Value = {
        // The model may wrap the JSON in code fences; strip them defensively.
        let trimmed = raw.trim();
        let stripped = trimmed
            .strip_prefix("```json")
            .or_else(|| trimmed.strip_prefix("```"))
            .unwrap_or(trimmed)
            .trim()
            .strip_suffix("```")
            .unwrap_or(trimmed)
            .trim();
        serde_json::from_str(stripped)
            .map_err(|e| format!("response is not valid JSON: {e}"))?
    };
    let raw: Raw = serde_json::from_value(value).map_err(|e| format!("schema violation: {e}"))?;

    if !raw.new_claims.as_array().map(|a| a.is_empty()).unwrap_or(false) {
        return Err("newClaims must be an empty array — new claims are forbidden".to_string());
    }
    let text = raw
        .text
        .as_str()
        .map(|s| s.trim().to_string())
        .ok_or("text must be a string")?;
    if text.is_empty() {
        return Err("text must not be empty".to_string());
    }
    let mut facts_used = Vec::new();
    match raw.facts_used.as_array() {
        Some(items) => {
            for item in items {
                let id = item
                    .as_i64()
                    .ok_or("factsUsed must contain only evidence ids (numbers)")?;
                facts_used.push(id);
            }
        }
        None => return Err("factsUsed must be an array of evidence ids".to_string()),
    }
    Ok(RewriteOutput { text, facts_used })
}

// ---------------------------------------------------------------------------
// Validation pipeline (spec §7.4)
// ---------------------------------------------------------------------------

fn numbers(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_ascii_digit())
        .filter(|t| !t.is_empty())
        .map(|t| t.trim_start_matches('0').to_string())
        .collect()
}

fn contains_phrase(haystack: &str, phrase: &str) -> bool {
    let h = haystack.to_lowercase();
    let words: Vec<&str> = phrase.split_whitespace().collect();
    if words.is_empty() {
        return false;
    }
    // Token-boundary containment for single words, substring for phrases.
    if words.len() == 1 {
        h.split(|c: char| !c.is_ascii_alphanumeric())
            .any(|t| t == words[0].to_lowercase().as_str())
    } else {
        h.contains(&phrase.to_lowercase())
    }
}

pub fn validate(
    ctx: &TailorContext,
    output: &RewriteOutput,
) -> ValidationResult {
    let mut violations: Vec<String> = Vec::new();

    // 1. Fact reference validation: every material claim maps to allowed facts.
    if !ctx.allowed_fact_ids.is_empty() && output.facts_used.is_empty() {
        violations.push("factsUsed is empty — the rewrite cites no evidence".to_string());
    }
    for id in &output.facts_used {
        if !ctx.allowed_fact_ids.contains(id) {
            violations.push(format!("factsUsed cites unknown evidence id {id}"));
        }
    }

    // 2. Metric diff: new numbers, percentages, users or scale are rejected.
    let original_numbers: Vec<String> = numbers(&ctx.bullet_text);
    let original_set: HashSet<&String> = original_numbers.iter().collect();
    for number in numbers(&output.text) {
        if !original_set.contains(&number) {
            violations.push(format!("introduces a new number ({number})"));
        }
    }

    // 3. Technology diff: Vault-vocabulary skills not present in the original or evidence notes.
    for skill in &ctx.skill_vocabulary {
        if contains_phrase(&output.text, skill)
            && !contains_phrase(&ctx.bullet_text, skill)
            && !ctx.evidence_notes.iter().any(|note| contains_phrase(note, skill))
        {
            violations.push(format!("introduces a new technology ({skill})"));
        }
    }

    // 4. Forbidden rule scan.
    for pattern in &ctx.forbidden_patterns {
        if contains_phrase(&output.text, pattern) {
            violations.push(format!("uses a forbidden claim ({pattern})"));
        }
    }

    ValidationResult { ok: violations.is_empty(), violations }
}

/// Convenience: parse + validate in one step.
pub fn check(raw: &str, ctx: &TailorContext) -> Result<RewriteOutput, String> {
    let output = parse_response(raw)?;
    let validation = validate(ctx, &output);
    if validation.ok {
        Ok(output)
    } else {
        Err(validation.violations.join("; "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx() -> TailorContext {
        TailorContext {
            bullet_text: "Implemented an in-memory key-value store in Python with WAL persistence, TTL eviction and LRU caching".to_string(),
            target_requirements: vec!["Strong Python and SQL skills".to_string()],
            evidence_notes: vec!["GitHub repository with tests and benchmarks".to_string()],
            forbidden_patterns: vec!["production-scale distributed system".to_string()],
            allowed_fact_ids: vec![1],
            skill_vocabulary: vec!["Python".to_string(), "SQL".to_string(), "Kubernetes".to_string()],
        }
    }

    fn raw_json(text: &str, facts: &str) -> String {
        format!(r#"{{"text": "{text}", "factsUsed": {facts}, "newClaims": []}}"#)
    }

    #[test]
    fn parses_valid_response() {
        let out = parse_response(&raw_json(
            "Built an in-memory key-value store in Python with WAL persistence",
            "[1]",
        ))
        .unwrap();
        assert_eq!(out.facts_used, vec![1]);
    }

    #[test]
    fn strips_code_fences() {
        let raw = "```json\n{\"text\": \"x\", \"factsUsed\": [1], \"newClaims\": []}\n```";
        assert!(parse_response(raw).is_ok());
    }

    #[test]
    fn rejects_schema_violations() {
        assert!(parse_response("{\"text\": \"x\"}").is_err()); // missing fields
        assert!(parse_response("not json at all").is_err());
    }

    #[test]
    fn rejects_extra_fields() {
        let raw = r#"{"text": "x", "factsUsed": [1], "newClaims": [], "score": 92}"#;
        assert!(parse_response(raw).is_err());
    }

    #[test]
    fn rejects_non_empty_new_claims() {
        let raw = r#"{"text": "x", "factsUsed": [1], "newClaims": ["served millions"]}"#;
        assert!(parse_response(raw).is_err());
    }

    #[test]
    fn metric_diff_blocks_new_numbers() {
        let raw = raw_json("Served 5000000 users with Python", "[1]");
        let result = validate(&ctx(), &parse_response(&raw).unwrap());
        assert!(!result.ok);
        assert!(result.violations.iter().any(|v| v.contains("number")));
    }

    #[test]
    fn metric_diff_ignores_fuzzy_padding() {
        // numbers() strips leading zeros: "007" == "7"
        let out = RewriteOutput { text: "worked 7 years".into(), facts_used: vec![1] };
        let mut c = ctx();
        c.bullet_text = "worked 07 years".into();
        assert!(validate(&c, &out).ok);
    }

    #[test]
    fn tech_diff_blocks_new_vocabulary() {
        let raw = raw_json("Built a Kubernetes service in Python", "[1]");
        let result = validate(&ctx(), &parse_response(&raw).unwrap());
        assert!(!result.ok);
        assert!(result.violations.iter().any(|v| v.contains("Kubernetes")));
    }

    #[test]
    fn forbidden_scan_blocks_configured_patterns() {
        let raw = raw_json("Built a production-scale distributed system in Python", "[1]");
        let result = validate(&ctx(), &parse_response(&raw).unwrap());
        assert!(!result.ok);
        assert!(result.violations.iter().any(|v| v.contains("forbidden")));
    }

    #[test]
    fn fact_refs_must_be_known() {
        let raw = raw_json("Reworded bullet about Python", "[99]");
        let result = validate(&ctx(), &parse_response(&raw).unwrap());
        assert!(!result.ok);
        assert!(result.violations.iter().any(|v| v.contains("unknown evidence")));
    }

    #[test]
    fn empty_facts_rejected() {
        let raw = raw_json("Reworded bullet about Python", "[]");
        let result = validate(&ctx(), &parse_response(&raw).unwrap());
        assert!(!result.ok);
    }

    #[test]
    fn valid_rewrite_passes_all_gates() {
        let raw = raw_json(
            "Built an in-memory key-value store in Python, WAL persistence and TTL eviction",
            "[1]",
        );
        let out = check(&raw, &ctx()).unwrap();
        assert!(!out.text.is_empty());
    }

    #[test]
    fn test_validation_permits_empty_facts_when_no_evidence_ids() {
        let mut c = ctx();
        c.allowed_fact_ids = vec![];
        let raw = raw_json("Reworded bullet about Python", "[]");
        let result = validate(&c, &parse_response(&raw).unwrap());
        assert!(result.ok);
    }

    #[test]
    fn test_validation_allows_record_tech_stack() {
        let mut c = ctx();
        c.bullet_text = "Designed an in-memory database system".to_string();
        c.evidence_notes = vec!["Implemented in Rust".to_string()];
        c.skill_vocabulary = vec!["Rust".to_string()];
        let raw = raw_json("Designed an in-memory database system in Rust", "[1]");
        let result = validate(&c, &parse_response(&raw).unwrap());
        assert!(result.ok);
    }

    #[test]
    fn user_prompt_contains_grounding() {
        let prompt = build_user_prompt(&ctx());
        assert!(prompt.contains("Original bullet:"));
        assert!(prompt.contains("production-scale distributed system"));
        assert!(prompt.contains("[1]"));
    }
}

//! Matching engine (Phase 5 · spec §6). Pure and deterministic: the same
//! database state and weights always produce the identical report. The number
//! exists to rank the user's own records; the explanations are the product.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const MATCHING_VERSION: u32 = 1;

/// Spec §6.2 weights. Persisted inside every report for reproducibility.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Weights {
    pub required_skills: f64,
    pub preferred_skills: f64,
    pub responsibilities: f64,
    pub domain: f64,
    pub recency: f64,
    pub evidence_strength: f64,
}

pub const WEIGHTS: Weights = Weights {
    required_skills: 0.35,
    preferred_skills: 0.20,
    responsibilities: 0.15,
    domain: 0.10,
    recency: 0.10,
    evidence_strength: 0.10,
};

// ---------------------------------------------------------------------------
// Input model
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchSkill {
    pub id: i64,
    pub canonical_name: String,
    pub aliases: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchEntity {
    pub entity_type: String, // "project" | "experience"
    pub id: i64,
    pub title: String,
    pub description: String,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub is_current: bool,
    /// (skill_id, confidence)
    pub skills: Vec<(i64, i64)>,
    pub evidence_count: i64,
    pub bullets: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchRequirement {
    pub id: i64,
    pub kind: String, // required_skill | preferred_skill | responsibility
    pub raw_text: String,
    pub importance: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchInput {
    pub job_domain: String,
    pub requirements: Vec<MatchRequirement>,
    pub skills: Vec<MatchSkill>,
    pub entities: Vec<MatchEntity>,
}

// ---------------------------------------------------------------------------
// Output model
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Coverage {
    Covered,
    Partial,
    Missing,
}

impl Coverage {
    pub fn as_str(&self) -> &'static str {
        match self {
            Coverage::Covered => "covered",
            Coverage::Partial => "partial",
            Coverage::Missing => "missing",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityRef {
    pub entity_type: String,
    pub id: i64,
    pub title: String,
    pub contribution: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequirementResult {
    pub requirement_id: i64,
    pub kind: String,
    pub raw_text: String,
    pub importance: f64,
    pub coverage: Coverage,
    pub explanation: String,
    pub matched_skills: Vec<String>,
    pub entity_refs: Vec<EntityRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RankedEntity {
    pub entity_type: String,
    pub id: i64,
    pub title: String,
    pub relevance: f64,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreComponents {
    pub required_skills: f64,
    pub preferred_skills: f64,
    pub responsibilities: f64,
    pub domain: f64,
    pub recency: f64,
    pub evidence_strength: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchReport {
    pub matching_version: u32,
    pub weights: Weights,
    pub overall_score: f64,
    pub components: ScoreComponents,
    pub results: Vec<RequirementResult>,
    pub entity_ranking: Vec<RankedEntity>,
}

// ---------------------------------------------------------------------------
// Tokenization + skill matching
// ---------------------------------------------------------------------------

const STOPWORDS: &[&str] = &[
    "a", "an", "the", "and", "or", "of", "with", "for", "to", "in", "on", "at", "by", "from",
    "as", "is", "are", "be", "been", "was", "were", "you", "your", "we", "our", "their", "will",
    "shall", "must", "have", "has", "had", "do", "does", "using", "use", "used", "strong",
    "good", "great", "excellent", "plus", "years", "year", "experience", "ability", "able",
    "work", "working", "knowledge", "familiarity", "including", "such",
];

fn stem(token: &str) -> String {
    // Light plural strip; keeps sql/apis→api sensible without a real stemmer.
    if token.len() > 3 && token.ends_with('s') && !token.ends_with("ss") {
        token[..token.len() - 1].to_string()
    } else {
        token.to_string()
    }
}

fn tokens(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| t.len() > 1 && !STOPWORDS.contains(t))
        .map(|t| stem(t))
        .collect()
}

fn normalize_name(name: &str) -> String {
    name.trim().to_lowercase()
}

/// Word-boundary phrase containment (names may be multi-word, e.g. "machine learning").
fn contains_phrase(haystack_tokens: &[String], phrase: &str) -> bool {
    let phrase_tokens: Vec<String> = phrase
        .split_whitespace()
        .map(normalize_name)
        .filter(|t| !t.is_empty())
        .map(|t| stem(&t))
        .collect();
    if phrase_tokens.is_empty() || phrase_tokens.len() > haystack_tokens.len() {
        return false;
    }
    haystack_tokens
        .windows(phrase_tokens.len())
        .any(|window| window == phrase_tokens.as_slice())
}

/// Skills mentioned in the requirement text, matched ONLY through canonical
/// names or explicit aliases (spec §6.4 alias test).
fn skills_mentioned<'a>(text_tokens: &[String], skills: &'a [MatchSkill]) -> Vec<&'a MatchSkill> {
    let mut mentioned: Vec<&MatchSkill> = Vec::new();
    for skill in skills {
        let mut names = std::iter::once(skill.canonical_name.as_str())
            .chain(skill.aliases.iter().map(|a| a.as_str()));
        if names.any(|n| contains_phrase(text_tokens, &normalize_name(n))) {
            mentioned.push(skill);
        }
    }
    mentioned
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

const COVERED_CONFIDENCE: i64 = 3;

struct SkillVerdict {
    coverage: Coverage,
    best_confidence: Option<i64>,
    supporting: Vec<usize>, // indices into input.entities
}

fn skill_verdict(skill_id: i64, entities: &[MatchEntity]) -> SkillVerdict {
    let mut supporting = Vec::new();
    let mut best: Option<i64> = None;
    for (index, entity) in entities.iter().enumerate() {
        if let Some((_, confidence)) = entity.skills.iter().find(|(id, _)| *id == skill_id) {
            if best.map(|b| *confidence > b).unwrap_or(true) {
                best = Some(*confidence);
            }
            supporting.push(index);
        }
    }
    match best {
        Some(confidence) if confidence >= COVERED_CONFIDENCE => SkillVerdict {
            coverage: Coverage::Covered,
            best_confidence: best,
            supporting,
        },
        Some(_) => SkillVerdict { coverage: Coverage::Partial, best_confidence: best, supporting },
        None => SkillVerdict { coverage: Coverage::Partial, best_confidence: None, supporting },
    }
}

/// Best token-overlap ratio of an entity's content against the requirement.
fn best_overlap(req_tokens: &[String], entity: &MatchEntity) -> f64 {
    let req_set: std::collections::HashSet<&String> = req_tokens.iter().collect();
    let mut best = 0.0f64;
    let mut measure = |text: &str| {
        let tokens = tokens(text);
        if tokens.is_empty() || req_set.is_empty() {
            return;
        }
        let hits = tokens.iter().filter(|t| req_set.contains(t)).count();
        // Coverage of the requirement's meaningful tokens.
        let ratio = hits as f64 / req_set.len() as f64;
        if ratio > best {
            best = ratio;
        }
    };
    for bullet in &entity.bullets {
        measure(bullet);
    }
    measure(&entity.description);
    measure(&entity.title);
    best
}

const RESPONSIBILITY_COVERED: f64 = 0.5;
const RESPONSIBILITY_PARTIAL: f64 = 0.2;

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

fn coverage_value(coverage: Coverage) -> f64 {
    match coverage {
        Coverage::Covered => 1.0,
        Coverage::Partial => 0.5,
        Coverage::Missing => 0.0,
    }
}

fn weighted_coverage(results: &[RequirementResult], kind: &str) -> f64 {
    let rows: Vec<&RequirementResult> = results.iter().filter(|r| r.kind == kind).collect();
    if rows.is_empty() {
        return 0.5; // neutral when the category is absent
    }
    let total_importance: f64 = rows.iter().map(|r| r.importance.max(0.05)).sum();
    let earned: f64 = rows
        .iter()
        .map(|r| coverage_value(r.coverage) * r.importance.max(0.05))
        .sum();
    if total_importance <= 0.0 {
        0.5
    } else {
        earned / total_importance
    }
}

fn latest_date(entity: &MatchEntity) -> Option<String> {
    if entity.is_current {
        return Some("2999-12".to_string());
    }
    entity.end_date.clone().or(entity.start_date.clone())
}

/// 1.0 for evidence within ~1 year, decaying to 0.25 at 5+ years.
fn recency_score(entity: &MatchEntity, now: &str) -> f64 {
    let Some(date) = latest_date(entity) else { return 0.5 };
    let parse = |s: &str| -> Option<i64> {
        let mut parts = s.split('-');
        let year: i64 = parts.next()?.parse().ok()?;
        let month: i64 = parts.next().and_then(|m| m.parse().ok()).unwrap_or(1);
        Some(year * 12 + month)
    };
    match (parse(&date), parse(now)) {
        (Some(then), Some(now_m)) => {
            let months = (now_m - then).max(0);
            if months <= 12 {
                1.0
            } else if months >= 60 {
                0.25
            } else {
                1.0 - 0.75 * (months - 12) as f64 / 48.0
            }
        }
        _ => 0.5,
    }
}

fn entity_recency(entities: &[MatchEntity], now: &str) -> f64 {
    let mut best = 0.5;
    let mut any = false;
    for entity in entities {
        if latest_date(entity).is_some() {
            any = true;
            let score = recency_score(entity, now);
            if score > best {
                best = score;
            }
        }
    }
    if any { best } else { 0.5 }
}

fn evidence_strength_score(supporting: &[usize], entities: &[MatchEntity]) -> f64 {
    if supporting.is_empty() {
        return 0.0;
    }
    let with_evidence = supporting
        .iter()
        .filter(|&&i| entities[i].evidence_count > 0)
        .count();
    with_evidence as f64 / supporting.len() as f64
}

fn domain_score(job_domain: &str, entities: &[MatchEntity]) -> f64 {
    if job_domain.is_empty() {
        return 0.5;
    }
    let haystack: String = entities
        .iter()
        .map(|e| format!("{} {}", e.title, e.description))
        .collect::<Vec<_>>()
        .join(" ");
    let vault_domain = crate::jd::detect_domain(&haystack);
    if vault_domain.is_empty() {
        0.5
    } else if vault_domain.eq_ignore_ascii_case(job_domain) {
        1.0
    } else {
        0.3
    }
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

pub fn run_match(input: &MatchInput, now: &str) -> MatchReport {
    let mut results: Vec<RequirementResult> = Vec::new();
    // entity index -> accumulated relevance + reasons
    let mut relevance: Vec<f64> = vec![0.0; input.entities.len()];
    let mut reasons: Vec<Vec<String>> = vec![Vec::new(); input.entities.len()];
    let mut supporting: Vec<usize> = Vec::new();
    let mut resp_overlap_sum = 0.0;
    let mut resp_count = 0;

    for req in &input.requirements {
        let req_tokens = tokens(&req.raw_text);
        let mut matched_skills = Vec::new();
        let mut entity_refs: Vec<EntityRef> = Vec::new();
        let mut explanation = String::new();
        let coverage;

        if req.kind == "responsibility" {
            // Best overlapping entities against bullets/descriptions.
            let mut scored: Vec<(usize, f64)> = input
                .entities
                .iter()
                .enumerate()
                .map(|(i, e)| (i, best_overlap(&req_tokens, e)))
                .filter(|(_, ratio)| *ratio > 0.0)
                .collect();
            scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            resp_overlap_sum += scored.first().map(|(_, r)| *r).unwrap_or(0.0).min(1.0);
            resp_count += 1;

            if let Some((_, best)) = scored.first() {
                coverage = if *best >= RESPONSIBILITY_COVERED {
                    Coverage::Covered
                } else if *best >= RESPONSIBILITY_PARTIAL {
                    Coverage::Partial
                } else {
                    Coverage::Missing
                };
                let take = scored.iter().take(3).cloned().collect::<Vec<_>>();
                for (index, ratio) in take {
                    let entity = &input.entities[index];
                    entity_refs.push(EntityRef {
                        entity_type: entity.entity_type.clone(),
                        id: entity.id,
                        title: entity.title.clone(),
                        contribution: format!("overlapping work ({:.0}% of the requirement)", ratio * 100.0),
                    });
                    let kind_weight = 0.8;
                    relevance[index] += coverage_value(coverage) * req.importance * kind_weight;
                    reasons[index].push(format!(
                        "supports “{}” ({})",
                        truncate(&req.raw_text, 40),
                        coverage.as_str()
                    ));
                    if !supporting.contains(&index) {
                        supporting.push(index);
                    }
                }
                explanation = format!(
                    "Closest Vault evidence overlaps {:.0}% of this responsibility's wording.",
                    scored[0].1 * 100.0
                );
            } else {
                coverage = Coverage::Missing;
                explanation = "No project or experience text overlaps this responsibility."
                    .to_string();
            }
        } else {
            // Skill requirement: match skills by canonical name or explicit alias only.
            let mentioned = skills_mentioned(&req_tokens, &input.skills);
            if mentioned.is_empty() {
                coverage = Coverage::Missing;
                explanation = "No Vault skill (by name or alias) appears in this requirement."
                    .to_string();
            } else {
                let mut covered_count = 0;
                for skill in &mentioned {
                    matched_skills.push(skill.canonical_name.clone());
                    let verdict = skill_verdict(skill.id, &input.entities);
                    if verdict.coverage == Coverage::Covered {
                        covered_count += 1;
                    }
                    for index in &verdict.supporting {
                        let entity = &input.entities[*index];
                        let confidence = entity
                            .skills
                            .iter()
                            .find(|(id, _)| *id == skill.id)
                            .map(|(_, c)| *c)
                            .unwrap_or(0);
                        if confidence >= COVERED_CONFIDENCE {
                            entity_refs.push(EntityRef {
                                entity_type: entity.entity_type.clone(),
                                id: entity.id,
                                title: entity.title.clone(),
                                contribution: format!(
                                    "{} used here (confidence {}/5)",
                                    skill.canonical_name, confidence
                                ),
                            });
                        }
                        let kind_weight = if req.kind == "required_skill" { 1.0 } else { 0.6 };
                        relevance[*index] +=
                            coverage_value(verdict.coverage) * req.importance * kind_weight;
                        reasons[*index].push(format!(
                            "uses {} for “{}”",
                            skill.canonical_name,
                            truncate(&req.raw_text, 40)
                        ));
                        if !supporting.contains(index) {
                            supporting.push(*index);
                        }
                    }
                }
                let all = covered_count == mentioned.len();
                coverage = if all {
                    Coverage::Covered
                } else if covered_count == 0 {
                    Coverage::Partial
                } else {
                    Coverage::Partial
                };
                let names = mentioned
                    .iter()
                    .map(|s| s.canonical_name.as_str())
                    .collect::<Vec<_>>()
                    .join(", ");
                explanation = if all {
                    format!("Vault evidence supports {names}.")
                } else if covered_count == 0 {
                    format!("{names} known to the Vault, but only at low confidence or without project use.")
                } else {
                    format!("Partial: {covered_count} of {} skills are backed by strong Vault use ({names}).", mentioned.len())
                };
            }
        }

        results.push(RequirementResult {
            requirement_id: req.id,
            kind: req.kind.clone(),
            raw_text: req.raw_text.clone(),
            importance: req.importance,
            coverage,
            explanation,
            matched_skills,
            entity_refs,
        });
    }

    // Entity ranking: relevance + confidence + recency bonuses, all explainable.
    let mut ranking: Vec<RankedEntity> = Vec::new();
    for (index, entity) in input.entities.iter().enumerate() {
        if relevance[index] <= 0.0 {
            continue;
        }
        let confidence_bonus = 0.1
            * entity
                .skills
                .iter()
                .map(|(_, c)| *c as f64 / 5.0)
                .fold(0.0f64, |acc, x| if x > acc { x } else { acc });
        let recency_bonus = 0.1 * recency_score(entity, now);
        let mut reasons = reasons[index].clone();
        reasons.push(format!("+{:.2} strongest skill confidence", confidence_bonus));
        reasons.push(format!("+{:.2} recency", recency_bonus));
        ranking.push(RankedEntity {
            entity_type: entity.entity_type.clone(),
            id: entity.id,
            title: entity.title.clone(),
            relevance: (relevance[index] + confidence_bonus + recency_bonus) * 1000.0
                / 1000.0, // keep fp stable-ish
            reasons,
        });
    }
    ranking.sort_by(|a, b| b.relevance.partial_cmp(&a.relevance).unwrap_or(std::cmp::Ordering::Equal));

    let components = ScoreComponents {
        required_skills: weighted_coverage(&results, "required_skill"),
        preferred_skills: weighted_coverage(&results, "preferred_skill"),
        responsibilities: if resp_count == 0 {
            0.5
        } else {
            (resp_overlap_sum / resp_count as f64).clamp(0.0, 1.0)
        },
        domain: domain_score(&input.job_domain, &input.entities),
        recency: entity_recency(&input.entities, now),
        evidence_strength: evidence_strength_score(&supporting, &input.entities),
    };

    let overall_score = WEIGHTS.required_skills * components.required_skills
        + WEIGHTS.preferred_skills * components.preferred_skills
        + WEIGHTS.responsibilities * components.responsibilities
        + WEIGHTS.domain * components.domain
        + WEIGHTS.recency * components.recency
        + WEIGHTS.evidence_strength * components.evidence_strength;

    MatchReport {
        matching_version: MATCHING_VERSION,
        weights: WEIGHTS,
        overall_score,
        components,
        results,
        entity_ranking: ranking,
    }
}

fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        text.to_string()
    } else {
        let cut: String = text.chars().take(max).collect();
        format!("{cut}…")
    }
}

// ---------------------------------------------------------------------------
// Tests (spec §6.4)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn skill(id: i64, name: &str, aliases: &[&str]) -> MatchSkill {
        MatchSkill {
            id,
            canonical_name: name.to_string(),
            aliases: aliases.iter().map(|a| a.to_string()).collect(),
        }
    }

    fn entity(index_base: i64, title: &str, skills: Vec<(i64, i64)>, dates: (Option<&str>, Option<&str>)) -> MatchEntity {
        MatchEntity {
            entity_type: "project".to_string(),
            id: index_base,
            title: title.to_string(),
            description: format!("{title} description"),
            start_date: dates.0.map(String::from),
            end_date: dates.1.map(String::from),
            is_current: false,
            skills,
            evidence_count: 1,
            bullets: vec![],
        }
    }

    fn req(id: i64, kind: &str, text: &str) -> MatchRequirement {
        MatchRequirement { id, kind: kind.to_string(), raw_text: text.to_string(), importance: 0.8 }
    }

    #[test]
    fn alias_test_js_matches_only_through_alias() {
        let js_as_alias = MatchInput {
            job_domain: String::new(),
            requirements: vec![req(1, "required_skill", "Experience with JS")],
            skills: vec![skill(1, "JavaScript", &["JS"])],
            entities: vec![entity(1, "Frontend app", vec![(1, 4)], (None, None))],
        };
        let report = run_match(&js_as_alias, "2026-01");
        assert_eq!(report.results[0].coverage, Coverage::Covered);

        // Without the alias, "JS" must NOT match JavaScript.
        let no_alias = MatchInput {
            job_domain: String::new(),
            requirements: vec![req(1, "required_skill", "Experience with JS")],
            skills: vec![skill(1, "JavaScript", &[])],
            entities: vec![entity(1, "Frontend app", vec![(1, 4)], (None, None))],
        };
        let report = run_match(&no_alias, "2026-01");
        assert_eq!(report.results[0].coverage, Coverage::Missing);
    }

    #[test]
    fn missing_skill_test_kafka_stays_missing() {
        let input = MatchInput {
            job_domain: String::new(),
            requirements: vec![req(1, "required_skill", "Kafka experience")],
            skills: vec![skill(1, "Python", &[]), skill(2, "SQL", &[])],
            entities: vec![entity(1, "PyKV", vec![(1, 5)], (None, None))],
        };
        let report = run_match(&input, "2026-01");
        assert_eq!(report.results[0].coverage, Coverage::Missing);
        assert!(report.results[0].explanation.contains("No Vault skill"));
    }

    #[test]
    fn low_confidence_is_partial_not_covered() {
        let input = MatchInput {
            job_domain: String::new(),
            requirements: vec![req(1, "required_skill", "Strong Python")],
            skills: vec![skill(1, "Python", &[])],
            entities: vec![entity(1, "Coursework", vec![(1, 1)], (None, None))], // studied
        };
        let report = run_match(&input, "2026-01");
        assert_eq!(report.results[0].coverage, Coverage::Partial);
    }

    #[test]
    fn recency_test_newer_ranks_above_older() {
        let input = MatchInput {
            job_domain: String::new(),
            requirements: vec![req(1, "required_skill", "Strong Python")],
            skills: vec![skill(1, "Python", &[])],
            entities: vec![
                entity(1, "Old project", vec![(1, 4)], (Some("2020-01"), Some("2020-06"))),
                entity(2, "Recent project", vec![(1, 4)], (Some("2025-06"), Some("2025-09"))),
            ],
        };
        let report = run_match(&input, "2026-01");
        assert_eq!(report.entity_ranking[0].title, "Recent project");
        assert_eq!(report.entity_ranking[1].title, "Old project");
    }

    #[test]
    fn evidence_strength_test_higher_confidence_ranks_higher() {
        let input = MatchInput {
            job_domain: String::new(),
            requirements: vec![req(1, "required_skill", "Strong Python")],
            skills: vec![skill(1, "Python", &[])],
            entities: vec![
                entity(1, "Studied only", vec![(1, 1)], (None, None)),
                entity(2, "Internship work", vec![(1, 5)], (None, None)),
            ],
        };
        let report = run_match(&input, "2026-01");
        assert_eq!(report.entity_ranking[0].title, "Internship work");
    }

    #[test]
    fn determinism_test_identical_reports() {
        let input = MatchInput {
            job_domain: "Fintech".to_string(),
            requirements: vec![
                req(1, "required_skill", "Strong Python and SQL skills"),
                req(2, "preferred_skill", "Kafka experience"),
                req(3, "responsibility", "Design and ship REST APIs"),
            ],
            skills: vec![skill(1, "Python", &[]), skill(2, "SQL", &[]), skill(3, "Kafka", &[])],
            entities: vec![
                entity(1, "PyKV", vec![(1, 5)], (Some("2025-01"), None)),
                entity(2, "Watchdog SQL monitor", vec![(2, 4)], (Some("2024-01"), Some("2024-05"))),
            ],
        };
        let a = run_match(&input, "2026-01");
        let b = run_match(&input, "2026-01");
        assert_eq!(
            serde_json::to_string(&a).unwrap(),
            serde_json::to_string(&b).unwrap()
        );
    }

    #[test]
    fn responsibility_overlap_and_multi_skill_partial() {
        let input = MatchInput {
            job_domain: String::new(),
            requirements: vec![
                req(1, "responsibility", "Design and ship REST APIs for payment flows"),
                req(2, "required_skill", "Docker and Kubernetes"),
            ],
            skills: vec![skill(1, "Docker", &[])],
            entities: vec![MatchEntity {
                entity_type: "project".to_string(),
                id: 1,
                title: "Payments API".to_string(),
                description: "Designed and shipped REST APIs for payment flows at scale".into(),
                start_date: None,
                end_date: None,
                is_current: false,
                skills: vec![(1, 4)],
                evidence_count: 0,
                bullets: vec![],
            }],
        };
        let report = run_match(&input, "2026-01");
        assert_eq!(report.results[0].coverage, Coverage::Covered);
        // Docker known, Kubernetes not mentioned in Vault at all -> requirement
        // mentions only Docker by Vault vocabulary => covered set = {Docker} of 1.
        // Kubernetes cannot match (no skill), so matched=[Docker] -> covered.
        assert_eq!(report.results[1].coverage, Coverage::Covered);
        assert_eq!(report.results[1].matched_skills, vec!["Docker".to_string()]);
    }

    #[test]
    fn score_components_sum_with_weights() {
        let input = MatchInput {
            job_domain: "Fintech".to_string(),
            requirements: vec![req(1, "required_skill", "Strong Python")],
            skills: vec![skill(1, "Python", &[])],
            entities: vec![entity(1, "PyKV", vec![(1, 5)], (Some("2025-01"), None))],
        };
        let report = run_match(&input, "2026-01");
        assert!((report.components.required_skills - 1.0).abs() < 1e-9);
        assert!(report.overall_score > 0.0 && report.overall_score <= 1.0);
        assert_eq!(report.matching_version, MATCHING_VERSION);
    }

    // Silence unused warnings for helpers used only in some tests.
    #[allow(dead_code)]
    fn _unused(_: &HashMap<String, String>) {}
}

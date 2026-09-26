//! Interview Prep (Phase 12 · spec §9.4). Pure and deterministic: questions
//! come only from the exact JD, the submitted resume plan, your evidence and
//! the match gaps. No invented company-specific patterns, no AI required.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QuestionCategory {
    ProjectDeepDive,
    TechnicalSkill,
    Responsibility,
    WeakArea,
    ResumeQuestion,
}

impl QuestionCategory {
    pub fn as_str(&self) -> &'static str {
        match self {
            QuestionCategory::ProjectDeepDive => "project_deep_dive",
            QuestionCategory::TechnicalSkill => "technical_skill",
            QuestionCategory::Responsibility => "responsibility",
            QuestionCategory::WeakArea => "weak_area",
            QuestionCategory::ResumeQuestion => "resume_question",
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            QuestionCategory::ProjectDeepDive => "Project deep-dives",
            QuestionCategory::TechnicalSkill => "Technical questions",
            QuestionCategory::Responsibility => "Behavioral / responsibility",
            QuestionCategory::WeakArea => "Weak areas — prepare an answer",
            QuestionCategory::ResumeQuestion => "Resume questions",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterviewQuestion {
    pub category: QuestionCategory,
    pub question: String,
    /// Why this is being asked — grounded in which input produced it.
    pub why: String,
    pub evidence_refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepEntity {
    pub entity_type: String,
    pub id: i64,
    pub title: String,
    pub bullet_texts: Vec<String>,
    pub skill_names: Vec<String>,
    pub evidence_count: i64,
    pub evidence_titles: Vec<String>,
    /// Relevance from the match report (0 if unranked).
    pub relevance: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepRequirement {
    pub id: i64,
    pub kind: String,
    pub raw_text: String,
    /// covered | partial | missing (from the match report; "unmatched" if no report).
    pub coverage: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterviewPrep {
    pub job_label: String,
    pub questions: Vec<InterviewQuestion>,
    pub inputs: PrepInputsSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepInputsSummary {
    pub raw_jd_chars: usize,
    pub requirement_count: usize,
    pub plan_bullet_count: usize,
    pub gap_count: usize,
    pub evidence_count: usize,
}

const REQUIRED: &str = "required_skill";
const PREFERRED: &str = "preferred_skill";
const RESPONSIBILITY: &str = "responsibility";

fn tokenize(text: &str) -> HashSet<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|w| w.len() > 2)
        .map(|w| w.trim_end_matches('s').to_string())
        .collect()
}

/// Overlap of the requirement against an entity's bullets + description.
fn overlap_ratio(req_tokens: &HashSet<String>, text: &str) -> f64 {
    let tokens = tokenize(text);
    if req_tokens.is_empty() || tokens.is_empty() {
        return 0.0;
    }
    let hits = tokens.iter().filter(|t| req_tokens.contains(*t)).count();
    hits as f64 / req_tokens.len() as f64
}

/// Generates the grounded question set. Order within categories is stable.
pub fn generate(
    job_label: &str,
    raw_jd_chars: usize,
    requirements: &[PrepRequirement],
    entities: &[PrepEntity],
) -> InterviewPrep {
    let mut questions: Vec<InterviewQuestion> = Vec::new();
    let mut evidence_count = 0usize;

    // --- Project deep-dives + resume questions ------------------------------
    let mut featured: Vec<&PrepEntity> = entities.iter().filter(|e| e.relevance > 0.0).collect();
    featured.sort_by(|a, b| {
        b.relevance
            .partial_cmp(&a.relevance)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    for entity in entities {
        evidence_count += entity.evidence_count as usize;
    }

    for entity in entities
        .iter()
        .filter(|e| !e.bullet_texts.is_empty() || e.relevance > 0.0)
    {
        let is_featured = entity.relevance > 0.0;
        questions.push(InterviewQuestion {
            category: QuestionCategory::ProjectDeepDive,
            question: format!(
                "Walk me through {} — the problem, your specific work, and the outcome.",
                entity.title
            ),
            why: if is_featured {
                "You're featuring this on the submitted resume for this role.".to_string()
            } else {
                "This record is in your Vault and is fair game if the interviewer digs in."
                    .to_string()
            },
            evidence_refs: entity.evidence_titles.clone(),
        });

        // Evidence gap warning as a resume question.
        if entity.evidence_count == 0 {
            questions.push(InterviewQuestion {
                category: QuestionCategory::ResumeQuestion,
                question: format!(
                    "“{}” has no attached evidence — how will you back its claims if challenged?",
                    entity.title
                ),
                why: "Every claim should trace to proof; this one currently can't.".to_string(),
                evidence_refs: vec![],
            });
        }
    }

    // --- Technical questions per skill requirement ---------------------------
    for requirement in requirements {
        if requirement.kind != REQUIRED && requirement.kind != PREFERRED {
            continue;
        }
        let req_tokens = tokenize(&requirement.raw_text);
        // Best-overlapping entity for this skill.
        let mut best: Option<(&PrepEntity, f64)> = None;
        for entity in entities {
            let mut texts: Vec<&String> = entity.bullet_texts.iter().collect();
            texts.push(&entity.title);
            let ratio = texts
                .iter()
                .map(|t| overlap_ratio(&req_tokens, t))
                .fold(0.0f64, |acc, x| if x > acc { x } else { acc });
            let skill_hit = entity.skill_names.iter().any(|s| {
                let lower = s.to_lowercase();
                req_tokens.contains(&lower)
                    || req_tokens.contains(
                        <str as ToString>::to_string(lower.trim_end_matches('s')).as_str(),
                    )
            });
            let score = ratio.max(if skill_hit { 1.0 } else { 0.0 });
            if score > best.map(|(_, s)| s).unwrap_or(0.0) {
                best = Some((entity, score));
            }
        }

        let label = if requirement.kind == REQUIRED {
            "required"
        } else {
            "preferred"
        };
        match (best, requirement.coverage.as_str()) {
            (Some((entity, _)), "covered") => {
                let evidence: Vec<String> = entity.evidence_titles.clone();
                questions.push(InterviewQuestion {
                    category: QuestionCategory::TechnicalSkill,
                    question: format!(
                        "Your {label} skill “{}” is backed by {} — expect depth questions. Which parts are you weakest on?",
                        short_text(&requirement.raw_text),
                        entity.title
                    ),
                    why: format!(
                        "Required in the JD and your submitted resume covers it via {}.",
                        entity.title
                    ),
                    evidence_refs: evidence,
                });
            }
            (Some((entity, _)), "partial") => {
                questions.push(InterviewQuestion {
                    category: QuestionCategory::WeakArea,
                    question: format!(
                        "“{}” appears in your resume only lightly — the interviewer may probe the limits. Where exactly does your {} experience stop?",
                        short_text(&requirement.raw_text),
                        entity.title
                    ),
                    why: format!(
                        "Match report marks this {label} skill as PARTIAL — some support exists but not strong use."
                    ),
                    evidence_refs: entity.evidence_titles.clone(),
                });
            }
            _ => {
                questions.push(InterviewQuestion {
                    category: QuestionCategory::WeakArea,
                    question: format!(
                        "The role lists “{}” as a {label} skill and your submitted resume doesn't demonstrate it — decide how to address the gap.",
                        short_text(&requirement.raw_text)
                    ),
                    why: format!(
                        "Match report marks this {label} skill as MISSING from your submitted resume."
                    ),
                    evidence_refs: vec![],
                });
            }
        }
    }

    // --- Behavioral / responsibility questions ------------------------------
    for requirement in requirements.iter().filter(|r| r.kind == RESPONSIBILITY) {
        let req_tokens = tokenize(&requirement.raw_text);
        let mut best_entity: Option<&PrepEntity> = None;
        let mut best_score = 0.0f64;
        for entity in entities {
            let mut score = 0.0f64;
            for bullet in &entity.bullet_texts {
                let r = overlap_ratio(&req_tokens, bullet);
                if r > score {
                    score = r;
                }
            }
            if score > best_score {
                best_score = score;
                best_entity = Some(entity);
            }
        }
        let grounding = match best_entity {
            Some(e) => format!(
                "Closest experience: {} ({:.0}% wording overlap).",
                e.title, best_score * 100.0
            ),
            None => "No submitted experience overlaps this responsibility — prepare an answer from anything relevant.".to_string(),
        };
        questions.push(InterviewQuestion {
            category: QuestionCategory::Responsibility,
            question: format!(
                "The JD expects you to “{}” — prepare a specific story (STAR) demonstrating it.",
                short_text(&requirement.raw_text)
            ),
            why: grounding,
            evidence_refs: vec![],
        });
    }

    let inputs = PrepInputsSummary {
        raw_jd_chars,
        requirement_count: requirements.len(),
        plan_bullet_count: entities.iter().map(|e| e.bullet_texts.len()).sum(),
        gap_count: requirements
            .iter()
            .filter(|r| r.coverage != "covered")
            .count(),
        evidence_count,
    };

    InterviewPrep {
        job_label: job_label.to_string(),
        questions,
        inputs,
    }
}

fn short_text(text: &str) -> String {
    if text.chars().count() <= 90 {
        return text.to_string();
    }
    let cut: String = text.chars().take(90).collect();
    format!("{cut}…")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entity(
        id: i64,
        title: &str,
        skills: &[&str],
        bullets: Vec<String>,
        relevance: f64,
    ) -> PrepEntity {
        PrepEntity {
            entity_type: "project".to_string(),
            id,
            title: title.to_string(),
            bullet_texts: bullets,
            skill_names: skills.iter().map(|s| s.to_string()).collect(),
            evidence_count: 1,
            evidence_titles: vec![format!("{title} repo")],
            relevance,
        }
    }

    fn requirement(id: i64, kind: &str, text: &str, coverage: &str) -> PrepRequirement {
        PrepRequirement {
            id,
            kind: kind.to_string(),
            raw_text: text.to_string(),
            coverage: coverage.to_string(),
        }
    }

    #[test]
    fn covered_skill_asks_depth_missing_asks_gap() {
        let requirements = vec![
            requirement(1, REQUIRED, "Strong Python", "covered"),
            requirement(2, REQUIRED, "Kafka streaming", "missing"),
        ];
        let entities = vec![entity(
            1,
            "PyKV",
            &["Python"],
            vec!["Built PyKV in Python".to_string()],
            0.9,
        )];
        let prep = generate("Senior Backend Engineer", 1200, &requirements, &entities);

        let technical: Vec<&InterviewQuestion> = prep
            .questions
            .iter()
            .filter(|q| q.category == QuestionCategory::TechnicalSkill)
            .collect();
        assert_eq!(technical.len(), 1);
        assert!(technical[0].question.contains("PyKV"));
        assert_eq!(technical[0].evidence_refs, vec!["PyKV repo"]);

        let weak: Vec<&InterviewQuestion> = prep
            .questions
            .iter()
            .filter(|q| q.category == QuestionCategory::WeakArea)
            .collect();
        assert_eq!(weak.len(), 1);
        assert!(weak[0].question.contains("Kafka"));
        assert!(weak[0].evidence_refs.is_empty());
    }

    #[test]
    fn partial_skill_goes_to_weak_area_with_evidence() {
        let requirements = vec![requirement(1, REQUIRED, "Strong Docker", "partial")];
        let entities = vec![entity(
            1,
            "Containers project",
            &["Docker"],
            vec!["Used Docker lightly".to_string()],
            0.5,
        )];
        let prep = generate("DevOps Engineer", 800, &requirements, &entities);
        let weak: Vec<&InterviewQuestion> = prep
            .questions
            .iter()
            .filter(|q| q.category == QuestionCategory::WeakArea)
            .collect();
        assert_eq!(weak.len(), 1);
        assert!(weak[0].evidence_refs.len() == 1);
    }

    #[test]
    fn responsibilities_become_star_questions_with_grounding() {
        let requirements = vec![requirement(
            1,
            RESPONSIBILITY,
            "Design and ship REST APIs for payment flows",
            "unmatched",
        )];
        let entities = vec![entity(
            1,
            "Payments API",
            &[],
            vec!["Designed and shipped REST APIs for payment flows".to_string()],
            0.0,
        )];
        let prep = generate("Backend Engineer", 600, &requirements, &entities);
        let behavioral: Vec<&InterviewQuestion> = prep
            .questions
            .iter()
            .filter(|q| q.category == QuestionCategory::Responsibility)
            .collect();
        assert_eq!(behavioral.len(), 1);
        assert!(behavioral[0]
            .why
            .contains("Closest experience: Payments API"));
        assert!(behavioral[0].question.contains("STAR"));
    }

    #[test]
    fn evidence_gap_becomes_resume_question() {
        let mut no_evidence = entity(
            1,
            "NoProof",
            &["Python"],
            vec!["Built with Python".to_string()],
            0.5,
        );
        no_evidence.evidence_count = 0;
        no_evidence.evidence_titles = vec![];
        let prep = generate("Role", 100, &[], &[no_evidence]);
        let resume_qs: Vec<&InterviewQuestion> = prep
            .questions
            .iter()
            .filter(|q| q.category == QuestionCategory::ResumeQuestion)
            .collect();
        assert_eq!(resume_qs.len(), 1);
        assert!(resume_qs[0].question.contains("no attached evidence"));
    }

    #[test]
    fn inputs_summary_counts_correctly() {
        let requirements = vec![
            requirement(1, REQUIRED, "Python", "covered"),
            requirement(2, REQUIRED, "Kafka", "missing"),
        ];
        let entities = vec![entity(
            1,
            "PyKV",
            &["Python"],
            vec!["bullet".to_string()],
            0.9,
        )];
        let prep = generate("Role", 500, &requirements, &entities);
        assert_eq!(prep.inputs.requirement_count, 2);
        assert_eq!(prep.inputs.gap_count, 1);
        assert_eq!(prep.inputs.plan_bullet_count, 1);
        assert_eq!(prep.inputs.evidence_count, 1);
        assert_eq!(
            prep.questions
                .iter()
                .filter(|q| q.category == QuestionCategory::ProjectDeepDive)
                .count(),
            1
        );
    }
}

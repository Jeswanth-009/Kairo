//! Composer (Phase 6 · spec §7): the deterministic constraint solver.
//!
//! Selection and rewriting are separate (spec §7 key decision): this module
//! decides *what fits on the page* from approved content only — never wording.
//! Same input + config ⇒ identical plan.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const COMPOSER_VERSION: u32 = 1;

/// Spec §7.1 constraint configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposerConfig {
    pub target_pages: u32,
    pub max_projects: u32,
    pub max_experience_items: u32,
    pub max_bullets_per_item: u32,
    pub min_font_size_pt: f64,
}

impl Default for ComposerConfig {
    fn default() -> Self {
        ComposerConfig {
            target_pages: 1,
            max_projects: 3,
            max_experience_items: 2,
            max_bullets_per_item: 3,
            min_font_size_pt: 9.5,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposerProfile {
    pub full_name: String,
    pub headline: String,
    pub email: String,
    pub phone: String,
    pub location: String,
    pub website: String,
    pub github: String,
    pub linkedin: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposerEducation {
    pub id: i64,
    pub institution: String,
    pub degree: String,
    pub field_of_study: String,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub is_current: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposerBullet {
    pub id: i64,
    pub text: String,
    pub approved: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposerEntity {
    pub entity_type: String, // project | experience
    pub id: i64,
    pub title: String,
    pub subtitle: String, // org · role, or empty
    pub description: String,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub is_current: bool,
    pub skill_names: Vec<String>,
    pub evidence_count: i64,
    pub bullets: Vec<ComposerBullet>,
    /// Relevance from the match report (0 if it was never mentioned).
    pub relevance: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposerAchievement {
    pub id: i64,
    pub title: String,
    pub issuer: String,
    pub description: String,
    pub achieved_on: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposerInput {
    pub profile: Option<ComposerProfile>,
    pub education: Vec<ComposerEducation>,
    pub entities: Vec<ComposerEntity>,
    #[serde(default)]
    pub achievements: Vec<ComposerAchievement>,
    #[serde(default)]
    pub vault_skills: Vec<String>,
    /// Requirement texts the bullets are scored against.
    pub requirement_texts: Vec<String>,
    pub config: ComposerConfig,
}

// ---------------------------------------------------------------------------
// Plan model
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanBullet {
    pub id: i64,
    pub text: String,
    pub supports: Vec<String>,
    /// Studio-only toggle: excluded bullets stay in the plan but don't render.
    #[serde(default)]
    pub excluded: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanItem {
    pub entity_type: String,
    pub id: i64,
    pub title: String,
    pub subtitle: String,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub is_current: bool,
    pub description: String,
    pub bullets: Vec<PlanBullet>,
    pub skills: Vec<String>,
    pub relevance: f64,
    pub evidence_count: i64,
    /// Studio-only toggle: excluded items stay in the plan but don't render.
    #[serde(default)]
    pub excluded: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanAchievement {
    pub id: i64,
    pub title: String,
    pub issuer: String,
    pub description: String,
    pub achieved_on: Option<String>,
    /// Studio-only toggle: excluded achievements stay in the plan but don't render.
    #[serde(default)]
    pub excluded: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanEducation {
    pub id: i64,
    pub institution: String,
    pub degree: String,
    pub field_of_study: String,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub is_current: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanHeader {
    pub full_name: String,
    pub headline: String,
    pub email: String,
    pub phone: String,
    pub location: String,
    pub website: String,
    pub github: String,
    pub linkedin: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumePlan {
    pub composer_version: u32,
    pub config: ComposerConfig,
    pub header: PlanHeader,
    pub education: Vec<PlanEducation>,
    pub experience: Vec<PlanItem>,
    pub projects: Vec<PlanItem>,
    #[serde(default)]
    pub achievements: Vec<PlanAchievement>,
    pub skills: Vec<String>,
    /// Studio-only: skills hidden from the resume but kept in the plan.
    #[serde(default)]
    pub excluded_skills: Vec<String>,
    pub estimated_lines: u32,
    pub fits_one_page: bool,
    pub warnings: Vec<String>,
}

// ---------------------------------------------------------------------------
// Solver
// ---------------------------------------------------------------------------

/// Rough line capacity of one letter page between 9.5–10pt.
const LINES_PER_PAGE: f64 = 56.0;
const CHARS_PER_LINE: f64 = 95.0;

fn wrapped_lines(text: &str) -> u32 {
    let chars = text.chars().count() as f64;
    if chars == 0.0 {
        0
    } else {
        (chars / CHARS_PER_LINE).ceil().max(1.0) as u32
    }
}

fn item_lines(item: &PlanItem) -> u32 {
    // title + meta line, then bullets and an optional description block.
    let mut lines = 2;
    if !item.description.is_empty() {
        lines += wrapped_lines(&item.description);
    }
    for bullet in item.bullets.iter().filter(|b| !b.excluded) {
        lines += wrapped_lines(&bullet.text);
    }
    lines
}

/// Line estimate for a whole plan (studio re-estimates after manual edits).
pub fn estimate_plan_lines(plan: &ResumePlan) -> u32 {
    let mut lines = 4; // header block
    lines += plan.education.len() as u32 * 2;
    for item in plan.experience.iter().chain(plan.projects.iter()) {
        if !item.excluded {
            lines += item_lines(item);
        }
    }
    for ach in plan.achievements.iter().filter(|a| !a.excluded) {
        lines += 1;
        if !ach.description.is_empty() {
            lines += wrapped_lines(&ach.description);
        }
    }
    let included: Vec<&String> = plan
        .skills
        .iter()
        .filter(|s| !plan.excluded_skills.contains(s))
        .collect();
    if !included.is_empty() {
        lines += 1; // section heading
        let total: usize = included.iter().map(|s| s.len() + 2).sum();
        lines += (total as f64 / CHARS_PER_LINE).ceil() as u32;
    }
    lines
}

const STOPWORDS: &[&str] = &[
    "a", "an", "the", "and", "or", "of", "with", "for", "to", "in", "on", "at", "by", "from",
    "as", "is", "are", "be", "been", "was", "were", "you", "your", "we", "our", "their", "will",
    "shall", "must", "have", "has", "had", "do", "does", "using", "use", "used", "strong",
    "good", "great", "excellent", "plus", "years", "year", "experience", "ability", "able",
    "work", "working", "knowledge", "familiarity", "including", "such", "least", "one", "modern",
];

fn stem(token: &str) -> String {
    if token.len() > 3 && token.ends_with('s') && !token.ends_with("ss") {
        token[..token.len() - 1].to_string()
    } else {
        token.to_string()
    }
}

pub fn tokenize_filtered(text: &str) -> std::collections::HashSet<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|w| w.len() > 1 && !STOPWORDS.contains(w))
        .map(|w| stem(w))
        .collect()
}

pub fn bullet_overlap_count(bullet: &str, text: &str) -> usize {
    let bullet_tokens = tokenize_filtered(bullet);
    let other_tokens = tokenize_filtered(text);
    bullet_tokens.iter().filter(|t| other_tokens.contains(*t)).count()
}

/// How many requirement texts does this bullet support (calibrated token overlap)?
pub fn bullet_supports(text: &str, requirement_texts: &[String]) -> Vec<String> {
    let bullet_tokens = tokenize_filtered(text);
    let mut supports = Vec::new();
    for requirement in requirement_texts {
        let req_tokens = tokenize_filtered(requirement);
        if req_tokens.is_empty() {
            continue;
        }
        let hits = bullet_tokens.iter().filter(|t| req_tokens.contains(*t)).count();
        if hits >= 2 || (hits as f64 / req_tokens.len() as f64 >= 0.20) {
            supports.push(requirement.clone());
        }
    }
    supports
}

pub fn compose(input: &ComposerInput) -> ResumePlan {
    let mut warnings: Vec<String> = Vec::new();

    // 1. Mandatory layout: header + education are reserved first.
    let header = input
        .profile
        .as_ref()
        .map(|p| PlanHeader {
            full_name: p.full_name.clone(),
            headline: p.headline.clone(),
            email: p.email.clone(),
            phone: p.phone.clone(),
            location: p.location.clone(),
            website: p.website.clone(),
            github: p.github.clone(),
            linkedin: p.linkedin.clone(),
        })
        .unwrap_or(PlanHeader {
            full_name: String::new(),
            headline: String::new(),
            email: String::new(),
            phone: String::new(),
            location: String::new(),
            website: String::new(),
            github: String::new(),
            linkedin: String::new(),
        });
    if header.full_name.is_empty() {
        warnings.push("No profile in the Vault — the header is empty.".to_string());
    }

    let education: Vec<PlanEducation> = input
        .education
        .iter()
        .map(|e| PlanEducation {
            id: e.id,
            institution: e.institution.clone(),
            degree: e.degree.clone(),
            field_of_study: e.field_of_study.clone(),
            start_date: e.start_date.clone(),
            end_date: e.end_date.clone(),
            is_current: e.is_current,
        })
        .collect();

    // 2. Rank candidate records: match relevance first, then evidence and
    //    skill confidence as tie-breakers.
    let mut candidates: Vec<ComposerEntity> = input.entities.clone();
    candidates.sort_by(|a, b| {
        b.relevance
            .partial_cmp(&a.relevance)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(b.evidence_count.cmp(&a.evidence_count))
            .then(b.id.cmp(&a.id))
    });

    // 3. Select records within caps.
    let mut experience: Vec<PlanItem> = Vec::new();
    let mut projects: Vec<PlanItem> = Vec::new();
    for entity in &candidates {
        let is_experience = entity.entity_type == "experience";
        let cap = if is_experience {
            input.config.max_experience_items
        } else {
            input.config.max_projects
        };
        let list = if is_experience { &mut experience } else { &mut projects };
        if list.len() >= cap as usize {
            continue;
        }
        list.push(PlanItem {
            entity_type: entity.entity_type.clone(),
            id: entity.id,
            title: entity.title.clone(),
            subtitle: entity.subtitle.clone(),
            start_date: entity.start_date.clone(),
            end_date: entity.end_date.clone(),
            is_current: entity.is_current,
            description: entity.description.clone(),
            bullets: Vec::new(),
            skills: entity.skill_names.clone(),
            relevance: entity.relevance,
            evidence_count: entity.evidence_count,
            excluded: false,
        });
    }
    let dropped_count = candidates.len() - (experience.len() + projects.len());
    if dropped_count > 0 {
        warnings.push(format!(
            "{dropped_count} record(s) left out by the section caps — raise them if the page allows."
        ));
    }

    // 4. Select bullets: approved only, ranked by requirement support.
    let all_selected_ids: Vec<(String, i64)> = experience
        .iter()
        .chain(projects.iter())
        .map(|i| (i.entity_type.clone(), i.id))
        .collect();
    for (entity_type, id) in &all_selected_ids {
        let Some(entity) = input
            .entities
            .iter()
            .find(|e| &e.entity_type == entity_type && &e.id == id)
        else {
            continue;
        };
        let item = experience
            .iter_mut()
            .chain(projects.iter_mut())
            .find(|i| i.entity_type == *entity_type && i.id == *id)
            .unwrap();
        let mut scored: Vec<(PlanBullet, usize)> = entity
            .bullets
            .iter()
            .filter(|b| b.approved)
            .map(|b| {
                let supports = bullet_supports(&b.text, &input.requirement_texts);
                let support_count = supports.len();
                (
                    PlanBullet {
                        id: b.id,
                        text: b.text.clone(),
                        supports,
                        excluded: false,
                    },
                    support_count,
                )
            })
            .collect();
        scored.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.id.cmp(&b.0.id)));
        item.bullets = scored.into_iter().take(input.config.max_bullets_per_item as usize).map(|(b, _)| b).collect();
        let unapproved = entity.bullets.iter().filter(|b| !b.approved).count();
        if unapproved > 0 {
            warnings.push(format!(
                "{unapproved} unapproved bullet(s) on “{}” were excluded — approve them in the inspector to make them eligible.",
                entity.title
            ));
        }
    }

    // Skills: linked to selected records, requirement mentions first,
    // followed by all other skills from the Vault.
    let mut skills: Vec<String> = Vec::new();
    let req_token_sets: Vec<std::collections::HashSet<String>> = input
        .requirement_texts
        .iter()
        .map(|r| {
            r.to_lowercase()
                .split(|c: char| !c.is_ascii_alphanumeric())
                .filter(|w| w.len() > 2)
                .map(|w| w.trim_end_matches('s').to_string())
                .collect()
        })
        .collect();
    let mut mentioned = Vec::new();
    let mut other = Vec::new();
    for item in experience.iter().chain(projects.iter()) {
        for name in &item.skills {
            let lower = name.to_lowercase();
            if skills.iter().any(|s| s.to_lowercase() == lower) {
                continue;
            }
            let stem = lower.trim_end_matches('s').to_string();
            let hits_requirements = req_token_sets
                .iter()
                .any(|set| set.contains(&lower) || set.contains(&stem));
            if hits_requirements {
                mentioned.push(name.clone());
            } else {
                other.push(name.clone());
            }
            skills.push(name.clone());
        }
    }
    // Also include all vault skills so they are not lost
    for name in &input.vault_skills {
        let lower = name.to_lowercase();
        if skills.iter().any(|s| s.to_lowercase() == lower) {
            continue;
        }
        let stem = lower.trim_end_matches('s').to_string();
        let hits_requirements = req_token_sets
            .iter()
            .any(|set| set.contains(&lower) || set.contains(&stem));
        if hits_requirements {
            mentioned.push(name.clone());
        } else {
            other.push(name.clone());
        }
        skills.push(name.clone());
    }
    mentioned.extend(other);
    let skills = mentioned;

    let achievements: Vec<PlanAchievement> = input
        .achievements
        .iter()
        .map(|a| PlanAchievement {
            id: a.id,
            title: a.title.clone(),
            issuer: a.issuer.clone(),
            description: a.description.clone(),
            achieved_on: a.achieved_on.clone(),
            excluded: false,
        })
        .collect();

    let plan_at = |experience: &[PlanItem], projects: &[PlanItem], achievements: &[PlanAchievement], skills: &[String]| -> u32 {
        let mut lines = 4; // header block
        lines += education.len() as u32 * 2;
        for item in experience.iter().chain(projects.iter()) {
            lines += item_lines(item);
        }
        for ach in achievements.iter().filter(|a| !a.excluded) {
            lines += 1;
            if !ach.description.is_empty() {
                lines += wrapped_lines(&ach.description);
            }
        }
        if !skills.is_empty() {
            lines += 1; // section heading
            let chars: usize = skills.iter().map(|s| s.len() + 2).sum();
            lines += (chars as f64 / CHARS_PER_LINE).ceil() as u32;
        }
        lines
    };

    let capacity = (input.config.target_pages as f64 * LINES_PER_PAGE).floor() as u32;
    let mut estimated_lines = plan_at(&experience, &projects, &achievements, &skills);

    // 5–6. Resolve overflow: drop the lowest-support bullets first, then the
    // lowest-relevance record — never the mandatory education or header.
    let mut dropped_items = 0;
    while estimated_lines > capacity {
        // Find the weakest bullet still in the plan.
        // Owned snapshot avoids overlapping borrows across the two lists.
        let candidates: Vec<(String, i64, i64, usize)> = experience
            .iter()
            .chain(projects.iter())
            .flat_map(|item| {
                let entity_type = item.entity_type.clone();
                let item_id = item.id;
                item.bullets
                    .iter()
                    .filter(|b| !b.excluded)
                    .map(move |b| (entity_type.clone(), item_id, b.id, b.supports.len()))
            })
            .collect();
        let weakest = candidates
            .into_iter()
            .min_by_key(|(_, _, bullet_id, support)| (*support, std::cmp::Reverse(*bullet_id)));
        if let Some((entity_type, id, bullet_id, _)) = weakest {
            let list = if entity_type == "experience" { &mut experience } else { &mut projects };
            let item = list
                .iter_mut()
                .find(|i| i.entity_type == entity_type && i.id == id)
                .unwrap();
            item.bullets.retain(|b| b.id != bullet_id);
            estimated_lines = plan_at(&experience, &projects, &achievements, &skills);
            continue;
        }
        // No bullets left to trim: drop the lowest-relevance selected record.
        let weakest_item = experience
            .iter()
            .chain(projects.iter())
            .map(|i| (i.entity_type.clone(), i.id, i.relevance))
            .min_by(|a, b| a.2.partial_cmp(&b.2).unwrap_or(std::cmp::Ordering::Equal));
        match weakest_item {
            Some((entity_type, id, _)) => {
                if entity_type == "experience" {
                    experience.retain(|i| i.id != id);
                } else {
                    projects.retain(|i| i.id != id);
                }
                dropped_items += 1;
                estimated_lines = plan_at(&experience, &projects, &achievements, &skills);
            }
            None => break,
        }
    }
    if dropped_items > 0 {
        warnings.push(format!(
            "{dropped_items} record(s) were dropped to fit {capacity} lines — check the caps or the content."
        ));
    }

    let fits_one_page = estimated_lines <= capacity;
    if !fits_one_page {
        warnings.push(format!(
            "Content still exceeds one page at the minimum {}pt font — raise targetPages or trim the Vault entries.",
            input.config.min_font_size_pt
        ));
    }

    ResumePlan {
        composer_version: COMPOSER_VERSION,
        config: input.config.clone(),
        header,
        education,
        experience,
        projects,
        achievements,
        skills,
        excluded_skills: Vec::new(),
        estimated_lines,
        fits_one_page,
        warnings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bullet(id: i64, text: &str, approved: bool) -> ComposerBullet {
        ComposerBullet { id, text: text.to_string(), approved }
    }

    fn entity(
        id: i64,
        entity_type: &str,
        title: &str,
        relevance: f64,
        bullets: Vec<ComposerBullet>,
    ) -> ComposerEntity {
        ComposerEntity {
            entity_type: entity_type.to_string(),
            id,
            title: title.to_string(),
            subtitle: String::new(),
            description: String::new(),
            start_date: None,
            end_date: None,
            is_current: false,
            skill_names: vec![],
            evidence_count: 1,
            bullets,
            relevance,
        }
    }

    fn input(entities: Vec<ComposerEntity>, requirements: &[&str], config: ComposerConfig) -> ComposerInput {
        ComposerInput {
            profile: Some(ComposerProfile {
                full_name: "Jeswanth Sai".to_string(),
                headline: String::new(),
                email: "j@example.com".to_string(),
                phone: String::new(),
                location: String::new(),
                website: String::new(),
                github: String::new(),
                linkedin: String::new(),
            }),
            education: vec![ComposerEducation {
                id: 1,
                institution: "IIT Hyderabad".to_string(),
                degree: "B.Tech".to_string(),
                field_of_study: "CSE".to_string(),
                start_date: Some("2022-08".to_string()),
                end_date: Some("2026-05".to_string()),
                is_current: false,
            }],
            entities,
            achievements: vec![],
            vault_skills: vec![],
            requirement_texts: requirements.iter().map(|s| s.to_string()).collect(),
            config,
        }
    }

    #[test]
    fn selection_respects_caps_and_ranks_by_relevance() {
        let config = ComposerConfig { max_projects: 2, ..Default::default() };
        let entities = vec![
            entity(1, "project", "Low", 0.1, vec![]),
            entity(2, "project", "High", 0.9, vec![]),
            entity(3, "project", "Mid", 0.5, vec![]),
        ];
        let plan = compose(&input(entities, &[], config));
        assert_eq!(plan.projects.len(), 2);
        assert_eq!(plan.projects[0].title, "High");
        assert_eq!(plan.projects[1].title, "Mid");
        assert_eq!(plan.education.len(), 1); // mandatory section reserved
        assert!(plan.warnings.iter().any(|w| w.contains("left out")));
    }

    #[test]
    fn bullets_approved_only_and_support_ranked() {
        let config = ComposerConfig { max_bullets_per_item: 2, ..Default::default() };
        let entities = vec![entity(
            1,
            "project",
            "PyKV",
            0.9,
            vec![
                bullet(1, "Implemented WAL persistence and TTL eviction", true),
                bullet(2, "Implemented crash recovery and LRU caching", true),
                bullet(3, "Wrote documentation", true),
                bullet(4, "Unapproved claim about millions of users", false),
            ],
        )];
        let requirements = ["Strong Python and SQL skills", "Experience with WAL and TTL"];
        let plan = compose(&input(entities, &requirements, config));

        let item = &plan.projects[0];
        assert_eq!(item.bullets.len(), 2); // cap
        // Both kept bullets must support at least one requirement; the
        // documentation bullet (no support) and the unapproved one are out.
        assert!(item.bullets.iter().all(|b| !b.text.contains("documentation")));
        assert!(item.bullets.iter().all(|b| !b.text.contains("millions")));
        assert!(item.bullets.iter().any(|b| b.supports.len() > 0));
    }

    #[test]
    fn overflow_drops_weakest_bullets_before_records() {
        // One project with 3 supported bullets but a tiny line budget.
        let config = ComposerConfig { target_pages: 1, max_bullets_per_item: 3, ..Default::default() };
        let long = |t: &str| t.repeat(200);
        let entities = vec![entity(
            1,
            "project",
            "Big",
            0.9,
            vec![
                bullet(1, &long("supported one "), true),
                bullet(2, &long("supported two "), true),
                bullet(3, &long("weak filler x"), true),
            ],
        )];
        let requirements = ["supported one requirement", "supported two requirement"];
        let plan = compose(&input(entities, &requirements, config));

        assert!(plan.estimated_lines <= 56);
        assert!(plan.fits_one_page);
        // The unsupported filler bullet must be the first to go.
        assert!(!plan.projects[0].bullets.iter().any(|b| b.text.contains("weak filler")));
    }

    #[test]
    fn mandatory_header_and_education_survive_overflow() {
        let config = ComposerConfig { target_pages: 1, ..Default::default() };
        let entities: Vec<ComposerEntity> = (1..=5)
            .map(|i| {
                entity(
                    i,
                    "project",
                    &format!("Project {i}"),
                    0.9 - i as f64 * 0.1,
                    vec![bullet(i * 10, &"x".repeat(3000), true)],
                )
            })
            .collect();
        let plan = compose(&input(entities, &[], config));
        assert!(!plan.header.full_name.is_empty());
        assert_eq!(plan.education.len(), 1);
    }

    #[test]
    fn deterministic_output() {
        let entities = vec![
            entity(1, "project", "A", 0.7, vec![bullet(1, "text one", true)]),
            entity(2, "experience", "B", 0.4, vec![bullet(2, "text two", true)]),
        ];
        let requirements = vec!["text one requirement"];
        let a = compose(&input(entities.clone(), &requirements, ComposerConfig::default()));
        let b = compose(&input(entities, &requirements, ComposerConfig::default()));
        assert_eq!(
            serde_json::to_string(&a).unwrap(),
            serde_json::to_string(&b).unwrap()
        );
    }

    #[test]
    fn skills_mentioned_in_requirements_come_first() {
        let mut e = entity(1, "project", "PyKV", 0.9, vec![]);
        e.skill_names = vec!["Docker".to_string(), "Python".to_string()];
        let plan = compose(&input(vec![e], &["Strong Python"], ComposerConfig::default()));
        assert_eq!(plan.skills[0], "Python");
    }

    #[test]
    fn test_bullet_supports_matches_realistic_requirements() {
        let bullet = "Developed full-stack web applications using React, TypeScript, and Python REST APIs with PostgreSQL";
        let req1 = "Proficiency in at least one modern web development stack (e.g., React, TypeScript, JavaScript, HTML5/CSS3) and backend language (e.g., Python, Node.js, or Java).".to_string();
        let req2 = "Experience with Kubernetes cluster orchestration, Helm charts, and Terraform IAC".to_string();
        let supported = bullet_supports(bullet, &[req1.clone(), req2]);
        assert_eq!(supported.len(), 1);
        assert_eq!(supported[0], req1);
    }

    #[test]
    fn test_bullet_overlap_count() {
        let bullet = "Built microservices using Python and Docker";
        let req = "Python backend developer with Docker experience";
        assert!(bullet_overlap_count(bullet, req) >= 2);
    }
}


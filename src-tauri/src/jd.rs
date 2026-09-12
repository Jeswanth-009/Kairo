//! Job Description extraction (Phase 4 · spec §6). Pure functions: parsing
//! never touches the database. The output is a *suggestion model* — the review
//! screen is mandatory, and matching only ever runs on reviewed requirements.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RequirementKind {
    RequiredSkill,
    PreferredSkill,
    Responsibility,
}

impl RequirementKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            RequirementKind::RequiredSkill => "required_skill",
            RequirementKind::PreferredSkill => "preferred_skill",
            RequirementKind::Responsibility => "responsibility",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequirementDraft {
    pub kind: RequirementKind,
    pub raw_text: String,
    pub importance: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobExtraction {
    pub role: String,
    pub company: String,
    pub url: String,
    pub seniority: String,
    pub domain: String,
    pub requirements: Vec<RequirementDraft>,
}

const BULLETS: &[char] = &['-', '•', '·', '*', '▪', '◦', '‣'];

fn starts_with_bullet(line: &str) -> bool {
    let mut chars = line.chars();
    matches!(chars.next(), Some(c) if BULLETS.contains(&c))
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Section {
    Required,
    Preferred,
    Responsibilities,
    Skip,
}

fn detect_section(line: &str) -> Option<Section> {
    let cleaned: String = line
        .trim()
        .trim_start_matches(['#', '-', '*', '•', '·'])
        .trim()
        .trim_end_matches(':')
        .trim()
        .to_lowercase();
    let cleaned = cleaned.as_str();
    const REQUIRED: &[&str] = &[
        "requirements",
        "qualifications",
        "what you'll bring",
        "what you will bring",
        "what we're looking for",
        "what we are looking for",
        "must have",
        "must-have",
        "must haves",
        "you have",
        "about you",
        "who you are",
        "your profile",
        "skills & experience",
        "skills and experience",
        "what we need",
        "we're looking for",
    ];
    const PREFERRED: &[&str] = &[
        "nice to have",
        "nice-to-have",
        "preferred qualifications",
        "preferred skills",
        "preferred experience",
        "preferred",
        "bonus points",
        "bonus",
        "good to have",
        "desirable",
        "plus points",
        "it would be a plus",
    ];
    const RESPONSIBILITIES: &[&str] = &[
        "responsibilities",
        "what you'll do",
        "what you will do",
        "the role",
        "your role",
        "in this role",
        "about the role",
        "duties",
        "day to day",
        "day-to-day",
        "your mission",
        "key tasks",
    ];
    const SKIP: &[&str] = &[
        "about us",
        "about the company",
        "about the team",
        "benefits",
        "perks",
        "why join",
        "our mission",
        "equal opportunity",
        "how to apply",
        "our values",
        "who we are",
        "introducing",
    ];

    if REQUIRED.contains(&cleaned) {
        return Some(Section::Required);
    }
    if PREFERRED.contains(&cleaned) {
        return Some(Section::Preferred);
    }
    if RESPONSIBILITIES.contains(&cleaned) {
        return Some(Section::Responsibilities);
    }
    if SKIP.contains(&cleaned) {
        return Some(Section::Skip);
    }
    None
}

fn detect_seniority(text: &str) -> String {
    let lower = text.to_lowercase();
    let has = |needle: &str| lower.contains(needle);
    if has("intern") {
        "Internship".to_string()
    } else if has("staff") || has("principal") {
        "Staff".to_string()
    } else if has("head of") || has("director") || has("vice president") {
        "Leadership".to_string()
    } else if has("senior") || has("sr. ") || has("sr ") {
        "Senior".to_string()
    } else if has("junior") || has("entry-level") || has("entry level") || has("graduate") {
        "Junior".to_string()
    } else if has("lead") {
        "Lead".to_string()
    } else {
        String::new()
    }
}

const DOMAINS: &[(&str, &[&str])] = &[
    ("Fintech", &["fintech", "payments", "banking", "trading", "lending", "insurance"]),
    ("Healthcare", &["healthcare", "health care", "medical", "biotech", "clinical"]),
    ("E-commerce", &["e-commerce", "ecommerce", "marketplace", "retail", "shopping"]),
    ("AI/ML", &["machine learning", "artificial intelligence", "deep learning", "ai engineer", "ml engineer", "llm"]),
    ("Infrastructure", &["infrastructure", "devops", "cloud platform", "kubernetes", "site reliability"]),
    ("Cybersecurity", &["cybersecurity", "cyber security", "application security", "threat"]),
    ("Data", &["data platform", "analytics", "big data", "data engineering"]),
    ("Gaming", &["gaming", "game development", "game studio"]),
];

fn detect_domain(text: &str) -> String {
    let lower = format!(" {} ", text.to_lowercase());
    for (domain, terms) in DOMAINS {
        if terms.iter().any(|t| lower.contains(&format!(" {t}")) || lower.contains(&format!("{t} "))) {
            return domain.to_string();
        }
    }
    String::new()
}

fn split_title_line(line: &str) -> Option<(String, String)> {
    for sep in [" — ", " – ", " - ", " | ", ": "] {
        if let Some((a, b)) = line.split_once(sep) {
            let a = a.trim();
            let b = b.trim();
            if !a.is_empty() && !b.is_empty() && a.len() <= 80 && b.len() <= 80 {
                return Some((a.to_string(), b.to_string()));
            }
        }
    }
    if let Some(index) = line.find(['—', '–', '|']) {
        let a = line[..index].trim();
        let b = line[index + 1..].trim().trim_start_matches('-').trim();
        if !a.is_empty() && !b.is_empty() && a.len() <= 80 && b.len() <= 80 {
            return Some((a.to_string(), b.to_string()));
        }
    }
    None
}

fn looks_like_role(text: &str) -> bool {
    let lower = text.to_lowercase();
    ["engineer", "developer", "designer", "manager", "intern", "scientist", "analyst", "architect", "lead", "consultant", "specialist", "director"]
        .iter()
        .any(|k| lower.contains(k))
}

fn labeled_value(line: &str, labels: &[&str]) -> Option<String> {
    let lower = line.to_lowercase();
    for label in labels {
        let prefix = format!("{label} ");
        if lower.starts_with(&prefix) || lower.starts_with(&format!("{label}:")) {
            let after = line[label.len()..].trim().trim_start_matches(':').trim();
            if !after.is_empty() {
                return Some(after.to_string());
            }
        }
    }
    None
}

const IMPORTANCE: [(RequirementKind, f64); 3] = [
    (RequirementKind::RequiredSkill, 0.8),
    (RequirementKind::PreferredSkill, 0.4),
    (RequirementKind::Responsibility, 0.6),
];

fn default_importance(kind: RequirementKind) -> f64 {
    IMPORTANCE.iter().find(|(k, _)| *k == kind).map(|(_, v)| *v).unwrap_or(0.5)
}

fn split_at_marker(line: &str) -> Option<(String, String)> {
    let lower = line.to_lowercase();
    let i = lower.rfind(" at ")?;
    let a = line[..i].trim();
    let b = line[i + 4..].trim();
    if a.is_empty() || b.is_empty() || a.len() > 80 || b.len() > 80 {
        return None;
    }
    Some((a.to_string(), b.to_string()))
}

pub fn parse_jd(text: &str) -> JobExtraction {
    let mut role = String::new();
    let mut company = String::new();
    let mut url = String::new();
    let mut requirements: Vec<RequirementDraft> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    let mut section: Option<Section> = None;
    let mut saw_any_section = false;

    let mut title_line_handled = false;
    let mut title_lines_seen = 0usize;

    let mut lines = text.lines().peekable();

    while let Some(raw) = lines.next() {
        let line = raw.trim_end();
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if url.is_empty() {
            for word in trimmed.split_whitespace() {
                if word.starts_with("https://") || word.starts_with("http://") {
                    url = word.trim_end_matches(|c: char| matches!(c, '.' | ',' | ')' | ';')).to_string();
                    break;
                }
            }
        }

        // Title heuristics apply only to the first handful of content lines.
        if !title_line_handled {
            title_lines_seen += 1;
            if title_lines_seen > 6 {
                title_line_handled = true;
            } else if let Some(v) = labeled_value(trimmed, &["job title", "role", "position"]) {
                role = v;
                title_line_handled = true;
                continue;
            } else if let Some(v) = labeled_value(trimmed, &["company", "employer", "organization"]) {
                if company.is_empty() {
                    company = v;
                }
                title_line_handled = true;
                continue;
            } else if let Some((a, b)) = split_title_line(trimmed) {
                let a_is_role = looks_like_role(&a);
                let b_is_role = looks_like_role(&b);
                if a_is_role && !b_is_role {
                    role = a;
                    company = b;
                } else if b_is_role && !a_is_role {
                    role = b;
                    company = a;
                } else if let Some((r, c)) = split_at_marker(&a) {
                    role = r;
                    company = c;
                } else if let Some((r, c)) = split_at_marker(&b) {
                    role = r;
                    company = c;
                }
                title_line_handled = true;
                continue;
            } else if let Some((r, c)) = split_at_marker(trimmed) {
                if looks_like_role(&r) {
                    role = r;
                    company = c;
                    title_line_handled = true;
                    continue;
                }
            } else if role.is_empty() && trimmed.len() <= 80 && looks_like_role(trimmed) {
                role = trimmed.to_string();
                title_line_handled = true;
                continue;
            }
        }

        if let Some(next) = detect_section(trimmed) {
            section = Some(next);
            saw_any_section = true;
            continue;
        }

        // Sections govern their content. Before any heading, bullets are the
        // only recognizable requirements (bare JDs without structure).
        let sec = match section {
            Some(Section::Skip) => continue,
            Some(s) => s,
            None => {
                if saw_any_section || !starts_with_bullet(trimmed) {
                    continue;
                }
                Section::Responsibilities
            }
        };

        let content = trimmed.trim_start_matches(BULLETS).trim();
        if content.is_empty() {
            continue;
        }
        let is_bullet = starts_with_bullet(trimmed) || content != trimmed;
        if !is_bullet && content.ends_with(|c: char| c == ':' || c == '?') {
            continue; // sub-headings inside sections
        }

        let kind = match sec {
            Section::Required => RequirementKind::RequiredSkill,
            Section::Preferred => RequirementKind::PreferredSkill,
            _ => RequirementKind::Responsibility,
        };

        // "Skills: Python, SQL, Go" style lines expand into one entry each.
        if let Some((label, list)) = content.split_once(':') {
            if label.trim().to_lowercase().contains("skill") && list.contains(',') {
                for token in list.split(',') {
                    let token = token.trim();
                    if token.is_empty() {
                        continue;
                    }
                    push_requirement(&mut requirements, &mut seen, kind, token, default_importance(kind));
                }
                continue;
            }
        }

        push_requirement(&mut requirements, &mut seen, kind, content, default_importance(kind));
    }

    if requirements.len() > 40 {
        requirements.truncate(40);
    }

    JobExtraction {
        role,
        company,
        url,
        seniority: detect_seniority(text),
        domain: detect_domain(text),
        requirements,
    }
}

fn push_requirement(
    requirements: &mut Vec<RequirementDraft>,
    seen: &mut Vec<String>,
    kind: RequirementKind,
    raw: &str,
    importance: f64,
) {
    let text = raw.trim();
    if text.is_empty() || text.len() > 300 {
        return;
    }
    let key = text.to_lowercase();
    if seen.contains(&key) {
        return;
    }
    seen.push(key);
    requirements.push(RequirementDraft { kind, raw_text: text.to_string(), importance });
}

#[cfg(test)]
pub const SAMPLE_JD: &str = r#"
Senior Backend Engineer at NimbusPay

About NimbusPay
NimbusPay builds payment infrastructure for marketplaces.

Responsibilities
- Design and ship REST APIs for payment flows
- Own the reliability of core services
- Mentor junior engineers

Requirements
- 5+ years of backend experience
- Strong Python and SQL skills
- Experience with Docker and Kubernetes

Nice to have
- Kafka experience
- Prior fintech background

How to apply
Send your resume to jobs@nimbuspay.example.com or visit https://jobs.nimbuspay.example.com
"#;

#[cfg(test)]
mod tests {
    use super::*;

    const JD: &str = SAMPLE_JD;

    #[test]
    fn jd_parser_assigns_sections_and_meta() {
        let extraction = parse_jd(JD);

        assert_eq!(extraction.role, "Senior Backend Engineer");
        assert_eq!(extraction.company, "NimbusPay");
        assert_eq!(extraction.seniority, "Senior");
        assert_eq!(extraction.domain, "Fintech");
        assert!(extraction.url.contains("jobs.nimbuspay.example.com"));

        let kinds: Vec<(RequirementKind, usize)> = vec![
            (RequirementKind::Responsibility, 3),
            (RequirementKind::RequiredSkill, 3),
            (RequirementKind::PreferredSkill, 2),
        ];
        for (kind, expected) in kinds {
            let count = extraction.requirements.iter().filter(|r| r.kind == kind).count();
            assert_eq!(count, expected, "wrong count for {kind:?}");
        }

        let preferred = extraction
            .requirements
            .iter()
            .find(|r| r.kind == RequirementKind::PreferredSkill)
            .unwrap();
        assert!(preferred.raw_text.contains("Kafka"));
        assert!((preferred.importance - 0.4).abs() < f64::EPSILON);

        // "How to apply" content must not leak into requirements.
        assert!(!extraction.requirements.iter().any(|r| r.raw_text.to_lowercase().contains("resume")));
    }

    #[test]
    fn jd_parser_handles_skills_lists() {
        let extraction = parse_jd(
            "Backend Engineer\n\nRequirements\n- Skills: Python, SQL, Go\n- REST API design\n",
        );
        let required: Vec<&str> = extraction
            .requirements
            .iter()
            .filter(|r| r.kind == RequirementKind::RequiredSkill)
            .map(|r| r.raw_text.as_str())
            .collect();
        assert_eq!(required, vec!["Python", "SQL", "Go", "REST API design"]);
    }

    #[test]
    fn jd_parser_without_headings_uses_bullets_as_responsibilities() {
        let extraction = parse_jd("Engineer role\n- do things\n- build stuff\n");
        assert_eq!(extraction.requirements.len(), 2);
        assert!(extraction
            .requirements
            .iter()
            .all(|r| r.kind == RequirementKind::Responsibility));
    }

    #[test]
    fn jd_parser_dedupes_and_caps() {
        let mut text = String::from("Role\n\nRequirements\n");
        for _ in 0..50 {
            text.push_str("- Python\n");
        }
        let extraction = parse_jd(&text);
        assert_eq!(extraction.requirements.len(), 1);
    }
}

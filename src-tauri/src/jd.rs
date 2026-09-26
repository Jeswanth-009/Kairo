//! Job Description extraction (Phase 4 · spec §6). Pure functions: parsing
//! never touches the database. The output is a *suggestion model* — the review
//! screen is mandatory, and matching only ever runs on reviewed requirements.

use serde::{Deserialize, Serialize};

use crate::text::{rfind_ci, strip_ci_prefix};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RequirementKind {
    RequiredSkill,
    PreferredSkill,
    Responsibility,
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
    // Markdown posts wrap headings in emphasis ("**About You**") — strip the
    // markers or the trailing "**" defeats every match below.
    let cleaned: String = line
        .trim()
        .trim_start_matches(['#', '-', '*', '•', '·', '▪', '◦', '‣'])
        .trim()
        .trim_end_matches([':', '*', '_'])
        .trim_start_matches(['*', '_'])
        .trim()
        .trim_end_matches(':')
        .trim()
        .to_lowercase();
    let cleaned = cleaned.as_str();

    // Any heading starting with "about " (unless "about the role", "about you", etc.)
    // is company overview copy and should be skipped.
    if let Some(head) = cleaned.strip_prefix("about ") {
        let after = head.trim();
        if !after.starts_with("the role")
            && !after.starts_with("the job")
            && !after.starts_with("the position")
            && !after.starts_with("this role")
            && !after.starts_with("you")
        {
            return Some(Section::Skip);
        }
    }

    if cleaned.starts_with("life at ")
        || cleaned.starts_with("working at ")
        || cleaned.starts_with("work at ")
        || cleaned.starts_with("why join ")
        || cleaned.starts_with("why work at ")
        || cleaned.starts_with("join ")
    {
        return Some(Section::Skip);
    }

    if cleaned.contains("benefit")
        || cleaned.contains("perk")
        || cleaned.contains("total reward")
        || cleaned.contains("compensation")
        || cleaned.contains("what we offer")
        || cleaned.contains("our offer")
    {
        return Some(Section::Skip);
    }

    if cleaned.contains("equal opportunity")
        || cleaned.contains("eeo")
        || cleaned.contains("diversity")
        || cleaned.contains("inclusion")
        || cleaned.contains("accommodation")
        || cleaned.contains("affirmative action")
    {
        return Some(Section::Skip);
    }

    if cleaned.contains("how to apply")
        || cleaned.contains("application process")
        || cleaned.contains("notice to")
        || cleaned.contains("recruiting agenc")
        || cleaned.contains("privacy notice")
        || cleaned.contains("privacy policy")
        || cleaned.contains("legal disclaimer")
    {
        return Some(Section::Skip);
    }

    const SKIP: &[&str] = &[
        "about us",
        "about the company",
        "about our company",
        "about the team",
        "benefits",
        "perks",
        "why join",
        "our mission",
        "equal opportunity",
        "how to apply",
        "our values",
        "our culture",
        "who we are",
        "introducing",
        "company overview",
        "corporate responsibility",
        "work environment",
        "physical demands",
    ];
    if SKIP.contains(&cleaned) {
        return Some(Section::Skip);
    }

    // Preferred / Nice to have. starts_with, not contains — bullet text like
    // "backend programming languages (Golang/Java/PHP preferred)" must not be
    // mistaken for a heading.
    if cleaned.starts_with("preferred")
        || cleaned.starts_with("nice to have")
        || cleaned.starts_with("good to have")
        || cleaned == "bonus"
        || cleaned == "bonus points"
        || cleaned == "it would be a plus"
        || cleaned == "desirable"
    {
        return Some(Section::Preferred);
    }
    const PREFERRED: &[&str] = &[
        "nice to have",
        "nice-to-have",
        "preferred qualifications",
        "preferred skills",
        "preferred experience",
        "preferred requirements",
        "preferred",
        "bonus points",
        "bonus",
        "good to have",
        "desirable",
        "plus points",
        "it would be a plus",
        "additional qualifications",
        "would be great if you have",
    ];
    if PREFERRED.contains(&cleaned) {
        return Some(Section::Preferred);
    }

    // Responsibilities
    // starts_with rather than contains: a bullet like "Sense of ownership and
    // responsibility" must not hijack the section state mid-list.
    if cleaned.starts_with("responsibilit") {
        return Some(Section::Responsibilities);
    }
    // Real postings append the track to the heading ("What you'll do as a
    // Product Engineer Intern") — prefix-match the family instead of
    // requiring the bare heading.
    if cleaned.starts_with("what you'll do")
        || cleaned.starts_with("what you will do")
        || cleaned.starts_with("what you'll be doing")
        || cleaned.starts_with("what you will be doing")
        || cleaned.starts_with("what you'll work on")
        || cleaned.starts_with("what you will work on")
    {
        return Some(Section::Responsibilities);
    }
    const RESPONSIBILITIES: &[&str] = &[
        "responsibilities",
        "key responsibilities",
        "primary responsibilities",
        "core responsibilities",
        "what you'll do",
        "what you will do",
        "what you'll be doing",
        "what you will be doing",
        "the role",
        "your role",
        "in this role",
        "about the role",
        "duties",
        "day to day",
        "day-to-day",
        "your mission",
        "key tasks",
        "key accountabilities",
        "scope of work",
        "what you'll work on",
    ];
    if RESPONSIBILITIES.contains(&cleaned) {
        return Some(Section::Responsibilities);
    }

    // Required qualifications — prefix-matched so requirement *bullets*
    // ("requirements gathering", "required: X") don't hijack the state.
    // NOTE: "Description & Requirements" is deliberately NOT a heading — ATS
    // labels like it introduce prose, not requirement lists.
    const REQUIREMENT_HEADINGS: &[&str] = &[
        "requirement",
        "qualification",
        "minimum requirement",
        "minimum qualification",
        "basic requirement",
        "basic qualification",
        "technical requirement",
        "technical qualification",
        "job requirement",
        "role requirement",
        "key requirement",
        "other requirement",
        "education requirement",
    ];
    if cleaned != "description"
        && cleaned != "overview"
        && cleaned != "job overview"
        && REQUIREMENT_HEADINGS.iter().any(|s| cleaned.starts_with(s))
    {
        return Some(Section::Required);
    }

    const REQUIRED: &[&str] = &[
        "requirements",
        "qualifications",
        "minimum qualifications",
        "basic qualifications",
        "minimum requirements",
        "basic requirements",
        "what you'll bring",
        "what you will bring",
        "what you bring",
        "what we're looking for",
        "what we are looking for",
        "what you need",
        "what you will need",
        "what you'll need",
        "what you need to succeed",
        "must have",
        "must-have",
        "must haves",
        "you have",
        "about you",
        "who you are",
        "your profile",
        "skills & experience",
        "skills and experience",
        "required skills",
        "core skills",
        "technical skills",
        "what we need",
        "we're looking for",
        "candidate profile",
        "ideal candidate",
        "eligibility",
        "eligibility criteria",
    ];
    if REQUIRED.contains(&cleaned) {
        return Some(Section::Required);
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
    (
        "Fintech",
        &[
            "fintech",
            "payments",
            "banking",
            "trading",
            "lending",
            "insurance",
        ],
    ),
    (
        "Healthcare",
        &[
            "healthcare",
            "health care",
            "medical",
            "biotech",
            "clinical",
        ],
    ),
    (
        "E-commerce",
        &[
            "e-commerce",
            "ecommerce",
            "marketplace",
            "retail",
            "shopping",
        ],
    ),
    (
        "AI/ML",
        &[
            "machine learning",
            "artificial intelligence",
            "deep learning",
            "ai engineer",
            "ml engineer",
            "llm",
            "generative ai",
            "genai",
            "agentic",
            "nlp",
        ],
    ),
    (
        "Infrastructure",
        &[
            "infrastructure",
            "devops",
            "cloud platform",
            "kubernetes",
            "site reliability",
        ],
    ),
    (
        "Cybersecurity",
        &[
            "cybersecurity",
            "cyber security",
            "application security",
            "threat",
        ],
    ),
    (
        "Data",
        &["data platform", "analytics", "big data", "data engineering"],
    ),
    (
        "Gaming",
        &[
            "gaming",
            "game development",
            "game studio",
            "interactive entertainment",
            "video games",
        ],
    ),
];

pub(crate) fn detect_domain(text: &str) -> String {
    let lower = format!(" {} ", text.to_lowercase());
    for (domain, terms) in DOMAINS {
        if terms
            .iter()
            .any(|t| lower.contains(&format!(" {t}")) || lower.contains(&format!("{t} ")))
        {
            return domain.to_string();
        }
    }
    String::new()
}

fn is_employment_noise(text: &str) -> bool {
    let lower = text.trim().to_lowercase();
    if lower.contains("temporary employee")
        || lower.contains("worker type")
        || lower.contains("employment type")
        || lower.contains("work model")
        || lower.starts_with("intern - temporary")
        || lower.starts_with("intern / temporary")
    {
        return true;
    }
    matches!(
        lower.as_str(),
        "temporary employee"
            | "temporary"
            | "permanent"
            | "full time"
            | "full-time"
            | "part time"
            | "part-time"
            | "contract"
            | "contractor"
            | "intern"
            | "internship"
            | "hybrid"
            | "remote"
            | "on-site"
            | "onsite"
            | "paid"
            | "unpaid"
            | "co-op"
            | "coop"
    )
}

fn is_ats_preamble_label(line: &str) -> bool {
    let cleaned = line.trim().trim_end_matches(':').trim().to_lowercase();
    matches!(
        cleaned.as_str(),
        "general information"
            | "job information"
            | "basic information"
            | "location"
            | "locations"
            | "role id"
            | "job id"
            | "position id"
            | "req id"
            | "requisition id"
            | "worker type"
            | "employment type"
            | "job type"
            | "work model"
            | "workplace type"
            | "workplace"
            | "studio/department"
            | "department"
            | "team"
            | "business unit"
            | "date posted"
            | "posted on"
            | "posted"
            | "posted today"
    )
}

fn split_title_line(line: &str) -> Option<(String, String)> {
    for sep in [" — ", " – ", " - ", " | ", ": "] {
        if let Some((a, b)) = line.split_once(sep) {
            let a = a.trim();
            let b = b.trim();
            if !a.is_empty()
                && !b.is_empty()
                && a.len() <= 80
                && b.len() <= 80
                && !is_employment_noise(a)
                && !is_employment_noise(b)
            {
                return Some((a.to_string(), b.to_string()));
            }
        }
    }
    // match_indices yields char-boundary-aligned offsets; em/en dashes are
    // 3 bytes wide, so `index + 1` would slice inside the character.
    if let Some((index, sep)) = line.match_indices(['—', '–', '|']).next() {
        let a = line[..index].trim();
        let b = line[index + sep.len()..]
            .trim()
            .trim_start_matches('-')
            .trim();
        if !a.is_empty()
            && !b.is_empty()
            && a.len() <= 80
            && b.len() <= 80
            && !is_employment_noise(a)
            && !is_employment_noise(b)
        {
            return Some((a.to_string(), b.to_string()));
        }
    }
    None
}

fn looks_like_role(text: &str) -> bool {
    let lower = text.to_lowercase();
    [
        "engineer",
        "developer",
        "designer",
        "manager",
        "intern",
        "scientist",
        "analyst",
        "architect",
        "lead",
        "consultant",
        "specialist",
        "director",
    ]
    .iter()
    .any(|k| lower.contains(k))
}

fn labeled_value(line: &str, labels: &[&str]) -> Option<String> {
    for label in labels {
        // strip_ci_prefix keeps the offset on a char boundary of `line` even
        // when the text is non-ASCII (to_lowercase() can change byte lengths).
        let Some(rest) = strip_ci_prefix(line, label) else {
            continue;
        };
        let after = if let Some(stripped) = rest.strip_prefix(':') {
            stripped.trim()
        } else if rest.starts_with(char::is_whitespace) {
            rest.trim()
        } else {
            continue;
        };
        if !after.is_empty() {
            return Some(after.to_string());
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
    IMPORTANCE
        .iter()
        .find(|(k, _)| *k == kind)
        .map(|(_, v)| *v)
        .unwrap_or(0.5)
}

fn split_at_marker(line: &str) -> Option<(String, String)> {
    let (i, end) = rfind_ci(line, " at ")?;
    let a = line[..i].trim();
    let b = line[end..].trim();
    if a.is_empty() || b.is_empty() || a.len() > 80 || b.len() > 80 || is_employment_noise(b) {
        return None;
    }
    Some((a.to_string(), b.to_string()))
}

fn is_boilerplate_requirement(text: &str) -> bool {
    let lower = text.to_lowercase();
    let phrases = [
        "equal opportunity",
        "employment decisions are made without regard",
        "without regard to race",
        "protected by law",
        "workplace accommodation",
        "accommodations for qualified individuals",
        "criminal record",
        "background check",
        "drug test",
        "all qualified applicants will receive consideration",
        "at-will employment",
        "pay transparency",
        "salary range for this role",
        "total compensation package",
        "holistic approach to our benefits",
        "benefits program",
        "healthcare coverage",
        "mental well-being",
        "retirement savings",
        "paid time off",
        "family leaves",
        "complimentary games",
        "nurture environments where",
        "extensive portfolio of games",
        "creates next-level entertainment",
        "everyone is part of the story",
        "community that connects across the globe",
        "where creativity thrives",
        "makes play happen",
        "how to apply",
        "send your resume to",
        "visit our website",
        "click here to apply",
        "force multiplier, accelerating",
        "we are looking for a",
        "we are looking for",
        "is looking for a",
        "who are we",
    ];
    phrases.iter().any(|p| lower.contains(p))
}

fn extract_company_from_text(lines: &[&str]) -> Option<String> {
    // 1. Explicit labeled line: "Company: Electronic Arts"
    for (i, &line) in lines.iter().enumerate().take(30) {
        let trimmed = line.trim();
        if (i > 0 && is_ats_preamble_label(lines[i - 1].trim()))
            || is_ats_preamble_label(trimmed)
            || is_employment_noise(trimmed)
        {
            continue;
        }
        if let Some(v) = labeled_value(line, &["company", "employer", "organization"]) {
            if !is_employment_noise(&v) && !is_ats_preamble_label(&v) && v.len() >= 2 {
                return Some(v);
            }
        }
    }

    // 2. Look for "About <Company>" heading anywhere in the document
    for line in lines {
        let trimmed = line.trim().trim_start_matches(['#', '*', '-']).trim();
        let lower = trimmed.to_lowercase();
        if lower.starts_with("about ") {
            let candidate = trimmed[6..].trim().trim_end_matches(':').trim();
            let c_lower = candidate.to_lowercase();
            if !c_lower.starts_with("the role")
                && !c_lower.starts_with("the job")
                && !c_lower.starts_with("the position")
                && !c_lower.starts_with("this role")
                && !c_lower.starts_with("you")
                && !c_lower.starts_with("us")
                && !c_lower.starts_with("our ")
                && !candidate.is_empty()
                && candidate.len() <= 60
                && !is_employment_noise(candidate)
                && !is_ats_preamble_label(candidate)
            {
                return Some(candidate.to_string());
            }
        }
    }

    // 3. Header pattern: Role \n Company \n Location
    for i in 0..lines.len().min(25) {
        let line = lines[i].trim();
        if (i > 0 && is_ats_preamble_label(lines[i - 1].trim()))
            || is_ats_preamble_label(line)
            || is_employment_noise(line)
        {
            continue;
        }
        if looks_like_role(line) && i + 1 < lines.len() {
            let candidate = lines[i + 1].trim();
            if !candidate.is_empty()
                && candidate.len() <= 60
                && !looks_like_role(candidate)
                && !is_employment_noise(candidate)
                && !is_ats_preamble_label(candidate)
                && !candidate.starts_with("http")
                && !candidate.ends_with(':')
                && detect_section(candidate).is_none()
            {
                // If followed by location (line i + 2 has a comma, e.g. "Hyderabad, India")
                if i + 2 < lines.len() {
                    let loc = lines[i + 2].trim().to_lowercase();
                    if loc.contains(',')
                        || loc.contains("remote")
                        || loc.contains("hybrid")
                        || loc.contains("india")
                        || loc.contains("united states")
                        || loc.contains("san francisco")
                    {
                        return Some(candidate.to_string());
                    }
                }
            }
        }
    }

    // 4. "<Company> is an equal opportunity employer"
    for line in lines {
        let lower = line.to_lowercase();
        if let Some(idx) = lower.find(" is an equal opportunity employer") {
            let candidate = line[..idx].trim();
            if !candidate.is_empty()
                && candidate.len() <= 60
                && !candidate.to_lowercase().starts_with("the company")
            {
                return Some(candidate.to_string());
            }
        }
    }

    None
}

fn extract_role_from_text(lines: &[&str]) -> Option<String> {
    // 1. Explicit labeled line: "Role: Software Engineer" (ignoring "Role ID: ...")
    for (i, &line) in lines.iter().enumerate().take(30) {
        let trimmed = line.trim();
        if (i > 0 && is_ats_preamble_label(lines[i - 1].trim()))
            || is_ats_preamble_label(trimmed)
            || is_employment_noise(trimmed)
        {
            continue;
        }
        let lower = trimmed.to_lowercase();
        if lower.starts_with("role id")
            || lower.starts_with("job id")
            || lower.starts_with("position id")
        {
            continue;
        }
        if let Some(v) = labeled_value(line, &["job title", "role", "position"]) {
            if !is_employment_noise(&v) && !v.eq_ignore_ascii_case("id") && v.len() >= 3 {
                return Some(v);
            }
        }
    }

    // 2. Title with separator: "Role at Company" or "Role - Company"
    for (i, &line) in lines.iter().enumerate().take(20) {
        let trimmed = line.trim();
        if (i > 0 && is_ats_preamble_label(lines[i - 1].trim()))
            || is_ats_preamble_label(trimmed)
            || is_employment_noise(trimmed)
        {
            continue;
        }
        if let Some((a, _b)) = split_at_marker(trimmed) {
            if looks_like_role(&a) && !is_employment_noise(&a) && !is_ats_preamble_label(&a) {
                return Some(a);
            }
        }
        if let Some((a, b)) = split_title_line(trimmed) {
            let a_is_role =
                looks_like_role(&a) && !is_employment_noise(&a) && !is_ats_preamble_label(&a);
            let b_is_role =
                looks_like_role(&b) && !is_employment_noise(&b) && !is_ats_preamble_label(&b);
            if a_is_role && !b_is_role {
                return Some(a);
            } else if b_is_role && !a_is_role {
                return Some(b);
            }
        }
    }

    // 3. Header line that looks like a role title
    for (i, &line) in lines.iter().enumerate().take(25) {
        let trimmed = line.trim();
        if (i > 0 && is_ats_preamble_label(lines[i - 1].trim()))
            || is_ats_preamble_label(trimmed)
            || is_employment_noise(trimmed)
        {
            continue;
        }
        let lower = trimmed.to_lowercase();
        if lower.starts_with("role id")
            || lower.starts_with("job id")
            || lower.starts_with("position id")
        {
            continue;
        }
        if trimmed.len() <= 80
            && looks_like_role(trimmed)
            && !lower.starts_with("you will")
            && !lower.starts_with("we are")
            && !lower.starts_with("as an")
            && !lower.starts_with("about")
            && !lower.ends_with(':')
            && detect_section(trimmed).is_none()
        {
            return Some(trimmed.to_string());
        }
    }

    None
}

/// Strips a markdown-bold wrapper ("**Heading**") so heading and bullet
/// detection see the real text — "**" is itself a bullet character, so an
/// unstripped bold title parses as a bullet.
fn strip_md_bold(line: &str) -> &str {
    let t = line.trim();
    if t.len() >= 4 && t.starts_with("**") && t.ends_with("**") {
        t[2..t.len() - 2].trim()
    } else {
        t
    }
}

pub fn parse_jd(text: &str) -> JobExtraction {
    let raw_lines: Vec<&str> = text
        .lines()
        .map(strip_md_bold)
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect();

    let role = extract_role_from_text(&raw_lines).unwrap_or_default();
    let company = extract_company_from_text(&raw_lines).unwrap_or_default();
    let mut url = String::new();
    let mut requirements: Vec<RequirementDraft> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    let mut section: Option<Section> = None;
    let mut saw_any_section = false;

    // Detect URL from text
    for line in &raw_lines {
        for word in line.split_whitespace() {
            if word.starts_with("https://") || word.starts_with("http://") {
                url = word.trim_end_matches(['.', ',', ')', ';']).to_string();
                break;
            }
        }
        if !url.is_empty() {
            break;
        }
    }

    for &line in &raw_lines {
        #[cfg(test)]
        eprintln!("JDLINE sec={:?} | {}", section, line);
        if let Some(next) = detect_section(line) {
            section = Some(next);
            if next != Section::Skip {
                saw_any_section = true;
            }
            continue;
        }

        let sec = match section {
            Some(Section::Skip) => continue,
            Some(s) => s,
            None => {
                // Before any recognizable section, only parse lines that explicitly start with a bullet.
                if saw_any_section || !starts_with_bullet(line) {
                    continue;
                }
                Section::Responsibilities
            }
        };

        let content = line.trim_start_matches(BULLETS).trim();
        if content.is_empty() || content.len() < 4 {
            continue;
        }
        // Sub-headings (bulleted or not) never become requirements.
        if content.ends_with([':', '?']) {
            continue;
        }

        if is_boilerplate_requirement(content)
            || content.eq_ignore_ascii_case(&role)
            || content.eq_ignore_ascii_case(&company)
        {
            continue;
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
                    if token.is_empty() || is_boilerplate_requirement(token) {
                        continue;
                    }
                    push_requirement(
                        &mut requirements,
                        &mut seen,
                        kind,
                        token,
                        default_importance(kind),
                    );
                }
                continue;
            }
        }

        push_requirement(
            &mut requirements,
            &mut seen,
            kind,
            content,
            default_importance(kind),
        );
    }

    if requirements.len() > 40 {
        requirements.truncate(40);
    }

    // Thin-extraction rescue: prose-style JDs (no headings, no bullets) leave
    // the section pass nearly empty, starving matching and planning. Scan the
    // whole text for known technology terms and add the ones no captured
    // requirement already mentions.
    if requirements.len() < 4 {
        push_tech_requirements(text, &mut requirements, &mut seen);
    }

    let domain = {
        let context = format!(
            "{} {}",
            role,
            requirements
                .iter()
                .map(|r| r.raw_text.as_str())
                .collect::<Vec<_>>()
                .join(" ")
        );
        let from_context = detect_domain(&context);
        if !from_context.is_empty() {
            from_context
        } else {
            detect_domain(text)
        }
    };

    JobExtraction {
        role,
        company,
        url,
        seniority: detect_seniority(text),
        domain,
        requirements,
    }
}

/// Known technologies for the thin-extraction rescue pass, matched as padded
/// substrings of a punctuation-normalized lowercase copy of the JD. Terms are
/// chosen so plain substring matching is safe ("java" cannot match inside
/// "javascript", "git" not inside "github"). Single-letter names ("R", "C")
/// are deliberately excluded — too false-positive-prone.
const TECH_TERMS: &[&str] = &[
    "python",
    "javascript",
    "typescript",
    "java",
    "kotlin",
    "swift",
    "golang",
    "rust",
    "c++",
    "c#",
    "ruby",
    "php",
    "scala",
    "solidity",
    "react",
    "next.js",
    "angular",
    "vue",
    "svelte",
    "node.js",
    "express",
    "django",
    "flask",
    "fastapi",
    "spring boot",
    ".net",
    "tailwind",
    "sql",
    "postgresql",
    "mysql",
    "sqlite",
    "mongodb",
    "redis",
    "dynamodb",
    "cassandra",
    "elasticsearch",
    "graphql",
    "aws",
    "azure",
    "gcp",
    "docker",
    "kubernetes",
    "terraform",
    "github actions",
    "jenkins",
    "linux",
    "ci/cd",
    "pytorch",
    "tensorflow",
    "langchain",
    "openai",
    "hugging face",
    "llm",
    "rag",
    "kafka",
    "rabbitmq",
    "microservices",
    "grpc",
    "websockets",
    "rest api",
    "git",
];

/// Terms that must be matched as a capitalised standalone word — lowercase
/// matching would flood requirements ("good", "go to").
const TECH_TERMS_CAPITALISED: &[&str] = &["Go"];

/// Preferred-skill markers: a tech term mentioned near one of these reads as
/// optional rather than required.
const PREFERRED_MARKERS: &[&str] = &["nice to have", "plus", "bonus", "preferred", "familiarity"];

fn push_tech_requirements(
    text: &str,
    requirements: &mut Vec<RequirementDraft>,
    seen: &mut Vec<String>,
) {
    let mut normalized = text.to_lowercase();
    for marker in [',', ';', ':', '(', ')', '[', ']', '·', '•', '\n', '\r'] {
        normalized = normalized.replace(marker, " ");
    }
    let padded = format!(" {} ", normalized);

    for term in TECH_TERMS {
        let needle = format!(" {term} ");
        let Some(pos) = padded.find(&needle) else {
            continue;
        };
        // A tech term already mentioned inside a captured requirement is not a
        // new requirement.
        if seen.iter().any(|s| s.contains(term)) {
            continue;
        }
        let kind = if PREFERRED_MARKERS
            .iter()
            .any(|w| padded[..pos + needle.len()].contains(w))
        {
            RequirementKind::PreferredSkill
        } else {
            RequirementKind::RequiredSkill
        };
        let importance = match kind {
            RequirementKind::PreferredSkill => 0.4,
            _ => 0.65,
        };
        push_requirement(requirements, seen, kind, term, importance);
    }

    for term in TECH_TERMS_CAPITALISED {
        let word_match = text.split_whitespace().any(|w| {
            w.trim_matches(|c: char| !c.is_alphanumeric() && c != '+' && c != '#') == *term
        });
        if word_match && !seen.iter().any(|s| s.contains(&term.to_lowercase())) {
            push_requirement(
                requirements,
                seen,
                RequirementKind::RequiredSkill,
                term,
                0.65,
            );
        }
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
    if text.is_empty() {
        return;
    }
    if text.len() > 300 {
        if text.contains(". ") {
            for sentence in text.split(". ") {
                let s = sentence.trim();
                if !s.is_empty() {
                    push_requirement(requirements, seen, kind, s, importance);
                }
            }
        }
        return;
    }
    let key = text.to_lowercase();
    if seen.contains(&key) {
        return;
    }
    seen.push(key);
    requirements.push(RequirementDraft {
        kind,
        raw_text: text.to_string(),
        importance,
    });
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
            let count = extraction
                .requirements
                .iter()
                .filter(|r| r.kind == kind)
                .count();
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
        assert!(!extraction
            .requirements
            .iter()
            .any(|r| r.raw_text.to_lowercase().contains("resume")));
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

    #[test]
    fn jd_parser_prose_jd_gets_tech_requirements() {
        // No sections, no bullets — the section pass extracts nothing and the
        // technology rescue pass must fill the pipeline.
        let text = "Platform Engineer\n\nYou will join our platform team working with Go and Kubernetes daily. We run PostgreSQL and Redis at scale. Familiarity with Rust is a plus.\n";
        let extraction = parse_jd(text);
        assert!(
            !extraction.requirements.is_empty(),
            "prose JD must not starve the pipeline"
        );
        let names: Vec<String> = extraction
            .requirements
            .iter()
            .map(|r| r.raw_text.to_lowercase())
            .collect();
        for term in ["kubernetes", "postgresql", "redis", "go"] {
            assert!(
                names.contains(&term.to_string()),
                "missing {term}: {names:?}"
            );
        }
        let rust_req = extraction
            .requirements
            .iter()
            .find(|r| r.raw_text.eq_ignore_ascii_case("rust"))
            .expect("Rust must be extracted");
        assert_eq!(rust_req.kind, RequirementKind::PreferredSkill);
    }

    #[test]
    fn jd_parser_structured_jds_do_not_get_tech_noise() {
        // A JD whose sections already produced >= 4 requirements must not gain
        // dictionary duplicates.
        let extraction = parse_jd(SAMPLE_JD);
        let count = extraction.requirements.len();
        assert_eq!(count, 8, "structured JD extraction must stay stable");
        let typescript_free = extraction
            .requirements
            .iter()
            .all(|r| !r.raw_text.to_lowercase().contains("typescript"));
        assert!(typescript_free);
    }

    #[test]
    fn jd_parser_handles_ats_and_real_world_jd() {
        let text = r#"
General Information
Locations
: Hyderabad, Telangana, India 
Role ID
215939
Worker Type
Intern - Temporary Employee
Studio/Department
CT - IT
Work Model
Hybrid
Description & Requirements
Electronic Arts creates next-level entertainment experiences that inspire players and fans around the world. Here, everyone is part of the story. Part of a community that connects across the globe. A place where creativity thrives, new perspectives are invited, and ideas matter. A team where everyone makes play happen.

AI full stack Intern (Paid)
Electronic Arts
Hyderabad, India

Central Technology is the force multiplier, accelerating creative opportunity and progress at EA. We're a world-class community of technologists, innovators, strategists, and orchestrators transforming interactive entertainment. Together, we power platforms, AI-driven tools, live services, and infrastructure that ensure global scale, secure player experiences, and unlock bold new possibilities.

We are looking for a creative, AI Full Stack Engineer Intern to join our engineering team for paid internship. You will work at the intersection of modern full-stack web application development and the latest Generative AI technologies.

Responsibilities:

    You will Implement Agentic workflows, tool-calling capabilities, and LLM integrations using frameworks like Lang Chain, OpenAI APIs, and custom model endpoints.
    Explore latest Generative AI tools, model optimization techniques, and AI-assisted coding practices to boost team productivity and platform capabilities.
    You will develop responsive front-end components (React, TypeScript) and back-end APIs (Node.js, Python/Fast API).
    You will report to Senior Engineering Manager.

What we are looking for:

    Pursuing a bachelor's degree in computer science, Information Technology, or related field.
    Solid foundation in computer science fundamentals: data structures, algorithms, object-oriented/functional programming, and software design principles.
    Proficiency in at least one modern web development stack (e.g., React, TypeScript, JavaScript, HTML5/CSS3) and backend language (e.g., Python, Node.js, or Java).
    Hands-on academic or project experience incorporating machine learning, LLM APIs, or Generative AI tools.
    Familiarity with Git, RESTful APIs, and basic database design (SQL or NoSQL).
    Curiosity to learn new technologies.



About Electronic Arts
We’re proud to have an extensive portfolio of games and experiences, locations around the world, and opportunities across EA. We value adaptability, resilience, creativity, and curiosity. From leadership that brings out your potential, to creating space for learning and experimenting, we empower you to do great work and pursue opportunities for growth.

We adopt a holistic approach to our benefits programs, emphasizing physical, emotional, financial, career, and community wellness to support a balanced life. Our packages are tailored to meet local needs and may include healthcare coverage, mental well-being support, retirement savings, paid time off, family leaves, complimentary games, and more. We nurture environments where our teams can always bring their best to what they do.

Electronic Arts is an equal opportunity employer. All employment decisions are made without regard to race, color, national origin, ancestry, sex, gender, gender identity or expression, sexual orientation, age, genetic information, religion, disability, medical condition, pregnancy, marital status, family status, veteran status, or any other characteristic protected by law. We will also consider employment qualified applicants with criminal records in accordance with applicable law. EA also makes workplace accommodations for qualified individuals with disabilities as required by applicable law.
"#;

        let extraction = parse_jd(text);

        assert_eq!(extraction.company, "Electronic Arts");
        assert_eq!(extraction.role, "AI full stack Intern (Paid)");
        assert_eq!(extraction.seniority, "Internship");
        assert_eq!(extraction.domain, "AI/ML");

        // 4 Responsibilities + 6 Required Skills = 10 clean requirements
        let resp_count = extraction
            .requirements
            .iter()
            .filter(|r| r.kind == RequirementKind::Responsibility)
            .count();
        let req_count = extraction
            .requirements
            .iter()
            .filter(|r| r.kind == RequirementKind::RequiredSkill)
            .count();

        for r in &extraction.requirements {
            println!("EXTRACTED [{:?}]: {}", r.kind, r.raw_text);
        }

        assert_eq!(
            resp_count, 4,
            "Expected 4 responsibilities, got {resp_count}"
        );
        assert_eq!(req_count, 6, "Expected 6 required skills, got {req_count}");

        // Boilerplate, benefits, and EEO must NOT leak into requirements
        assert!(!extraction
            .requirements
            .iter()
            .any(|r| r.raw_text.to_lowercase().contains("benefits")));
        assert!(!extraction
            .requirements
            .iter()
            .any(|r| r.raw_text.to_lowercase().contains("equal opportunity")));
        assert!(!extraction
            .requirements
            .iter()
            .any(|r| r.raw_text.to_lowercase().contains("criminal")));
        assert!(!extraction
            .requirements
            .iter()
            .any(|r| r.raw_text.to_lowercase().contains("healthcare")));
        assert!(!extraction
            .requirements
            .iter()
            .any(|r| r.raw_text.to_lowercase().contains("portfolio of games")));
    }

    // --- Regression (v4): UTF-8 char-boundary panics ------------------------
    // The Jobs "paste a JD" path shared the import parser's byte-slicing bugs.

    #[test]
    fn jd_parser_handles_markdown_postings() {
        // Real-world shape (Chess.com): markdown-bold headings, "as a ..."
        // heading variants, nested bullet lists.
        let text = r#"
**Engineering Internship**

**About Us**

Chess.com is one of the largest gaming sites in the world and the #1 platform for playing, learning, and enjoying chess.

We are a tech company. A gaming company. A content company.

**About You**

Above all, you love chess and want to share it with the world! You also naturally resonate with a variable mix of the following qualities:

- Multidisciplinary: ability to switch between relevant subject matter with relative ease.
- Resilient: high tolerance for ambiguity during initial discovery phases in projects.
- Ability to simplify: absorb inherent complexity within your projects.
- Agile: able to maximize output and future-proof for further growth.
- Unorthodox thinker: find novel solutions to the limitations inherent in every technology.

**What you'll do as a Product Engineer Intern**

- Build features and optimize systems, scaling for a global top 100 website
- Contribute to technology, architecture, workflow, and design decisions
- Contribute to the team knowledge-base

**What you'll do as an AI/ML Intern**

- Optimize data preprocessing and feature engineering pipelines
- Develop, train, and deploy ML models, and integrate them into Chess.com products
- Build AI applications powered by LLMs

**Preferred Skills for All Internship Opportunities**

- Chess player
- Sense of ownership and responsibility
- Excellent communicator and team player
- Degree-seeking student currently enrolled at a college or university

**Preferred Skills for Product Engineer Intern**

- Training, relevant coursework or experience with:

* client side programming languages (HTML, CSS, Typescript, Swift, Kotlin)
* backend programming languages (Golang/Java/PHP preferred)
* web application frameworks
* relational databases (MySQL preferred)

**Preferred Skills for AI/ML Engineer Intern**

- Strong math foundation and understanding of traditional ML algorithms
- Training, relevant coursework or experience with:

* Python or another programming language (TypeScript/Go/Java preferred)
* ML libraries and frameworks such as scikit-learn or PyTorch
* LLMs/RAG/context engineering/evals/agentic patterns
* SQL (BigQuery, MySQL, Postgres, etc.)

**About the Opportunity**

- This is a full-time position
- We are 100% remote (work from anywhere!)
"#;

        let extraction = parse_jd(text);

        let resp = extraction
            .requirements
            .iter()
            .filter(|r| r.kind == RequirementKind::Responsibility)
            .count();
        let required = extraction
            .requirements
            .iter()
            .filter(|r| r.kind == RequirementKind::RequiredSkill)
            .count();
        let preferred = extraction
            .requirements
            .iter()
            .filter(|r| r.kind == RequirementKind::PreferredSkill)
            .count();

        assert!(resp >= 5, "responsibilities: {resp}");
        assert!(required >= 4, "required: {required}");
        assert!(preferred >= 8, "preferred: {preferred}");

        let names: Vec<String> = extraction
            .requirements
            .iter()
            .map(|r| r.raw_text.to_lowercase())
            .collect();
        assert!(names
            .iter()
            .any(|n| n.starts_with("build features and optimize systems")));
        assert!(names
            .iter()
            .any(|n| n.starts_with("optimize data preprocessing")));
        assert!(names.iter().any(|n| n.contains("chess player")));
        assert!(names.iter().any(|n| n.contains("sense of ownership")));
        assert!(names.iter().any(|n| n.contains("pytorch")));
        // Company copy under Skip headings must not leak in.
        assert!(!names.iter().any(|n| n.contains("600+ fully remote")));
        assert!(!names.iter().any(|n| n.contains("equal opportunity")));
        // The bulleted sub-heading line is a label, not a requirement.
        assert!(!names
            .iter()
            .any(|n| n.starts_with("training, relevant coursework")));
        // A bold title line is not a bullet.
        assert!(!names
            .iter()
            .any(|n| n.starts_with("engineering internship")));
    }

    #[test]
    fn jd_parser_survives_unspaced_dashes() {
        // `split_title_line`'s fallback used to slice inside the 3-byte dash.
        let text =
            "Requirements\nRust—Systems Engineer\n2024–2025 Program\n-Ownership of routing\n";
        let extraction = parse_jd(text);
        assert!(!extraction.requirements.is_empty());
    }

    #[test]
    fn jd_parser_labeled_values_are_boundary_safe() {
        let text =
            "Company: İstanbul Teknoloji\nRole Senior Systems Engineer\nRequirements\n- Rust\n";
        let extraction = parse_jd(text);
        assert_eq!(extraction.company, "İstanbul Teknoloji");
    }

    #[test]
    fn jd_split_at_marker_is_boundary_safe() {
        assert_eq!(
            split_at_marker("Lead at Acme at Scale"),
            Some(("Lead at Acme".to_string(), "Scale".to_string()))
        );
        // `İ` expands under to_lowercase(); the old rfind offset from the
        // lowercased copy sliced out of bounds here.
        assert_eq!(
            split_at_marker("İİ Mühendis at X"),
            Some(("İİ Mühendis".to_string(), "X".to_string()))
        );
        assert_eq!(split_at_marker("no marker"), None);
    }
}

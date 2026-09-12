//! Import candidate extraction (Phase 3 · spec §5.3).
//!
//! Pure functions only: nothing in this module touches the database. Extractors
//! produce *candidates* that stay transient until the user explicitly accepts
//! them through the normal Vault create commands.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

// ---------------------------------------------------------------------------
// Candidate models
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProfile {
    pub full_name: String,
    pub email: String,
    pub github: String,
    pub website: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDraft {
    pub title: String,
    pub description: String,
    pub skills: Vec<String>,
    pub source_snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExperienceDraft {
    pub organization: String,
    pub role: String,
    pub description: String,
    pub source_snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EducationDraft {
    pub institution: String,
    pub degree: String,
    pub field_of_study: String,
    pub source_snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CertificateCandidate {
    pub title: String,
    pub issuer: String,
    pub issue_date: Option<String>,
    pub email: String,
    pub source_snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubRepoCandidate {
    pub title: String,
    pub description: String,
    pub url: String,
    pub repo_url: String,
    pub start_date: Option<String>,
    pub skills: Vec<String>,
    pub source_preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeImport {
    pub profile: Option<ImportProfile>,
    pub projects: Vec<ProjectDraft>,
    pub experiences: Vec<ExperienceDraft>,
    pub education: Vec<EducationDraft>,
    pub skills: Vec<String>,
}

// ---------------------------------------------------------------------------
// Resume text parser
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq)]
enum Section {
    Projects,
    Experience,
    Education,
    Skills,
    Ignored,
}

fn detect_section(line: &str) -> Option<Section> {
    let cleaned: String = line
        .trim()
        .trim_start_matches(['#', '-', '*', '•', '·', '▪'])
        .trim()
        .trim_end_matches(':')
        .trim()
        .to_lowercase();
    match cleaned.as_str() {
        "projects" | "project" | "personal projects" | "key projects" | "selected projects" => {
            Some(Section::Projects)
        }
        "experience" | "work experience" | "professional experience" | "employment"
        | "employment history" | "internships" | "internship" => Some(Section::Experience),
        "education" => Some(Section::Education),
        "skills" | "technical skills" | "skills & technologies" | "technologies" | "tech stack"
        | "skills and tools" => Some(Section::Skills),
        "certifications" | "certificates" | "certifications & training" => Some(Section::Ignored),
        _ => None,
    }
}

const BULLETS: &[char] = &['-', '•', '·', '*', '▪', '◦'];

fn starts_with_bullet(line: &str) -> bool {
    let mut chars = line.chars();
    matches!(chars.next(), Some(c) if BULLETS.contains(&c))
}

/// Splits "Acme Corp — Software Engineer" style lines into a pair.
fn split_pair(line: &str) -> Option<(String, String)> {
    for sep in [" — ", " – ", " - ", " | ", ": "] {
        if let Some((a, b)) = line.split_once(sep) {
            let a = a.trim();
            let b = b.trim();
            if !a.is_empty() && !b.is_empty() {
                return Some((a.to_string(), b.to_string()));
            }
        }
    }
    if let Some(index) = line.find(['—', '–', '|']) {
        let a = line[..index].trim();
        let b = line[index + 1..].trim().trim_start_matches(['-', ' ']).trim();
        if !a.is_empty() && !b.is_empty() {
            return Some((a.to_string(), b.to_string()));
        }
    }
    None
}

fn looks_like_role_at_org(part: &str) -> Option<(String, String)> {
    let lower = part.to_lowercase();
    lower
        .find(" at ")
        .map(|i| (part[..i].trim().to_string(), part[i + 4..].trim().to_string()))
}

fn is_probable_name(line: &str) -> bool {
    let line = line.trim();
    if line.len() < 2 || line.len() > 48 || line.contains('@') || line.contains("http") {
        return false;
    }
    if line.chars().any(|c| c.is_ascii_digit()) {
        return false;
    }
    let lower = line.to_lowercase();
    if lower.contains("resume") || lower.contains("curriculum") {
        return false;
    }
    if detect_section(line).is_some() {
        return false;
    }
    let words: Vec<&str> = line.split_whitespace().collect();
    if words.len() > 4 {
        return false;
    }
    // A name line is Title Case or ALL CAPS; arbitrary sentences are lowercase.
    words.iter().all(|w| {
        let first = w.chars().next();
        match first {
            Some(c) => c.is_uppercase(),
            None => false,
        }
    })
}

fn first_email(text: &str) -> String {
    for word in text.split_whitespace() {
        let word = word.trim_matches(|c: char| matches!(c, '.' | ',' | ';' | ')' | '"' | '\''));
        if let Some(at) = word.find('@') {
            let (local, domain) = word.split_at(at);
            let domain = &domain[1..];
            let ok = !local.is_empty()
                && domain.contains('.')
                && word.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '@' | '.' | '_' | '+' | '-'))
                && domain.len() >= 4;
            if ok {
                return word.to_string();
            }
        }
    }
    String::new()
}

fn github_url(text: &str) -> String {
    for word in text.split_whitespace() {
        if let Some(i) = word.find("github.com/") {
            let mut end = i + "github.com/".len();
            let bytes = word.as_bytes();
            while end < bytes.len()
                && (bytes[end].is_ascii_alphanumeric()
                    || matches!(bytes[end], b'-' | b'_' | b'.' | b'/'))
            {
                end += 1;
            }
            let path = &word[i..end];
            // Keep only github.com/<user> (strip repo paths for the profile link).
            let user = path
                .trim_start_matches("github.com/")
                .split('/')
                .next()
                .unwrap_or_default();
            if !user.is_empty() {
                return format!("https://github.com/{user}");
            }
        }
    }
    String::new()
}

fn website_url(text: &str) -> String {
    for word in text.split_whitespace() {
        if (word.starts_with("https://") || word.starts_with("http://"))
            && !word.contains("github.com")
            && word.len() <= 120
        {
            return word.trim_end_matches(|c: char| matches!(c, '.' | ',' | ';')).to_string();
        }
    }
    String::new()
}

fn split_skills_line(line: &str, out: &mut Vec<String>, seen: &mut Vec<String>) {
    let cleaned = line.trim_start_matches(BULLETS).trim();
    for token in cleaned.split([',', ';', '|', '•', '·']) {
        let token = token.trim();
        let lower = token.to_lowercase();
        if token.is_empty()
            || token.len() > 40
            || token.contains('@')
            || token.split_whitespace().count() > 3
            || seen.contains(&lower)
        {
            continue;
        }
        seen.push(lower);
        out.push(token.to_string());
    }
}

pub fn parse_resume_text(text: &str) -> ResumeImport {
    let mut section: Option<Section> = None;

    let mut profile_name = String::new();
    let mut projects: Vec<ProjectDraft> = Vec::new();
    let mut experiences: Vec<ExperienceDraft> = Vec::new();
    let mut education: Vec<EducationDraft> = Vec::new();
    let mut skills: Vec<String> = Vec::new();
    let mut seen_skills: Vec<String> = Vec::new();

    let mut cur_project: Option<ProjectDraft> = None;
    let mut cur_experience: Option<ExperienceDraft> = None;
    let mut cur_education: Option<EducationDraft> = None;
    let mut snippet: Vec<String> = Vec::new();

    let mut first_line_checked = false;

    for raw in text.lines() {
        let line = raw.trim_end();
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if !first_line_checked {
            first_line_checked = true;
            if is_probable_name(trimmed) {
                profile_name = trimmed.to_string();
                continue;
            }
        }

        if let Some(next) = detect_section(trimmed) {
            if let Some(p) = cur_project.take() {
                projects.push(p);
            }
            if let Some(e) = cur_experience.take() {
                experiences.push(e);
            }
            if let Some(e) = cur_education.take() {
                education.push(e);
            }
            section = Some(next);
            continue;
        }

        let Some(sec) = section else { continue };

        match sec {
            Section::Skills => {
                split_skills_line(trimmed, &mut skills, &mut seen_skills);
            }
            Section::Projects => {
                let content = trimmed.trim_start_matches(BULLETS).trim();
                if starts_with_bullet(trimmed) {
                    if let Some(p) = cur_project.as_mut() {
                        if !p.description.is_empty() {
                            p.description.push('\n');
                        }
                        p.description.push_str(content);
                        snippet.push(line.to_string());
                    }
                } else {
                    if let Some(p) = cur_project.take() {
                        projects.push(p);
                    }
                    let (title, rest) = split_pair(content)
                        .unwrap_or((content.to_string(), String::new()));
                    cur_project = Some(ProjectDraft {
                        title,
                        description: rest,
                        skills: Vec::new(),
                        source_snippet: String::new(),
                    });
                    snippet = vec![line.to_string()];
                }
            }
            Section::Experience => {
                let content = trimmed.trim_start_matches(BULLETS).trim();
                if starts_with_bullet(trimmed) {
                    if let Some(e) = cur_experience.as_mut() {
                        if !e.description.is_empty() {
                            e.description.push('\n');
                        }
                        e.description.push_str(content);
                        snippet.push(line.to_string());
                    }
                } else {
                    if let Some(e) = cur_experience.take() {
                        experiences.push(e);
                    }
                    let (first, second) = split_pair(content)
                        .unwrap_or((content.to_string(), String::new()));
                    let (organization, role) = match looks_like_role_at_org(&first) {
                        Some((role, org)) => (org, role),
                        None => {
                            if second.is_empty() {
                                (first, String::new())
                            } else {
                                (first, second)
                            }
                        }
                    };
                    cur_experience = Some(ExperienceDraft {
                        organization,
                        role,
                        description: String::new(),
                        source_snippet: String::new(),
                    });
                    snippet = vec![line.to_string()];
                }
            }
            Section::Education => {
                let content = trimmed.trim_start_matches(BULLETS).trim();
                if starts_with_bullet(trimmed) {
                    if let Some(e) = cur_education.as_mut() {
                        // Education drafts carry no description; fold extras into degree.
                        e.degree.push(' ');
                        e.degree.push_str(content);
                        snippet.push(line.to_string());
                    }
                } else {
                    if let Some(e) = cur_education.take() {
                        education.push(e);
                    }
                    let (institution, second) = split_pair(content)
                        .unwrap_or((content.to_string(), String::new()));
                    // "B.Tech, CSE" style: degree and field separated by a comma.
                    let (degree, field) = match split_pair(&second) {
                        Some((degree, field)) => (degree, field),
                        None => match second.split_once(", ") {
                            Some((degree, field)) => (degree.to_string(), field.to_string()),
                            None => (second.clone(), String::new()),
                        },
                    };
                    cur_education = Some(EducationDraft {
                        institution,
                        degree,
                        field_of_study: field,
                        source_snippet: String::new(),
                    });
                    snippet = vec![line.to_string()];
                }
            }
            Section::Ignored => {}
        }
    }
    if let Some(p) = cur_project.take() {
        projects.push(p);
    }
    if let Some(e) = cur_experience.take() {
        experiences.push(e);
    }
    if let Some(e) = cur_education.take() {
        education.push(e);
    }

    // Attach snippets.
    for p in &mut projects {
        if p.source_snippet.is_empty() {
            p.source_snippet = snippet.clone().join("\n");
        }
    }

    let profile = if !profile_name.is_empty() || !first_email(text).is_empty() {
        Some(ImportProfile {
            full_name: profile_name,
            email: first_email(text),
            github: github_url(text),
            website: website_url(text),
        })
    } else {
        None
    };

    ResumeImport { profile, projects, experiences, education, skills }
}

// ---------------------------------------------------------------------------
// Certificate text parser
// ---------------------------------------------------------------------------

const MONTHS: &[(&str, &str, u8)] = &[
    ("jan", "january", 1),
    ("feb", "february", 2),
    ("mar", "march", 3),
    ("apr", "april", 4),
    ("may", "may", 5),
    ("jun", "june", 6),
    ("jul", "july", 7),
    ("aug", "august", 8),
    ("sep", "september", 9),
    ("oct", "october", 10),
    ("nov", "november", 11),
    ("dec", "december", 12),
];

fn extract_month_year(line: &str) -> Option<String> {
    let lower = line.to_lowercase();
    // ISO yyyy-mm anywhere in the line.
    let chars: Vec<char> = lower.chars().collect();
    if chars.len() >= 7 {
        for i in 0..=chars.len() - 7 {
            let window: String = chars[i..i + 7].iter().collect();
            let bytes = window.as_bytes();
            if bytes[0..4].iter().all(|c| c.is_ascii_digit())
                && bytes[4] == b'-'
                && bytes[5].is_ascii_digit()
                && bytes[6].is_ascii_digit()
            {
                let month: u8 = window[5..7].parse().unwrap_or(0);
                if (1..=12).contains(&month) {
                    return Some(format!("{}-{}", &window[0..4], &window[5..7]));
                }
            }
        }
    }

    // "March 2025" / "March 12, 2025" / "Mar '25" style — word-based scan.
    let words: Vec<String> = lower
        .split_whitespace()
        .map(|w| w.trim_matches(|c: char| matches!(c, ',' | '.' | ':' | ';' | '(' | ')')).to_string())
        .collect();
    for (i, word) in words.iter().enumerate() {
        let Some((_, _, num)) = MONTHS.iter().find(|(abbrev, full, _)| {
            word.as_str() == *full
                || word.as_str() == *abbrev
                || (word.starts_with(*abbrev)
                    && word[abbrev.len()..].chars().all(|c| !c.is_ascii_alphabetic()))
        }) else {
            continue;
        };
        for next in words.iter().skip(i + 1).take(2) {
            let digits: String = next.chars().filter(|c| c.is_ascii_digit()).collect();
            if digits.len() == 4 {
                let year: u32 = digits.parse().unwrap_or(0);
                if (1900..=2100).contains(&year) {
                    return Some(format!("{year}-{num:02}"));
                }
            }
        }
    }
    None
}

pub fn parse_certificate_text(text: &str) -> CertificateCandidate {
    let mut title = String::new();
    let mut issuer = String::new();
    let mut issue_date: Option<String> = None;
    let mut snippet: Vec<String> = Vec::new();

    // Pass 1: the specific "successfully completed" phrasing wins for titles.
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        let lower = line.to_lowercase();
        if let Some(i) = lower.find("has successfully completed") {
            let after = line[i + "has successfully completed".len()..]
                .trim()
                .trim_matches(|c: char| matches!(c, '"' | '\'' | '.' | ':' | ','))
                .trim_start_matches("the ")
                .trim_start_matches("a ")
                .trim();
            if !after.is_empty() {
                title = after.to_string();
                snippet.push(line.to_string());
                break;
            }
        }
    }

    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        let lower = line.to_lowercase();

        if title.is_empty() && (lower.contains("certificate of") || lower.contains("certificate for")) {
            title = line.trim_end_matches(|c: char| matches!(c, '.' | ':')).to_string();
            snippet.push(line.to_string());
            continue;
        }

        if issuer.is_empty() {
            for phrase in ["issued by", "presented by", "provided by", "authorized by", "offered by"] {
                if let Some(i) = lower.find(phrase) {
                    let after = line[i + phrase.len()..].trim().trim_start_matches(':');
                    if !after.is_empty() {
                        issuer = after.to_string();
                        snippet.push(line.to_string());
                    }
                    break;
                }
            }
        }

        if issue_date.is_none() {
            issue_date = extract_month_year(line);
        }

        if snippet.len() < 6 {
            snippet.push(line.to_string());
        }
    }

    // Fallback: the first meaningful line is the best title guess available.
    if title.is_empty() {
        for raw in text.lines() {
            let line = raw.trim();
            let lower = line.to_lowercase();
            if line.is_empty()
                || lower.starts_with("issued by")
                || extract_month_year(line).is_some() && line.len() < 12
                || line.contains('@')
            {
                continue;
            }
            title = line.trim_end_matches(|c: char| matches!(c, '.' | ':')).to_string();
            break;
        }
    }

    CertificateCandidate {
        title,
        issuer,
        issue_date,
        email: first_email(text),
        source_snippet: {
            let mut unique: Vec<String> = Vec::new();
            for line in snippet {
                if !unique.contains(&line) {
                    unique.push(line);
                }
            }
            unique.join("\n")
        },
    }
}

// ---------------------------------------------------------------------------
// GitHub repository import (public repos, unauthenticated API)
// ---------------------------------------------------------------------------

fn github_err(e: ureq::Error) -> String {
    match e {
        ureq::Error::Status(code, _) => format!(
            "GitHub returned HTTP {code} (404 = repository not found or private, 403 = rate limited)"
        ),
        other => format!("Network error: {other}"),
    }
}

pub fn github_repo_candidate(owner: &str, repo: &str) -> Result<GithubRepoCandidate, String> {
    let valid = |s: &str| {
        !s.is_empty()
            && s.len() <= 100
            && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    };
    if !valid(owner) || !valid(repo) {
        return Err("Repository names may only contain letters, digits, '.', '-' and '_'".to_string());
    }

    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(15))
        .user_agent("kairo-import")
        .build();

    let base = format!("https://api.github.com/repos/{owner}/{repo}");
    let meta: serde_json::Value = agent
        .get(&base)
        .set("Accept", "application/vnd.github+json")
        .call()
        .map_err(github_err)?
        .into_json()
        .map_err(|e| e.to_string())?;

    let mut languages: Vec<(String, u64)> = agent
        .get(&format!("{base}/languages"))
        .set("Accept", "application/vnd.github+json")
        .call()
        .map_err(github_err)?
        .into_json::<HashMap<String, u64>>()
        .map_err(|e| e.to_string())?
        .into_iter()
        .collect();
    languages.sort_by(|a, b| b.1.cmp(&a.1));

    let mut skills: Vec<String> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for (name, _) in &languages {
        let lower = name.to_lowercase();
        if !seen.contains(&lower) {
            seen.push(lower);
            skills.push(name.clone());
        }
    }
    if let Some(topics) = meta["topics"].as_array() {
        for topic in topics {
            if let Some(t) = topic.as_str() {
                let lower = t.to_lowercase();
                if !seen.contains(&lower) && skills.len() < 8 {
                    seen.push(lower);
                    skills.push(t.to_string());
                }
            }
        }
    }

    let description = meta["description"].as_str().unwrap_or_default().to_string();
    let repo_url = meta["html_url"].as_str().unwrap_or_default().to_string();
    let homepage = meta["homepage"].as_str().unwrap_or_default();
    let url = if homepage.starts_with("http") { homepage.to_string() } else { repo_url.clone() };
    let start_date = meta["created_at"]
        .as_str()
        .filter(|s| s.len() >= 7)
        .map(|s| s[..7].to_string());
    let title = meta["name"].as_str().unwrap_or(repo).to_string();

    let lang_list = languages.iter().map(|(n, _)| n.as_str()).collect::<Vec<_>>().join(", ");
    let source_preview = format!(
        "GET {base}\nRepository: {}/{}\nDescription: {description}\nLanguages: {lang_list}",
        meta["owner"]["full_name"].as_str().unwrap_or(owner),
        title,
    );

    Ok(GithubRepoCandidate { title, description, url, repo_url, start_date, skills, source_preview })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    const RESUME: &str = r#"
Jeswanth Sai
jeswanth@example.com
github.com/jeswanth

PROJECTS
PyKV — in-memory key-value store
- Implemented WAL persistence, TTL eviction and LRU caching
- Measured local benchmarks
Kairo — Rust career workspace with SQLite

EXPERIENCE
Acme Corp — Software Intern
- Built internal tooling in Python
Engineer at NextLabs
- Shipped REST APIs

EDUCATION
IIT Hyderabad — B.Tech, CSE

SKILLS
Python, Rust, SQL
Docker | Kubernetes
"#;

    #[test]
    fn resume_parser_extracts_all_sections() {
        let import = parse_resume_text(RESUME);

        assert_eq!(import.profile.as_ref().unwrap().full_name, "Jeswanth Sai");
        assert_eq!(import.profile.as_ref().unwrap().email, "jeswanth@example.com");
        assert_eq!(import.profile.as_ref().unwrap().github, "https://github.com/jeswanth");

        assert_eq!(import.projects.len(), 2);
        assert_eq!(import.projects[0].title, "PyKV");
        assert!(import.projects[0].description.contains("WAL persistence"));
        assert!(import.projects[0].description.contains("benchmarks"));
        assert_eq!(import.projects[1].title, "Kairo");

        assert_eq!(import.experiences.len(), 2);
        assert_eq!(import.experiences[0].organization, "Acme Corp");
        assert_eq!(import.experiences[0].role, "Software Intern");
        // "Engineer at NextLabs" -> role at org
        assert_eq!(import.experiences[1].organization, "NextLabs");
        assert_eq!(import.experiences[1].role, "Engineer");

        assert_eq!(import.education.len(), 1);
        assert_eq!(import.education[0].institution, "IIT Hyderabad");
        assert_eq!(import.education[0].degree, "B.Tech");
        assert_eq!(import.education[0].field_of_study, "CSE");

        assert_eq!(
            import.skills,
            vec!["Python", "Rust", "SQL", "Docker", "Kubernetes"]
        );
    }

    #[test]
    fn resume_parser_handles_plain_text_without_sections() {
        let import = parse_resume_text("just some text\nno structure here");
        assert!(import.projects.is_empty());
        assert!(import.profile.is_none() || import.profile.as_ref().unwrap().full_name.is_empty());
    }

    #[test]
    fn certificate_parser_extracts_fields() {
        let text = "Certificate of Completion\nThis certifies that jeswanth@example.com\n\
                    has successfully completed the Rust Fundamentals course\n\
                    issued by Coursera\nMarch 2025";
        let candidate = parse_certificate_text(text);
        assert_eq!(candidate.title, "Rust Fundamentals course");
        assert_eq!(candidate.issuer, "Coursera");
        assert_eq!(candidate.issue_date.as_deref(), Some("2025-03"));
        assert_eq!(candidate.email, "jeswanth@example.com");
        assert!(!candidate.source_snippet.is_empty());
    }

    #[test]
    fn certificate_parser_handles_iso_dates() {
        let candidate = parse_certificate_text("AWS Cloud Practitioner\nissued by Amazon\n2025-04-10");
        assert_eq!(candidate.title, "AWS Cloud Practitioner");
        assert_eq!(candidate.issue_date.as_deref(), Some("2025-04"));
    }

    #[test]
    fn github_name_validation() {
        // Pure validation path — no network call happens for bad names.
        assert!(github_repo_candidate("../etc", "passwd").is_err());
        assert!(github_repo_candidate("", "repo").is_err());
    }
}


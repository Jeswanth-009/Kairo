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
    pub headline: String,
    pub email: String,
    pub phone: String,
    pub github: String,
    pub website: String,
    pub linkedin: String,
    pub summary: String,
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
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub is_current: bool,
    pub location: String,
    pub source_snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EducationDraft {
    pub institution: String,
    pub degree: String,
    pub field_of_study: String,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub is_current: bool,
    pub source_snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AchievementDraft {
    pub title: String,
    pub issuer: String,
    pub description: String,
    pub achieved_on: Option<String>,
    pub source_snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDraft {
    pub name: String,
    pub category: String,
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
    pub achievements: Vec<AchievementDraft>,
    pub skills: Vec<SkillDraft>,
}

// ---------------------------------------------------------------------------
// Resume text parser
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq)]
enum Section {
    Summary,
    Projects,
    Experience,
    Education,
    Achievements,
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
        "summary" | "about" | "about me" | "objective" | "career objective"
        | "professional summary" | "profile summary" => Some(Section::Summary),
        "projects" | "project" | "personal projects" | "key projects" | "selected projects"
        | "projects & work" => Some(Section::Projects),
        "experience" | "work experience" | "professional experience" | "employment"
        | "employment history" | "internships" | "internship" | "work & experience"
        | "experience & work" => Some(Section::Experience),
        "education" => Some(Section::Education),
        "achievements" | "achievement" | "awards" | "honors" | "honours"
        | "awards & achievements" | "achievements & awards" | "accomplishments" => {
            Some(Section::Achievements)
        }
        "skills" | "technical skills" | "skills & technologies" | "technologies" | "tech stack"
        | "skills and tools" | "skills & tools" | "toolkit" | "technical expertise" => {
            Some(Section::Skills)
        }
        "certifications" | "certificates" | "certifications & training"
        | "contact" | "contact information" | "references"
        | "publications" | "hobbies" | "interests" | "courses" | "coursework"
        | "extracurricular" | "declaration" | "positions of responsibility"
        | "volunteer" | "volunteering" => Some(Section::Ignored),
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
    // Bare domains in the contact header ("jeswanth-portfolio.vercel.app")
    // carry no scheme; only scan the first lines so words like "B.Tech"
    // further down are never mistaken for URLs.
    for raw in text.lines().filter(|l| !l.trim().is_empty()).take(4) {
        for word in raw.split_whitespace() {
            let w = word.trim_matches(|c: char| matches!(c, '|' | ',' | ';' | '"' | '\''));
            if w.contains('@')
                || w.contains("://")
                || w.contains("github.com")
                || w.contains("linkedin.com")
            {
                continue;
            }
            let parts: Vec<&str> = w.split('.').collect();
            if parts.len() < 2 || parts.iter().any(|p| p.is_empty()) {
                continue;
            }
            let tld = parts[parts.len() - 1];
            let plausible = tld.len() >= 2
                && tld.chars().all(|c| c.is_ascii_alphabetic())
                && parts[0].len() >= 2
                && w.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-');
            if plausible {
                return format!("https://{w}");
            }
        }
    }
    String::new()
}

fn first_phone(text: &str) -> String {
    for line in text.lines().take(6) {
        for segment in line.split(['|', '•', '·', ';']) {
            let s = segment.trim();
            if s.contains('@') || s.contains("http") || s.contains(".com") || s.contains(".app") {
                continue;
            }
            let digits = s.chars().filter(|c| c.is_ascii_digit()).count();
            if (8..=15).contains(&digits)
                && s.chars().all(|c| c.is_ascii_digit() || matches!(c, '+' | '-' | ' ' | '(' | ')' | '.'))
            {
                return s.to_string();
            }
        }
    }
    String::new()
}

fn linkedin_url(text: &str) -> String {
    for word in text.split_whitespace() {
        if let Some(i) = word.find("linkedin.com/in/") {
            let mut end = i + "linkedin.com/in/".len();
            let bytes = word.as_bytes();
            while end < bytes.len()
                && (bytes[end].is_ascii_alphanumeric()
                    || matches!(bytes[end], b'-' | b'_' | b'.' | b'%'))
            {
                end += 1;
            }
            let path = &word[i..end];
            if path.ends_with('/') {
                continue;
            }
            return format!("https://{path}");
        }
    }
    String::new()
}

pub fn classify_skill_category(category_hint: Option<&str>, skill_name: &str) -> String {
    let lower_skill = skill_name.to_lowercase();
    let dict_cat = match lower_skill.as_str() {
        "rust" | "python" | "typescript" | "javascript" | "c++" | "c" | "java" | "go" | "golang"
        | "dart" | "sql" | "c#" | "php" | "ruby" | "swift" | "kotlin" | "html" | "css" | "bash"
        | "shell" | "r" | "scala" | "lua" => Some("language"),

        "tauri" | "react" | "next.js" | "node.js" | "fastapi" | "flask" | "django" | "express"
        | "vue" | "angular" | "svelte" | "flutter" | "tailwind css" | "tailwind" | "shadcn ui"
        | "bootstrap" | "spring" | "spring boot" | "asp.net" | "laravel" => Some("framework"),

        "sqlite" | "sqlite (wal)" | "postgresql" | "postgres" | "mongodb" | "mysql" | "redis"
        | "dynamodb" | "hive" | "cassandra" | "mariadb" | "oracle" | "couchdb" => Some("database"),

        "aws" | "amazon bedrock" | "amazon bedrock (nova lite)" | "bedrock" | "azure" | "gcp"
        | "google cloud" | "cloudflare" | "vercel" | "netlify" | "heroku" | "lambda"
        | "aws lambda" | "api gateway" => Some("cloud"),

        "docker" | "kubernetes" | "git" | "github" | "github actions" | "gitlab" | "linux"
        | "tectonic" | "terraform" | "ansible" | "jenkins" | "nginx" => Some("devops"),

        "pandas" | "numpy" | "scikit-learn" | "pytorch" | "tensorflow" | "keras" | "postman"
        | "figma" | "vite" | "webpack" => Some("tool"),

        _ => None,
    };

    if let Some(hint) = category_hint {
        let h = hint.to_lowercase();
        if h.contains("lang") {
            return "language".to_string();
        }
        if h.contains("framework") || h.contains("librar") {
            return "framework".to_string();
        }
        if h.contains("database") || h.contains("db") || h.contains("storage") {
            return "database".to_string();
        }
        if h.contains("cloud") {
            return "cloud".to_string();
        }
        if h.contains("devops") || h.contains("infra") || h.contains("ci/cd") {
            return "devops".to_string();
        }
        if h.contains("tool") || h.contains("platform") {
            // For general "Tools" heading, if dictionary knows it's cloud/db/devops, use dictionary
            if let Some(c) = dict_cat {
                return c.to_string();
            }
            return "tool".to_string();
        }
        if h.contains("data") || h.contains("ml") || h.contains("ai") {
            if let Some(c) = dict_cat {
                return c.to_string();
            }
            return "tool".to_string();
        }
        if h.contains("soft") || h.contains("competenc") {
            return "soft".to_string();
        }
    }

    if let Some(c) = dict_cat {
        return c.to_string();
    }

    "other".to_string()
}

fn split_skills_line(line: &str, out: &mut Vec<SkillDraft>, seen: &mut Vec<String>) {
    let mut cleaned = line.trim_start_matches(BULLETS).trim();
    let mut category_hint = None;
    if let Some(i) = cleaned.find(':') {
        let prefix = &cleaned[..i];
        if prefix.split_whitespace().count() <= 4 && !prefix.contains("//") {
            category_hint = Some(prefix.trim());
            let rest = cleaned[i + 1..].trim();
            if !rest.is_empty() {
                cleaned = rest;
            }
        }
    }
    let expanded = expand_parens(cleaned);
    for token in expanded.split([',', ';', '|', '•', '·']) {
        let token = token.trim();
        let lower = token.to_lowercase();
        if token.is_empty()
            || token.len() > 40
            || token.contains('@')
            || token.chars().next().is_some_and(|c| c.is_ascii_digit())
            || token.split_whitespace().count() > 4
            || seen.contains(&lower)
        {
            continue;
        }
        seen.push(lower);
        let category = classify_skill_category(category_hint, token);
        out.push(SkillDraft {
            name: token.to_string(),
            category,
        });
    }
}

/// "AWS (Lambda, API Gateway, DynamoDB)" -> "AWS,Lambda, API Gateway, DynamoDB"
/// so plain comma splitting sees clean tokens.
fn expand_parens(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    for ch in line.chars() {
        match ch {
            '(' => {
                if out.ends_with(' ') {
                    out.pop();
                }
                if !out.is_empty() && !out.ends_with(',') {
                    out.push(',');
                }
            }
            ')' => {}
            _ => out.push(ch),
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Heading-line helpers: dates, roles, degrees
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

fn extract_bare_year(text: &str) -> Option<String> {
    for word in text.split_whitespace() {
        let clean = word.trim_matches(|c: char| !c.is_ascii_digit());
        if is_year_word(clean) {
            let yr: u32 = clean.parse().unwrap_or(0);
            if (1900..=2100).contains(&yr) {
                return Some(format!("{yr}-01"));
            }
        }
    }
    None
}

fn extract_date_range(line: &str) -> (Option<String>, Option<String>, bool) {
    let lower = line.to_lowercase();
    let seps = [" – ", " — ", " - ", " to "];
    for sep in seps {
        if let Some((left, right)) = lower.split_once(sep) {
            let is_present = right.contains("present") || right.contains("current");
            let start = extract_month_year(left).or_else(|| extract_bare_year(left));
            let end = if is_present {
                None
            } else {
                extract_month_year(right).or_else(|| extract_bare_year(right))
            };
            if start.is_some() || end.is_some() || is_present {
                return (start, end, is_present);
            }
        }
    }
    let single = extract_month_year(&lower).or_else(|| extract_bare_year(&lower));
    (single, None, false)
}

fn extract_location(line: &str) -> (String, String) {
    let lower = line.to_lowercase();
    for suffix in ["remote", "hybrid", "on-site", "onsite", "wfh"] {
        if lower.ends_with(suffix) {
            let cut = line.len() - suffix.len();
            let base = line[..cut].trim().trim_end_matches([',', '-', '–', '|']).trim();
            let loc = match suffix {
                "remote" => "Remote",
                "hybrid" => "Hybrid",
                "wfh" => "WFH",
                _ => "On-site",
            };
            return (base.to_string(), loc.to_string());
        }
    }
    if let Some(i) = line.rfind(',') {
        let tail = line[i + 1..].trim();
        let before = line[..i].trim();
        if let Some(j) = before.rfind(|c: char| c == ',' || c == ' ' || c == '-' || c == '–') {
            let city = before[j + 1..].trim();
            let loc = format!("{city}, {tail}");
            let base = before[..j].trim().trim_end_matches([',', '-', '–', '|']).trim();
            if !base.is_empty() && base.split_whitespace().count() >= 2 {
                return (base.to_string(), loc);
            }
        }
    }
    (line.to_string(), String::new())
}

fn is_month_word(word: &str) -> bool {
    // Months appear capitalized in real headings ("February 2026") while the
    // table is lowercase — compare case-insensitively.
    let word = word.to_lowercase();
    MONTHS.iter().any(|(abbrev, full, _)| word == *abbrev || word == *full)
}

fn is_year_word(word: &str) -> bool {
    word.len() == 4 && word.chars().all(|c| c.is_ascii_digit())
}

const DATE_SEPARATORS: &[&str] = &["–", "—", "-", "to", "|", "·", "•"];

/// Removes trailing date ranges from heading lines so they never leak into
/// titles: "Infosys Springboard February 2026 – April 2026" keeps only the
/// organization. Handles "Month YYYY – Month YYYY", "Month YYYY", bare
/// "YYYY – YYYY" and "– Present".
fn strip_trailing_dates(line: &str) -> String {
    let mut words: Vec<&str> = line.split_whitespace().collect();
    loop {
        let n = words.len();
        if n == 0 {
            break;
        }
        let last = words[n - 1].trim_end_matches([',', '.', ';', ':']);
        if last.eq_ignore_ascii_case("present") {
            words.truncate(n - 1);
        } else if is_year_word(last) {
            let prev = if n >= 2 {
                words[n - 2].trim_end_matches([',', '.', ';', ':'])
            } else {
                ""
            };
            if is_month_word(prev) || is_year_word(prev) {
                words.truncate(n - 2);
            } else {
                words.truncate(n - 1);
                break;
            }
        } else {
            break;
        }
        while matches!(words.last(), Some(w) if DATE_SEPARATORS.contains(&w.to_lowercase().as_str()))
        {
            words.pop();
        }
    }
    words.join(" ")
}

const LOCATION_SUFFIXES: &[&str] = &["remote", "hybrid", "on-site", "onsite", "wfh"];

/// "Python Intern Remote" -> "Python Intern"; also drops a trailing
/// comma-separated place ("Project Intern Visakhapatnam, India").
fn strip_trailing_location(line: &str) -> String {
    let mut words: Vec<String> = line
        .split_whitespace()
        .map(|w| w.to_string())
        .collect();
    while matches!(words.last(), Some(w) if LOCATION_SUFFIXES.contains(&w.to_lowercase().as_str())) {
        words.pop();
    }
    let mut s = words.join(" ");
    if let Some(i) = s.rfind(',') {
        let tail = s[i + 1..].trim();
        let tail_words = tail.split_whitespace().count();
        if tail_words <= 2 && s[..i].trim().split_whitespace().count() >= 2 {
            s = s[..i].trim().to_string();
        }
    }
    s.trim_end_matches(',').trim().to_string()
}

fn looks_like_role_line(line: &str) -> bool {
    const ROLE_WORDS: &[&str] = &[
        "intern", "engineer", "developer", "manager", "analyst", "designer", "consultant",
        "associate", "architect", "scientist", "administrator", "director", "founder",
        "trainee", "fellow", "sde", "devops", "research", "teaching", "lead", "member",
    ];
    let lower = line.to_lowercase();
    ROLE_WORDS.iter().any(|w| lower.contains(w))
}

fn looks_like_degree(line: &str) -> bool {
    const DEGREE_WORDS: &[&str] = &[
        "bachelor", "master", "b.tech", "btech", "b.e", "m.tech", "mtech", "m.e", "ph.d", "phd",
        "diploma", "mba", "msc", "bsc", "bca", "mca", "associate", "high school", "secondary",
        "intermediate",
    ];
    let lower = line.trim_start_matches(['-', '•', '*', ' ']).to_lowercase();
    DEGREE_WORDS.iter().any(|w| lower.starts_with(w))
}

/// "Bachelor of Technology in Computer Science" -> ("Bachelor of Technology", "Computer Science")
fn split_degree_field(line: &str) -> (String, String) {
    let lower = line.to_lowercase();
    if let Some(i) = lower.find(" in ") {
        let degree = line[..i].trim();
        let field = line[i + 4..].trim();
        if !degree.is_empty() && !field.is_empty() {
            return (degree.to_string(), field.to_string());
        }
    }
    match line.split_once(", ") {
        Some((degree, field)) => (degree.to_string(), field.to_string()),
        None => (line.trim().to_string(), String::new()),
    }
}

fn clean_title(title: &str) -> String {
    title
        .trim_end_matches(['↗', '→', '⇗', '↑', '▲', '*'])
        .trim()
        .to_string()
}

/// A "Title | Rust, Tauri 2, React" tech stack is a skill list, not a
/// description: 2–8 short comma-separated tokens with no sentences.
fn tech_skill_list(rest: &str) -> Option<Vec<String>> {
    let tokens: Vec<String> = rest
        .split(',')
        .map(|t| t.trim().trim_end_matches(['.', ';']).to_string())
        .filter(|t| !t.is_empty())
        .collect();
    if tokens.len() < 2 || tokens.len() > 8 {
        return None;
    }
    if tokens
        .iter()
        .any(|t| t.chars().count() > 30 || t.split_whitespace().count() > 4 || t.contains('@'))
    {
        return None;
    }
    Some(tokens)
}

/// Lines made only of punctuation ("-----", "___") are layout, not content.
fn is_separator_line(line: &str) -> bool {
    !line.is_empty()
        && line.chars().any(|c| !matches!(c, ' ' | '\t'))
        && line
            .chars()
            .all(|c| matches!(c, '-' | '=' | '_' | '~' | '—' | '–' | '·' | '•' | '*' | '▪' | '.' | ' ' | '\t'))
}

pub fn parse_resume_text(text: &str) -> ResumeImport {
    let mut section: Option<Section> = None;

    let mut profile_name = String::new();
    let mut summary_lines: Vec<String> = Vec::new();
    let mut projects: Vec<ProjectDraft> = Vec::new();
    let mut experiences: Vec<ExperienceDraft> = Vec::new();
    let mut education: Vec<EducationDraft> = Vec::new();
    let mut achievements: Vec<AchievementDraft> = Vec::new();
    let mut skills: Vec<SkillDraft> = Vec::new();
    let mut seen_skills: Vec<String> = Vec::new();

    let mut cur_project: Option<ProjectDraft> = None;
    let mut cur_experience: Option<ExperienceDraft> = None;
    let mut cur_education: Option<EducationDraft> = None;
    let mut cur_achievement: Option<AchievementDraft> = None;
    let mut snippet: Vec<String> = Vec::new();

    let mut first_line_checked = false;

    for raw in text.lines() {
        let line = raw.trim_end();
        let trimmed = line.trim();
        if trimmed.is_empty() || is_separator_line(trimmed) {
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
            if let Some(mut p) = cur_project.take() {
                p.source_snippet = snippet.join("\n");
                projects.push(p);
            }
            if let Some(mut e) = cur_experience.take() {
                e.source_snippet = snippet.join("\n");
                experiences.push(e);
            }
            if let Some(mut e) = cur_education.take() {
                e.source_snippet = snippet.join("\n");
                education.push(e);
            }
            if let Some(mut a) = cur_achievement.take() {
                a.source_snippet = snippet.join("\n");
                achievements.push(a);
            }
            snippet.clear();
            section = Some(next);
            continue;
        }

        let Some(sec) = section else { continue };

        match sec {
            Section::Summary => {
                let content = trimmed.trim_start_matches(BULLETS).trim();
                if !content.is_empty() {
                    summary_lines.push(content.to_string());
                }
            }
            Section::Skills => {
                split_skills_line(trimmed, &mut skills, &mut seen_skills);
            }
            Section::Projects => {
                let content = trimmed.trim_start_matches(BULLETS).trim();
                let is_bullet = starts_with_bullet(trimmed);
                let has_separator = trimmed.contains('|') || trimmed.contains('↗') || trimmed.contains('→');
                let is_header = has_separator || cur_project.is_none();

                if is_bullet {
                    if let Some(p) = cur_project.as_mut() {
                        if !p.description.is_empty() {
                            p.description.push('\n');
                        }
                        p.description.push_str(content);
                        snippet.push(line.to_string());
                    }
                } else if !is_header && cur_project.as_ref().map_or(false, |p| !p.description.is_empty()) {
                    if let Some(p) = cur_project.as_mut() {
                        if !p.description.is_empty() {
                            p.description.push(' ');
                        }
                        p.description.push_str(trimmed);
                        snippet.push(line.to_string());
                    }
                } else {
                    if let Some(mut p) = cur_project.take() {
                        p.source_snippet = snippet.join("\n");
                        projects.push(p);
                    }
                    snippet = vec![line.to_string()];
                    let content = strip_trailing_dates(content);
                    let (title, rest) = split_pair(&content)
                        .unwrap_or((content.clone(), String::new()));
                    let title = clean_title(&title);
                    let (description, skills) = match tech_skill_list(&rest) {
                        Some(list) => (String::new(), list),
                        None => (rest, Vec::new()),
                    };
                    cur_project = Some(ProjectDraft {
                        title,
                        description,
                        skills,
                        source_snippet: String::new(),
                    });
                }
            }
            Section::Experience => {
                let content = trimmed.trim_start_matches(BULLETS).trim();
                let is_bullet = starts_with_bullet(trimmed);
                let (content_no_loc, loc) = extract_location(content);
                let (start_date, end_date, is_current) = extract_date_range(&content_no_loc);
                let clean_content = strip_trailing_dates(&content_no_loc);

                if is_bullet {
                    if let Some(e) = cur_experience.as_mut() {
                        if !e.description.is_empty() {
                            e.description.push('\n');
                        }
                        e.description.push_str(content);
                        snippet.push(line.to_string());
                    }
                } else if looks_like_role_line(&clean_content)
                    && cur_experience.as_ref().map_or(false, |e| e.role.is_empty() && e.description.is_empty())
                {
                    if let Some(e) = cur_experience.as_mut() {
                        e.role = clean_content;
                        if !loc.is_empty() && e.location.is_empty() {
                            e.location = loc;
                        }
                        if start_date.is_some() && e.start_date.is_none() {
                            e.start_date = start_date;
                            e.end_date = end_date;
                            e.is_current = is_current;
                        }
                        snippet.push(line.to_string());
                    }
                } else if cur_experience.as_ref().map_or(false, |e| !e.description.is_empty())
                    && start_date.is_none()
                    && !looks_like_role_line(&clean_content)
                    && (trimmed.chars().next().is_some_and(|c| c.is_lowercase())
                        || trimmed.starts_with("at ")
                        || trimmed.starts_with("vs."))
                {
                    if let Some(e) = cur_experience.as_mut() {
                        if !e.description.is_empty() {
                            e.description.push(' ');
                        }
                        e.description.push_str(content);
                        snippet.push(line.to_string());
                    }
                } else {
                    if let Some(mut e) = cur_experience.take() {
                        e.source_snippet = snippet.join("\n");
                        experiences.push(e);
                    }
                    snippet = vec![line.to_string()];
                    let (first, second) = split_pair(&clean_content)
                        .unwrap_or((clean_content.clone(), String::new()));
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
                        start_date,
                        end_date,
                        is_current,
                        location: loc,
                        source_snippet: String::new(),
                    });
                }
            }
            Section::Education => {
                let content = trimmed.trim_start_matches(BULLETS).trim();
                if starts_with_bullet(trimmed) {
                    if let Some(e) = cur_education.as_mut() {
                        e.degree.push(' ');
                        e.degree.push_str(content);
                        snippet.push(line.to_string());
                    }
                } else {
                    let (start_date, end_date, is_current) = extract_date_range(content);
                    let clean_content = strip_trailing_dates(content);
                    if looks_like_degree(&clean_content) {
                        if let Some(e) = cur_education.as_mut() {
                            if e.degree.is_empty() {
                                let (degree, field) = split_degree_field(&clean_content);
                                e.degree = degree;
                                e.field_of_study = field;
                                if start_date.is_some() && e.start_date.is_none() {
                                    e.start_date = start_date;
                                    e.end_date = end_date;
                                    e.is_current = is_current;
                                }
                                snippet.push(line.to_string());
                                continue;
                            }
                        }
                    }
                    if let Some(mut e) = cur_education.take() {
                        e.source_snippet = snippet.join("\n");
                        education.push(e);
                    }
                    snippet = vec![line.to_string()];
                    let (institution, second) = split_pair(&clean_content)
                        .unwrap_or((clean_content.clone(), String::new()));
                    let (degree, field) = match split_pair(&second) {
                        Some((degree, field)) => (degree, field),
                        None => split_degree_field(&second),
                    };
                    cur_education = Some(EducationDraft {
                        institution: strip_trailing_location(&institution),
                        degree,
                        field_of_study: field,
                        start_date,
                        end_date,
                        is_current,
                        source_snippet: String::new(),
                    });
                }
            }
            Section::Achievements => {
                let content = trimmed.trim_start_matches(BULLETS).trim();
                let is_bullet = starts_with_bullet(trimmed);
                let (date, _, _) = extract_date_range(content);
                let clean_content = strip_trailing_dates(content);
                let has_separator = clean_content.contains('|') || clean_content.contains('—') || clean_content.contains('–');

                if is_bullet {
                    if let Some(a) = cur_achievement.as_mut() {
                        if !a.description.is_empty() {
                            a.description.push('\n');
                        }
                        a.description.push_str(content);
                        snippet.push(line.to_string());
                    }
                } else if cur_achievement.as_ref().map_or(false, |a| !a.description.is_empty())
                    && (trimmed.chars().next().is_some_and(|c| c.is_lowercase()) || (!has_separator && date.is_none()))
                {
                    if let Some(a) = cur_achievement.as_mut() {
                        if !a.description.is_empty() {
                            a.description.push(' ');
                        }
                        a.description.push_str(content);
                        snippet.push(line.to_string());
                    }
                } else {
                    if let Some(mut a) = cur_achievement.take() {
                        a.source_snippet = snippet.join("\n");
                        achievements.push(a);
                    }
                    snippet = vec![line.to_string()];
                    let (first, second) = split_pair(&clean_content)
                        .unwrap_or((clean_content.clone(), String::new()));
                    let (title, issuer) = if second.is_empty() {
                        (clean_title(&first), String::new())
                    } else {
                        (clean_title(&first), second)
                    };
                    cur_achievement = Some(AchievementDraft {
                        title,
                        issuer,
                        description: String::new(),
                        achieved_on: date,
                        source_snippet: String::new(),
                    });
                }
            }
            Section::Ignored => {}
        }
    }
    if let Some(mut p) = cur_project.take() {
        p.source_snippet = snippet.join("\n");
        projects.push(p);
    }
    if let Some(mut e) = cur_experience.take() {
        e.source_snippet = snippet.join("\n");
        experiences.push(e);
    }
    if let Some(mut e) = cur_education.take() {
        e.source_snippet = snippet.join("\n");
        education.push(e);
    }
    if let Some(mut a) = cur_achievement.take() {
        a.source_snippet = snippet.join("\n");
        achievements.push(a);
    }

    let (headline, summary) = if !summary_lines.is_empty() {
        let first = &summary_lines[0];
        let headline = if first.len() <= 120 || first.contains('|') {
            first.clone()
        } else {
            String::new()
        };
        let full = summary_lines.join("\n");
        (headline, full)
    } else {
        (String::new(), String::new())
    };

    let phone = first_phone(text);
    let profile = if !profile_name.is_empty()
        || !first_email(text).is_empty()
        || !phone.is_empty()
        || !headline.is_empty()
    {
        Some(ImportProfile {
            full_name: profile_name,
            headline,
            email: first_email(text),
            phone,
            github: github_url(text),
            website: website_url(text),
            linkedin: linkedin_url(text),
            summary,
        })
    } else {
        None
    };

    ResumeImport {
        profile,
        projects,
        experiences,
        education,
        achievements,
        skills,
    }
}

// ---------------------------------------------------------------------------
// Certificate text parser
// ---------------------------------------------------------------------------


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
            import.skills.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(),
            vec!["Python", "Rust", "SQL", "Docker", "Kubernetes"]
        );
        assert_eq!(import.skills[0].category, "language");
        assert_eq!(import.skills[1].category, "language");
        assert_eq!(import.skills[3].category, "devops");
    }

    #[test]
    fn resume_parser_handles_plain_text_without_sections() {
        let import = parse_resume_text("just some text\nno structure here");
        assert!(import.projects.is_empty());
        assert!(import.profile.is_none() || import.profile.as_ref().unwrap().full_name.is_empty());
    }

    /// Regression test built from a real resume:
    /// phone extraction, summary, date ranges, location suffixes, achievements,
    /// and categorized skills.
    const MESSY_RESUME: &str = r#"Jeswanth Sai Kancharana
+91 9182452133 | jeswanth1811@gmail.com | linkedin.com/in/jeswanth-sai-k |
github.com/Jeswanth-009 | jeswanth-portfolio.vercel.app
Summary
Software Developer | GSoC '26 Eval Call (Apache) | HackAp '25 Winner | 1300+ Codeforces
Experience
Infosys Springboard February 2026 – April 2026
Python Intern Remote
• Engineered PyKV, an in-memory LRU cache engine with O(1) GET/SET
• Built automated benchmarking pipeline with 20-way concurrent load
BDL (Bharat Dynamics Limited) June 2025 – July 2025
Project Intern Visakhapatnam, India
• Reduced message delivery latency to <100ms with AES-256-GCM encryption
Projects
Kairo↗ | Rust, Tauri 2, TypeScript, React, SQLite (WAL), Tectonic
• Architected a local-first career workspace in Rust and Tauri 2
CodeSensei↗ | TypeScript, AWS Lambda, API Gateway, Amazon Bedrock (Nova Lite), DynamoDB
• Built a 4-layer Socratic reasoning pipeline
WatchDog↗ | Python, Flask, SQLite (WAL), psutil
• Built a user-space background daemon
Achievements
Google Summer of Code 2026 | Apache Software Foundation May 2026
• Received a direct evaluation call
HackAp Hackathon 2025 | Winner March 2025
• Secured 1st place
Skills
Languages: Rust, Python, TypeScript, JavaScript, C++, C, Java, Dart, SQL
Frameworks & Libraries: Tauri, FastAPI, Flask, Node.js, Next.js, React
Developer Tools: Docker, Git, GitHub Actions, AWS (Lambda, API Gateway, DynamoDB, Bedrock), Linux, Tectonic
Data & ML: Pandas, NumPy, Scikit-learn
Databases: SQLite (WAL), PostgreSQL, MongoDB, Hive
Education
Andhra University College Of Engineering Visakhapatnam, Andhra Pradesh
Bachelor of Technology in Computer Science & Systems Engineering September 2023 – May 2027
"#;

    #[test]
    fn resume_parser_handles_real_world_layout() {
        let import = parse_resume_text(MESSY_RESUME);

        // Profile: contact details and summary from header.
        let p = import.profile.as_ref().unwrap();
        assert_eq!(p.full_name, "Jeswanth Sai Kancharana");
        assert_eq!(p.email, "jeswanth1811@gmail.com");
        assert_eq!(p.phone, "+91 9182452133");
        assert_eq!(p.github, "https://github.com/Jeswanth-009");
        assert_eq!(p.linkedin, "https://linkedin.com/in/jeswanth-sai-k");
        assert_eq!(p.website, "https://jeswanth-portfolio.vercel.app");
        assert!(p.headline.contains("Software Developer"));
        assert!(p.summary.contains("Software Developer"));

        // Experience: two entries, dates & locations extracted.
        assert_eq!(import.experiences.len(), 2, "got {:?}", import.experiences);
        assert_eq!(import.experiences[0].organization, "Infosys Springboard");
        assert_eq!(import.experiences[0].role, "Python Intern");
        assert_eq!(import.experiences[0].location, "Remote");
        assert_eq!(import.experiences[0].start_date.as_deref(), Some("2026-02"));
        assert_eq!(import.experiences[0].end_date.as_deref(), Some("2026-04"));
        assert!(import.experiences[0].description.contains("PyKV"));

        assert_eq!(import.experiences[1].organization, "BDL (Bharat Dynamics Limited)");
        assert!(import.experiences[1].role.contains("Project Intern"));
        assert_eq!(import.experiences[1].start_date.as_deref(), Some("2025-06"));
        assert_eq!(import.experiences[1].end_date.as_deref(), Some("2025-07"));

        // Projects: three projects with arrows stripped and tech stacks as skills.
        assert_eq!(import.projects.len(), 3, "got {:?}", import.projects);
        assert_eq!(import.projects[0].title, "Kairo");
        assert!(import.projects[0].skills.contains(&"Rust".to_string()));
        assert!(import.projects[0].skills.contains(&"Tauri 2".to_string()));
        assert!(import.projects[0].skills.contains(&"SQLite (WAL)".to_string()));
        assert!(import.projects[0].description.contains("local-first career workspace"));
        assert_eq!(import.projects[1].title, "CodeSensei");
        assert!(import.projects[1].skills.contains(&"Amazon Bedrock (Nova Lite)".to_string()));
        assert_eq!(import.projects[2].title, "WatchDog");

        // Achievements: parsed into AchievementDraft candidates!
        assert_eq!(import.achievements.len(), 2, "got {:?}", import.achievements);
        assert_eq!(import.achievements[0].title, "Google Summer of Code 2026");
        assert_eq!(import.achievements[0].issuer, "Apache Software Foundation");
        assert_eq!(import.achievements[0].achieved_on.as_deref(), Some("2026-05"));
        assert!(import.achievements[0].description.contains("direct evaluation call"));
        assert_eq!(import.achievements[1].title, "HackAp Hackathon 2025");
        assert_eq!(import.achievements[1].achieved_on.as_deref(), Some("2025-03"));

        // Skills: categorized properly!
        let rust_skill = import.skills.iter().find(|s| s.name == "Rust").expect("Rust found");
        assert_eq!(rust_skill.category, "language");

        let react_skill = import.skills.iter().find(|s| s.name == "React").expect("React found");
        assert_eq!(react_skill.category, "framework");

        let sqlite_skill = import.skills.iter().find(|s| s.name.contains("SQLite")).expect("SQLite found");
        assert_eq!(sqlite_skill.category, "database");

        let docker_skill = import.skills.iter().find(|s| s.name == "Docker").expect("Docker found");
        assert!(docker_skill.category == "tool" || docker_skill.category == "devops");

        let pandas_skill = import.skills.iter().find(|s| s.name == "Pandas").expect("Pandas found");
        assert_eq!(pandas_skill.category, "tool");

        // Education: two-line header resolved into institution/degree/field and dates.
        assert_eq!(import.education.len(), 1, "got {:?}", import.education);
        assert!(import.education[0].institution.contains("Andhra University"));
        assert_eq!(import.education[0].degree, "Bachelor of Technology");
        assert_eq!(
            import.education[0].field_of_study,
            "Computer Science & Systems Engineering"
        );
        assert_eq!(import.education[0].start_date.as_deref(), Some("2023-09"));
        assert_eq!(import.education[0].end_date.as_deref(), Some("2027-05"));
    }

    #[test]
    fn date_stripping_and_location_suffixes() {
        assert_eq!(strip_trailing_dates("Infosys Springboard February 2026 – April 2026"), "Infosys Springboard");
        assert_eq!(strip_trailing_dates("Bachelor of Technology in CS September 2023 – May 2027"), "Bachelor of Technology in CS");
        assert_eq!(strip_trailing_dates("Role May 2026 – Present"), "Role");
        assert_eq!(strip_trailing_dates("Kairo 2025"), "Kairo");
        assert_eq!(strip_trailing_dates("No dates here"), "No dates here");
        assert_eq!(strip_trailing_location("Python Intern Remote"), "Python Intern");
        assert_eq!(strip_trailing_location("Project Intern Visakhapatnam, India"), "Project Intern Visakhapatnam");
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


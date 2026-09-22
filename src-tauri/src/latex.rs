//! LaTeX rendering (Phase 9 · spec §9.1). Pure and deterministic: the plan is
//! the only input, every user string is escaped, and the LLM is never involved
//! — the renderer owns all document structure.

use crate::composer::{effective_bullets, PlanItem, ResumePlan};

/// Escapes LaTeX special characters and normalizes the Unicode characters
/// that Latin Modern has no text-mode glyph for (arrows, typographic quotes,
/// soft hyphens, …). Backslash first, then the rest.
pub fn escape_latex(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 16);
    for c in text.chars() {
        match c {
            '\\' => out.push_str("\\textbackslash{}"),
            '&'  => out.push_str("\\&"),
            '%'  => out.push_str("\\%"),
            '$'  => out.push_str("\\$"),
            '#'  => out.push_str("\\#"),
            '_'  => out.push_str("\\_"),
            '{'  => out.push_str("\\{"),
            '}'  => out.push_str("\\}"),
            '~'  => out.push_str("\\textasciitilde{}"),
            '^'  => out.push_str("\\textasciicircum{}"),
            '\n' => out.push_str("\\par "),
            // Dropped: they leak in from copy-pasted text and confuse hyphenation.
            '\u{00AD}' | '\u{FFFE}' | '\u{FFFF}' | '\u{200B}' => {}
            '\u{00A0}' => out.push(' '),
            // Typographic punctuation with no text-mode glyph in Latin Modern.
            '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{201B}' => out.push('\''),
            '\u{201C}' | '\u{201D}' | '\u{201E}' | '\u{201F}' => out.push('"'),
            '\u{2013}' => out.push_str("--"),
            '\u{2014}' => out.push_str("---"),
            '\u{2026}' => out.push_str("\\ldots{}"),
            '\u{2022}' => out.push_str("\\textbullet{}"),
            '\u{2192}' => out.push_str("$\\rightarrow$"),
            '\u{2190}' => out.push_str("$\\leftarrow$"),
            '\u{21D2}' => out.push_str("$\\Rightarrow$"),
            '\u{2264}' => out.push_str("$\\leq$"),
            '\u{2265}' => out.push_str("$\\geq$"),
            '\u{00D7}' => out.push_str("$\\times$"),
            // Greek letters have no text-mode glyph in Latin Modern; math mode
            // renders them correctly.
            '\u{03B1}' => out.push_str("$\\alpha$"),
            '\u{03B2}' => out.push_str("$\\beta$"),
            '\u{03B3}' => out.push_str("$\\gamma$"),
            '\u{03B4}' => out.push_str("$\\delta$"),
            '\u{03B5}' => out.push_str("$\\epsilon$"),
            '\u{03B8}' => out.push_str("$\\theta$"),
            '\u{03BB}' => out.push_str("$\\lambda$"),
            '\u{03BC}' => out.push_str("$\\mu$"),
            '\u{03C0}' => out.push_str("$\\pi$"),
            '\u{03C1}' => out.push_str("$\\rho$"),
            '\u{03C3}' => out.push_str("$\\sigma$"),
            '\u{03C4}' => out.push_str("$\\tau$"),
            '\u{03C6}' => out.push_str("$\\phi$"),
            '\u{03C9}' => out.push_str("$\\omega$"),
            '\u{0393}' => out.push_str("$\\Gamma$"),
            '\u{0394}' => out.push_str("$\\Delta$"),
            '\u{03A0}' => out.push_str("$\\Pi$"),
            '\u{03A3}' => out.push_str("$\\Sigma$"),
            '\u{03A9}' => out.push_str("$\\Omega$"),
            c if (c as u32) < 32 => { /* strip other control characters */ }
            c    => out.push(c),
        }
    }
    out
}

/// Collapses whitespace runs (incl. newlines) to single spaces.
fn inline(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Prepares a raw URL for a hyperref `\href{...}` target. Display text is
/// escaped separately; the target must stay raw but percent-encode the few
/// characters that would otherwise end the argument or start a comment
/// (`%`, `#`, braces, backslash, spaces). `_`, `&`, `~`, `$` are safe inside
/// hyperref's verbatim-style URL catcodes — escaping them (as display text
/// needs) corrupts the link target.
fn latex_url(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len() + 8);
    for c in raw.trim().chars() {
        match c {
            '%' => out.push_str("%25"),
            '#' => out.push_str("%23"),
            ' ' => out.push_str("%20"),
            '{' => out.push_str("%7B"),
            '}' => out.push_str("%7D"),
            '\\' => out.push_str("%5C"),
            c => out.push(c),
        }
    }
    out
}

/// Builds a complete hyperref link: raw/percent-encoded target, escaped text.
fn latex_href(url: &str, display: &str, underline: bool) -> String {
    let text = escape_latex(display);
    if underline {
        format!("\\href{{{}}}{{\\underline{{{}}}}}", latex_url(url), text)
    } else {
        format!("\\href{{{}}}{{{}}}", latex_url(url), text)
    }
}

const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/// "2022-08" / "2022-08-14" / "2022" → "Aug 2022" / "2022". Unparseable input
/// is passed through untouched.
fn pretty_date(v: &str) -> String {
    let v = v.trim();
    if v.is_empty() {
        return String::new();
    }
    let parts: Vec<&str> = v.split('-').collect();
    match parts.as_slice() {
        [y] if y.len() == 4 => (*y).to_string(),
        [y, m] if y.len() == 4 => {
            if let Some(name) = month_name(m) {
                format!("{name} {y}")
            } else {
                v.to_string()
            }
        }
        [y, m, _d] if y.len() == 4 => {
            if let Some(name) = month_name(m) {
                format!("{name} {y}")
            } else {
                v.to_string()
            }
        }
        _ => v.to_string(),
    }
}

fn month_name(m: &str) -> Option<&'static str> {
    m.parse::<usize>().ok().and_then(|n| MONTHS.get(n.wrapping_sub(1))).copied()
}

/// Renders a stored date range the way resumes are read: "Aug 2022 – May 2026",
/// "Jun 2025 – Present". Empty sides are dropped rather than printed as "--".
fn fmt_dates(start: &Option<String>, end: &Option<String>, current: bool) -> String {
    let s = pretty_date(start.as_deref().unwrap_or(""));
    let e = pretty_date(end.as_deref().unwrap_or(""));
    if current {
        if s.is_empty() {
            "Present".to_string()
        } else {
            format!("{s} -- Present")
        }
    } else {
        match (s.is_empty(), e.is_empty()) {
            (false, false) => format!("{s} -- {e}"),
            (false, true)  => s,
            (true, false)  => e,
            (true, true)   => String::new(),
        }
    }
}

/// Splits "Org — Role" (the format used by db/composer.rs assemble()) into
/// (escaped_org, escaped_role). Falls back to (full_title, "") if no " — "
/// separator is present.
fn split_title_role(title: &str) -> (String, String) {
    if let Some(idx) = title.find(" \u{2014} ") {
        let org  = escape_latex(&inline(&title[..idx]));
        let role = escape_latex(&inline(&title[idx + 4..])); // 4 bytes for " — "
        (org, role)
    } else if let Some(idx) = title.find(" - ") {
        let org  = escape_latex(&inline(&title[..idx]));
        let role = escape_latex(&inline(&title[idx + 3..]));
        (org, role)
    } else {
        (escape_latex(&inline(title)), String::new())
    }
}

fn paper_class(plan: &ResumePlan) -> &'static str {
    if plan.config.paper.eq_ignore_ascii_case("a4") {
        "a4paper"
    } else {
        "letterpaper"
    }
}

/// Substitutes the paper token in a preamble.
fn preamble(template: &str, plan: &ResumePlan) -> String {
    template.replace("__PAPER__", paper_class(plan))
}

/// The bullet lines that render for an item, escaped and inlined. Falls back
/// to the description's newline-separated lines when the plan has no included
/// bullets (plans composed before canonical bullets existed).
fn item_bullet_lines(item: &PlanItem) -> Vec<String> {
    effective_bullets(item)
        .into_iter()
        .map(|t| escape_latex(&inline(&t)))
        .filter(|t| !t.is_empty())
        .collect()
}

/// Renders the approved plan into the chosen LaTeX template.
pub fn render_plan(plan: &ResumePlan, template_id: &str) -> String {
    match template_id {
        "expressive" => render_expressive(plan),
        "plushcv"    => render_plushcv(plan),
        _            => render_jake(plan), // "jake" or any unknown → Jake (ATS-safe default)
    }
}

// ---------------------------------------------------------------------------
// Shared: grouped skills (category → pretty rows), flat fallback
// ---------------------------------------------------------------------------

fn skill_groups(plan: &ResumePlan) -> Vec<(String, Vec<String>)> {
    let included: Vec<String> = plan
        .skills
        .iter()
        .filter(|s| !plan.excluded_skills.contains(s))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if included.is_empty() {
        return Vec::new();
    }
    let included_lc: Vec<String> = included.iter().map(|s| s.to_lowercase()).collect();
    let mut groups: Vec<(String, Vec<String>)> = plan
        .skills_grouped
        .iter()
        .map(|g| {
            (
                g.category.clone(),
                g.skills
                    .iter()
                    .filter(|s| included_lc.contains(&s.to_lowercase()))
                    .cloned()
                    .collect::<Vec<String>>(),
            )
        })
        .filter(|(_, names)| !names.is_empty())
        .collect();
    if groups.is_empty() {
        groups.push(("Skills".to_string(), included));
    }
    groups
}

// ---------------------------------------------------------------------------
// Jake template renderer
// ---------------------------------------------------------------------------

fn render_jake(plan: &ResumePlan) -> String {
    let mut tex = String::with_capacity(6000);
    tex.push_str(&preamble(crate::latex_templates::JAKE_PREAMBLE, plan));
    tex.push_str("\n\\begin{document}\n\n");

    // --- Heading ---
    let name = escape_latex(&inline(if plan.header.full_name.is_empty() { "Your Name" } else { &plan.header.full_name }));
    let mut contact_parts: Vec<String> = Vec::new();
    if !plan.header.phone.is_empty() {
        contact_parts.push(escape_latex(&plan.header.phone));
    }
    if !plan.header.email.is_empty() {
        let email = plan.header.email.trim();
        contact_parts.push(latex_href(&format!("mailto:{email}"), email, true));
    }
    if !plan.header.linkedin.is_empty() {
        let raw = plan.header.linkedin
            .trim_start_matches("https://www.linkedin.com/in/")
            .trim_start_matches("https://linkedin.com/in/")
            .trim_end_matches('/');
        contact_parts.push(latex_href(&plan.header.linkedin, &format!("linkedin.com/in/{raw}"), true));
    }
    if !plan.header.github.is_empty() {
        let raw = plan.header.github
            .trim_start_matches("https://www.github.com/")
            .trim_start_matches("https://github.com/")
            .trim_end_matches('/');
        contact_parts.push(latex_href(&plan.header.github, &format!("github.com/{raw}"), true));
    }
    if !plan.header.website.is_empty() {
        let raw = plan.header.website
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .trim_end_matches('/');
        contact_parts.push(latex_href(&plan.header.website, raw, true));
    }
    if !plan.header.location.is_empty() {
        contact_parts.push(escape_latex(&plan.header.location));
    }
    tex.push_str("\\begin{center}\n");
    tex.push_str(&format!("    \\textbf{{\\Huge \\scshape {}}} \\\\ \\vspace{{1pt}}\n", name));
    if !contact_parts.is_empty() {
        tex.push_str(&format!("    \\small {}\n", contact_parts.join(" $|$ ")));
    }
    tex.push_str("\\end{center}\n\n");

    // --- Education ---
    if !plan.education.is_empty() {
        tex.push_str("%-----------EDUCATION-----------\n\\needspace{4\\baselineskip}\n\\section{Education}\n  \\resumeSubHeadingListStart\n");
        for e in &plan.education {
            let inst = escape_latex(&inline(&e.institution));
            let degree_field = [e.degree.clone(), e.field_of_study.clone()]
                .iter()
                .filter(|s| !s.is_empty())
                .map(|s| escape_latex(&inline(s)))
                .collect::<Vec<_>>()
                .join(", ");
            let dates = escape_latex(&fmt_dates(&e.start_date, &e.end_date, e.is_current));
            // Jake: \resumeSubheading{Institution}{Location}{Degree}{Dates}
            tex.push_str("    \\needspace{3\\baselineskip}\n");
            tex.push_str(&format!(
                "    \\resumeSubheading\n      {{{}}}{{}}\n      {{{}}}{{{}}}\n",
                inst, degree_field, dates
            ));
        }
        tex.push_str("  \\resumeSubHeadingListEnd\n\n");
    }

    // --- Experience ---
    // item.title = "Org — Role", item.subtitle = location (set by db/composer.rs assemble())
    let exp: Vec<&PlanItem> = plan.experience.iter().filter(|i| !i.excluded).collect();
    if !exp.is_empty() {
        tex.push_str("%-----------EXPERIENCE-----------\n\\needspace{4\\baselineskip}\n\\section{Experience}\n  \\resumeSubHeadingListStart\n\n");
        for item in exp {
            let (company, role) = split_title_role(&item.title);
            let loc = escape_latex(&inline(&item.subtitle));
            let dates = escape_latex(&fmt_dates(&item.start_date, &item.end_date, item.is_current));
            // Jake: \resumeSubheading{Company}{Dates}{Role}{Location}
            tex.push_str("    \\needspace{3\\baselineskip}\n");
            tex.push_str(&format!(
                "    \\resumeSubheading\n      {{{}}}{{{}}}\n      {{{}}}{{{}}}\n",
                company, dates, role, loc
            ));
            push_jake_items(&mut tex, item, "      ");
        }
        tex.push_str("  \\resumeSubHeadingListEnd\n\n");
    }

    // --- Projects ---
    let proj: Vec<&PlanItem> = plan.projects.iter().filter(|i| !i.excluded).collect();
    if !proj.is_empty() {
        tex.push_str("%-----------PROJECTS-----------\n\\needspace{4\\baselineskip}\n\\section{Projects}\n    \\resumeSubHeadingListStart\n");
        for item in proj {
            let title = escape_latex(&inline(&item.title));
            let tech_str = if !item.skills.is_empty() {
                format!(" $|$ \\emph{{{}}}", escape_latex(&item.skills.join(", ")))
            } else {
                String::new()
            };
            let dates = escape_latex(&fmt_dates(&item.start_date, &item.end_date, item.is_current));
            tex.push_str("      \\needspace{3\\baselineskip}\n");
            tex.push_str(&format!(
                "      \\resumeProjectHeading\n          {{\\textbf{{{}}}{}}}{{{}}}\n",
                title, tech_str, dates
            ));
            push_jake_items(&mut tex, item, "          ");
        }
        tex.push_str("    \\resumeSubHeadingListEnd\n\n");
    }

    // --- Achievements ---
    let ach: Vec<_> = plan.achievements.iter().filter(|a| !a.excluded).collect();
    if !ach.is_empty() {
        tex.push_str("%-----------ACHIEVEMENTS-----------\n\\needspace{4\\baselineskip}\n\\section{Achievements \\& Awards}\n  \\resumeSubHeadingListStart\n");
        for a in ach {
            let title = escape_latex(&inline(&a.title));
            let issuer = escape_latex(&inline(&a.issuer));
            let date = escape_latex(&pretty_date(a.achieved_on.as_deref().unwrap_or("")));
            let tech_str = if !issuer.is_empty() {
                format!(" $|$ \\emph{{{}}}", issuer)
            } else {
                String::new()
            };
            tex.push_str("    \\needspace{3\\baselineskip}\n");
            tex.push_str(&format!(
                "    \\resumeProjectHeading\n        {{\\textbf{{{}}}{}}}{{{}}}\n",
                title, tech_str, date
            ));
            if !a.description.is_empty() {
                tex.push_str("        \\resumeItemListStart\n");
                tex.push_str(&format!("          \\resumeItem{{{}}}\n", escape_latex(&inline(&a.description))));
                tex.push_str("        \\resumeItemListEnd\n");
            }
        }
        tex.push_str("  \\resumeSubHeadingListEnd\n\n");
    }

    // --- Skills (grouped by category, Jakegut-style rows) ---
    let groups = skill_groups(plan);
    if !groups.is_empty() {
        tex.push_str("%-----------TECHNICAL SKILLS-----------\n\\needspace{4\\baselineskip}\n\\section{Technical Skills}\n");
        tex.push_str(" \\begin{itemize}[leftmargin=0.15in, label={}]\n    \\small{\\item{\n");
        let rows: Vec<String> = groups
            .iter()
            .map(|(cat, names)| {
                format!(
                    "     \\textbf{{{}}}{{: {}}} \\\\",
                    escape_latex(cat),
                    names.iter().map(|s| escape_latex(&inline(s))).collect::<Vec<_>>().join(", ")
                )
            })
            .collect();
        tex.push_str(&rows.join("\n"));
        tex.push_str("\n    }}\n \\end{itemize}\n\n");
    }

    tex.push_str("%-------------------------------------------\n\\end{document}\n");
    tex
}

/// Emits the item list for a Jake experience/project entry. Entries with
/// neither bullets nor a description render as a bare heading (no empty
/// itemize, which XeTeX treats as an error).
fn push_jake_items(tex: &mut String, item: &PlanItem, indent: &str) {
    let lines = item_bullet_lines(item);
    if lines.is_empty() {
        return;
    }
    tex.push_str(&format!("{indent}\\resumeItemListStart\n"));
    for text in lines {
        tex.push_str(&format!("{indent}  \\resumeItem{{{}}}\n", text));
    }
    tex.push_str(&format!("{indent}\\resumeItemListEnd\n\n"));
}

// ---------------------------------------------------------------------------
// Expressive template renderer
// ---------------------------------------------------------------------------

fn render_expressive(plan: &ResumePlan) -> String {
    let mut tex = String::with_capacity(6000);
    tex.push_str(&preamble(crate::latex_templates::EXPRESSIVE_PREAMBLE, plan));
    tex.push_str("\n\\begin{document}\n\n");

    // Header: pre-built contact line with properly linked entries.
    let name = escape_latex(&inline(if plan.header.full_name.is_empty() { "Your Name" } else { &plan.header.full_name }));
    let mut contact_parts: Vec<String> = Vec::new();
    if !plan.header.email.is_empty() {
        contact_parts.push(latex_href(&format!("mailto:{}", plan.header.email.trim()), plan.header.email.trim(), false));
    }
    if !plan.header.linkedin.is_empty() {
        let raw = plan.header.linkedin
            .trim_start_matches("https://www.linkedin.com/in/")
            .trim_start_matches("https://linkedin.com/in/")
            .trim_end_matches('/');
        contact_parts.push(latex_href(&plan.header.linkedin, &format!("linkedin.com/in/{raw}"), false));
    }
    if !plan.header.github.is_empty() {
        let raw = plan.header.github
            .trim_start_matches("https://www.github.com/")
            .trim_start_matches("https://github.com/")
            .trim_end_matches('/');
        contact_parts.push(latex_href(&plan.header.github, &format!("github.com/{raw}"), false));
    }
    if !plan.header.phone.is_empty() {
        contact_parts.push(escape_latex(&plan.header.phone));
    }
    if !plan.header.location.is_empty() {
        contact_parts.push(escape_latex(&plan.header.location));
    }
    tex.push_str(&format!(
        "\\resumeheader{{{}}}{{{}}}\n\n",
        name,
        contact_parts.join(" \\quad|\\quad ")
    ));

    // Objective / headline
    if !plan.header.headline.is_empty() {
        tex.push_str(&format!(
            "\\objective{{{}}}\n\n",
            escape_latex(&inline(&plan.header.headline))
        ));
    }

    // Experience
    let exp: Vec<&PlanItem> = plan.experience.iter().filter(|i| !i.excluded).collect();
    if !exp.is_empty() {
        tex.push_str("\\section{Work Experience}\n\n");
        for item in exp {
            let (company, role) = split_title_role(&item.title);
            let loc    = escape_latex(&inline(&item.subtitle));
            let dates  = escape_latex(&fmt_dates(&item.start_date, &item.end_date, item.is_current));
            let lines = item_bullet_lines(item);
            if lines.is_empty() {
                // No itemize: keep the two heading lines readable without it.
                tex.push_str(&format!(
                    "{{\\bfseries\\large {}}}\\hfill{{\\small {}}}\\par\n",
                    company, loc
                ));
                if !role.is_empty() {
                    tex.push_str(&format!(
                        "\\vspace{{2pt}}{{\\bfseries {}}}\\hfill{{\\small\\itshape {}}}\\par\\vspace{{4pt}}\n",
                        role, dates
                    ));
                }
                continue;
            }
            tex.push_str(&format!("\\experience{{{}}}{{{}}}{{\n", company, loc));
            tex.push_str(&format!("    \\role{{{}}}{{{}}}{{\n", role, dates));
            for text in lines {
                tex.push_str(&format!("        \\achievement{{{}}}\n", text));
            }
            tex.push_str("    }\n}\n\n");
        }
    }

    // Projects
    let proj: Vec<&PlanItem> = plan.projects.iter().filter(|i| !i.excluded).collect();
    if !proj.is_empty() {
        tex.push_str("\\section{Technical Projects}\n\n");
        for item in proj {
            let title = escape_latex(&inline(&item.title));
            let dates = escape_latex(&fmt_dates(&item.start_date, &item.end_date, item.is_current));
            let lines = item_bullet_lines(item);
            if lines.is_empty() {
                tex.push_str(&format!(
                    "\\vspace{{2pt}}{{\\bfseries {}}}\\hfill{{\\small\\itshape {}}}\\par\\vspace{{4pt}}\n",
                    title, dates
                ));
                continue;
            }
            tex.push_str(&format!("\\project{{{}}}{{{}}}{{\n", title, dates));
            for text in lines {
                tex.push_str(&format!("    \\achievement{{{}}}\n", text));
            }
            tex.push_str("}\n\n");
        }
    }

    // Education
    if !plan.education.is_empty() {
        tex.push_str("\\section{Education}\n\n");
        for e in &plan.education {
            let inst = escape_latex(&inline(&e.institution));
            let degree_field = [e.degree.clone(), e.field_of_study.clone()]
                .iter()
                .filter(|s| !s.is_empty())
                .map(|s| escape_latex(&inline(s)))
                .collect::<Vec<_>>()
                .join(", ");
            let dates = fmt_dates(&e.start_date, &e.end_date, e.is_current);
            // Degree + dates on one row, institution on its own line — long
            // institution names must never push the date into a mid-range wrap.
            tex.push_str(&format!(
                "\\needspace{{3\\baselineskip}}\n\\vspace{{2pt}}{{\\bfseries {}}}\\hfill{{\\small\\itshape {}}}\\par\n",
                degree_field,
                escape_latex(&dates)
            ));
            if !inst.is_empty() {
                tex.push_str(&format!("{{\\small {}}}\\par\\vspace{{4pt}}\n", inst));
            }
        }
        tex.push('\n');
    }

    // Achievements
    let ach: Vec<_> = plan.achievements.iter().filter(|a| !a.excluded).collect();
    if !ach.is_empty() {
        tex.push_str("\\section{Honors \\& Achievements}\n\n");
        for a in ach {
            let title = escape_latex(&inline(&a.title));
            let issuer = escape_latex(&inline(&a.issuer));
            let date = escape_latex(&pretty_date(a.achieved_on.as_deref().unwrap_or("")));
            let right_parts = [issuer, date].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" $|$ ");
            tex.push_str(&format!("{{\\bfseries {}}}\\hfill{{\\small\\itshape {}}}\\par\n", title, right_parts));
            if !a.description.is_empty() {
                tex.push_str(&format!("\\vspace{{1pt}}{{\\small {}}}\\par\\vspace{{4pt}}\n", escape_latex(&inline(&a.description))));
            }
        }
        tex.push('\n');
    }

    // Skills — one line per category
    let groups = skill_groups(plan);
    if !groups.is_empty() {
        tex.push_str("\\section{Skills}\n\n");
        for (cat, names) in &groups {
            tex.push_str(&format!(
                "\\small \\textbf{{{}}}: {}\\par\n",
                escape_latex(cat),
                names.iter().map(|s| escape_latex(&inline(s))).collect::<Vec<_>>().join(" \\textbullet{} ")
            ));
        }
        tex.push('\n');
    }

    tex.push_str("\\end{document}\n");
    tex
}

// ---------------------------------------------------------------------------
// PlushCV template renderer (two-column with paracol)
// ---------------------------------------------------------------------------

fn render_plushcv(plan: &ResumePlan) -> String {
    let mut tex = String::with_capacity(8000);
    tex.push_str(&preamble(crate::latex_templates::PLUSHCV_PREAMBLE, plan));
    tex.push_str("\n\\begin{document}\n\n");

    // Name/header banner
    let words: Vec<&str> = plan.header.full_name.split_whitespace().collect();
    let first = escape_latex(words.first().copied().unwrap_or("Your"));
    let last  = if words.len() > 1 { escape_latex(&words[1..].join(" ")) } else { String::new() };
    let title = escape_latex(&inline(if plan.header.headline.is_empty() { "Software Engineer" } else { &plan.header.headline }));

    let mut contact_parts: Vec<String> = Vec::new();
    if !plan.header.location.is_empty() {
        contact_parts.push(escape_latex(&plan.header.location));
    }
    if !plan.header.website.is_empty() {
        contact_parts.push(escape_latex(plan.header.website.trim_start_matches("https://").trim_start_matches("http://")));
    }
    if !plan.header.github.is_empty() {
        let raw = plan.header.github
            .trim_start_matches("https://www.github.com/")
            .trim_start_matches("https://github.com/");
        contact_parts.push(format!("github.com/{}", escape_latex(raw)));
    }
    if !plan.header.linkedin.is_empty() {
        let raw = plan.header.linkedin
            .trim_start_matches("https://www.linkedin.com/in/")
            .trim_start_matches("https://linkedin.com/in/");
        contact_parts.push(format!("linkedin.com/in/{}", escape_latex(raw)));
    }
    if !plan.header.email.is_empty() {
        contact_parts.push(escape_latex(&plan.header.email));
    }
    if !plan.header.phone.is_empty() {
        contact_parts.push(escape_latex(&plan.header.phone));
    }

    tex.push_str(&format!(
        "\\namesection{{{}}}{{{}}}{{{}}}{{{}}}\n\n",
        first, last, title,
        contact_parts.join(" \\quad ")
    ));

    // Two-column layout: 68% left / 32% right
    tex.push_str("\\columnratio{0.68}\n\\begin{paracol}{2}\n\n");

    // ---- LEFT COLUMN: Experience + Projects ----
    let exp: Vec<&PlanItem> = plan.experience.iter().filter(|i| !i.excluded).collect();
    if !exp.is_empty() {
        tex.push_str("\\needspace{4\\baselineskip}\n\\section{Experience}\n");
        for item in exp {
            let (company, role) = split_title_role(&item.title);
            let loc   = escape_latex(&inline(&item.subtitle));
            let dates = escape_latex(&fmt_dates(&item.start_date, &item.end_date, item.is_current));
            let loc_date = if loc.is_empty() { dates.clone() } else { format!("{} | {}", loc, dates) };
            tex.push_str("\\needspace{4\\baselineskip}\n");
            tex.push_str(&format!("\\runsubsection{{{}}}\n", company));
            if !role.is_empty() {
                tex.push_str(&format!("\\descript{{| {}}}\n", role));
            }
            tex.push_str(&format!("\\location{{{}}}\n", loc_date));
            let lines = item_bullet_lines(item);
            if !lines.is_empty() {
                tex.push_str("\\begin{tightemize}\n");
                for text in lines {
                    tex.push_str(&format!("\\item {}\n", text));
                }
                tex.push_str("\\end{tightemize}\n");
            }
            tex.push_str("\\sectionsep\n\n");
        }
    }

    let proj: Vec<&PlanItem> = plan.projects.iter().filter(|i| !i.excluded).collect();
    if !proj.is_empty() {
        tex.push_str("\\needspace{4\\baselineskip}\n\\section{Projects}\n\n");
        for item in proj {
            let title = escape_latex(&inline(&item.title));
            let dates = escape_latex(&fmt_dates(&item.start_date, &item.end_date, item.is_current));
            tex.push_str("\\needspace{4\\baselineskip}\n");
            tex.push_str(&format!("\\runsubsection{{{}}}\n", title));
            if !item.skills.is_empty() {
                tex.push_str(&format!("\\descript{{| {}}}\n", escape_latex(&item.skills.join(", "))));
            }
            tex.push_str(&format!("\\location{{{}}}\n", dates));
            let lines = item_bullet_lines(item);
            if !lines.is_empty() {
                tex.push_str("\\begin{tightemize}\n");
                for text in lines {
                    tex.push_str(&format!("\\item {}\n", text));
                }
                tex.push_str("\\end{tightemize}\n");
            }
            tex.push_str("\\sectionsep\n\n");
        }
    }

    // ---- RIGHT COLUMN ----
    tex.push_str("\\switchcolumn\n\n");

    // Skills — one subsection per category
    let groups = skill_groups(plan);
    if !groups.is_empty() {
        tex.push_str("\\needspace{4\\baselineskip}\n\\section{Skills}\n");
        for (cat, names) in &groups {
            tex.push_str(&format!(
                "\\subsection{{{}}}\n\\location{{}}\n{{\\small {} }}\n\\sectionsep\n\n",
                escape_latex(cat),
                names.iter().map(|s| escape_latex(&inline(s))).collect::<Vec<_>>().join(" \\textbullet{} ")
            ));
        }
    }

    // Education
    if !plan.education.is_empty() {
        tex.push_str("\\needspace{4\\baselineskip}\n\\section{Education}\n");
        for e in &plan.education {
            let inst = escape_latex(&inline(&e.institution));
            let degree_field = [e.degree.clone(), e.field_of_study.clone()]
                .iter()
                .filter(|s| !s.is_empty())
                .map(|s| escape_latex(&inline(s)))
                .collect::<Vec<_>>()
                .join(", ");
            let dates = fmt_dates(&e.start_date, &e.end_date, e.is_current);
            tex.push_str(&format!(
                "\\needspace{{4\\baselineskip}}\n\\subsection{{{}}}\n\\descript{{{}}}\n\\location{{{}}}\n\\sectionsep\n\n",
                inst, degree_field, escape_latex(&dates)
            ));
        }
    }

    // Achievements
    let ach: Vec<_> = plan.achievements.iter().filter(|a| !a.excluded).collect();
    if !ach.is_empty() {
        tex.push_str("\\needspace{4\\baselineskip}\n\\section{Achievements}\n");
        for a in ach {
            let title = escape_latex(&inline(&a.title));
            let issuer = escape_latex(&inline(&a.issuer));
            let date = escape_latex(&pretty_date(a.achieved_on.as_deref().unwrap_or("")));
            tex.push_str(&format!("\\subsection{{{}}}\n", title));
            if !issuer.is_empty() {
                tex.push_str(&format!("\\descript{{{}}}\n", issuer));
            }
            if !date.is_empty() {
                tex.push_str(&format!("\\location{{{}}}\n", date));
            }
            if !a.description.is_empty() {
                tex.push_str(&format!("\\small {}\n", escape_latex(&inline(&a.description))));
            }
            tex.push_str("\\sectionsep\n\n");
        }
    }

    tex.push_str("\\end{paracol}\n\\end{document}\n");
    tex
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_all_specials() {
        assert_eq!(escape_latex("100% & $5 #1 a_b {c} d~e f^g"), "100\\% \\& \\$5 \\#1 a\\_b \\{c\\} d\\textasciitilde{}e f\\textasciicircum{}g");
        assert_eq!(escape_latex("back\\slash"), "back\\textbackslash{}slash");
        assert_eq!(escape_latex("line\nbreak"), "line\\par break");
        assert_eq!(escape_latex("ctrl\u{7}char"), "ctrlchar");
    }

    #[test]
    fn normalizes_unicode() {
        assert_eq!(escape_latex("a\u{00AD}b"), "ab");
        assert_eq!(escape_latex("it’s"), "it's");
        assert_eq!(escape_latex("A → B"), "A $\\rightarrow$ B");
        assert_eq!(escape_latex("2020–2024"), "2020--2024");
        assert_eq!(escape_latex("x≤y"), "x$\\leq$y");
    }

    #[test]
    fn pretty_dates() {
        assert_eq!(pretty_date("2022-08"), "Aug 2022");
        assert_eq!(pretty_date("2023-01-14"), "Jan 2023");
        assert_eq!(pretty_date("2027"), "2027");
        assert_eq!(pretty_date("junk"), "junk");
        assert_eq!(pretty_date(""), "");
        assert_eq!(fmt_dates(&Some("2022-08".into()), &None, true), "Aug 2022 -- Present");
        assert_eq!(fmt_dates(&Some("2025-06".into()), &Some("2025-07".into()), false), "Jun 2025 -- Jul 2025");
        assert_eq!(fmt_dates(&None, &None, false), "");
        assert_eq!(fmt_dates(&None, &None, true), "Present");
        // old bug: "-- Present" with a missing start
        assert!(!fmt_dates(&None, &Some("2026-05".into()), true).starts_with("--"));
    }

    fn sample_plan() -> ResumePlan {
        serde_json::from_str(
            r#"{
              "composerVersion": 1,
              "config": { "targetPages": 1, "maxProjects": 3, "maxExperienceItems": 2,
                          "maxBulletsPerItem": 3, "minFontSizePt": 9.5 },
              "header": { "fullName": "Alex Rivera", "headline": "", "email": "j@example.com",
                          "phone": "", "location": "Hyderabad, India", "website": "",
                          "github": "https://github.com/j", "linkedin": "" },
              "education": [{ "id": 1, "institution": "IIT Hyderabad", "degree": "B.Tech",
                              "fieldOfStudy": "CSE", "startDate": "2022-08", "endDate": "2026-05",
                              "isCurrent": false }],
              "experience": [],
              "projects": [],
              "skills": ["Python", "Rust"],
              "estimatedLines": 20,
              "fitsOnePage": true,
              "warnings": []
            }"#,
        )
        .expect("sample plan")
    }

    #[test]
    fn paper_token_substituted() {
        let mut plan = sample_plan();
        let tex = render_plan(&plan, "jake");
        assert!(tex.contains("\\documentclass[letterpaper,11pt]"));
        plan.config.paper = "a4".to_string();
        let tex = render_plan(&plan, "expressive");
        assert!(tex.contains("\\documentclass[11pt, a4paper]"));
    }

    #[test]
    fn location_rendered_in_headers() {
        let plan = sample_plan();
        for t in ["jake", "expressive", "plushcv"] {
            let tex = render_plan(&plan, t);
            assert!(tex.contains("Hyderabad, India"), "template {t} drops location");
        }
    }

    #[test]
    fn grouped_skills_render_per_template() {
        let mut plan = sample_plan();
        plan.skills_grouped = vec![
            crate::composer::PlanSkillGroup {
                category: "Languages".into(),
                skills: vec!["Python".into(), "Rust".into()],
            },
        ];
        let jake = render_plan(&plan, "jake");
        assert!(jake.contains("\\textbf{Languages}{: Python, Rust}"));
        let expr = render_plan(&plan, "expressive");
        assert!(expr.contains("\\textbf{Languages}: Python \\textbullet{} Rust"));
        let plush = render_plan(&plan, "plushcv");
        assert!(plush.contains("\\subsection{Languages}"));
    }

    #[test]
    fn href_targets_stay_raw_and_display_escaped() {
        let mut plan = sample_plan();
        plan.header.email = "first_last@e.com".to_string();
        plan.header.github = "https://github.com/first_last".to_string();
        plan.header.website = "https://ex.com/a%1#frag".to_string();
        let tex = render_plan(&plan, "jake");
        // Targets keep raw underscores (hyperref-safe) and percent-encode
        // argument-terminating characters.
        assert!(tex.contains("\\href{mailto:first_last@e.com}"));
        assert!(tex.contains("\\href{https://github.com/first_last}"));
        assert!(tex.contains("\\href{https://ex.com/a%251%23frag}"));
        // Display text is LaTeX-escaped.
        assert!(tex.contains("\\underline{first\\_last@e.com}"));
    }

    #[test]
    fn flat_skills_fall_back_to_single_group() {
        let plan = sample_plan();
        let tex = render_plan(&plan, "jake");
        assert!(tex.contains("\\textbf{Skills}{: Python, Rust}"));
    }
}

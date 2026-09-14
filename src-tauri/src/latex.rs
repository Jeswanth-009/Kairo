//! LaTeX rendering (Phase 9 · spec §9.1). Pure and deterministic: the plan is
//! the only input, every user string is escaped, and the LLM is never involved
//! — the renderer owns all document structure.

use crate::composer::ResumePlan;

/// Escapes LaTeX special characters. Backslash first, then the rest.
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

fn fmt_dates(start: &Option<String>, end: &Option<String>, current: bool) -> String {
    let fmt = |v: &Option<String>| v.clone().unwrap_or_default();
    if current {
        format!("{} -- Present", fmt(start))
    } else {
        format!("{} -- {}", fmt(start), fmt(end))
    }
    .trim()
    .trim_end_matches('-')
    .trim()
    .to_string()
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
// Jake template renderer
// ---------------------------------------------------------------------------

fn render_jake(plan: &ResumePlan) -> String {
    let mut tex = String::with_capacity(6000);
    tex.push_str(crate::latex_templates::JAKE_PREAMBLE);
    tex.push_str("\n\\begin{document}\n\n");

    // --- Heading ---
    let name = escape_latex(&inline(if plan.header.full_name.is_empty() { "Your Name" } else { &plan.header.full_name }));
    let mut contact_parts: Vec<String> = Vec::new();
    if !plan.header.phone.is_empty() {
        contact_parts.push(escape_latex(&plan.header.phone));
    }
    if !plan.header.email.is_empty() {
        contact_parts.push(format!(
            "\\href{{mailto:{0}}}{{\\underline{{{0}}}}}",
            escape_latex(&plan.header.email)
        ));
    }
    if !plan.header.linkedin.is_empty() {
        let raw = plan.header.linkedin
            .trim_start_matches("https://www.linkedin.com/in/")
            .trim_start_matches("https://linkedin.com/in/")
            .trim_end_matches('/');
        contact_parts.push(format!(
            "\\href{{{}}}{{\\underline{{linkedin.com/in/{}}}}}",
            escape_latex(&plan.header.linkedin),
            escape_latex(raw)
        ));
    }
    if !plan.header.github.is_empty() {
        let raw = plan.header.github
            .trim_start_matches("https://www.github.com/")
            .trim_start_matches("https://github.com/")
            .trim_end_matches('/');
        contact_parts.push(format!(
            "\\href{{{}}}{{\\underline{{github.com/{}}}}}",
            escape_latex(&plan.header.github),
            escape_latex(raw)
        ));
    }
    if !plan.header.website.is_empty() {
        let raw = plan.header.website
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .trim_end_matches('/');
        contact_parts.push(format!(
            "\\href{{{}}}{{\\underline{{{}}}}}",
            escape_latex(&plan.header.website),
            escape_latex(raw)
        ));
    }
    tex.push_str("\\begin{center}\n");
    tex.push_str(&format!("    \\textbf{{\\Huge \\scshape {}}} \\\\ \\vspace{{1pt}}\n", name));
    if !contact_parts.is_empty() {
        tex.push_str(&format!("    \\small {}\n", contact_parts.join(" $|$ ")));
    }
    tex.push_str("\\end{center}\n\n");

    // --- Education ---
    if !plan.education.is_empty() {
        tex.push_str("%-----------EDUCATION-----------\n\\section{Education}\n  \\resumeSubHeadingListStart\n");
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
            tex.push_str(&format!(
                "    \\resumeSubheading\n      {{{}}}{{}}\n      {{{}}}{{{}}}\n",
                inst, degree_field, dates
            ));
        }
        tex.push_str("  \\resumeSubHeadingListEnd\n\n");
    }

    // --- Experience ---
    // PlanItem.title = company, PlanItem.subtitle = role (set by composer)
    let exp: Vec<_> = plan.experience.iter().filter(|i| !i.excluded).collect();
    if !exp.is_empty() {
        tex.push_str("%-----------EXPERIENCE-----------\n\\section{Experience}\n  \\resumeSubHeadingListStart\n\n");
        for item in exp {
            let company = escape_latex(&inline(&item.title));
            let role    = escape_latex(&inline(&item.subtitle));
            let dates   = escape_latex(&fmt_dates(&item.start_date, &item.end_date, item.is_current));
            // Jake: \resumeSubheading{Company}{Dates}{Role}{}
            tex.push_str(&format!(
                "    \\resumeSubheading\n      {{{}}}{{{}}}\n      {{{}}}{{}}\n",
                company, dates, role
            ));
            let bullets: Vec<_> = item.bullets.iter().filter(|b| !b.excluded).collect();
            if !bullets.is_empty() {
                tex.push_str("      \\resumeItemListStart\n");
                for b in &bullets {
                    tex.push_str(&format!("        \\resumeItem{{{}}}\n", escape_latex(&inline(&b.text))));
                }
                tex.push_str("      \\resumeItemListEnd\n\n");
            }
        }
        tex.push_str("  \\resumeSubHeadingListEnd\n\n");
    }

    // --- Projects ---
    let proj: Vec<_> = plan.projects.iter().filter(|i| !i.excluded).collect();
    if !proj.is_empty() {
        tex.push_str("%-----------PROJECTS-----------\n\\section{Projects}\n    \\resumeSubHeadingListStart\n");
        for item in &proj {
            let title = escape_latex(&inline(&item.title));
            let tech_str = if !item.skills.is_empty() {
                format!(" $|$ \\emph{{{}}}", escape_latex(&item.skills.join(", ")))
            } else {
                String::new()
            };
            let dates = escape_latex(&fmt_dates(&item.start_date, &item.end_date, item.is_current));
            tex.push_str(&format!(
                "      \\resumeProjectHeading\n          {{\\textbf{{{}}}{}}}{{{}}}\n",
                title, tech_str, dates
            ));
            let bullets: Vec<_> = item.bullets.iter().filter(|b| !b.excluded).collect();
            if !bullets.is_empty() {
                tex.push_str("          \\resumeItemListStart\n");
                for b in &bullets {
                    tex.push_str(&format!("            \\resumeItem{{{}}}\n", escape_latex(&inline(&b.text))));
                }
                tex.push_str("          \\resumeItemListEnd\n");
            }
        }
        tex.push_str("    \\resumeSubHeadingListEnd\n\n");
    }

    // --- Skills ---
    let skills: Vec<_> = plan.skills.iter().filter(|s| !plan.excluded_skills.contains(s)).collect();
    if !skills.is_empty() {
        tex.push_str("%-----------PROGRAMMING SKILLS-----------\n\\section{Technical Skills}\n");
        tex.push_str(" \\begin{itemize}[leftmargin=0.15in, label={}]\n    \\small{\\item{\n");
        tex.push_str(&format!(
            "     \\textbf{{Skills}}{{: {}}}\n",
            skills.iter().map(|s| escape_latex(&inline(s))).collect::<Vec<_>>().join(", ")
        ));
        tex.push_str("    }}\n \\end{itemize}\n\n");
    }

    tex.push_str("%-------------------------------------------\n\\end{document}\n");
    tex
}

// ---------------------------------------------------------------------------
// Expressive template renderer
// ---------------------------------------------------------------------------

fn render_expressive(plan: &ResumePlan) -> String {
    let mut tex = String::with_capacity(6000);
    tex.push_str(crate::latex_templates::EXPRESSIVE_PREAMBLE);
    tex.push_str("\n\\begin{document}\n\n");

    // Header
    let name = escape_latex(&inline(if plan.header.full_name.is_empty() { "Your Name" } else { &plan.header.full_name }));
    let email    = escape_latex(&plan.header.email);
    let linkedin = escape_latex(
        plan.header.linkedin
            .trim_start_matches("https://www.linkedin.com/in/")
            .trim_start_matches("https://linkedin.com/in/")
            .trim_end_matches('/')
    );
    let github = escape_latex(
        plan.header.github
            .trim_start_matches("https://www.github.com/")
            .trim_start_matches("https://github.com/")
            .trim_end_matches('/')
    );
    let phone = escape_latex(&plan.header.phone);
    tex.push_str(&format!(
        "\\resumeheader{{{}}}{{{}}}{{{}}}{{{}}}{{{}}}\n\n",
        name, email, linkedin, github, phone
    ));

    // Objective / headline
    if !plan.header.headline.is_empty() {
        tex.push_str(&format!(
            "\\objective{{{}}}\n\n",
            escape_latex(&inline(&plan.header.headline))
        ));
    }

    // Experience
    let exp: Vec<_> = plan.experience.iter().filter(|i| !i.excluded).collect();
    if !exp.is_empty() {
        tex.push_str("\\section{Work Experience}\n\n");
        for item in exp {
            let company = escape_latex(&inline(&item.title));
            let role    = escape_latex(&inline(&item.subtitle));
            let dates   = escape_latex(&fmt_dates(&item.start_date, &item.end_date, item.is_current));
            tex.push_str(&format!("\\experience{{{}}}{{}}{{\n", company));
            tex.push_str(&format!("    \\role{{{}}}{{{}}}{{\n", role, dates));
            for b in item.bullets.iter().filter(|b| !b.excluded) {
                tex.push_str(&format!("        \\achievement{{{}}}\n", escape_latex(&inline(&b.text))));
            }
            tex.push_str("    }\n}\n\n");
        }
    }

    // Projects
    let proj: Vec<_> = plan.projects.iter().filter(|i| !i.excluded).collect();
    if !proj.is_empty() {
        tex.push_str("\\section{Technical Projects}\n\n");
        for item in proj {
            let title = escape_latex(&inline(&item.title));
            let dates = escape_latex(&fmt_dates(&item.start_date, &item.end_date, item.is_current));
            tex.push_str(&format!("\\project{{{}}}{{{}}}{{\n", title, dates));
            for b in item.bullets.iter().filter(|b| !b.excluded) {
                tex.push_str(&format!("    \\achievement{{{}}}\n", escape_latex(&inline(&b.text))));
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
            let year = e.end_date.as_deref()
                .and_then(|d| d.get(..4))
                .unwrap_or("")
                .to_string();
            tex.push_str(&format!(
                "\\degree{{{}}}{{{}}}{{{}}}{{\n    \\achievement{{}}\n}}\n\n",
                degree_field, inst, year
            ));
        }
    }

    // Skills
    let skills: Vec<_> = plan.skills.iter().filter(|s| !plan.excluded_skills.contains(s)).collect();
    if !skills.is_empty() {
        tex.push_str("\\section{Skills}\n\n");
        tex.push_str(&format!(
            "\\small {}\n\n",
            skills.iter().map(|s| escape_latex(&inline(s))).collect::<Vec<_>>().join(" \\textbullet{} ")
        ));
    }

    tex.push_str("\\end{document}\n");
    tex
}

// ---------------------------------------------------------------------------
// PlushCV template renderer (two-column with paracol)
// ---------------------------------------------------------------------------

fn render_plushcv(plan: &ResumePlan) -> String {
    let mut tex = String::with_capacity(8000);
    tex.push_str(crate::latex_templates::PLUSHCV_PREAMBLE);
    tex.push_str("\n\\begin{document}\n\n");

    // Name/header banner
    let words: Vec<&str> = plan.header.full_name.split_whitespace().collect();
    let first = escape_latex(words.first().copied().unwrap_or("Your"));
    let last  = if words.len() > 1 { escape_latex(&words[1..].join(" ")) } else { String::new() };
    let title = escape_latex(&inline(if plan.header.headline.is_empty() { "Software Engineer" } else { &plan.header.headline }));

    let mut contact_parts: Vec<String> = Vec::new();
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
    let exp: Vec<_> = plan.experience.iter().filter(|i| !i.excluded).collect();
    if !exp.is_empty() {
        tex.push_str("\\section{Experience}\n");
        for item in exp {
            let company = escape_latex(&inline(&item.title));
            let role    = escape_latex(&inline(&item.subtitle));
            let dates   = escape_latex(&fmt_dates(&item.start_date, &item.end_date, item.is_current));
            tex.push_str(&format!("\\runsubsection{{{}}}\n", company));
            if !role.is_empty() {
                tex.push_str(&format!("\\descript{{| {}}}\n", role));
            }
            tex.push_str(&format!("\\location{{{}}}\n", dates));
            let bullets: Vec<_> = item.bullets.iter().filter(|b| !b.excluded).collect();
            if !bullets.is_empty() {
                tex.push_str("\\begin{tightemize}\n");
                for b in &bullets {
                    tex.push_str(&format!("\\item {}\n", escape_latex(&inline(&b.text))));
                }
                tex.push_str("\\end{tightemize}\n");
            }
            tex.push_str("\\sectionsep\n\n");
        }
    }

    let proj: Vec<_> = plan.projects.iter().filter(|i| !i.excluded).collect();
    if !proj.is_empty() {
        tex.push_str("\\section{Projects}\n\n");
        for item in proj {
            let title = escape_latex(&inline(&item.title));
            let dates = escape_latex(&fmt_dates(&item.start_date, &item.end_date, item.is_current));
            tex.push_str(&format!("\\runsubsection{{{}}}\n", title));
            if !item.skills.is_empty() {
                tex.push_str(&format!("\\descript{{| {}}}\n", escape_latex(&item.skills.join(", "))));
            }
            tex.push_str(&format!("\\location{{{}}}\n", dates));
            let bullets: Vec<_> = item.bullets.iter().filter(|b| !b.excluded).collect();
            if !bullets.is_empty() {
                tex.push_str("\\begin{tightemize}\n");
                for b in &bullets {
                    tex.push_str(&format!("\\item {}\n", escape_latex(&inline(&b.text))));
                }
                tex.push_str("\\end{tightemize}\n");
            }
            tex.push_str("\\sectionsep\n\n");
        }
    }

    // ---- RIGHT COLUMN ----
    tex.push_str("\\switchcolumn\n\n");

    // Skills
    let skills: Vec<_> = plan.skills.iter().filter(|s| !plan.excluded_skills.contains(s)).collect();
    if !skills.is_empty() {
        tex.push_str("\\section{Skills}\n\\subsection{Programming}\n\\sectionsep\n");
        tex.push_str(&format!(
            "{}\n\\sectionsep\n\\sectionsep\n\n",
            skills.iter().map(|s| escape_latex(&inline(s))).collect::<Vec<_>>().join(" \\textbullet{} ")
        ));
    }

    // Education
    if !plan.education.is_empty() {
        tex.push_str("\\section{Education}\n");
        for e in &plan.education {
            let inst = escape_latex(&inline(&e.institution));
            let degree_field = [e.degree.clone(), e.field_of_study.clone()]
                .iter()
                .filter(|s| !s.is_empty())
                .map(|s| escape_latex(&inline(s)))
                .collect::<Vec<_>>()
                .join(", ");
            let dates = escape_latex(&fmt_dates(&e.start_date, &e.end_date, e.is_current));
            tex.push_str(&format!("\\subsection{{{}}}\n\\descript{{{}}}\n\\location{{{}}}\n\\sectionsep\n\n", inst, degree_field, dates));
        }
    }

    tex.push_str("\\end{paracol}\n\\end{document}\n");
    tex
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::composer::{
        ComposerBullet, ComposerConfig, ComposerEducation, ComposerEntity, ComposerInput,
        ComposerProfile, PlanBullet, PlanEducation, PlanItem,
    };

    fn escape_test(input: &str, expected: &str) {
        assert_eq!(escape_latex(input), expected);
    }

    #[test]
    fn escapes_all_specials() {
        escape_test(
            "100% & $5 #1 a_b {c} d~e f^g",
            "100\\% \\& \\$5 \\#1 a\\_b \\{c\\} d\\textasciitilde{}e f\\textasciicircum{}g",
        );
        escape_test("back\\slash", "back\\textbackslash{}slash");
        escape_test("line\nbreak", "line\\par break");
        escape_test("ctrl\u{7}char", "ctrlchar");
    }

    #[test]
    fn rendered_jake_contains_structure() {
        let plan = ResumePlan {
            composer_version: 1,
            config: ComposerConfig::default(),
            header: crate::composer::PlanHeader {
                full_name: "Jeswanth Sai".to_string(),
                headline: String::new(),
                email: "j@example.com".to_string(),
                phone: String::new(),
                location: String::new(),
                website: String::new(),
                github: "https://github.com/j".to_string(),
                linkedin: String::new(),
            },
            education: vec![PlanEducation {
                id: 1,
                institution: "IIT Hyderabad".to_string(),
                degree: "B.Tech".to_string(),
                field_of_study: "CSE".to_string(),
                start_date: Some("2022-08".to_string()),
                end_date: Some("2026-05".to_string()),
                is_current: false,
            }],
            experience: vec![],
            projects: vec![PlanItem {
                entity_type: "project".to_string(),
                id: 2,
                title: "PyKV & friends".to_string(),
                subtitle: String::new(),
                start_date: None,
                end_date: None,
                is_current: false,
                description: String::new(),
                bullets: vec![PlanBullet {
                    id: 10,
                    text: "Handled 100% of the a_b testing".to_string(),
                    supports: vec![],
                    excluded: false,
                }],
                skills: vec![],
                relevance: 0.9,
                evidence_count: 1,
                excluded: false,
            }],
            skills: vec!["Python & SQL".to_string()],
            excluded_skills: vec![],
            estimated_lines: 20,
            fits_one_page: true,
            warnings: vec![],
        };

        let tex = render_plan(&plan, "jake");
        assert!(tex.contains("Jeswanth Sai"));
        assert!(tex.contains("PyKV \\& friends"));
        assert!(tex.contains("Handled 100\\% of the a\\_b testing"));
        assert!(tex.contains("Python \\& SQL"));
        assert!(tex.ends_with("\\end{document}\n"));
    }

    #[test]
    fn empty_plan_still_compiles_shape() {
        let plan = ResumePlan {
            composer_version: 1,
            config: ComposerConfig::default(),
            header: crate::composer::PlanHeader {
                full_name: String::new(),
                headline: String::new(),
                email: String::new(),
                phone: String::new(),
                location: String::new(),
                website: String::new(),
                github: String::new(),
                linkedin: String::new(),
            },
            education: vec![],
            experience: vec![],
            projects: vec![],
            skills: vec![],
            excluded_skills: vec![],
            estimated_lines: 0,
            fits_one_page: true,
            warnings: vec![],
        };
        let tex = render_plan(&plan, "jake");
        assert!(tex.contains("Your Name"));
        assert!(tex.ends_with("\\end{document}\n"));
    }

    // silence unused imports in test builds
    #[allow(dead_code)]
    fn _touch(_: ComposerEntity, _: ComposerInput, _: ComposerBullet, _: ComposerProfile, _: ComposerEducation) {}
}

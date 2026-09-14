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
            '&' => out.push_str("\\&"),
            '%' => out.push_str("\\%"),
            '$' => out.push_str("\\$"),
            '#' => out.push_str("\\#"),
            '_' => out.push_str("\\_"),
            '{' => out.push_str("\\{"),
            '}' => out.push_str("\\}"),
            '~' => out.push_str("\\textasciitilde{}"),
            '^' => out.push_str("\\textasciicircum{}"),
            '\n' => out.push_str("\\par "),
            c if (c as u32) < 32 => { /* strip other control characters */ }
            c => out.push(c),
        }
    }
    out
}

/// Collapses whitespace runs (incl. newlines) to single spaces — headings and
/// bullets must stay single-line.
fn inline(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn contact_line(parts: &[String]) -> String {
    let kept: Vec<String> = parts.iter().filter(|p| !p.is_empty()).map(|p| escape_latex(p)).collect();
    kept.join(" \\textbar{} ")
}

/// Renders the approved plan into the chosen LaTeX template.
pub fn render_plan(plan: &ResumePlan, template_id: &str) -> String {
    let mut tex = String::with_capacity(4096);

    let preamble = match template_id {
        "modern" => crate::latex_templates::MODERN_PREAMBLE,
        "minimal" => crate::latex_templates::MINIMAL_PREAMBLE,
        _ => crate::latex_templates::CLASSIC_PREAMBLE,
    };
    tex.push_str(preamble);
    tex.push_str("\n\\begin{document}\n\n");

    // Header
    let name = if plan.header.full_name.is_empty() { "Your Name" } else { &plan.header.full_name };
    let headline = if plan.header.headline.is_empty() { String::new() } else { escape_latex(&inline(&plan.header.headline)) };
    let contact = contact_line(&[
        plan.header.email.clone(),
        plan.header.phone.clone(),
        plan.header.location.clone(),
        plan.header.github.clone(),
        plan.header.website.clone(),
        plan.header.linkedin.clone(),
    ]);
    tex.push_str(&format!("\\resumeHeader{{{}}}{{{}}}{{{}}}\n\n", escape_latex(&inline(name)), headline, contact));

    // Education (mandatory, always rendered)
    if !plan.education.is_empty() {
        tex.push_str("\\resumeSection{Education}\n");
        for e in &plan.education {
            let left = escape_latex(&inline(&e.institution));
            let right_bits: Vec<String> = [e.degree.clone(), e.field_of_study.clone()]
                .iter()
                .filter(|s| !s.is_empty())
                .map(|s| escape_latex(&inline(s)))
                .collect();
            let subtitle = right_bits.join(", ");
            let dates = fmt_dates(&e.start_date, &e.end_date, e.is_current);
            tex.push_str(&format!("\\resumeItem{{{}}}{{{}}}{{{}}}\n", left, subtitle, escape_latex(&dates)));
        }
    }

    // Experience + Projects
    for (kind, title) in [("experience", "Experience"), ("projects", "Projects")] {
        let items: Vec<&crate::composer::PlanItem> = if kind == "experience" {
            plan.experience.iter().filter(|i| !i.excluded).collect()
        } else {
            plan.projects.iter().filter(|i| !i.excluded).collect()
        };
        if items.is_empty() {
            continue;
        }
        tex.push_str(&format!("\\resumeSection{{{}}}\n", escape_latex(title)));
        for item in items {
            let name = escape_latex(&inline(&item.title));
            let subtitle = escape_latex(&inline(&item.subtitle));
            let dates = fmt_dates(&item.start_date, &item.end_date, item.is_current);
            tex.push_str(&format!("\\resumeItem{{{}}}{{{}}}{{{}}}\n", name, subtitle, escape_latex(&dates)));
            
            if !item.description.is_empty() {
                tex.push_str(&format!("\\resumeDesc{{{}}}\n", escape_latex(&inline(&item.description))));
            }
            
            let rendered: Vec<&crate::composer::PlanBullet> =
                item.bullets.iter().filter(|b| !b.excluded).collect();
            if !rendered.is_empty() {
                tex.push_str("\\begin{resumeItemList}\n");
                for bullet in rendered {
                    tex.push_str(&format!("  \\resumeItemBullet{{{}}}\n", escape_latex(&inline(&bullet.text))));
                }
                tex.push_str("\\end{resumeItemList}\n");
            }
        }
    }

    // Skills (excluded ones omitted)
    let included_skills: Vec<&String> = plan
        .skills
        .iter()
        .filter(|s| !plan.excluded_skills.contains(s))
        .collect();
    if !included_skills.is_empty() {
        tex.push_str("\\resumeSection{Skills}\n");
        let joined = included_skills
            .iter()
            .map(|s| escape_latex(&inline(s)))
            .collect::<Vec<_>>()
            .join(" \\textbar{} ");
        tex.push_str(&format!("\\resumeSkills{{{}}}\n", joined));
    }

    tex.push_str("\n\\end{document}\n");
    tex
}

fn fmt_dates(start: &Option<String>, end: &Option<String>, current: bool) -> String {
    let fmt = |v: &Option<String>| v.clone().unwrap_or_default();
    if current {
        format!("{} — Present", fmt(start))
    } else {
        format!("{} — {}", fmt(start), fmt(end))
    }
    .trim()
    .trim_end_matches('—')
    .trim()
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::composer::{
        ComposerBullet, ComposerConfig, ComposerEducation, ComposerEntity, ComposerInput,
        ComposerProfile, PlanItem,
    };

    fn escape_test(input: &str, expected: &str) {
        assert_eq!(escape_latex(input), expected);
    }

    #[test]
    fn escapes_all_specials() {
        escape_test("100% & $5 #1 a_b {c} d~e f^g", "100\\% \\& \\$5 \\#1 a\\_b \\{c\\} d\\textasciitilde{}e f\\textasciicircum{}g");
        escape_test("back\\slash", "back\\textbackslash{}slash");
        escape_test("line\nbreak", "line\\par break");
        escape_test("ctrl\u{7}char", "ctrlchar");
    }

    #[test]
    fn rendered_tex_contains_escaped_content_and_structure() {
        let plan = ResumePlan {
            composer_version: 1,
            config: ComposerConfig::default(),
            header: crate::composer::PlanHeader {
                full_name: "Alex Rivera".to_string(),
                headline: String::new(),
                email: "j@example.com".to_string(),
                phone: String::new(),
                location: String::new(),
                website: String::new(),
                github: "https://github.com/j".to_string(),
                linkedin: String::new(),
            },
            education: vec![crate::composer::PlanEducation {
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
                bullets: vec![crate::composer::PlanBullet {
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

        let tex = render_plan(&plan, "classic");
        assert!(tex.contains("\\documentclass[10pt,letterpaper]{article}"));
        assert!(tex.contains("Alex Rivera"));
        assert!(tex.contains("PyKV \\& friends")); // escaped ampersand

        assert!(tex.contains("Handled 100\\% of the a\\_b testing")); // escaped % and _
        assert!(tex.contains("Python \\& SQL")); // escaped in skills
        assert!(tex.contains("\\resumeSection{Education}"));
        assert!(tex.contains("\\resumeSection{Projects}"));
        assert!(tex.contains("\\resumeSection{Skills}"));
        // github link rendered raw (escaped is identical here)
        assert!(tex.contains("https://github.com/j"));
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
        let tex = render_plan(&plan, "classic");
        assert!(tex.contains("Your Name"));
        assert!(!tex.contains("\\resumeSection{"));
        assert!(tex.ends_with("\\end{document}\n"));
    }

    // silence unused import in test builds
    #[allow(dead_code)]
    fn _touch(_: ComposerEntity, _: ComposerInput, _: ComposerBullet) {}
}

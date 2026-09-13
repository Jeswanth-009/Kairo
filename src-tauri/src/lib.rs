mod ai;
mod commands;
pub mod composer;
pub mod db;
mod imports;
mod interview;
mod jd;
pub mod latex;
mod logging;
mod matching;
mod tailor;

use std::sync::Mutex;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let conn = db::open_and_migrate(&data_dir.join("kairo.db"))?;
            if let Err(e) = logging::init(&data_dir.join("logs")) {
                eprintln!("logging disabled: {e}");
            }
            let schema_version = db::applied_migrations(&conn).map(|m| m.len()).unwrap_or(0);
            logging::log_event(
                "info",
                "app_start",
                &[
                    ("schema_migrations", schema_version.to_string()),
                    ("db_path", data_dir.join("kairo.db").to_string_lossy().to_string()),
                ],
            );
            app.manage(db::DbState(Mutex::new(conn)));
            app.manage(commands::pdf_commands::AppDataDir(data_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::db_commands::get_diagnostics,
            commands::db_commands::db_smoke_test,
            commands::vault_commands::project_commands::list_projects,
            commands::vault_commands::project_commands::create_project,
            commands::vault_commands::project_commands::update_project,
            commands::vault_commands::project_commands::delete_project,
            commands::vault_commands::experience_commands::list_experiences,
            commands::vault_commands::experience_commands::create_experience,
            commands::vault_commands::experience_commands::update_experience,
            commands::vault_commands::experience_commands::delete_experience,
            commands::vault_commands::education_commands::list_education,
            commands::vault_commands::education_commands::create_education,
            commands::vault_commands::education_commands::update_education,
            commands::vault_commands::education_commands::delete_education,
            commands::vault_commands::certification_commands::list_certifications,
            commands::vault_commands::certification_commands::create_certification,
            commands::vault_commands::certification_commands::update_certification,
            commands::vault_commands::certification_commands::delete_certification,
            commands::vault_commands::achievement_commands::list_achievements,
            commands::vault_commands::achievement_commands::create_achievement,
            commands::vault_commands::achievement_commands::update_achievement,
            commands::vault_commands::achievement_commands::delete_achievement,
            commands::vault_commands::skill_commands::list_skills,
            commands::vault_commands::skill_commands::create_skill,
            commands::vault_commands::skill_commands::update_skill,
            commands::vault_commands::skill_commands::delete_skill,
            commands::vault_commands::get_profile,
            commands::vault_commands::upsert_profile,
            commands::vault_commands::add_skill_alias,
            commands::vault_commands::delete_skill_alias,
            commands::trust_commands::list_evidence,
            commands::trust_commands::create_evidence,
            commands::trust_commands::update_evidence,
            commands::trust_commands::delete_evidence,
            commands::trust_commands::list_bullets,
            commands::trust_commands::create_bullet,
            commands::trust_commands::update_bullet,
            commands::trust_commands::delete_bullet,
            commands::trust_commands::list_claim_rules,
            commands::trust_commands::create_claim_rule,
            commands::trust_commands::update_claim_rule,
            commands::trust_commands::delete_claim_rule,
            commands::import_commands::parse_resume_text,
            commands::import_commands::parse_certificate_text,
            commands::import_commands::github_repo_candidate,
            commands::job_commands::list_jobs,
            commands::job_commands::get_job,
            commands::job_commands::update_job,
            commands::job_commands::delete_job,
            commands::job_commands::create_job_with_requirements,
            commands::job_commands::list_requirements,
            commands::job_commands::add_requirement,
            commands::job_commands::update_requirement,
            commands::job_commands::delete_requirement,
            commands::job_commands::parse_jd,
            commands::match_commands::run_job_match,
            commands::match_commands::get_match,
            commands::composer_commands::run_composer,
            commands::composer_commands::get_plan,
            commands::composer_commands::save_plan,
            commands::composer_commands::estimate_plan_lines,
            commands::ai_commands::ai_get_config,
            commands::ai_commands::ai_save_config,
            commands::ai_commands::ai_test_connection,
            commands::ai_commands::tailor_suggest,
            commands::ai_commands::tailor_list,
            commands::ai_commands::tailor_set_status,
            commands::ai_commands::tailor_delete,
            commands::ai_commands::claim_changes,
            commands::ai_commands::tailor_save_manual_edit,
            commands::pdf_commands::export_pdf,
            commands::pdf_commands::get_pdf_artifact,
            commands::version_commands::save_resume_version,
            commands::version_commands::list_resume_versions,
            commands::version_commands::get_resume_version,
            commands::applications_commands::list_applications,
            commands::applications_commands::create_application,
            commands::applications_commands::update_application,
            commands::applications_commands::set_application_status,
            commands::applications_commands::delete_application,
            commands::interview_commands::generate_interview_prep,
            commands::dashboard_commands::get_dashboard,
            commands::backup_commands::list_backups,
            commands::backup_commands::create_backup,
            commands::backup_commands::restore_backup,
        ])
        .run(tauri::generate_context!())
        .expect("Kairo failed to start");
}

mod commands;
mod db;

use std::sync::Mutex;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let db_path = app.path().app_data_dir()?.join("kairo.db");
            let conn = db::open_and_migrate(&db_path)?;
            app.manage(db::DbState(Mutex::new(conn)));
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
        ])
        .run(tauri::generate_context!())
        .expect("Kairo failed to start");
}

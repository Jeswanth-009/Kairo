//! Career Vault command boundary (Phase 1): one list/create/update/delete set
//! per entity plus profile and skill-alias operations. Thin wrappers only —
//! persistence, validation and enrichment live in `db::vault`.

use crate::db::{vault, DbState};
use serde::Serialize;
use tauri::State;

const DB_LOCK: &str = "database lock poisoned";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationOk {
    pub ok: bool,
}

/// Generates a CRUD command module. Fn names are explicit because the command
/// name (and therefore the invoke name) must be unique across the app.
macro_rules! vault_commands {
    (
        $modname:ident, $entity:ty, $arg:ident,
        list $list:ident, create $create:ident, update $update:ident, delete $delete:ident
    ) => {
        pub mod $modname {
            use super::*;

            #[tauri::command]
            pub fn $list(state: State<'_, DbState>) -> Result<Vec<$entity>, String> {
                let conn = state.0.lock().map_err(|_| DB_LOCK)?;
                vault::vault_list::<$entity>(&conn)
            }

            #[tauri::command]
            pub fn $create(state: State<'_, DbState>, $arg: $entity) -> Result<$entity, String> {
                let conn = state.0.lock().map_err(|_| DB_LOCK)?;
                vault::vault_create::<$entity>(&conn, &$arg)
            }

            #[tauri::command]
            pub fn $update(state: State<'_, DbState>, $arg: $entity) -> Result<$entity, String> {
                let conn = state.0.lock().map_err(|_| DB_LOCK)?;
                vault::vault_update::<$entity>(&conn, &$arg)
            }

            #[tauri::command]
            pub fn $delete(state: State<'_, DbState>, id: i64) -> Result<MutationOk, String> {
                let conn = state.0.lock().map_err(|_| DB_LOCK)?;
                vault::vault_delete::<$entity>(&conn, id)?;
                Ok(MutationOk { ok: true })
            }
        }
    };
}

vault_commands!(
    project_commands,
    vault::Project,
    project,
    list list_projects,
    create create_project,
    update update_project,
    delete delete_project
);

vault_commands!(
    experience_commands,
    vault::Experience,
    experience,
    list list_experiences,
    create create_experience,
    update update_experience,
    delete delete_experience
);

vault_commands!(
    education_commands,
    vault::Education,
    education,
    list list_education,
    create create_education,
    update update_education,
    delete delete_education
);

vault_commands!(
    certification_commands,
    vault::Certification,
    certification,
    list list_certifications,
    create create_certification,
    update update_certification,
    delete delete_certification
);

vault_commands!(
    achievement_commands,
    vault::Achievement,
    achievement,
    list list_achievements,
    create create_achievement,
    update update_achievement,
    delete delete_achievement
);

vault_commands!(
    skill_commands,
    vault::Skill,
    skill,
    list list_skills,
    create create_skill,
    update update_skill,
    delete delete_skill
);

#[tauri::command]
pub fn get_profile(state: State<'_, DbState>) -> Result<Option<vault::Profile>, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    vault::get_profile(&conn)
}

#[tauri::command]
pub fn upsert_profile(
    state: State<'_, DbState>,
    profile: vault::Profile,
) -> Result<vault::Profile, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    vault::upsert_profile(&conn, &profile)
}

#[tauri::command]
pub fn add_skill_alias(
    state: State<'_, DbState>,
    skill_id: i64,
    alias: String,
) -> Result<MutationOk, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    vault::add_skill_alias(&conn, skill_id, &alias)?;
    Ok(MutationOk { ok: true })
}

#[tauri::command]
pub fn delete_skill_alias(state: State<'_, DbState>, alias_id: i64) -> Result<MutationOk, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    vault::delete_skill_alias(&conn, alias_id)?;
    Ok(MutationOk { ok: true })
}

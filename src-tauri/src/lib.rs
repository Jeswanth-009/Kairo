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
            commands::db_commands::db_smoke_test
        ])
        .run(tauri::generate_context!())
        .expect("Kairo failed to start");
}

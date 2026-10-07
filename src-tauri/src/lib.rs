mod active_database;
mod backup_restore;
mod data_root;
mod database_commands;
mod discovery_capabilities;
mod discovery_progress;
mod external_links;
mod import;
mod migrations;
mod portable_paths;
mod progress_link;
mod quest_facets;

use data_root::{StartupFailure, StartupPresentation, StartupState};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let paths = portable_paths::PortablePaths::current()
        .unwrap_or_else(|detail| portable_paths::exit_with_filesystem_error(&detail));
    let plan = data_root::prepare_startup(paths.clone())
        .unwrap_or_else(|detail| portable_paths::exit_with_filesystem_error(&detail));
    tauri::Builder::default()
        .manage(paths)
        .manage(backup_restore::RestoreSelectionState::default())
        .manage(data_root::DataRootSelectionState::default())
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            match tauri::async_runtime::block_on(data_root::initialize(plan)) {
                Ok((database, info)) => {
                    app.manage(database);
                    app.manage(StartupState(std::sync::Mutex::new(
                        StartupPresentation::Normal(info),
                    )));
                }
                Err(StartupFailure::Recovery(recovery)) => {
                    app.manage(StartupState(std::sync::Mutex::new(
                        StartupPresentation::Recovery(recovery),
                    )));
                }
                Err(StartupFailure::Filesystem(detail)) => {
                    portable_paths::exit_with_filesystem_error(&detail);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            database_commands::database_select,
            database_commands::database_execute,
            discovery_progress::mark_discovery_discovered,
            discovery_progress::set_discovery_reported,
            discovery_progress::set_discovery_card_owned,
            data_root::data_root_status,
            data_root::choose_custom_data_root,
            data_root::migrate_selected_data_root,
            data_root::migrate_to_default_data_root,
            data_root::recovery_choose_existing_root,
            data_root::recovery_activate_selected_root,
            data_root::recovery_activate_last_good,
            data_root::recovery_rollback_previous,
            backup_restore::create_database_backup,
            backup_restore::select_restore_backup,
            backup_restore::restore_database_backup,
            import::select_import_file,
            import::apply_master_import,
            progress_link::complete_quest_with_linked_discoveries,
            progress_link::discover_with_linked_quest,
            external_links::open_gvdb_site
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

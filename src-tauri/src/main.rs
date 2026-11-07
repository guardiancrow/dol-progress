// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod native_error;
mod single_instance;

fn main() {
    if let Err(error) = single_instance::run(dol_progress_manager_lib::run) {
        native_error::exit_with_native_error(&error.message());
    }
}

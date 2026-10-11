mod commands;
mod registry;
mod search;

use registry::FileRegistry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(FileRegistry::new())
        .invoke_handler(tauri::generate_handler![
            commands::open_file,
            commands::open_folder,
            commands::close_file,
            commands::read_range,
            commands::list_files,
            commands::search_bytes,
            commands::export_binary,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

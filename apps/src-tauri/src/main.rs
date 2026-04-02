mod commands;
mod db;
mod metadata;
mod storage;
mod sync;

pub struct AppState {
  pub db: std::sync::Mutex<db::Database>,
  pub drive: std::sync::Mutex<sync::DriveState>
}

fn main() {
  dotenvy::dotenv().ok();
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .manage(AppState {
      db: std::sync::Mutex::new(db::Database::new().expect("db init failed")),
      drive: std::sync::Mutex::new(sync::DriveState::default())
    })
    .invoke_handler(tauri::generate_handler![
      commands::import_books,
      commands::list_books,
      commands::refresh_metadata,
      commands::fetch_cover,
      commands::cover_data,
      commands::read_book_bytes,
      commands::update_progress,
      commands::reading_stats,
      commands::drive_auth_start,
      commands::drive_auth_wait,
      commands::drive_status,
      commands::drive_sync
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

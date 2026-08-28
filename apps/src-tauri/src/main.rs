#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod metadata;
mod storage;
mod sync;
use std::path::Path;
use tauri::{image::Image, Emitter, Manager};

const SUPPORTED_BOOK_EXTENSIONS: [&str; 4] = ["epub", "pdf", "mobi", "azw3"];

pub struct AppState {
  pub db: std::sync::Mutex<db::Database>,
  pub drive: std::sync::Mutex<sync::DriveState>,
  pub pending_open_paths: std::sync::Mutex<Vec<String>>
}

fn supported_book_paths(args: impl IntoIterator<Item = String>) -> Vec<String> {
  args
    .into_iter()
    .filter(|value| {
      let path = Path::new(value);
      path.is_file()
        && path
          .extension()
          .and_then(|extension| extension.to_str())
          .map(|extension| {
            SUPPORTED_BOOK_EXTENSIONS
              .iter()
              .any(|supported| extension.eq_ignore_ascii_case(supported))
          })
          .unwrap_or(false)
    })
    .collect()
}

fn main() {
  dotenvy::dotenv().ok();
  let startup_paths = supported_book_paths(std::env::args().skip(1));
  tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
      let paths = supported_book_paths(args.into_iter().skip(1));
      if !paths.is_empty() {
        let state = app.state::<AppState>();
        state.pending_open_paths.lock().unwrap().extend(paths);
        let _ = app.emit("open-book-files", ());
      }

      if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
      }
    }))
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      if let Some(window) = app.get_webview_window("main") {
        let bytes = include_bytes!("../../src/assets/logoLeaflet500x500.png");
        if let Ok(decoded) = image::load_from_memory(bytes) {
          let rgba = decoded.to_rgba8();
          let (width, height) = rgba.dimensions();
          let icon = Image::new_owned(rgba.into_raw(), width, height);
          let _ = window.set_icon(icon);
        }
      }
      Ok(())
    })
    .manage(AppState {
      db: std::sync::Mutex::new(db::Database::new().expect("db init failed")),
      drive: std::sync::Mutex::new(sync::DriveState::default()),
      pending_open_paths: std::sync::Mutex::new(startup_paths)
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
      commands::drive_sync,
      commands::converter_status,
      commands::install_converter,
      commands::take_pending_open_paths,
      commands::clear_all_data
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

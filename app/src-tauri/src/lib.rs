//! Gitvur desktop viewer backend. Read-only: it writes only to `<repo>/.gitvur/` when the
//! user clicks Index or Validate, and to its own config folder.

use std::time::{SystemTime, UNIX_EPOCH};

pub mod bindings;
pub mod bundle;
mod commands;
pub mod diffs;
pub mod error;
pub mod settings;

/// Starts the app.
///
/// # Panics
///
/// Panics if Tauri fails to start (e.g. no display), which is fatal anyway.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::open_repository,
            commands::index_repository,
            commands::validate_repository,
            commands::read_source,
            commands::recent_repositories,
            commands::get_settings,
            commands::set_settings,
            commands::list_commits,
            commands::diff_revisions,
            commands::read_revision_source,
            commands::forget_recent,
            commands::get_view_state,
            commands::set_view_state,
            commands::clear_view_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Gitvur app");
}

/// Current time as `YYYY-MM-DDTHH:MM:SSZ` for `manifest.generatedAt`.
pub(crate) fn now_rfc3339() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let (days, rem) = (secs / 86_400, secs % 86_400);
    // Howard Hinnant's civil-from-days.
    let z = days + 719_468;
    let (era, doe) = (z / 146_097, z % 146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + u64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

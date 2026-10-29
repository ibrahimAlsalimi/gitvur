//! Tauri commands: thin async wrappers that run the blocking work off the main thread.

use std::path::PathBuf;

use gitvur_index::{IndexOptions, index, write_output};
use tauri::{AppHandle, Manager};

use crate::bundle::{self, RepoBundle, SourceSlice};
use crate::error::{AppError, ErrorCode};
use crate::settings::{self, RecentRepo, Settings};

fn config_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path().app_config_dir().map_err(|e| {
        AppError::new(ErrorCode::Io, "cannot find the app config folder").with_detail(e.to_string())
    })
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| {
        AppError::new(ErrorCode::Io, "background task failed").with_detail(e.to_string())
    })?
}

/// Opens the repository and records it in the recent list.
fn open_and_remember(app: &AppHandle, path: &str) -> Result<RepoBundle, AppError> {
    let bundle = bundle::open_repository(path)?;
    // A failure to update the recent list must not prevent opening.
    let _ = settings::remember(
        &config_dir(app)?,
        &bundle.root,
        &bundle.manifest.project_name,
    );
    Ok(bundle)
}

#[tauri::command]
pub async fn open_repository(app: AppHandle, path: String) -> Result<RepoBundle, AppError> {
    blocking(move || open_and_remember(&app, &path)).await
}

/// Runs the extractor, writes `.gitvur/manifest.json` + `structure.json`, then reloads.
#[tauri::command]
pub async fn index_repository(app: AppHandle, path: String) -> Result<RepoBundle, AppError> {
    blocking(move || {
        let root = bundle::repo_root(&path)?;
        let generated_at = crate::now_rfc3339();
        let output = index(&root, &IndexOptions { generated_at }).map_err(|e| {
            AppError::new(ErrorCode::IndexFailed, "Indexing failed").with_detail(e.to_string())
        })?;
        let dir = gitvur_validate::gitvur_dir(&root).map_err(|e| {
            AppError::new(ErrorCode::PathEscape, "cannot write .gitvur").with_detail(e.to_string())
        })?;
        write_output(&dir, &output).map_err(|e| AppError::io("cannot write .gitvur", &e))?;
        open_and_remember(&app, &path)
    })
    .await
}

/// Runs the validator, writes `.gitvur/report.json`, then reloads.
#[tauri::command]
pub async fn validate_repository(app: AppHandle, path: String) -> Result<RepoBundle, AppError> {
    blocking(move || {
        let root = bundle::repo_root(&path)?;
        let report = gitvur_validate::validate_repo(&root).map_err(|e| {
            AppError::new(ErrorCode::IndexFailed, "Validation failed").with_detail(e.to_string())
        })?;
        let dir = gitvur_validate::gitvur_dir(&root).map_err(|e| {
            AppError::new(ErrorCode::PathEscape, "cannot write .gitvur").with_detail(e.to_string())
        })?;
        gitvur_validate::write_report(&dir, &report)
            .map_err(|e| AppError::io("cannot write report.json", &e))?;
        open_and_remember(&app, &path)
    })
    .await
}

#[tauri::command]
pub async fn read_source(
    path: String,
    file: String,
    start: u32,
    end: u32,
    context: u32,
) -> Result<SourceSlice, AppError> {
    blocking(move || bundle::read_source(&path, &file, start, end, context)).await
}

#[tauri::command]
pub async fn recent_repositories(app: AppHandle) -> Result<Vec<RecentRepo>, AppError> {
    let dir = config_dir(&app)?;
    blocking(move || Ok(settings::recent(&dir))).await
}

#[tauri::command]
pub async fn get_settings(app: AppHandle) -> Result<Settings, AppError> {
    let dir = config_dir(&app)?;
    blocking(move || Ok(settings::load(&dir))).await
}

#[tauri::command]
pub async fn set_settings(app: AppHandle, settings: Settings) -> Result<(), AppError> {
    let dir = config_dir(&app)?;
    blocking(move || settings::save(&dir, &settings)).await
}

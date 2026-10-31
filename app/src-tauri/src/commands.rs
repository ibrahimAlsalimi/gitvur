//! Tauri commands: thin async wrappers that run the blocking work off the main thread.

use std::path::PathBuf;

use gitvur_index::{IndexOptions, index, write_output};
use tauri::{AppHandle, Manager};

use crate::bundle::{self, RepoBundle, SourceSlice};
use crate::diffs::{self, CommitInfo, DiffBundle};
use crate::error::{AppError, ErrorCode};
use crate::settings::{self, RecentRepo, Settings, ViewState};

fn config_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path().app_config_dir().map_err(|e| {
        AppError::new(ErrorCode::Io, "cannot find the app config folder").with_detail(e.to_string())
    })
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path().app_data_dir().map_err(|e| {
        AppError::new(ErrorCode::Io, "cannot find the app data folder").with_detail(e.to_string())
    })
}

fn cache_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path().app_cache_dir().map_err(|e| {
        AppError::new(ErrorCode::Io, "cannot find the app cache folder").with_detail(e.to_string())
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

#[tauri::command]
pub async fn list_commits(path: String, limit: Option<usize>) -> Result<Vec<CommitInfo>, AppError> {
    blocking(move || diffs::list_commits(&path, limit.unwrap_or(50))).await
}

/// Indexes both revisions (read via Git into temporary folders, cached) and diffs them.
#[tauri::command]
pub async fn diff_revisions(
    app: AppHandle,
    path: String,
    from: String,
    to: String,
) -> Result<DiffBundle, AppError> {
    let cache = cache_dir(&app)?;
    blocking(move || diffs::diff_revisions(&path, &from, &to, &cache)).await
}

#[tauri::command]
pub async fn read_revision_source(
    path: String,
    rev: String,
    file: String,
    start: u32,
    end: u32,
    context: u32,
) -> Result<SourceSlice, AppError> {
    blocking(move || diffs::read_revision_source(&path, &rev, &file, start, end, context)).await
}

#[tauri::command]
pub async fn forget_recent(app: AppHandle, path: String) -> Result<(), AppError> {
    let dir = config_dir(&app)?;
    blocking(move || settings::forget(&dir, &path)).await
}

/// `root` is the bundle's canonical root, so the key does not depend on how it was typed.
#[tauri::command]
pub async fn get_view_state(app: AppHandle, root: String) -> Result<Option<ViewState>, AppError> {
    let dir = data_dir(&app)?;
    blocking(move || Ok(settings::view_state(&dir, &root))).await
}

#[tauri::command]
pub async fn set_view_state(
    app: AppHandle,
    root: String,
    state: ViewState,
) -> Result<(), AppError> {
    let dir = data_dir(&app)?;
    blocking(move || settings::save_view_state(&dir, &root, &state)).await
}

#[tauri::command]
pub async fn clear_view_state(app: AppHandle, root: String) -> Result<(), AppError> {
    let dir = data_dir(&app)?;
    blocking(move || settings::clear_view_state(&dir, &root)).await
}

/// The deterministic call tree of an entry point or node (read-only).
#[tauri::command]
pub async fn get_trace(
    path: String,
    start: String,
    depth: u32,
    max_nodes: u32,
) -> Result<gitvur_schema::Trace, AppError> {
    blocking(move || crate::trace::get_trace(&path, &start, depth, max_nodes)).await
}

#[tauri::command]
pub async fn list_docs(path: String) -> Result<Vec<crate::docs::DocEntry>, AppError> {
    blocking(move || crate::docs::list_docs(&path)).await
}
#[tauri::command]
pub async fn read_doc(path: String, doc_path: String) -> Result<crate::docs::DocContent, AppError> {
    blocking(move || crate::docs::read_doc(&path, &doc_path)).await
}
#[tauri::command]
pub async fn read_doc_asset(
    path: String,
    doc_path: String,
    href: String,
) -> Result<crate::docs::AssetData, AppError> {
    blocking(move || crate::docs::read_doc_asset(&path, &doc_path, &href)).await
}

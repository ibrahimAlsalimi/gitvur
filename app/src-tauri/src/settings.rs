//! App settings and recent repositories, stored in the app config directory, never in a
//! repository.

use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::AppError;

const RECENT_FILE: &str = "recent.json";
const SETTINGS_FILE: &str = "settings.json";
const MAX_RECENT: usize = 10;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RecentRepo {
    pub path: String,
    pub name: String,
    /// Unix time in seconds.
    #[ts(type = "number")]
    pub opened_at: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

/// UI preferences. Unknown or missing fields fall back to defaults, so old files keep working.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub explorer_width: u32,
    pub inspector_width: u32,
    pub inspector_collapsed: bool,
    pub theme: Theme,
    /// The first-run guide was finished or dismissed.
    pub guide_seen: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            explorer_width: 280,
            inspector_width: 380,
            inspector_collapsed: false,
            theme: Theme::System,
            guide_seen: false,
        }
    }
}

fn write_atomic(dir: &Path, name: &str, contents: &str) -> Result<(), AppError> {
    fs::create_dir_all(dir).map_err(|e| AppError::io("cannot create the app config folder", &e))?;
    let tmp = dir.join(format!(".{name}.tmp"));
    fs::write(&tmp, contents).map_err(|e| AppError::io("cannot save app settings", &e))?;
    fs::rename(&tmp, dir.join(name)).map_err(|e| AppError::io("cannot save app settings", &e))
}

pub fn recent(config_dir: &Path) -> Vec<RecentRepo> {
    fs::read_to_string(config_dir.join(RECENT_FILE))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

/// Moves `root` to the front of the recent list.
pub fn remember(config_dir: &Path, root: &str, name: &str) -> Result<(), AppError> {
    let mut list = recent(config_dir);
    list.retain(|r| r.path != root);
    let opened_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    list.insert(
        0,
        RecentRepo {
            path: root.to_owned(),
            name: name.to_owned(),
            opened_at,
        },
    );
    list.truncate(MAX_RECENT);
    write_atomic(
        config_dir,
        RECENT_FILE,
        &gitvur_schema::to_canonical_json(&list),
    )
}

pub fn load(config_dir: &Path) -> Settings {
    fs::read_to_string(config_dir.join(SETTINGS_FILE))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub fn save(config_dir: &Path, settings: &Settings) -> Result<(), AppError> {
    write_atomic(
        config_dir,
        SETTINGS_FILE,
        &gitvur_schema::to_canonical_json(settings),
    )
}

/// Removes `path` from the recent list (a repository that moved or was deleted).
pub fn forget(config_dir: &Path, path: &str) -> Result<(), AppError> {
    let mut list = recent(config_dir);
    list.retain(|r| r.path != path);
    write_atomic(
        config_dir,
        RECENT_FILE,
        &gitvur_schema::to_canonical_json(&list),
    )
}

/// The map's camera.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Viewport {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}

/// Where the user was in one repository. Stored per repository in the app data folder
/// (keyed by a hash of the canonical path), never in the repository. Every field is
/// optional so old or partial files still load; the viewer drops IDs that no longer exist.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
pub struct ViewState {
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_tab: Option<String>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doc_path: Option<String>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doc_scroll: Option<f64>,
    /// Flows tab: the selected flow or entry point ID.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flow_selection: Option<String>,
    /// Flows tab: `flow` or `trace`.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flow_mode: Option<String>,
    pub expanded_ids: Vec<String>,
    /// Classes whose rows are folded on the map.
    pub collapsed_ids: Vec<String>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_id: Option<String>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub viewport: Option<Viewport>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lens: Option<String>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff_from: Option<String>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff_to: Option<String>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub explorer_width: Option<u32>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inspector_width: Option<u32>,
}

fn view_file(data_dir: &Path, root: &str) -> std::path::PathBuf {
    let hash = gitvur_schema::content_hash(root);
    data_dir
        .join("views")
        .join(format!("{}.json", &hash[7..23]))
}

/// The saved view of the repository at canonical path `root`, if any.
pub fn view_state(data_dir: &Path, root: &str) -> Option<ViewState> {
    let text = fs::read_to_string(view_file(data_dir, root)).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn save_view_state(data_dir: &Path, root: &str, state: &ViewState) -> Result<(), AppError> {
    let file = view_file(data_dir, root);
    let dir = file.parent().unwrap_or(data_dir);
    let name = file
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("view.json");
    let json = serde_json::to_string(state)
        .map_err(|e| AppError::io("cannot save the view", &std::io::Error::other(e)))?;
    write_atomic(dir, name, &json)
}

/// "Reset view": forgets the saved view of `root`.
pub fn clear_view_state(data_dir: &Path, root: &str) -> Result<(), AppError> {
    match fs::remove_file(view_file(data_dir, root)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
            Err(AppError::io("cannot reset the view", &e))
        }
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn view_state_round_trips_per_repository_and_resets() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(view_state(dir.path(), "/a"), None);
        let state = ViewState {
            expanded_ids: vec!["module:x".into()],
            selected_id: Some("file:a.py".into()),
            viewport: Some(Viewport {
                x: 1.0,
                y: 2.5,
                zoom: 0.8,
            }),
            lens: Some("coverage".into()),
            ..ViewState::default()
        };
        save_view_state(dir.path(), "/a", &state).unwrap();
        assert_eq!(view_state(dir.path(), "/a"), Some(state));
        assert_eq!(view_state(dir.path(), "/b"), None);
        clear_view_state(dir.path(), "/a").unwrap();
        clear_view_state(dir.path(), "/a").unwrap();
        assert_eq!(view_state(dir.path(), "/a"), None);
        // Partial files load with defaults.
        fs::write(view_file(dir.path(), "/c"), r#"{"lens":"changes"}"#).unwrap();
        assert_eq!(
            view_state(dir.path(), "/c").unwrap().lens.as_deref(),
            Some("changes")
        );
    }

    #[test]
    fn forget_removes_a_recent_repository() {
        let dir = tempfile::tempdir().unwrap();
        remember(dir.path(), "/a", "a").unwrap();
        remember(dir.path(), "/b", "b").unwrap();
        forget(dir.path(), "/a").unwrap();
        let paths: Vec<String> = recent(dir.path()).into_iter().map(|r| r.path).collect();
        assert_eq!(paths, ["/b"]);
    }
}

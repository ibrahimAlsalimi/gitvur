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
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            explorer_width: 280,
            inspector_width: 380,
            inspector_collapsed: false,
            theme: Theme::System,
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

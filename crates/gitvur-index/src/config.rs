//! Config is data: parse declared entry paths without evaluating a shell or loading packages.
use gitvur_schema::EntryKind;
use serde::Deserialize;
use serde_json::value::RawValue;
use std::{collections::BTreeMap, fs, path::Path};

pub(crate) enum Target {
    File(String),
    Python(String),
}
pub(crate) struct ConfigEntry {
    pub kind: EntryKind,
    pub name: String,
    pub raw: String,
    pub file: String,
    pub line: u32,
    pub target: Target,
}

pub(crate) fn is_config(path: &str) -> bool {
    matches!(
        path.rsplit('/').next(),
        Some("package.json" | "pyproject.toml")
    )
}

pub(crate) fn discover(root: &Path, warnings: &mut Vec<String>) -> Vec<ConfigEntry> {
    let (paths, walk_warnings) = crate::walk::discover(root, is_config);
    warnings.extend(walk_warnings);
    let mut entries = Vec::new();
    for path in paths {
        let content = if let Some(text) = root
            .join(&path)
            .canonicalize()
            .ok()
            .filter(|p| p.starts_with(root))
            .and_then(|p| fs::read_to_string(p).ok())
        {
            text.replace("\r\n", "\n").replace('\r', "\n")
        } else {
            warnings.push(format!(
                "{path}: cannot read entry point configuration; skipped"
            ));
            continue;
        };
        let parsed = if path.ends_with("pyproject.toml") {
            python(&path, &content)
        } else {
            package(&path, &content)
        };
        match parsed {
            Ok(found) => entries.extend(found),
            Err(error) => warnings.push(format!(
                "{path}: invalid entry point configuration: {error}"
            )),
        }
    }
    entries.sort_by(|a, b| {
        (&a.file, a.line, a.kind, &a.name, &a.raw).cmp(&(&b.file, b.line, b.kind, &b.name, &b.raw))
    });
    entries
}

fn line_at(text: &str, offset: usize) -> u32 {
    u32::try_from(text.bytes().take(offset).filter(|&b| b == b'\n').count() + 1).unwrap_or(u32::MAX)
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct Project {
    scripts: BTreeMap<String, toml::Spanned<toml::Value>>,
    #[serde(rename = "gui-scripts")]
    gui_scripts: BTreeMap<String, toml::Spanned<toml::Value>>,
}
#[derive(Default, Deserialize)]
#[serde(default)]
struct Poetry {
    scripts: BTreeMap<String, toml::Spanned<toml::Value>>,
}
#[derive(Default, Deserialize)]
#[serde(default)]
struct Tool {
    poetry: Poetry,
}
#[derive(Default, Deserialize)]
#[serde(default)]
struct PyProject {
    project: Project,
    tool: Tool,
}

fn python(file: &str, text: &str) -> Result<Vec<ConfigEntry>, String> {
    let config: PyProject = toml::from_str(text).map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    for scripts in [
        config.project.scripts,
        config.project.gui_scripts,
        config.tool.poetry.scripts,
    ] {
        for (name, value) in scripts {
            let Some(raw) = value.get_ref().as_str() else {
                continue;
            };
            entries.push(ConfigEntry {
                kind: EntryKind::ConsoleScript,
                name,
                raw: raw.into(),
                file: file.into(),
                line: line_at(text, value.span().start),
                target: Target::Python(raw.into()),
            });
        }
    }
    Ok(entries)
}

type Object<'a> = BTreeMap<String, &'a RawValue>;
fn object(value: &RawValue) -> Option<Object<'_>> {
    serde_json::from_str(value.get()).ok()
}
fn string(value: &RawValue) -> Option<String> {
    serde_json::from_str(value.get()).ok()
}

/// Borrowed raw JSON retains each value's original byte address, including repeated values
/// and escaped strings. This yields exact evidence lines without searching text by value.
fn raw_line(text: &str, value: &RawValue) -> u32 {
    line_at(
        text,
        value
            .get()
            .as_ptr()
            .addr()
            .saturating_sub(text.as_ptr().addr()),
    )
}

fn package(file: &str, text: &str) -> Result<Vec<ConfigEntry>, String> {
    let config: Object<'_> = serde_json::from_str(text).map_err(|e| e.to_string())?;
    let name = config
        .get("name")
        .and_then(|v| string(v))
        .unwrap_or_else(|| file.into());
    let mut entries = Vec::new();
    let mut add = |kind, name: String, value: &RawValue, target: Option<String>| {
        if let Some(raw) = string(value) {
            entries.push(ConfigEntry {
                kind,
                name,
                raw: raw.clone(),
                file: file.into(),
                line: raw_line(text, value),
                target: Target::File(target.unwrap_or(raw)),
            });
        }
    };
    if let Some(bin) = config.get("bin") {
        if string(bin).is_some() {
            add(EntryKind::PackageBin, name.clone(), bin, None);
        } else if let Some(bins) = object(bin) {
            for (key, value) in bins {
                add(EntryKind::PackageBin, key, value, None);
            }
        }
    }
    for field in ["main", "module"] {
        if let Some(value) = config.get(field) {
            add(
                EntryKind::PackageMain,
                format!("{name}:{field}"),
                value,
                None,
            );
        }
    }
    if let Some(exports) = config.get("exports").and_then(|v| object(v))
        && let Some(value) = exports.get(".")
    {
        let mut leaves = Vec::new();
        export_leaves(value, String::new(), &mut leaves);
        for (condition, value) in leaves {
            add(
                EntryKind::PackageMain,
                format!("{name}:exports{condition}"),
                value,
                None,
            );
        }
    }
    if let Some(scripts) = config.get("scripts").and_then(|v| object(v)) {
        for (key, value) in scripts {
            if let Some(raw) = string(value)
                && let Some(path) = script_path(&raw)
            {
                add(
                    EntryKind::NpmScript,
                    format!("{name}:{key}"),
                    value,
                    Some(path),
                );
            }
        }
    }
    Ok(entries)
}

fn export_leaves<'a>(value: &'a RawValue, path: String, out: &mut Vec<(String, &'a RawValue)>) {
    if string(value).is_some() {
        out.push((path, value));
    } else if let Some(conditions) = object(value) {
        for (key, child) in conditions {
            export_leaves(child, format!("{path}:{key}"), out);
        }
    }
}

fn script_path(command: &str) -> Option<String> {
    // Recognise an anchored runner and the next path only. Never expand variables,
    // interpret operators, follow shell commands, or execute any part of the value.
    let mut parts = command.split_whitespace();
    let runner = parts.next()?;
    match runner {
        "node" | "ts-node" | "tsx" | "bun" => {}
        "deno" if parts.next() == Some("run") => {}
        _ => return None,
    }
    let token = parts.next()?;
    let path = token
        .split([';', '&', '|', '>', '<'])
        .next()?
        .trim_matches(['\'', '"']);
    if path.is_empty()
        || path.starts_with('-')
        || path.contains(['$', '`', ';', '&', '|', '>', '<'])
    {
        return None;
    }
    Some(path.into())
}

/// Resolve config paths lexically without touching the filesystem. Only indexed files
/// can become targets, so symlinks, dependencies and paths beyond the root never resolve.
pub(crate) fn relative_path(config: &str, value: &str) -> Option<String> {
    if value.is_empty() || value.starts_with('/') || value.contains(['\\', ':', '\0']) {
        return None;
    }
    let mut parts: Vec<_> = config.split('/').collect();
    parts.pop();
    for part in value.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            _ => parts.push(part),
        }
    }
    Some(parts.join("/"))
}

//! File discovery: `.gitignore`-aware, deterministic, never leaves the repository.

use std::path::Path;

use ignore::WalkBuilder;

/// Directory names that are never indexed, at any depth.
pub const SKIPPED_DIRS: &[&str] = &[
    ".git",
    ".gitvur",
    "node_modules",
    "venv",
    ".venv",
    "__pycache__",
    "dist",
    "build",
    "target",
];

/// Repo-relative, `/`-separated paths of the files `wanted` accepts, sorted.
///
/// Only `.gitignore` files inside `root` are honoured: global gitignore,
/// `.git/info/exclude` and `.ignore` files are machine-specific or non-standard and
/// would make the output depend on where it runs. Symlinks are never followed or indexed.
/// Walk errors (unreadable directories, malformed `.gitignore` patterns) become warnings.
pub fn discover(root: &Path, wanted: impl Fn(&str) -> bool) -> (Vec<String>, Vec<String>) {
    let walker = WalkBuilder::new(root)
        .hidden(false)
        .parents(false)
        .ignore(false)
        .git_ignore(true)
        .git_global(false)
        .git_exclude(false)
        .require_git(false)
        .follow_links(false)
        .filter_entry(|entry| {
            let is_dir = entry.file_type().is_some_and(|t| t.is_dir());
            !(is_dir && entry.depth() > 0 && SKIPPED_DIRS.iter().any(|d| entry.file_name() == *d))
        })
        .build();

    let mut files = Vec::new();
    let mut warnings = Vec::new();
    for entry in walker {
        let entry = match entry {
            Ok(entry) => entry,
            Err(err) => {
                warnings.push(format!("skipping: {err}"));
                continue;
            }
        };
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue; // directories, symlinks, sockets
        }
        let Ok(relative) = entry.path().strip_prefix(root) else {
            continue;
        };
        let parts: Option<Vec<&str>> = relative
            .components()
            .map(|c| c.as_os_str().to_str())
            .collect();
        let Some(parts) = parts else {
            warnings.push(format!("skipping non-UTF-8 path {}", relative.display()));
            continue;
        };
        let relpath = parts.join("/");
        if wanted(&relpath) {
            files.push(relpath);
        }
    }
    files.sort();
    (files, warnings)
}

//! Markdown discovery using exactly the source indexer's walk policy.
use std::fs::File;
use std::io::{self, Read};
use std::path::Path;
use std::time::UNIX_EPOCH;

#[derive(Debug, Clone)]
pub struct DocEntry {
    pub path: String,
    pub title: String,
    pub size_bytes: u64,
    /// Unix seconds, as a string to avoid precision loss across the bridge.
    pub modified: String,
}

pub fn discover_docs(repo: &Path) -> io::Result<Vec<DocEntry>> {
    let root = repo.canonicalize()?;
    let (paths, _) = crate::walk::discover(&root, |p| {
        Path::new(p)
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("markdown"))
    });
    let mut docs = Vec::new();
    for path in paths {
        let Ok(file) = File::open(root.join(&path)) else {
            continue;
        };
        let Ok(meta) = file.metadata() else { continue };
        let mut bytes = Vec::new();
        if file.take(4096).read_to_end(&mut bytes).is_err() {
            continue;
        }
        let title = String::from_utf8_lossy(&bytes)
            .lines()
            .find_map(|l| l.strip_prefix("# ").map(str::trim))
            .filter(|s| !s.is_empty())
            .map_or_else(
                || {
                    Path::new(&path)
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned()
                },
                str::to_owned,
            );
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map_or_else(String::new, |d| d.as_secs().to_string());
        docs.push(DocEntry {
            path,
            title,
            size_bytes: meta.len(),
            modified,
        });
    }
    docs.sort_by(|a, b| (rank(&a.path), &a.path).cmp(&(rank(&b.path), &b.path)));
    Ok(docs)
}

fn rank(p: &str) -> u8 {
    if p.eq_ignore_ascii_case("README.md") {
        0
    } else if p.starts_with("docs/") || p.starts_with("doc/") {
        1
    } else {
        2
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ordering_titles_and_walk_policy() {
        let dir = tempfile::tempdir().unwrap();
        for folder in ["docs", "node_modules", "ignored"] {
            std::fs::create_dir(dir.path().join(folder)).unwrap();
        }
        for (p, text) in [
            ("z.md", "No heading"),
            ("README.md", "# Welcome"),
            ("docs/a.markdown", "# Guide"),
            ("node_modules/a.md", "# Hidden"),
            ("ignored/a.md", "# Hidden"),
            ("a.mdx", "# Ignored"),
            (".gitignore", "ignored/"),
        ] {
            std::fs::write(dir.path().join(p), text).unwrap();
        }
        let entries = discover_docs(dir.path()).unwrap();
        assert_eq!(
            entries.iter().map(|d| d.path.as_str()).collect::<Vec<_>>(),
            ["README.md", "docs/a.markdown", "z.md"]
        );
        assert_eq!(entries[0].title, "Welcome");
        assert_eq!(entries[2].title, "z.md");
    }
}

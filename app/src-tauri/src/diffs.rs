//! Structural diff between two revisions, for the Changes lens. Revisions are read from
//! Git's object database into temporary directories; the repository is never written.
//! Indexed structures are cached in the app cache folder by
//! `(repository path hash, commit SHA, extractor version)`.

use std::fs;
use std::path::Path;

use gitvur_diff::revision::{self, RevisionError, WORKTREE};
use gitvur_schema::{Structure, StructureDiff, content_hash, to_canonical_json};
use serde::Serialize;
use ts_rs::TS;

use crate::bundle::{self, SourceSlice};
use crate::error::{AppError, ErrorCode};

/// A commit for the revision picker.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub sha: String,
    pub short: String,
    pub subject: String,
    pub author: String,
    /// Committer time, seconds since the Unix epoch.
    #[ts(type = "number")]
    pub date: i64,
}

/// A diff with both structures, so the viewer can draw the union of A and B.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DiffBundle {
    pub diff: StructureDiff,
    pub from: Structure,
    pub to: Structure,
}

fn git_error(err: &RevisionError) -> AppError {
    let code = match err {
        RevisionError::Index(_) => ErrorCode::IndexFailed,
        _ => ErrorCode::Io,
    };
    AppError::new(code, "Cannot read the revision").with_detail(err.to_string())
}

pub fn list_commits(path: &str, limit: usize) -> Result<Vec<CommitInfo>, AppError> {
    let root = bundle::repo_root(path)?;
    let commits = revision::list_commits(&root, limit).map_err(|e| git_error(&e))?;
    Ok(commits
        .into_iter()
        .map(|c| CommitInfo {
            sha: c.sha,
            short: c.short,
            subject: c.subject,
            author: c.author,
            date: c.time,
        })
        .collect())
}

/// The structure of `rev` (a full SHA from [`revision::resolve`], or `worktree`), from the
/// cache when present. The working tree is never cached. Cache failures are ignored.
fn structure(root: &Path, cache: &Path, rev: &str) -> Result<(String, Structure), AppError> {
    if rev == WORKTREE {
        let r = revision::index_revision(root, WORKTREE).map_err(|e| git_error(&e))?;
        return Ok((r.sha, r.structure));
    }
    let sha = revision::resolve(root, rev).map_err(|e| git_error(&e))?;
    let key = content_hash(&root.to_string_lossy());
    let dir = cache.join("revisions").join(&key[7..23]);
    let file = dir.join(format!("{sha}-{}.json", env!("CARGO_PKG_VERSION")));
    if let Some(cached) = fs::read_to_string(&file)
        .ok()
        .and_then(|text| serde_json::from_str::<Structure>(&text).ok())
    {
        return Ok((sha, cached));
    }
    let r = revision::index_revision(root, &sha).map_err(|e| git_error(&e))?;
    if fs::create_dir_all(&dir).is_ok() {
        let tmp = file.with_extension("tmp");
        if fs::write(&tmp, to_canonical_json(&r.structure)).is_ok() {
            let _ = fs::rename(&tmp, &file);
        }
    }
    Ok((sha, r.structure))
}

pub fn diff_revisions(
    path: &str,
    from: &str,
    to: &str,
    cache: &Path,
) -> Result<DiffBundle, AppError> {
    let root = bundle::repo_root(path)?;
    let (from_sha, a) = structure(&root, cache, from)?;
    let (to_sha, b) = structure(&root, cache, to)?;
    let mut diff = gitvur_diff::diff(&a, &b);
    diff.from_commit = from_sha;
    diff.to_commit = to_sha;
    Ok(DiffBundle {
        diff,
        from: a,
        to: b,
    })
}

/// Source of `file` in `rev` (`worktree` reads the file on disk, path-checked).
pub fn read_revision_source(
    path: &str,
    rev: &str,
    file: &str,
    start: u32,
    end: u32,
    context: u32,
) -> Result<SourceSlice, AppError> {
    if rev == WORKTREE {
        return bundle::read_source(path, file, start, end, context);
    }
    let root = bundle::repo_root(path)?;
    let bytes = revision::read_file(&root, rev, file)
        .map_err(|e| git_error(&e))?
        .ok_or_else(|| AppError::new(ErrorCode::Io, format!("`{file}` is not in {rev}")))?;
    Ok(bundle::slice(file, &bytes, start, end, context))
}

#[cfg(test)]
mod tests {
    use std::process::Command;

    use super::*;

    fn git(dir: &Path, args: &[&str]) {
        let ok = Command::new("git")
            .args([
                "-c",
                "core.hooksPath=/dev/null",
                "-c",
                "commit.gpgsign=false",
            ])
            .args([
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.invalid",
            ])
            .args(args)
            .current_dir(dir)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .status()
            .unwrap()
            .success();
        assert!(ok, "git {args:?}");
    }

    #[test]
    fn diffs_revisions_with_a_cache_and_reads_old_sources() {
        let repo = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let dir = repo.path();
        fs::write(dir.join("a.py"), "def f():\n    return 1\n").unwrap();
        git(dir, &["init", "-q", "-b", "main"]);
        git(dir, &["add", "a.py"]);
        git(dir, &["commit", "-q", "-m", "one"]);
        fs::write(dir.join("a.py"), "def f():\n    return 2\n").unwrap();
        git(dir, &["commit", "-q", "-am", "two"]);
        let path = dir.to_str().unwrap();

        let commits = list_commits(path, 50).unwrap();
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].subject, "two");

        let first = diff_revisions(path, "HEAD~1", "HEAD", cache.path()).unwrap();
        assert_eq!(first.diff.summary.modified, 2);
        let cached = fs::read_dir(cache.path().join("revisions"))
            .unwrap()
            .count();
        assert_eq!(cached, 1);
        let again = diff_revisions(path, "HEAD~1", "HEAD", cache.path()).unwrap();
        assert_eq!(first, again);

        let worktree = diff_revisions(path, "HEAD", WORKTREE, cache.path()).unwrap();
        assert_eq!(worktree.diff.elements, vec![]);

        let old = read_revision_source(path, &first.diff.from_commit, "a.py", 1, 2, 0).unwrap();
        assert_eq!(old.lines, ["def f():", "    return 1"]);
        assert!(read_revision_source(path, "HEAD", "missing.py", 1, 1, 0).is_err());
    }
}

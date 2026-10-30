//! Revisions without a checkout: read a commit's tree with `gix`, write the blobs that
//! indexing needs into a fresh temporary directory, index it, delete it.
//!
//! The user's working tree, index, `HEAD` and refs are only read, never written.

use std::fs;
use std::path::{Path, PathBuf};

use gitvur_index::{IndexOptions, index, index_inputs, walk::SKIPPED_DIRS};
use gitvur_schema::Structure;

/// Revision name that means "the files on disk now" (indexed in place, read-only).
pub const WORKTREE: &str = "worktree";

#[derive(Debug, thiserror::Error)]
pub enum RevisionError {
    #[error("{path} is not inside a Git repository: {message}")]
    NoRepository { path: PathBuf, message: String },
    #[error("cannot resolve revision `{rev}`: {message}")]
    Resolve { rev: String, message: String },
    #[error("cannot read the Git object database: {0}")]
    Read(String),
    #[error("cannot write the temporary copy: {0}")]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Index(#[from] gitvur_index::IndexError),
}

/// A commit, for pickers and summaries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Commit {
    /// Full hex SHA.
    pub sha: String,
    /// 7-character SHA.
    pub short: String,
    /// First line of the message.
    pub subject: String,
    pub author: String,
    /// Committer time, seconds since the Unix epoch.
    pub time: i64,
}

/// The structure of one revision.
#[derive(Debug, Clone)]
pub struct Revision {
    /// Full SHA, or [`WORKTREE`].
    pub sha: String,
    pub structure: Structure,
}

fn open(repo: &Path) -> Result<gix::Repository, RevisionError> {
    gix::discover(repo).map_err(|e| RevisionError::NoRepository {
        path: repo.to_path_buf(),
        message: e.to_string(),
    })
}

/// Resolves `rev` (`HEAD`, `HEAD~1`, a branch, a SHA prefix) to a full commit SHA.
pub fn resolve(repo: &Path, rev: &str) -> Result<String, RevisionError> {
    let repository = open(repo)?;
    resolve_in(&repository, rev).map(|c| c.id.to_string())
}

fn resolve_in<'r>(repo: &'r gix::Repository, rev: &str) -> Result<gix::Commit<'r>, RevisionError> {
    let fail = |message: String| RevisionError::Resolve {
        rev: rev.to_owned(),
        message,
    };
    let id = repo
        .rev_parse_single(rev)
        .map_err(|e| fail(e.to_string()))?;
    id.object()
        .map_err(|e| fail(e.to_string()))?
        .peel_to_commit()
        .map_err(|e| fail(e.to_string()))
}

/// Up to `limit` commits reachable from `HEAD`, newest first (by commit time, then SHA).
pub fn list_commits(repo: &Path, limit: usize) -> Result<Vec<Commit>, RevisionError> {
    let repository = open(repo)?;
    let read = |e: &dyn std::fmt::Display| RevisionError::Read(e.to_string());
    let Ok(head) = repository.head_id() else {
        return Ok(Vec::new()); // no commits yet
    };
    let walk = repository
        .rev_walk([head.detach()])
        .sorting(gix::revision::walk::Sorting::ByCommitTime(
            gix::traverse::commit::simple::CommitTimeOrder::default(),
        ))
        .all()
        .map_err(|e| read(&e))?;
    let mut commits = Vec::new();
    for info in walk.take(limit) {
        let info = info.map_err(|e| read(&e))?;
        let commit = repository.find_commit(info.id).map_err(|e| read(&e))?;
        let message = commit.message_raw_sloppy().to_string();
        let author = commit
            .author()
            .map(|a| a.name.to_string())
            .unwrap_or_default();
        let time = commit.time().map(|t| t.seconds).unwrap_or_default();
        let sha = info.id.to_string();
        commits.push(Commit {
            short: sha[..7.min(sha.len())].to_owned(),
            sha,
            subject: message.lines().next().unwrap_or_default().trim().to_owned(),
            author,
            time,
        });
    }
    Ok(commits)
}

/// Indexes `rev` of the repository at `repo`. [`WORKTREE`] indexes the files on disk in
/// place (read-only); anything else is resolved to a commit and indexed from a temporary
/// copy of its tree, which is deleted afterwards, also on error.
pub fn index_revision(repo: &Path, rev: &str) -> Result<Revision, RevisionError> {
    let opts = IndexOptions {
        generated_at: String::new(),
    };
    if rev == WORKTREE {
        let output = index(repo, &opts)?;
        return Ok(Revision {
            sha: WORKTREE.to_owned(),
            structure: output.structure,
        });
    }
    let repository = open(repo)?;
    let commit = resolve_in(&repository, rev)?;
    let sha = commit.id.to_string();
    // The copy lives in a directory named like the repository, so the project node (named
    // after the root folder) is the same on both sides.
    let name = repo
        .canonicalize()?
        .file_name()
        .map_or_else(|| "root".into(), std::ffi::OsStr::to_os_string);
    let temp = tempfile::Builder::new().prefix("gitvur-rev-").tempdir()?;
    let root = temp.path().join(name);
    fs::create_dir(&root)?;
    materialize(&repository, &commit, &root)?;
    let output = index(&root, &opts)?;
    temp.close()?;
    Ok(Revision {
        sha,
        structure: output.structure,
    })
}

/// Writes the blobs of `commit` that indexing reads into `dest`. Skips symlinks,
/// submodules, directories in [`SKIPPED_DIRS`], non-UTF-8 paths and any path component
/// that could leave `dest` (`.`, `..`, backslashes).
fn materialize(
    repo: &gix::Repository,
    commit: &gix::Commit<'_>,
    dest: &Path,
) -> Result<(), RevisionError> {
    let read = |e: &dyn std::fmt::Display| RevisionError::Read(e.to_string());
    let tree = commit.tree().map_err(|e| read(&e))?;
    let mut recorder = gix::traverse::tree::Recorder::default();
    tree.traverse()
        .breadthfirst(&mut recorder)
        .map_err(|e| read(&e))?;
    let wanted = index_inputs();
    for entry in recorder.records {
        if !entry.mode.is_blob() {
            continue; // trees, symlinks, submodules
        }
        let Ok(relpath) = std::str::from_utf8(&entry.filepath) else {
            continue;
        };
        let parts: Vec<&str> = relpath.split('/').collect();
        let unsafe_part = parts
            .iter()
            .any(|p| p.is_empty() || *p == "." || *p == ".." || p.contains('\\'));
        let skipped = parts[..parts.len() - 1]
            .iter()
            .any(|p| SKIPPED_DIRS.contains(p));
        if unsafe_part || skipped || !wanted(relpath) {
            continue;
        }
        let blob = repo.find_blob(entry.oid).map_err(|e| read(&e))?;
        let path = dest.join(relpath);
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        fs::write(&path, &blob.data)?;
    }
    Ok(())
}

/// The bytes of `relpath` in commit `rev`, or `None` when the commit has no such blob.
/// Read from the object database; nothing is written.
pub fn read_file(repo: &Path, rev: &str, relpath: &str) -> Result<Option<Vec<u8>>, RevisionError> {
    let read = |e: &dyn std::fmt::Display| RevisionError::Read(e.to_string());
    let repository = open(repo)?;
    let commit = resolve_in(&repository, rev)?;
    let tree = commit.tree().map_err(|e| read(&e))?;
    let Some(entry) = tree.lookup_entry_by_path(relpath).map_err(|e| read(&e))? else {
        return Ok(None);
    };
    if !entry.mode().is_blob() {
        return Ok(None);
    }
    let blob = repository
        .find_blob(entry.object_id())
        .map_err(|e| read(&e))?;
    Ok(Some(blob.data.clone()))
}

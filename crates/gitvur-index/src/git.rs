//! Commit SHA lookup without spawning `git`.

use std::path::Path;

/// Short (7-character) SHA of `HEAD` for the repository containing `path`, or `None`
/// when there is no repository or it has no commits.
pub fn head_short_sha(path: &Path) -> Option<String> {
    let repo = gix::discover(path).ok()?;
    let id = repo.head_id().ok()?;
    Some(id.to_hex_with_len(7).to_string())
}

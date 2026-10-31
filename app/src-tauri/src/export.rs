//! `write_export`: saves an exported diagram where the user chose in the save dialog.
//! Never inside the analysed repository (the viewer is read-only).

use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine as _;

use crate::bundle;
use crate::error::{AppError, ErrorCode};

/// Largest export accepted (a 2× PNG of a large trace is a few MB).
pub const MAX_EXPORT_BYTES: usize = 64 * 1024 * 1024;

/// Checks that `target` is an absolute `.png`/`.svg` path in an existing directory outside
/// the canonical repository root (after resolving symlinks). Returns the path to write.
pub fn export_target(repo: &str, target: &str) -> Result<PathBuf, AppError> {
    let root = bundle::repo_root(repo)?;
    let path = Path::new(target);
    let refuse = |message: &str| AppError::new(ErrorCode::PathEscape, message);
    if !path.is_absolute() {
        return Err(refuse("The export path must be absolute"));
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    if !matches!(ext.as_deref(), Some("png" | "svg")) {
        return Err(refuse("Exports are saved as .png or .svg files"));
    }
    let name = path
        .file_name()
        .ok_or_else(|| refuse("The export path has no file name"))?;
    let parent = path
        .parent()
        .ok_or_else(|| refuse("The export path has no folder"))?
        .canonicalize()
        .map_err(|e| AppError::io("cannot open the export folder", &e))?;
    let resolved = parent.join(name);
    // An existing symlink is followed, so its real target is what must stay outside.
    let real = resolved.canonicalize().unwrap_or_else(|_| resolved.clone());
    if parent.starts_with(&root) || real.starts_with(&root) {
        return Err(refuse(
            "Exports can't be saved inside the repository; choose another folder",
        ));
    }
    Ok(resolved)
}

pub fn write_export(repo: &str, target: &str, data_base64: &str) -> Result<(), AppError> {
    let path = export_target(repo, target)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64)
        .map_err(|e| {
            AppError::new(ErrorCode::Io, "the export data is invalid").with_detail(e.to_string())
        })?;
    if bytes.len() > MAX_EXPORT_BYTES {
        return Err(AppError::new(ErrorCode::Io, "the export is too large"));
    }
    fs::write(&path, bytes).map_err(|e| AppError::io("cannot write the export", &e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(p: &Path) -> String {
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn writes_outside_and_refuses_inside_the_repository() {
        let repo = tempfile::tempdir().unwrap();
        let out = tempfile::tempdir().unwrap();
        let data = base64::engine::general_purpose::STANDARD.encode(b"<svg/>");
        let target = out.path().join("flow.svg");
        write_export(&s(repo.path()), &s(&target), &data).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"<svg/>");

        fs::create_dir(repo.path().join("docs")).unwrap();
        let inside = repo.path().join("docs/flow.png");
        let err = write_export(&s(repo.path()), &s(&inside), &data).unwrap_err();
        assert_eq!(err.code, ErrorCode::PathEscape);
        assert!(!inside.exists());
        let err =
            write_export(&s(repo.path()), &s(&out.path().join("flow.txt")), &data).unwrap_err();
        assert_eq!(err.code, ErrorCode::PathEscape);
        assert!(export_target(&s(repo.path()), "flow.png").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlinks_that_lead_into_the_repository() {
        let repo = tempfile::tempdir().unwrap();
        let out = tempfile::tempdir().unwrap();
        let link = out.path().join("into-repo");
        std::os::unix::fs::symlink(repo.path(), &link).unwrap();
        assert!(export_target(&s(repo.path()), &s(&link.join("a.png"))).is_err());
        fs::write(repo.path().join("x.png"), b"").unwrap();
        let file_link = out.path().join("b.png");
        std::os::unix::fs::symlink(repo.path().join("x.png"), &file_link).unwrap();
        assert!(export_target(&s(repo.path()), &s(&file_link)).is_err());
    }
}

//! Bounded, read-only Markdown and image access. All paths stay inside the repository.
use std::fs::File;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

use crate::error::{AppError, ErrorCode};
use base64::Engine;
use serde::Serialize;
use ts_rs::TS;

const DOC_LIMIT: u64 = 2 * 1024 * 1024;
const ASSET_LIMIT: u64 = 5 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DocEntry {
    pub path: String,
    pub title: String,
    #[ts(type = "number")]
    pub size_bytes: u64,
    pub modified: String,
}
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DocContent {
    pub path: String,
    pub text: String,
    pub truncated: bool,
}
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AssetData {
    pub mime: String,
    pub data_url: String,
}

fn blocked() -> AppError {
    AppError::new(
        ErrorCode::PathEscape,
        "Image or document outside the repository was not loaded",
    )
}

pub fn list_docs(path: &str) -> Result<Vec<DocEntry>, AppError> {
    let root = crate::bundle::repo_root(path)?;
    gitvur_index::discover_docs(&root)
        .map(|docs| {
            docs.into_iter()
                .map(|d| DocEntry {
                    path: d.path,
                    title: d.title,
                    size_bytes: d.size_bytes,
                    modified: d.modified,
                })
                .collect()
        })
        .map_err(|e| AppError::io("cannot list documents", &e))
}

fn doc_path(root: &Path, relative: &str) -> Result<PathBuf, AppError> {
    if relative.is_empty()
        || relative.contains('\\')
        || Path::new(relative)
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(blocked());
    }
    let p = root
        .join(relative)
        .canonicalize()
        .map_err(|e| AppError::io("document no longer exists", &e))?;
    if !p.starts_with(root) {
        return Err(blocked());
    }
    Ok(p)
}

pub fn read_doc(path: &str, relative: &str) -> Result<DocContent, AppError> {
    let root = crate::bundle::repo_root(path)?;
    let p = doc_path(&root, relative)?;
    if !p
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("markdown"))
    {
        return Err(blocked());
    }
    let mut bytes = Vec::new();
    File::open(p)
        .and_then(|f| f.take(DOC_LIMIT + 1).read_to_end(&mut bytes))
        .map_err(|e| AppError::io("cannot read document", &e))?;
    let truncated = bytes.len() as u64 > DOC_LIMIT;
    bytes.truncate(2 * 1024 * 1024);
    Ok(DocContent {
        path: relative.into(),
        text: String::from_utf8_lossy(&bytes).into_owned(),
        truncated,
    })
}

pub fn read_doc_asset(path: &str, doc: &str, href: &str) -> Result<AssetData, AppError> {
    let root = crate::bundle::repo_root(path)?;
    let document = doc_path(&root, doc)?;
    if href.is_empty() || href.contains(['\\', ':', '?', '#', '\0']) || href.starts_with("//") {
        return Err(blocked());
    }
    let candidate = if href.starts_with('/') {
        root.join(href.trim_start_matches('/'))
    } else {
        document.parent().unwrap_or(&root).join(href)
    };
    let p = candidate.canonicalize().map_err(|_| blocked())?;
    if !p.starts_with(&root) {
        return Err(blocked());
    }
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => return Err(blocked()),
    };
    let mut bytes = Vec::new();
    File::open(p)
        .and_then(|f| f.take(ASSET_LIMIT + 1).read_to_end(&mut bytes))
        .map_err(|e| AppError::io("cannot read image", &e))?;
    if bytes.len() as u64 > ASSET_LIMIT {
        return Err(AppError::new(ErrorCode::Io, "Image exceeds 5 MB"));
    }
    let data = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(AssetData {
        mime: mime.into(),
        data_url: format!("data:{mime};base64,{data}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_docs_and_confined_assets() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_str().unwrap();
        std::fs::write(
            dir.path().join("README.md"),
            "a".repeat(usize::try_from(DOC_LIMIT + 20).unwrap()),
        )
        .unwrap();
        std::fs::write(dir.path().join("pic.png"), b"png").unwrap();
        let doc = read_doc(root, "README.md").unwrap();
        assert!(doc.truncated);
        assert_eq!(doc.text.len() as u64, DOC_LIMIT);
        assert_eq!(
            read_doc_asset(root, "README.md", "/pic.png").unwrap().mime,
            "image/png"
        );
        std::fs::write(
            dir.path().join("large.png"),
            vec![0; usize::try_from(ASSET_LIMIT + 1).unwrap()],
        )
        .unwrap();
        assert!(read_doc_asset(root, "README.md", "large.png").is_err());
        for href in [
            "../../etc/passwd",
            "/etc/passwd",
            "file:///etc/passwd",
            "//tracker/x.png",
            "README.md",
        ] {
            assert!(read_doc_asset(root, "README.md", href).is_err(), "{href}");
        }
        #[cfg(unix)]
        {
            let outside = tempfile::tempdir().unwrap();
            std::fs::write(outside.path().join("secret.png"), "secret").unwrap();
            std::fs::write(outside.path().join("a.md"), "private document").unwrap();
            std::os::unix::fs::symlink(
                outside.path().join("secret.png"),
                dir.path().join("link.png"),
            )
            .unwrap();
            assert!(read_doc_asset(root, "README.md", "link.png").is_err());
            std::os::unix::fs::symlink(outside.path(), dir.path().join("outside")).unwrap();
            assert!(matches!(
                read_doc(root, "outside/a.md").unwrap_err().code,
                ErrorCode::PathEscape
            ));
        }
    }
}

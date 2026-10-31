//! Deterministic structure extractor: nodes, ranges, hashes, imports and calls.
//!
//! No AI, no network, and no code from the analysed repository is ever executed.
//! Resolution rules are documented in this crate's `README.md`.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use gitvur_schema::{ExtractorInfo, Manifest, SCHEMA_VERSION, Structure, UNCOMMITTED};

mod config;
mod docs;
pub mod git;
pub use docs::{DocEntry, discover_docs};
pub mod lang;
mod output;
mod resolve;
pub mod walk;

use lang::LanguageBackend;
use lang::c::C;
use lang::go::Go;
use lang::python::Python;
use lang::typescript::TypeScript;
pub use output::write_output;
use resolve::SourceFile;

/// Inputs that are not read from the repository.
#[derive(Debug, Clone)]
pub struct IndexOptions {
    /// Written to `manifest.generatedAt`. The CLI passes the current time; tests pass a
    /// fixed value so the output is reproducible.
    pub generated_at: String,
}

#[derive(Debug, Clone)]
pub struct IndexOutput {
    pub manifest: Manifest,
    pub structure: Structure,
    /// Non-fatal problems (unparseable files, unreadable paths), in discovery order.
    pub warnings: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum IndexError {
    #[error("cannot open repository {path}: {source}")]
    Repo {
        path: PathBuf,
        source: std::io::Error,
    },
}

/// Every language backend, in the order they are asked whether they handle a path.
fn backends(go_modules: Vec<(String, String)>) -> Vec<Box<dyn LanguageBackend>> {
    vec![
        Box::new(Python::new()),
        Box::new(TypeScript::new()),
        Box::new(C::new()),
        Box::new(Go::new(go_modules)),
    ]
}

/// Indexes the repository at `repo`.
pub fn index(repo: &Path, opts: &IndexOptions) -> Result<IndexOutput, IndexError> {
    let root = repo.canonicalize().map_err(|source| IndexError::Repo {
        path: repo.to_path_buf(),
        source,
    })?;
    let mut warnings = Vec::new();
    let go_modules = config::go_modules(&root, &mut warnings);
    let backends = backends(go_modules);
    let backend_for = |relpath: &str| {
        backends
            .iter()
            .find(|b| b.handles(relpath))
            .map(AsRef::as_ref)
    };

    let (relpaths, walk_warnings) = walk::discover(&root, |p| backend_for(p).is_some());
    warnings.extend(walk_warnings);
    let mut files = Vec::with_capacity(relpaths.len());
    let mut languages = BTreeSet::new();
    for relpath in relpaths {
        let Some(backend) = backend_for(&relpath) else {
            continue;
        };
        let bytes = match fs::read(root.join(&relpath)) {
            Ok(bytes) => bytes,
            Err(err) => {
                warnings.push(format!("{relpath}: cannot read: {err}; skipped"));
                continue;
            }
        };
        let text = String::from_utf8(bytes).unwrap_or_else(|e| {
            warnings.push(format!(
                "{relpath}: not valid UTF-8; invalid bytes replaced"
            ));
            String::from_utf8_lossy(e.as_bytes()).into_owned()
        });
        // Parse normalised text so parser rows match the contract's line numbering.
        let text = text.replace("\r\n", "\n").replace('\r', "\n");
        let parsed = match backend.parse(&relpath, &text) {
            Ok(parsed) => Some(parsed),
            Err(err) => {
                warnings.push(format!(
                    "{relpath}: {err}; indexed as a file without children"
                ));
                None
            }
        };
        languages.insert(backend.language());
        files.push(SourceFile {
            relpath,
            text,
            parsed,
            backend,
        });
    }

    let project_name = root
        .file_name()
        .map_or_else(|| "root".to_owned(), |n| n.to_string_lossy().into_owned());
    let config_entries = config::discover(&root, &mut warnings);
    let structure = resolve::build_structure(&project_name, &files, &config_entries);
    let mut manifest = Manifest {
        schema_version: SCHEMA_VERSION.into(),
        project_name,
        commit_sha: git::head_short_sha(&root).unwrap_or_else(|| UNCOMMITTED.into()),
        generated_at: opts.generated_at.clone(),
        extractor: ExtractorInfo {
            name: "gitvur-index".into(),
            version: env!("CARGO_PKG_VERSION").into(),
        },
        languages: languages.into_iter().collect(),
    };
    manifest.canonicalize();
    Ok(IndexOutput {
        manifest,
        structure,
        warnings,
    })
}

/// A predicate for the files [`index`] reads from a directory: every path a language
/// backend handles, plus `.gitignore` files (which decide what is skipped). Lets callers
/// that materialise a revision write only what indexing needs; directories in
/// [`walk::SKIPPED_DIRS`] are still the walker's to skip.
pub fn index_inputs() -> impl Fn(&str) -> bool {
    let backends = backends(Vec::new());
    move |relpath: &str| {
        relpath == ".gitignore"
            || relpath.ends_with("/.gitignore")
            || config::is_config(relpath)
            || config::is_go_mod(relpath)
            || backends.iter().any(|b| b.handles(relpath))
    }
}

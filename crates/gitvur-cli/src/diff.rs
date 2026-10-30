//! `gitvur diff`: compare the structure of two revisions.

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::fs;
use std::path::Path;

use anyhow::Context as _;
use gitvur_diff::revision::{WORKTREE, index_revision};
use gitvur_schema::{Annotations, ChangeKind, ElementChange, StructureDiff, to_canonical_json};

/// Runs the diff and prints it (summary, or canonical JSON with `json`). With `carry`,
/// rewrites moved IDs in `<repo>/.gitvur/annotations.json`, the command's only write.
pub fn run(repo: &Path, from: &str, to: &str, json: bool, carry: bool) -> anyhow::Result<()> {
    let a = index_revision(repo, from).with_context(|| format!("reading revision {from}"))?;
    let b = index_revision(repo, to).with_context(|| format!("reading revision {to}"))?;
    let mut diff = gitvur_diff::diff(&a.structure, &b.structure);
    diff.from_commit = a.sha;
    diff.to_commit = b.sha;

    let annotations = read_annotations(repo);
    if json {
        print!("{}", to_canonical_json(&diff));
    } else {
        print!("{}", summary(&diff, from, to, annotations.as_ref()));
    }
    if carry {
        let annotations =
            annotations.context("--carry-annotations needs a valid .gitvur/annotations.json")?;
        let (carried, count) = gitvur_diff::carry_annotations(&annotations, &diff, &b.structure);
        let dir = gitvur_validate::gitvur_dir(repo)?;
        let tmp = dir.join(".annotations.json.tmp");
        fs::write(&tmp, to_canonical_json(&carried))?;
        fs::rename(&tmp, dir.join("annotations.json"))?;
        eprintln!("annotations.json: {count} reference(s) carried to moved elements");
    }
    Ok(())
}

/// `.gitvur/annotations.json`, parsed as the validator does; `None` when missing or
/// invalid (the summary then groups by file only).
fn read_annotations(repo: &Path) -> Option<Annotations> {
    let text = fs::read_to_string(repo.join(".gitvur/annotations.json")).ok()?;
    gitvur_validate::load_annotations(&text, &mut Vec::new())
}

fn marker(change: ChangeKind) -> char {
    match change {
        ChangeKind::Added => '+',
        ChangeKind::Removed => '−',
        ChangeKind::Modified | ChangeKind::Unchanged => '~',
        ChangeKind::Moved => '→',
    }
}

/// The file an element ID belongs to: `file:a/b.py` and `function:a/b.py:f` → `a/b.py`.
fn file_of(id: &str) -> &str {
    let rest = id.split_once(':').map_or(id, |(_, rest)| rest);
    if id.starts_with("file:") {
        rest
    } else {
        rest.rsplit_once(':').map_or(rest, |(file, _)| file)
    }
}

fn line(e: &ElementChange) -> String {
    let mut out = format!("{} {}", marker(e.change), e.id);
    if let Some(from) = &e.moved_from {
        let _ = write!(out, "  (from {from})");
    }
    if e.change == ChangeKind::Modified && e.child_changed == Some(true) {
        out.push_str("  (contents changed)");
    }
    out
}

/// Readable summary, grouped by module (when annotations assign files) and file.
pub fn summary(
    diff: &StructureDiff,
    from: &str,
    to: &str,
    annotations: Option<&Annotations>,
) -> String {
    let short = |sha: &str| {
        if sha == WORKTREE {
            "working tree".to_owned()
        } else {
            sha.chars().take(7).collect()
        }
    };
    let s = &diff.summary;
    let mut out = format!(
        "{from} ({}) → {to} ({})\n+{} added · −{} removed · ~{} modified · →{} moved · edges +{} −{}\n",
        short(&diff.from_commit),
        short(&diff.to_commit),
        s.added,
        s.removed,
        s.modified,
        s.moved,
        s.edges_added,
        s.edges_removed,
    );
    let module_of: BTreeMap<String, &str> = annotations
        .into_iter()
        .flat_map(|a| &a.modules)
        .flat_map(|m| m.files.iter().map(move |f| (f.clone(), m.name.as_str())))
        .collect();
    let mut groups: BTreeMap<&str, BTreeMap<&str, Vec<&ElementChange>>> = BTreeMap::new();
    for e in &diff.elements {
        let file = file_of(&e.id);
        let module =
            module_of
                .get(&format!("file:{file}"))
                .copied()
                .unwrap_or(if annotations.is_some() {
                    "Unassigned files"
                } else {
                    ""
                });
        groups
            .entry(module)
            .or_default()
            .entry(file)
            .or_default()
            .push(e);
    }
    for (module, files) in &groups {
        out.push('\n');
        let indent = if module.is_empty() {
            ""
        } else {
            let _ = writeln!(out, "{module}");
            "  "
        };
        for (file, changes) in files {
            let _ = writeln!(out, "{indent}{file}");
            for e in changes {
                let _ = writeln!(out, "{indent}  {}", line(e));
            }
        }
    }
    if !diff.edges.is_empty() {
        out.push_str("\nRelationships\n");
        for e in &diff.edges {
            let _ = writeln!(
                out,
                "  {} {} → {} ({})",
                marker(e.change),
                e.from,
                e.to,
                serde_name(e.edge_type)
            );
        }
    }
    if diff.elements.is_empty() && diff.edges.is_empty() {
        out.push_str("\nNo structural changes.\n");
    }
    out
}

fn serde_name(t: gitvur_schema::EdgeType) -> &'static str {
    match t {
        gitvur_schema::EdgeType::Calls => "calls",
        gitvur_schema::EdgeType::DependsOn => "depends_on",
        gitvur_schema::EdgeType::Imports => "imports",
        gitvur_schema::EdgeType::References => "references",
    }
}

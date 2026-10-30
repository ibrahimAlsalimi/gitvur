//! `--carry-annotations`: follow moved elements in `annotations.json`.

use std::collections::BTreeMap;

use gitvur_schema::{Annotations, ChangeKind, Structure, StructureDiff};

/// Rewrites annotation IDs of moved elements from their A ID to their B ID. Returns the
/// new annotations and how many references were rewritten.
///
/// - A description moves only when its `basedOnHash` equals the element's hash in `b`, so
///   the text still describes exactly that code.
/// - Module file lists and AI edge endpoints follow moved IDs; AI edge evidence follows a
///   moved file (its lines are identical, since the hash is).
///
/// Nothing else changes, and the result is canonical.
pub fn carry_annotations(
    annotations: &Annotations,
    diff: &StructureDiff,
    b: &Structure,
) -> (Annotations, usize) {
    let moves: BTreeMap<&str, &str> = diff
        .elements
        .iter()
        .filter(|e| e.change == ChangeKind::Moved)
        .filter_map(|e| e.moved_from.as_deref().map(|from| (from, e.id.as_str())))
        .collect();
    let hash_in_b: BTreeMap<&str, &str> = b
        .nodes
        .iter()
        .filter_map(|n| n.content_hash.as_deref().map(|h| (n.id.as_str(), h)))
        .collect();
    let file_moves: BTreeMap<&str, &str> = moves
        .iter()
        .filter_map(|(from, to)| Some((from.strip_prefix("file:")?, to.strip_prefix("file:")?)))
        .collect();

    let mut out = annotations.clone();
    let mut count = 0;
    let mut rewrite = |id: &mut String| {
        if let Some(to) = moves.get(id.as_str()) {
            *id = (*to).to_owned();
            count += 1;
        }
    };
    for d in &mut out.descriptions {
        let matches = moves
            .get(d.id.as_str())
            .is_some_and(|to| hash_in_b.get(to) == Some(&d.based_on_hash.as_str()));
        if matches {
            rewrite(&mut d.id);
        }
    }
    for m in &mut out.modules {
        for f in &mut m.files {
            rewrite(f);
        }
    }
    for e in &mut out.edges {
        rewrite(&mut e.from);
        rewrite(&mut e.to);
    }
    for e in &mut out.edges {
        if let Some(to) = file_moves.get(e.evidence.file.as_str()) {
            e.evidence.file = (*to).to_owned();
            count += 1;
        }
    }
    out.canonicalize();
    (out, count)
}

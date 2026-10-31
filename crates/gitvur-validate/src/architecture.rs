//! Source-grounded architecture checks. Natural-language semantics still require human review.
use gitvur_flow::EvidenceSource;
use gitvur_schema::{
    Architecture, ArchitectureComponent, Evidence, Issue, Provenance, Severity, Structure,
};
use std::collections::{BTreeMap, BTreeSet};

/// Validate optional architecture without trusting a cached report. No repository code is run.
#[allow(clippy::too_many_lines)]
pub fn check_architecture(
    structure: &Structure,
    a: &Architecture,
    files: &mut impl EvidenceSource,
) -> Vec<Issue> {
    check_model(structure, a, files, true)
}

#[allow(clippy::too_many_lines)]
fn check_model(
    structure: &Structure,
    a: &Architecture,
    files: &mut impl EvidenceSource,
    legacy: bool,
) -> Vec<Issue> {
    let mut issues = Vec::new();
    let mut push = |id: &str, code: &str, message: &str, stale: bool| {
        issues.push(Issue {
            id: Some(id.into()),
            code: format!("architecture-{code}"),
            message: message.into(),
            severity: if stale {
                Severity::Warning
            } else {
                Severity::Error
            },
        });
    };
    let nodes: BTreeMap<_, _> = structure.nodes.iter().map(|n| (n.id.as_str(), n)).collect();
    // Groups may cite their descendants; no fake source file is required for a subsystem.
    let expanded = expanded_components(a);
    let components: BTreeMap<_, _> = expanded.iter().map(|c| (c.id.as_str(), c)).collect();
    let mut ids = BTreeSet::new();
    let mut owners = BTreeMap::new();
    if a.version != 1 || a.summary.trim().is_empty() {
        push(
            "architecture",
            "version",
            "Architecture requires version 1 and a summary",
            false,
        );
    }
    for c in if legacy { &a.components } else { &expanded } {
        if !valid_id(&c.id)
            || !ids.insert(&c.id)
            || c.name.trim().is_empty()
            || c.kind.trim().is_empty()
            || c.responsibility.trim().is_empty()
            || c.provenance != Provenance::Ai
            || c.sources.is_empty()
        {
            push(
                &c.id,
                "component",
                "Component requires a unique arch: ID, name, kind, responsibility, AI provenance and sources",
                false,
            );
        }
        for source in &c.sources {
            match nodes.get(source.node.as_str()) {
                Some(n) if n.source.is_some() => {
                    if n.content_hash.as_ref() != Some(&source.based_on_hash) {
                        push(
                            &c.id,
                            "stale",
                            "Referenced source changed; review architecture",
                            true,
                        );
                    }
                    if let Some(range) = &n.source {
                        let current = files.text(&range.file).and_then(|text| {
                            gitvur_schema::extract_lines(text, range.start_line, range.end_line)
                        });
                        if current.as_deref().map(gitvur_schema::content_hash).as_ref()
                            != Some(&source.based_on_hash)
                        {
                            push(
                                &c.id,
                                "stale",
                                "Source on disk changed or disappeared; review architecture",
                                true,
                            );
                        }
                    }
                    if legacy
                        && let Some(range) = &n.source
                        && let Some(owner) = owners.insert(&range.file, &c.id)
                        && owner != &c.id
                    {
                        push(
                            &c.id,
                            "membership",
                            "Source belongs to multiple components",
                            false,
                        );
                    }
                }
                _ => push(
                    &c.id,
                    "source",
                    "Source must reference an indexed file, class or function",
                    false,
                ),
            }
        }
        let mut seen = BTreeSet::from([c.id.as_str()]);
        let mut parent = c.parent.as_deref();
        while let Some(p) = parent {
            if !seen.insert(p) || !components.contains_key(p) {
                push(
                    &c.id,
                    "hierarchy",
                    "Parent is missing or hierarchy contains a cycle",
                    false,
                );
                break;
            }
            parent = components[p].parent.as_deref();
        }
        if c.evidence.is_empty()
            || !c
                .evidence
                .iter()
                .all(|e| evidence_in_component(e, c, structure) && evidence_exists(e, files))
        {
            push(
                &c.id,
                "evidence",
                "Evidence must be inside a referenced source and a readable repository line",
                false,
            );
        }
    }
    for r in &a.relationships {
        if !valid_id(&r.id)
            || !ids.insert(&r.id)
            || r.label.trim().is_empty()
            || r.kind.trim().is_empty()
            || (legacy && r.provenance != Provenance::Ai)
        {
            push(
                &r.id,
                "relationship",
                "Relationship requires a unique arch: ID, kind, label and AI provenance",
                false,
            );
        }
        let (Some(from), Some(to)) = (
            components.get(r.from.as_str()),
            components.get(r.to.as_str()),
        ) else {
            push(
                &r.id,
                "dangling",
                "Relationship endpoint does not exist",
                false,
            );
            continue;
        };
        if r.from == r.to
            || r.evidence.is_empty()
            || !r.evidence.iter().all(|e| {
                if !evidence_in_component(e, from, structure) {
                    return false;
                }
                let Some(text) = files.text(&e.file) else {
                    return false;
                };
                let Some(line) = gitvur_schema::extract_lines(text, e.line, e.line) else {
                    return false;
                };
                if !legacy {
                    return true;
                }
                // Legacy compatibility: exact symbol/label matching is traceability only.
                line.contains(&r.label)
                    || to.sources.iter().any(|s| {
                        nodes.get(s.node.as_str()).is_some_and(|n| {
                            let stem = n.name.rsplit_once('.').map_or(n.name.as_str(), |(s, _)| s);
                            !stem.is_empty() && line.contains(stem)
                        })
                    })
            })
        {
            push(
                &r.id,
                "unsupported",
                "Relationship evidence must be in its source component and mention a target or the exact label",
                false,
            );
        }
        if !legacy && !structural_support(structure, from, to, r) {
            push(
                &r.id,
                if r.provenance == Provenance::Ai {
                    "unresolved"
                } else {
                    "unsupported"
                },
                "References are traceable; this interaction has no matching deterministic proof. Semantic interpretation needs review.",
                r.provenance == Provenance::Ai,
            );
        }
    }
    issues.sort_by(|a, b| (&a.id, &a.code, &a.message).cmp(&(&b.id, &b.code, &b.message)));
    issues.dedup();
    issues
}

fn expanded_components(a: &Architecture) -> Vec<ArchitectureComponent> {
    a.components
        .iter()
        .map(|c| {
            let mut expanded = c.clone();
            let mut seen = BTreeSet::from([c.id.as_str()]);
            let mut pending = vec![c.id.as_str()];
            while let Some(parent) = pending.pop() {
                for child in a
                    .components
                    .iter()
                    .filter(|s| s.parent.as_deref() == Some(parent))
                {
                    if seen.insert(child.id.as_str()) {
                        expanded.sources.extend(child.sources.clone());
                        pending.push(&child.id);
                    }
                }
            }
            expanded
        })
        .collect()
}

fn structural_support(
    s: &Structure,
    from: &ArchitectureComponent,
    to: &ArchitectureComponent,
    r: &gitvur_schema::ArchitectureRelationship,
) -> bool {
    // An import cannot prove writes/events/reads, even with a valid citation.
    let edge_type = match r.kind.as_str() {
        "calls" | "invokes" => gitvur_schema::EdgeType::Calls,
        "imports" | "depends_on" => gitvur_schema::EdgeType::Imports,
        _ => return false,
    };
    let owns = |c: &ArchitectureComponent, id: &str| {
        let node = s.nodes.iter().find(|n| n.id == id);
        c.sources.iter().any(|source| {
            source.node == id
                || s.nodes
                    .iter()
                    .find(|n| n.id == source.node)
                    .is_some_and(|owner| {
                        owner
                            .source
                            .as_ref()
                            .zip(node.and_then(|n| n.source.as_ref()))
                            .is_some_and(|(a, b)| {
                                a.file == b.file
                                    && a.start_line <= b.start_line
                                    && a.end_line >= b.end_line
                            })
                    })
        })
    };
    s.edges.iter().any(|e| {
        e.edge_type == edge_type
            && e.provenance == Provenance::Syntactic
            && owns(from, &e.from)
            && owns(to, &e.to)
            && r.evidence.contains(&e.evidence)
    })
}

/// Loads the standalone artifact safely. It takes precedence even if malformed: a broken
/// new artifact must not silently revive a conflicting legacy interpretation.
/// Absence alone enables the legacy annotation contract; nothing is rewritten on read.
pub fn for_repository(
    input: &crate::ValidateInput,
) -> (Option<gitvur_schema::ArchitectureArtifact>, Vec<Issue>) {
    let error = |message: String| Issue {
        id: Some("architecture".into()),
        code: "architecture-schema".into(),
        message,
        severity: Severity::Error,
    };
    let text = match crate::repo::read_gitvur_file(&input.repo_root, "architecture.json") {
        Ok(Some(text)) => text,
        Ok(None) => return (None, validate_architecture(input)),
        Err(message) => return (None, vec![error(message)]),
    };
    let artifact: gitvur_schema::ArchitectureArtifact = match serde_json::from_str(&text) {
        Ok(a) => a,
        Err(e) => {
            return (
                None,
                vec![error(format!(
                    "architecture.json does not match the schema: {e}"
                ))],
            );
        }
    };
    let mut issues = Vec::new();
    if artifact.schema_version != 1
        || artifact.commit_sha.trim().is_empty()
        || artifact.index_hash.len() != 71
        || !artifact.index_hash.starts_with("sha256:")
        || !artifact.index_hash[7..]
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        issues.push(error(
            "Architecture requires schemaVersion 1, commitSha and a sha256 indexHash".into(),
        ));
    }
    if artifact.index_hash != gitvur_schema::architecture_index_hash(&input.structure) {
        issues.push(Issue { id: Some("architecture".into()), code: "architecture-snapshot".into(),
            message: "The indexed snapshot changed. Review architecture for new or changed boundaries; preserve unaffected components.".into(), severity: Severity::Warning });
    }
    let mut files = crate::checks::EvidenceFiles::new(input);
    issues.extend(check_model(
        &input.structure,
        &artifact.architecture,
        &mut files,
        false,
    ));
    issues.sort_by(|a, b| (&a.id, &a.code, &a.message).cmp(&(&b.id, &b.code, &b.message)));
    (Some(artifact), issues)
}

fn valid_id(id: &str) -> bool {
    id.strip_prefix("arch:").is_some_and(|s| {
        !s.is_empty()
            && s.bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    })
}
fn evidence_exists(e: &Evidence, files: &mut impl EvidenceSource) -> bool {
    files
        .text(&e.file)
        .and_then(|t| gitvur_schema::extract_lines(t, e.line, e.line))
        .is_some()
}
fn evidence_in_component(e: &Evidence, c: &ArchitectureComponent, s: &Structure) -> bool {
    c.sources.iter().any(|r| {
        s.nodes
            .iter()
            .find(|n| n.id == r.node)
            .and_then(|n| n.source.as_ref())
            .is_some_and(|range| {
                range.file == e.file && e.line >= range.start_line && e.line <= range.end_line
            })
    })
}

/// Fresh architecture-only validation for read-only viewers, independent of cached reports.
pub fn validate_architecture(input: &crate::ValidateInput) -> Vec<Issue> {
    input
        .annotations
        .as_ref()
        .and_then(|a| a.architecture.as_ref())
        .map_or_else(Vec::new, |a| {
            let mut files = crate::checks::EvidenceFiles::new(input);
            check_architecture(&input.structure, a, &mut files)
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Files;
    impl EvidenceSource for Files {
        fn text(&mut self, file: &str) -> Option<&str> {
            (file == "a.ts").then_some("import b\n")
        }
    }
    #[test]
    fn shared_browser_example_is_valid_against_real_fixture_sources() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/py-flows")
            .canonicalize()
            .unwrap();
        let mut annotations: gitvur_schema::Annotations = serde_json::from_str(include_str!(
            "../../../fixtures/py-flows/.gitvur/annotations.json"
        ))
        .unwrap();
        annotations.architecture = Some(
            serde_json::from_str(include_str!("../../../app/e2e/fixtures/architecture.json"))
                .unwrap(),
        );
        let input = crate::ValidateInput {
            structure: serde_json::from_str(include_str!(
                "../../../fixtures/py-flows/.gitvur/structure.json"
            ))
            .unwrap(),
            annotations: Some(annotations),
            repo_root: root,
            commit_sha: "uncommitted".into(),
        };
        assert_eq!(validate_architecture(&input), []);
        let mut broken = input.clone();
        let a = broken
            .annotations
            .as_mut()
            .unwrap()
            .architecture
            .as_mut()
            .unwrap();
        a.relationships[0].evidence[0].line = 9;
        assert!(
            validate_architecture(&broken)
                .iter()
                .any(|i| i.code == "architecture-unsupported")
        );
        let a = broken
            .annotations
            .as_mut()
            .unwrap()
            .architecture
            .as_mut()
            .unwrap();
        a.components[1].sources = a.components[0].sources.clone();
        assert!(
            validate_architecture(&broken)
                .iter()
                .any(|i| i.code == "architecture-membership")
        );
    }
    #[test]
    fn checks_compatibility_references_hashes_cycles_and_claims() {
        let old: gitvur_schema::Annotations =
            serde_json::from_str(r#"{"modules":[],"descriptions":[],"edges":[]}"#).unwrap();
        assert!(old.architecture.is_none());
        let mut a: Architecture = serde_json::from_value(serde_json::json!({"version":1,"summary":"example","components":[{"id":"arch:a","name":"A","kind":"package","responsibility":"Sources","sources":[{"node":"file:a.ts","basedOnHash":"sha256:old"}],"provenance":"ai","evidence":[{"file":"a.ts","line":1}]}],"relationships":[]})).unwrap();
        let mut s: Structure = serde_json::from_value(serde_json::json!({"nodes":[{"id":"file:a.ts","name":"a.ts","type":"file","source":{"file":"a.ts","startLine":1,"endLine":1},"contentHash":"sha256:old"}],"edges":[],"unresolvedCalls":[]})).unwrap();
        let hash = gitvur_schema::content_hash("import b\n");
        s.nodes[0].content_hash = Some(hash.clone());
        a.components[0].sources[0].based_on_hash = hash;
        assert_eq!(check_architecture(&s, &a, &mut Files), []);
        assert_eq!(
            serde_json::from_str::<Architecture>(&gitvur_schema::to_canonical_json(&a)).unwrap(),
            a
        );
        a.components[0].sources[0].based_on_hash = "changed".into();
        a.components[0].parent = Some("arch:a".into());
        a.components[0].evidence[0].file = "../escape".into();
        let codes: Vec<_> = check_architecture(&s, &a, &mut Files)
            .into_iter()
            .map(|i| i.code)
            .collect();
        assert!(codes.contains(&"architecture-stale".into()));
        assert!(codes.contains(&"architecture-hierarchy".into()));
        assert!(codes.contains(&"architecture-evidence".into()));
        a.relationships.push(serde_json::from_value(serde_json::json!({"id":"arch:r","from":"arch:a","to":"arch:missing","kind":"reads","label":"Reads","provenance":"ai","evidence":[]})).unwrap());
        assert!(
            check_architecture(&s, &a, &mut Files)
                .iter()
                .any(|i| i.code == "architecture-dangling")
        );
    }
}

//! Canonical JSON serialisation.

use serde::Serialize;

/// Serialises `value` as canonical JSON: 2-space indent, keys in struct
/// declaration order, `\n` line endings, and a trailing newline.
///
/// This does not sort anything; call the type's `canonicalize()` first.
///
/// # Panics
///
/// Panics if `value`'s `Serialize` implementation fails, which cannot happen for
/// the contract types (no maps with non-string keys, no fallible serialisers).
pub fn to_canonical_json<T: Serialize>(value: &T) -> String {
    let mut out =
        serde_json::to_string_pretty(value).expect("contract types always serialise to JSON");
    out.push('\n');
    out
}

#[cfg(test)]
mod tests {
    use crate::{
        Annotations, Description, Edge, EdgeType, Evidence, ExtractorInfo, Issue, Language,
        Manifest, Module, Node, NodeType, Provenance, Report, Severity, SourceRange, Status,
        Structure, Summary, UnresolvedCall, to_canonical_json,
    };
    use crate::{ElementStatus, SCHEMA_VERSION};

    fn edge(from: &str, to: &str, edge_type: EdgeType, line: u32) -> Edge {
        Edge {
            from: from.into(),
            to: to.into(),
            edge_type,
            provenance: Provenance::Syntactic,
            evidence: Evidence {
                file: "a.py".into(),
                line,
            },
            note: None,
        }
    }

    fn node(id: &str, node_type: NodeType) -> Node {
        Node {
            id: id.into(),
            node_type,
            name: id.rsplit(':').next().unwrap_or(id).into(),
            parent_id: Some("project:root".into()),
            source: Some(SourceRange {
                file: "a.py".into(),
                start_line: 1,
                end_line: 2,
            }),
            content_hash: Some(crate::content_hash("x")),
        }
    }

    fn sample_structure() -> Structure {
        Structure {
            entry_points: Vec::new(),
            nodes: vec![
                node("function:a.py:run", NodeType::Function),
                Node {
                    id: "project:root".into(),
                    node_type: NodeType::Project,
                    name: "demo".into(),
                    parent_id: None,
                    source: None,
                    content_hash: None,
                },
                node("file:a.py", NodeType::File),
                node("class:a.py:Store", NodeType::Class),
            ],
            edges: vec![
                edge("function:a.py:run", "function:b.py:z", EdgeType::Calls, 9),
                edge("function:a.py:run", "function:b.py:z", EdgeType::Calls, 3),
                edge("file:a.py", "file:b.py", EdgeType::Imports, 1),
                edge("function:a.py:run", "function:b.py:z", EdgeType::Calls, 3),
            ],
            unresolved_calls: vec![
                UnresolvedCall {
                    from: "function:a.py:run".into(),
                    name: "save".into(),
                    evidence: Evidence {
                        file: "a.py".into(),
                        line: 7,
                    },
                    candidates: vec![
                        "function:y.py:Cache.save".into(),
                        "function:x.py:S.save".into(),
                    ],
                },
                UnresolvedCall {
                    from: "function:a.py:run".into(),
                    name: "load".into(),
                    evidence: Evidence {
                        file: "a.py".into(),
                        line: 4,
                    },
                    candidates: vec!["function:y.py:C.load".into(), "function:x.py:S.load".into()],
                },
            ],
        }
    }

    #[test]
    fn structure_canonical_ordering() {
        let mut s = sample_structure();
        s.canonicalize();
        let ids: Vec<_> = s.nodes.iter().map(|n| n.id.as_str()).collect();
        assert_eq!(
            ids,
            [
                "class:a.py:Store",
                "file:a.py",
                "function:a.py:run",
                "project:root"
            ]
        );
        let edges: Vec<_> = s
            .edges
            .iter()
            .map(|e| (e.from.as_str(), e.evidence.line))
            .collect();
        assert_eq!(
            edges,
            [
                ("file:a.py", 1),
                ("function:a.py:run", 3),
                ("function:a.py:run", 9)
            ],
            "sorted and exact duplicates removed"
        );
        assert_eq!(s.unresolved_calls[0].name, "load");
        assert_eq!(
            s.unresolved_calls[1].candidates,
            ["function:x.py:S.save", "function:y.py:Cache.save"]
        );
    }

    #[test]
    fn canonical_json_is_independent_of_input_order() {
        let mut a = sample_structure();
        let mut b = sample_structure();
        b.nodes.reverse();
        b.edges.reverse();
        b.unresolved_calls.reverse();
        a.canonicalize();
        b.canonicalize();
        assert_eq!(to_canonical_json(&a), to_canonical_json(&b));
    }

    #[test]
    fn canonical_json_format() {
        let ev = Evidence {
            file: "a.py".into(),
            line: 3,
        };
        assert_eq!(
            to_canonical_json(&ev),
            "{\n  \"file\": \"a.py\",\n  \"line\": 3\n}\n"
        );
    }

    #[test]
    fn structure_round_trip() {
        let mut s = sample_structure();
        s.canonicalize();
        let json = to_canonical_json(&s);
        let back: Structure = serde_json::from_str(&json).unwrap();
        assert_eq!(back, s);
        assert_eq!(to_canonical_json(&back), json);
    }

    #[test]
    fn manifest_round_trip() {
        let mut m = Manifest {
            schema_version: SCHEMA_VERSION.into(),
            project_name: "demo".into(),
            commit_sha: crate::UNCOMMITTED.into(),
            generated_at: "2026-10-29T15:00:00Z".into(),
            extractor: ExtractorInfo {
                name: "gitvur-index".into(),
                version: "0.2.0".into(),
            },
            languages: vec![Language::Typescript, Language::Python, Language::Typescript],
        };
        m.canonicalize();
        assert_eq!(m.languages, [Language::Python, Language::Typescript]);
        let json = to_canonical_json(&m);
        assert!(json.contains("\"commitSha\": \"uncommitted\""));
        assert_eq!(serde_json::from_str::<Manifest>(&json).unwrap(), m);
    }

    #[test]
    fn annotations_round_trip() {
        let mut a = Annotations {
            entry_points: Vec::new(),
            flows: Vec::new(),
            modules: vec![Module {
                id: "module:auth".into(),
                name: "Auth".into(),
                description: "Sign-in.".into(),
                files: vec!["file:b.py".into(), "file:a.py".into()],
            }],
            descriptions: vec![Description {
                id: "function:a.py:run".into(),
                text: "Runs.".into(),
                based_on_hash: crate::content_hash("x"),
            }],
            edges: vec![Edge {
                provenance: Provenance::Ai,
                note: Some("Registered as a handler.".into()),
                ..edge(
                    "function:a.py:run",
                    "function:b.py:z",
                    EdgeType::References,
                    5,
                )
            }],
        };
        a.canonicalize();
        assert_eq!(a.modules[0].files, ["file:a.py", "file:b.py"]);
        let json = to_canonical_json(&a);
        assert_eq!(serde_json::from_str::<Annotations>(&json).unwrap(), a);
    }

    #[test]
    fn report_round_trip_and_ordering() {
        let issue = |severity, code: &str| Issue {
            severity,
            code: code.into(),
            message: "m".into(),
            id: None,
        };
        let mut r = Report {
            flows: Vec::new(),
            schema_version: SCHEMA_VERSION.into(),
            commit_sha: "9f1c2e7".into(),
            summary: Summary::default(),
            elements: vec![
                ElementStatus {
                    id: "file:b.py".into(),
                    status: Status::Stale,
                    child_changed: Some(true),
                    self_changed: Some(false),
                },
                ElementStatus {
                    id: "file:a.py".into(),
                    status: Status::Documented,
                    child_changed: None,
                    self_changed: None,
                },
            ],
            issues: vec![
                issue(Severity::Warning, "a-warn"),
                issue(Severity::Error, "z-err"),
            ],
        };
        r.canonicalize();
        assert_eq!(r.elements[0].id, "file:a.py");
        assert_eq!(r.issues[0].severity, Severity::Error);
        let json = to_canonical_json(&r);
        assert!(json.contains("\"childChanged\": true,\n      \"selfChanged\": false"));
        assert!(
            !json[..json.find("file:b.py").unwrap()].contains("childChanged"),
            "omitted when None"
        );
        assert_eq!(serde_json::from_str::<Report>(&json).unwrap(), r);
    }

    #[test]
    fn unknown_fields_are_rejected() {
        let err = serde_json::from_str::<Evidence>(r#"{"file":"a.py","line":1,"extra":true}"#);
        assert!(err.is_err());
        let err = serde_json::from_str::<Structure>(
            r#"{"nodes":[],"edges":[],"unresolvedCalls":[],"x":1}"#,
        );
        assert!(err.is_err());
    }

    #[test]
    fn enums_use_contract_spelling() {
        assert_eq!(
            serde_json::to_string(&EdgeType::DependsOn).unwrap(),
            "\"depends_on\""
        );
        assert_eq!(serde_json::to_string(&Provenance::Ai).unwrap(), "\"ai\"");
        assert_eq!(
            serde_json::to_string(&NodeType::Function).unwrap(),
            "\"function\""
        );
        assert_eq!(
            serde_json::to_string(&Status::Undocumented).unwrap(),
            "\"undocumented\""
        );
        assert_eq!(
            serde_json::to_string(&Language::Typescript).unwrap(),
            "\"typescript\""
        );
        assert!(serde_json::from_str::<NodeType>("\"module\"").is_err());
    }

    #[test]
    fn commit_sha_is_required() {
        let missing = r#"{"schemaVersion":"0.2","projectName":"d","generatedAt":"t",
            "extractor":{"name":"x","version":"1"},"languages":[]}"#;
        assert!(serde_json::from_str::<Manifest>(missing).is_err());
        let null = missing.replace("\"projectName\"", "\"commitSha\":null,\"projectName\"");
        assert!(serde_json::from_str::<Manifest>(&null).is_err());
    }
}

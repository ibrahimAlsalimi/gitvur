use gitvur_flow::{TraceOptions, trace};
use gitvur_schema::{
    Edge, EdgeType, EntryKind, EntryPoint, Evidence, Node, NodeType, Provenance, SourceRange,
    Structure, TraceKind, UnresolvedCall, to_canonical_json,
};

fn graph() -> Structure {
    let nodes = ["a", "b", "c", "d", "e"]
        .into_iter()
        .enumerate()
        .map(|(i, name)| Node {
            id: name.into(),
            node_type: NodeType::Function,
            name: name.into(),
            parent_id: None,
            source: Some(SourceRange {
                file: "code.py".into(),
                start_line: u32::try_from(i).unwrap() + 1,
                end_line: u32::try_from(i).unwrap() + 1,
            }),
            content_hash: None,
        })
        .collect();
    Structure {
        nodes,
        edges: Vec::new(),
        unresolved_calls: Vec::new(),
        entry_points: Vec::new(),
    }
}
fn edge(s: &mut Structure, from: &str, to: &str, provenance: Provenance) {
    s.edges.push(Edge {
        from: from.into(),
        to: to.into(),
        edge_type: EdgeType::Calls,
        provenance,
        evidence: Evidence {
            file: "code.py".into(),
            line: 1,
        },
        note: None,
    });
}
fn opts() -> TraceOptions {
    TraceOptions::default()
}

#[test]
fn breadth_first_diamond_shallow_path_wins_and_back_edges_are_cycles() {
    let mut s = graph();
    for (a, b) in [
        ("a", "c"),
        ("a", "b"),
        ("b", "d"),
        ("c", "e"),
        ("d", "e"),
        ("e", "a"),
    ] {
        edge(&mut s, a, b, Provenance::Syntactic);
    }
    let t = trace(&s, "a", &opts());
    let actual: Vec<_> = t
        .nodes
        .iter()
        .map(|n| (n.name.as_str(), n.depth, n.kind))
        .collect();
    assert_eq!(
        actual,
        [
            ("a", 0, TraceKind::Node),
            ("b", 1, TraceKind::Node),
            ("c", 1, TraceKind::Node),
            ("d", 2, TraceKind::Node),
            ("e", 2, TraceKind::Node),
            ("e", 3, TraceKind::Ref),
            ("a", 3, TraceKind::Cycle)
        ]
    );
    assert_eq!(t.nodes[5].reference.as_deref(), Some("trace:5"));
    assert_eq!(t.nodes[6].reference.as_deref(), Some("trace:1"));
    let bytes = to_canonical_json(&t);
    s.nodes.reverse();
    s.edges.reverse();
    assert_eq!(bytes, to_canonical_json(&trace(&s, "a", &opts())));
}

#[test]
fn recursion_ambiguity_and_edge_provenance_never_guess_targets() {
    let mut s = graph();
    edge(&mut s, "a", "a", Provenance::Syntactic);
    edge(&mut s, "a", "b", Provenance::Semantic);
    edge(&mut s, "a", "c", Provenance::Ai);
    edge(&mut s, "a", "missing", Provenance::Syntactic);
    s.unresolved_calls.push(UnresolvedCall {
        from: "a".into(),
        name: "save".into(),
        evidence: Evidence {
            file: "code.py".into(),
            line: 9,
        },
        candidates: vec!["d".into(), "c".into(), "d".into()],
    });
    let t = trace(&s, "a", &opts());
    assert_eq!(t.nodes.len(), 3);
    assert_eq!(t.nodes[1].kind, TraceKind::Cycle);
    assert_eq!(t.nodes[2].kind, TraceKind::Ambiguous);
    assert_eq!(t.nodes[2].candidates, ["c", "d"]);
    assert_eq!(t.nodes[2].children.len(), 0);
    let t = trace(
        &s,
        "a",
        &TraceOptions {
            include_semantic: true,
            ..opts()
        },
    );
    assert!(t.nodes.iter().any(|n| n.node.as_deref() == Some("b")));
    assert!(!t.nodes.iter().any(|n| n.node.as_deref() == Some("c")));
}

#[test]
fn limits_include_stubs_and_report_immediate_hidden_children() {
    let mut s = graph();
    for (a, b) in [("a", "b"), ("a", "c"), ("b", "d"), ("b", "e")] {
        edge(&mut s, a, b, Provenance::Syntactic);
    }
    let t = trace(
        &s,
        "a",
        &TraceOptions {
            max_depth: 0,
            ..opts()
        },
    );
    assert_eq!(t.nodes.len(), 1);
    assert!(t.truncated);
    assert_eq!(t.nodes[0].hidden_children, 2);
    let t = trace(
        &s,
        "a",
        &TraceOptions {
            max_nodes: 2,
            ..opts()
        },
    );
    assert_eq!(t.nodes.len(), 2);
    assert_eq!(t.nodes[0].hidden_children, 1);
    assert_eq!(t.nodes[1].hidden_children, 2);
    let t = trace(
        &s,
        "a",
        &TraceOptions {
            max_nodes: 0,
            ..opts()
        },
    );
    assert_eq!(t.nodes.len(), 0);
    assert_eq!(t.hidden_roots, 1);
    assert!(t.truncated);
    assert!(trace(&s, "missing", &opts()).error.is_some());
}

#[test]
fn entries_use_function_target_plus_calls_and_preserve_ambiguous_sites() {
    let mut s = graph();
    s.entry_points.push(EntryPoint {
        id: "entry:other:start".into(),
        kind: EntryKind::Other,
        name: "start".into(),
        target: Some("a".into()),
        raw: None,
        calls: vec!["b".into(), "a".into(), "missing".into()],
        evidence: None,
        provenance: Provenance::Ai,
    });
    s.unresolved_calls.push(UnresolvedCall {
        from: "entry:other:start".into(),
        name: "save".into(),
        evidence: Evidence {
            file: "code.py".into(),
            line: 8,
        },
        candidates: vec!["c".into(), "d".into()],
    });
    edge(&mut s, "a", "b", Provenance::Syntactic);
    let t = trace(&s, "entry:other:start", &opts());
    assert_eq!(t.roots.len(), 3);
    assert_eq!(t.nodes[3].kind, TraceKind::Ref);
    s.entry_points[0].target = None;
    s.entry_points[0].calls.clear();
    s.unresolved_calls.clear();
    let t = trace(&s, "entry:other:start", &opts());
    assert!(t.error.is_none());
    assert_eq!(t.roots.len(), 0);
    s.nodes[0].node_type = NodeType::File;
    s.entry_points[0].target = Some("a".into());
    assert_eq!(trace(&s, "entry:other:start", &opts()).roots.len(), 0);
}

#[test]
fn both_flow_fixtures_trace_deep_chains_and_recursive_functions() {
    for (fixture, entry, recursive) in [
        (
            "py-flows",
            "entry:console-script:flow-shop",
            "function:flowapp/backends.py:countdown",
        ),
        (
            "ts-flows",
            "entry:top-level-call:src-cli-ts",
            "function:src/backends.ts:countdown",
        ),
    ] {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures")
            .join(fixture);
        let s = gitvur_index::index(
            &root,
            &gitvur_index::IndexOptions {
                generated_at: "fixed".into(),
            },
        )
        .unwrap()
        .structure;
        let t = trace(&s, entry, &opts());
        assert!(t.error.is_none(), "{t:?}");
        assert!(t.nodes.iter().any(|n| n.depth >= 5), "{fixture}: {t:?}");
        let t = trace(&s, recursive, &opts());
        assert!(t.nodes.iter().any(|n| n.kind == TraceKind::Cycle));
    }
}

#[test]
fn default_budget_bounds_large_traces_and_exact_boundary_is_not_truncated() {
    let mut s = graph();
    for i in 0..1000 {
        let mut node = s.nodes[0].clone();
        node.id = format!("long:{i}");
        s.nodes.push(node);
        if i > 0 {
            edge(
                &mut s,
                &format!("long:{}", i - 1),
                &format!("long:{i}"),
                Provenance::Syntactic,
            );
        }
    }
    let t = trace(
        &s,
        "long:0",
        &TraceOptions {
            max_depth: u32::MAX,
            ..opts()
        },
    );
    assert_eq!(t.nodes.len(), 300);
    assert!(t.truncated);
    assert_eq!(t.nodes[299].hidden_children, 1);
    let t = trace(
        &s,
        "long:0",
        &TraceOptions {
            max_depth: u32::MAX,
            max_nodes: 1000,
            ..opts()
        },
    );
    assert_eq!(t.nodes.len(), 1000);
    assert!(!t.truncated);
    // Arena serialization and text rendering need no recursive tree walk.
    assert_eq!(
        serde_json::from_str::<gitvur_schema::Trace>(&to_canonical_json(&t)).unwrap(),
        t
    );
}

#[test]
fn child_order_uses_source_location_then_id_and_duplicate_edges_collapse() {
    let mut s = graph();
    s.nodes[1].source.as_mut().unwrap().file = "z.py".into();
    for (from, to) in [("a", "b"), ("a", "c"), ("a", "c")] {
        edge(&mut s, from, to, Provenance::Syntactic);
    }
    let t = trace(&s, "a", &opts());
    assert_eq!(
        t.nodes.iter().map(|n| n.name.as_str()).collect::<Vec<_>>(),
        ["a", "c", "b"]
    );
}

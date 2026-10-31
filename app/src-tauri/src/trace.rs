//! `get_trace`: the deterministic call tree from `gitvur-flow`, over the repository's own
//! `.gitvur/` data (the structure the app shows, plus the agent's entry points).

use gitvur_flow::TraceOptions;
use gitvur_schema::{Annotations, Structure, Trace};

use crate::bundle;
use crate::error::AppError;

/// Upper bounds for the limits a caller may ask for.
pub const MAX_DEPTH: u32 = 64;
pub const MAX_NODES: u32 = 5_000;

/// Adds agent entry points to the extractor's. An agent entry whose ID the extractor already
/// uses is left out (the validator reports it as `entry-bad-id`).
pub fn merged(mut structure: Structure, annotations: Option<&Annotations>) -> Structure {
    let ai: Vec<_> = annotations
        .into_iter()
        .flat_map(|a| &a.entry_points)
        .filter(|e| !structure.entry_points.iter().any(|s| s.id == e.id))
        .cloned()
        .collect();
    structure.entry_points.extend(ai);
    structure.canonicalize();
    structure
}

/// Traces `start` (an entry point or node ID). An unknown ID is not an error here: the
/// returned trace carries it in `error`.
pub fn get_trace(path: &str, start: &str, depth: u32, max_nodes: u32) -> Result<Trace, AppError> {
    let bundle = bundle::open_repository(path)?;
    let structure = merged(bundle.structure, bundle.annotations.as_ref());
    let options = TraceOptions {
        max_depth: depth.min(MAX_DEPTH),
        max_nodes: max_nodes.min(MAX_NODES),
        include_semantic: false,
    };
    Ok(gitvur_flow::trace(&structure, start, &options))
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use gitvur_schema::TraceKind;

    use super::*;

    fn fixture(name: &str) -> String {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures")
            .join(name)
            .to_string_lossy()
            .into_owned()
    }

    #[test]
    fn traces_static_and_agent_entries_from_the_committed_bundle() {
        let trace =
            get_trace(&fixture("py-flows"), "entry:http-route:post-orders", 6, 300).unwrap();
        assert_eq!(trace.error, None);
        assert_eq!(
            trace.nodes[0].node.as_deref(),
            Some("function:flowapp/api.py:handle")
        );
        let ts = get_trace(
            &fixture("ts-flows"),
            "function:src/backends.ts:countdown",
            6,
            300,
        )
        .unwrap();
        assert_eq!(ts.nodes[1].kind, TraceKind::Cycle);
    }

    /// `app/src/api/mockTraces.json`: default-limit traces of every entry point and node of
    /// the flow fixtures, for the browser mock. Regenerate with
    /// `GITVUR_WRITE_MOCK_TRACES=1 cargo test -p gitvur-app mock_traces`.
    #[test]
    fn mock_traces_are_up_to_date() {
        let mut out = serde_json::Map::new();
        for name in ["py-flows", "ts-flows"] {
            let bundle = bundle::open_repository(&fixture(name)).unwrap();
            let structure = merged(bundle.structure, bundle.annotations.as_ref());
            let starts = structure
                .entry_points
                .iter()
                .map(|e| e.id.clone())
                .chain(structure.nodes.iter().map(|n| n.id.clone()));
            for start in starts {
                let trace = gitvur_flow::trace(&structure, &start, &TraceOptions::default());
                out.insert(
                    format!("{name}|{start}"),
                    serde_json::to_value(trace).unwrap(),
                );
            }
        }
        let text = format!("{}\n", serde_json::to_string(&out).unwrap());
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/api/mockTraces.json");
        if std::env::var_os("GITVUR_WRITE_MOCK_TRACES").is_some() {
            std::fs::write(&path, &text).unwrap();
        }
        assert_eq!(
            std::fs::read_to_string(&path).unwrap_or_default(),
            text,
            "mockTraces.json is out of date; run GITVUR_WRITE_MOCK_TRACES=1 cargo test -p gitvur-app mock_traces"
        );
    }

    #[test]
    fn unknown_starts_and_huge_limits_are_bounded() {
        let trace = get_trace(&fixture("py-flows"), "nope", u32::MAX, u32::MAX).unwrap();
        assert!(trace.error.is_some());
        let shallow = get_trace(
            &fixture("py-flows"),
            "entry:console-script:flow-shop",
            1,
            300,
        )
        .unwrap();
        assert!(shallow.truncated);
    }
}

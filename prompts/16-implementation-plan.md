# Phase 16 implementation plan

Audit: the app already has independent repository tabs, persisted tab selection, React Flow,
Dagre, a shared layout worker, safe source inspection and save-dialog SVG/PNG export.
The v0.3 annotation contract has optional extensions and schema/binding drift checks.
The packet already includes modules, entries, traces and per-node hashes. No AI runtime is needed.

1. Add an optional, independently versioned `annotations.architecture` object. Keep old
   annotation bytes unchanged when absent. Components reference structure nodes with hashes;
   relationships reference components and carry evidence. Status is computed, never trusted.
2. Validate IDs, unique membership, hierarchy, source hashes, evidence locations and relationship
   support in the Rust validator. Report architecture errors/warnings through existing issues.
   Evidence proves traceability, not the truth of arbitrary natural-language claims.
3. Build a pure frontend architecture projection from indexed files grouped by directories.
   Aggregate only verified imports/calls with neutral labels. Overlay valid, current AI
   groupings while retaining unclaimed files and verified dependencies. Offer structure-only mode.
4. Add Diagram/Ctrl+4 with Dagre layout in the existing worker, overview/drill-down hierarchy,
   filtering, selection, source inspector context and Map/Docs navigation. Reuse theme tokens.
5. Reuse safe export capture/save dialogs, add escaped grouped Mermaid serialization.
6. Test contract compatibility, validation, determinism, aggregation, layout, navigation and exports;
   review browser screenshots in both themes, run required workspace/frontend checks.

No source extraction or existing Map/Docs/Flows artifacts change. No new dependencies or network
services. Directory grouping describes organization, not inferred runtime responsibilities.

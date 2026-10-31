# Gitvur — Phase 16: Agent-Generated Architecture Diagrams (planned)

This is a future implementation prompt. The current documentation-only task must not execute
it. Read `CLAUDE.md`, `PROGRESS.md`, `agent/codeDOC.md`, the schema documentation and
[the dedicated Phase 16 plan](../PHASE_16_ARCHITECTURE_DIAGRAM.md) before implementation.
The dedicated plan supplies all workstreams, ordering, acceptance gates and unresolved choices.

The agreed pipeline is Indexer → Documentation Agent → Architecture Artifact → Validator →
Diagram UI. The Documentation Agent owns semantic architecture during its normal documentation
workflow. The indexer supplies deterministic facts and authoritative indexed code IDs; do not
build a deterministic architecture inference engine as the primary diagram source.

Proposed `.gitvur/architecture.json` is a separate versioned semantic artifact, not a static
image, Mermaid text or UI layout. Exact schema and migration remain to be designed. Validation
checks references, evidence, schema and freshness; valid references do not prove interpretations.
Unsupported interactions remain unresolved when deterministic proof is unavailable.

The independent Diagram view reads saved validated data without invoking AI. Preserve Map,
Docs, Flows and Inspector, support absent architecture safely, reuse existing rendering and
safe exports, remain local-first and never execute analyzed repository code.

Audit the legacy directory-based Diagram and optional `annotations.architecture` implementation;
they predate this revised decision. Resolve compatibility explicitly. Do not treat the legacy
implementation or its prior tests as completion of the new plan. Keep future agent instructions
inactive until the new contract and validation are implemented.

In a later authorized implementation session, follow the dedicated plan's acceptance criteria,
run applicable checks, review both themes and report changes, evidence, limitations and remaining
work in `PROGRESS.md`. This prompt does not authorize implementation during documentation work.

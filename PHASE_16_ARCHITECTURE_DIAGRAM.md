# Phase 16 — Agent-Generated Architecture Diagrams

**Status: implemented contract and acceptance plan (2026-10-31).** The user subsequently
authorized implementation after the documentation-only planning task. This document retains
workstream acceptance criteria; current implementation and verification are recorded in
`PROGRESS.md`. The earlier directory-based enrichment model remains legacy compatibility,
not the default Diagram experience.

## Ownership and scope

`Indexer → Documentation Agent → Architecture Artifact → Validator → Diagram UI`

The deterministic indexer supplies existing structural facts, relationships and authoritative
code identities. It does not infer semantic architecture. During its normal documentation
workflow, the Documentation Agent interprets architecture and produces a structured artifact
alongside normal annotations. The validator checks schema, references, evidence and staleness;
reference validity does not prove semantic correctness. Unsupported relationships remain
unresolved when deterministic proof is unavailable. Preserve structural versus AI provenance.

The additional view is `Map | Docs | Flows | Diagram`. Map remains the full hierarchical code
map; Flows retains curated execution paths and deterministic traces. Diagram shows major
components, responsibilities, subsystem groups and labeled interactions. It reads saved,
validated data with no AI invocation on tab open. Missing architecture leaves the app usable.
Reuse React Flow, Dagre and existing worker, inspector and safe export infrastructure.
Keep local-first operation; never execute untrusted repository code or require a new AI service.

## Artifact contract

Path: `<repo>/.gitvur/architecture.json`, written by the Documentation Agent. See
[the schema README](crates/gitvur-schema/README.md) and generated
[standalone schema](schemas/architecture.schema.json). Existing validate/stale/packet paths and
repository loading support it. Indexing does not generate semantic architecture.

| Area | Contents |
| --- | --- |
| Overview | Short architecture summary; optional important design characteristics |
| Component | Stable ID, name, type/category, concise English responsibility, indexed code references, optional parent/group, evidence references, provenance |
| Relationship | Stable ID, source/target component IDs, typed interaction, short readable label, evidence references, provenance |
| Metadata | Schema version, repository/index version or relevant snapshot identity; generation metadata only where consistent with existing conventions |

The root contains `schemaVersion: 1`, `commitSha`, `indexHash`, optional `designNotes`, and
`architecture` (the version-1 summary/components/relationships model). Architecture IDs use
`arch:<lowercase-kebab-slug>`. The index fingerprint is copied from `gitvur packet`.
Reuse existing code IDs unchanged; retain stable architecture IDs across incremental edits.
Reuse `syntactic | semantic | ai` provenance semantics without labeling
AI interpretation as extracted fact. Code references should retain copied indexed hashes for
freshness. Evidence uses repository-relative `/` paths and 1-based inclusive locations; enforce
existing canonical path confinement, including symlinks. Define checks for duplicate IDs,
dangling endpoints, parent cycles, evidence bounds and changed/deleted references.

Architecture data contains no canonical UI coordinates. Layout is separate presentation state;
Mermaid, SVG and PNG are derived exports. Validation status is computed, not agent-authored
confidence. Deterministic outputs retain canonical ordering and existing timestamp restrictions
(currently `manifest.generatedAt`); do not casually add generation timestamps to this artifact.

## Workstreams and acceptance criteria

### 1. Artifact schema and compatibility

Design the separate artifact, Rust types, generated schema and frontend bindings consistently
with existing versioning, IDs, hashes, provenance and canonical serialization. Audit strict
readers and the legacy annotation extension before deciding migration policy.

Acceptance: schema and version policy documented and tested; stable identities survive unrelated
edits; old v0.2/v0.3 bundles without architecture still load; unknown versions fail safely for
Diagram alone. Explicitly decide coexistence, precedence and migration from
`annotations.architecture`; do not silently reinterpret legacy data or rewrite old artifacts.

### 2. Documentation-agent prompt and packet integration

After workstream 1, extend initial/incremental packets with available architecture, relevant
indexed context and architecture findings. Activate future agent instructions only after the
writer, schema and validator contract is usable. Retain existing documentation completion rules.

Acceptance: the normal documentation workflow emits annotations plus the new artifact;
components use real indexed sources and evidence; medium-repository diagrams typically have
5–15 meaningful components, with fewer permitted. Responsibilities and typed interactions are
concise and source-backed. Incremental examples preserve unaffected IDs/data, update affected
architecture and detect new boundaries without full rewrites for unrelated edits. No static
image/Mermaid is canonical; no separate architecture inference engine or AI runtime is added.

### 3. Validation and staleness

After workstream 1, validate schema, indexed references, component endpoints/groups, evidence
locations and hashes/snapshots. Preserve the difference between reference validity and semantic
support. Surface missing, stale, invalid and unresolved findings explicitly.

Acceptance: tests cover missing/deleted IDs, dangling edges, cycles, unsafe/out-of-range evidence,
changed hashes and unsupported relationships. Deterministic proof may support structural facts;
AI claims without such proof remain unresolved even with valid citations. Status aggregation
and partial rendering policy are documented; unrelated components remain current. Results are
canonical and repeated validation is byte-identical for identical inputs.

### 4. CLI and repository-bundle integration

After 1 and 3, integrate artifact loading and validation into existing CLI and bundle paths;
then finalize packet integration in 2. Audit current implementations before proposing commands.
No new CLI command or packet field is assumed to exist by this plan.

Acceptance: index/validate/stale/packet and bundle tests exercise missing, valid, malformed,
unsupported-version and stale architecture safely. Indexing does not write semantic architecture.
Bundle results expose artifact and findings consistently; tab open requires no AI and does not
trust outdated cached validation. Optional failures do not break Map, Docs or Flows. Repository
reads remain confined; documentation writes stay within the explicitly authorized artifact set.

### 5. Diagram tab and interactive rendering

After 4, render saved validated components, groups, responsibilities and labeled relationships
using the existing visualization stack. Keep semantic data separate from layout. Do not replace
an absent agent artifact with deterministic semantic architecture inference.

Acceptance: pan, zoom, fit-to-view, selection and inspection work with keyboard access, visible
focus and both themes. Empty/loading/error/stale/unresolved states are clear. Missing artifacts
leave other tabs usable; opening Diagram makes zero AI calls. Any retained legacy structural
view is clearly distinguished from the new agent-authored artifact. Test small and large models.

### 6. Inspector and source navigation

After 4–5, integrate component/relationship responsibilities, provenance, findings and evidence
with the existing inspector and navigation.

Acceptance: components link to Map, relevant Docs and actual source ranges; relationships show
endpoints, meaning, evidence and unresolved status. Broken references yield a clear unavailable
state. Navigation preserves the existing tab/view conventions and safe source-read boundaries.

### 7. Mermaid, SVG and PNG exports

After 5–6, derive exports from semantic data and current presentation with existing save paths.

Acceptance: Mermaid preserves groups, labels and escaped identifiers; SVG/PNG are readable in
both themes and preserve meaningful status/provenance context. Save-dialog exports require a
user-selected destination, never automatic writes into the analyzed repository. Test escaping,
empty diagrams, image output and path confinement. Exports are never canonical input.

### 8. Unit, integration and UI tests

Begin with 1 and add tests alongside every workstream, using safe fixtures as data only.

Acceptance: serialization/schema/binding drift, stable IDs, compatibility, evidence, staleness,
incremental preservation, bundle loading, layout, navigation and exports have meaningful tests.
UI regressions cover Map/Docs/Flows and no-AI tab open. Run applicable Rust format/Clippy/tests
and frontend typecheck/lint/unit/Playwright checks discovered in the repository. Do not weaken
existing tests or execute analyzed repository code.

### 9. Visual evaluation on representative repositories

After 5–8, review small repositories with few components, medium repositories and larger
multi-subsystem repositories using saved agent artifacts.

Acceptance: record repository revision, artifact/review context and light/dark screenshots;
review responsibility clarity, supported interactions, grouping, label collisions, navigation
and exports. Confirm a useful overview without one node per file/function; do not pad small
repositories. Record human semantic review separately from validator results and resolve
material readability defects before declaring completion.

## Implementation order and open decisions

Order: 1 → (2 design and 3) → 4 → finish/activate 2 → 5 → 6 → 7 → 9.
Workstream 8 accompanies all steps; its regression gate precedes final visual acceptance.
Implementation reused the legacy graph/layout/inspector/export infrastructure and retained
its raw structure mode explicitly as secondary exploration.

Implemented choices: independent schemaVersion 1 and model version 1; arch IDs; open nonempty
interaction kinds (calls/invokes and imports/depends_on can carry direct structural support);
optional parent groups with descendant evidence; overlapping source membership; canonical index
fingerprint plus per-source hashes and on-disk freshness checks. Standalone data takes precedence
even when malformed; legacy annotation maps remain readable only when it is absent. No migration
occurs on open. Errors block the explanatory map, stale sources remain visibly marked, and
traceable AI interactions without deterministic proof stay visible as unresolved warnings.

Follow-up evaluation: native desktop save dialogs and substantially larger real-world architecture
maps beyond the small Go and representative Python fixtures. Reference checks and automated UI
tests do not replace human review of architectural interpretations.


## Implementation file inventory

- Contract: `crates/gitvur-schema/src/{architecture.rs,lib.rs,schema.rs}`,
  `crates/gitvur-schema/tests/compatibility.rs`, `schemas/architecture.schema.json`, and
  `app/src/generated/contract.ts`.
- Validation: `crates/gitvur-validate/src/{architecture.rs,lib.rs,repo.rs}` and
  `crates/gitvur-validate/tests/architecture.rs`.
- CLI/bundle: `crates/gitvur-cli/src/{main.rs,packet.rs}`, `crates/gitvur-cli/tests/cli.rs`,
  `app/src-tauri/src/{bundle.rs,bindings.rs}`, and `app/src-tauri/tests/bundle.rs`.
- Diagram/inspection: `app/src/diagram/{DiagramTab.tsx,ComponentNode.tsx,RelationshipEdge.tsx,
  model.ts,model.test.ts,layout.ts,mermaid.ts,diagram.css}` and `app/src/docs/DocsTab.tsx`.
- Browser data/review: `app/src/api/mock.ts`, `app/e2e/diagram.spec.ts`,
  `app/e2e/fixtures/architecture-artifact.json`, eight new Diagram review screenshots under
  `app/e2e/__screenshots__/{light,dark}/`, and the documented `fixtures/go-small/.gitvur/` bundle.
- Instructions/plans: `agent/codeDOC.md`, both schema/validator crate READMEs, `CLAUDE.md`,
  `README.md`, `PROTOTYPE_V2_PLAN.md`, `PROGRESS.md`, this plan, `prompts/README.md`,
  `prompts/16-Architecture-Diagram.md`, and `prompts/16-implementation-plan.md`.

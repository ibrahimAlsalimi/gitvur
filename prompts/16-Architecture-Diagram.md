# Gitvur — Phase 16: Architecture Diagram

You are a senior software architect, Rust engineer, React/TypeScript engineer, and information visualization designer working on Gitvur.

Your task is to implement a new, independent **Architecture Diagram** feature inspired by GitDiagram.

## 1. Project Context

Gitvur is a local-first application for understanding, visualizing, documenting, and navigating source-code repositories.

The existing application includes:

- **Map:** Detailed, hierarchical repository visualization with source-code relationships.
- **Docs:** AI-assisted documentation grounded in actual code.
- **Flows:** Execution-flow visualization and deterministic call tracing.
- **Inspector:** Source-code navigation, evidence, descriptions, and relationships.
- **Indexing and Validation:** Deterministic structural analysis, AI annotations, provenance tracking, and validation.

The existing implementation uses Rust crates, a Tauri desktop application, React/TypeScript, and React Flow (`@xyflow/react`).

Do not assume the exact current directory structure or implementation. Inspect the repository before making changes.

## 2. Main Objective

Add a fourth top-level tab:

**Map | Docs | Flows | Diagram**

The Diagram tab must generate and display a high-level software architecture diagram for the indexed repository.

The experience should be conceptually similar to GitDiagram:

A developer opens an unfamiliar repository and immediately understands:

1. What the software does.
2. What its main architectural components are.
3. What each component is responsible for.
4. How those components interact.
5. Where those components are implemented in the source code.

**This is an additional feature, NOT a replacement for the existing Gitvur architecture, Map, Docs, or Flows.**

## 3. Critical Design Principles

### A. Architecture, not a call graph

Do not display individual functions as the primary diagram nodes.

A diagram should contain meaningful architectural components, such as:

- API / HTTP Layer
- Authentication
- Business Logic
- Database / Persistence
- Background Workers
- Event Processing
- External Integrations
- CLI
- Frontend
- Infrastructure

These are examples, not a mandatory template. Only include components supported by the actual repository.

### B. Semantic relationships

Relationships must describe meaningful interactions.

Examples:

- Routes requests to
- Authenticates
- Reads from
- Writes to
- Publishes events to
- Consumes messages from
- Invokes
- Depends on

Do not turn imports or function calls into stronger runtime claims without sufficient evidence.

### C. Readability first

A diagram with hundreds of boxes is not an architecture diagram.

Use abstraction, grouping, hierarchy, and progressive disclosure.

The default view should show a concise overview, normally around 5–15 major components when justified by repository size and structure.

This is a guideline, not an arbitrary data limit.

### D. Evidence-based architecture

Gitvur's existing philosophy must be preserved:

- Derive structural facts deterministically.
- Use AI only where semantic understanding is required.
- Validate references and relationships.
- Preserve provenance.
- Never invent components or connections merely to make the diagram visually complete.

### E. Local-first and safe

Treat analyzed repositories as untrusted data.

Never execute scripts, builds, tests, package installers, or other commands from repositories being analyzed.

Do not introduce mandatory external AI services or network dependencies.

Architecture visualization must continue to work without an AI provider, even if the fallback is less semantically rich.

## 4. First Task — Repository Audit

Before changing code, inspect:

- `CLAUDE.md`
- `PROGRESS.md`
- Relevant schema documentation
- Existing `structure.json` and `annotations.json` formats
- Existing AI documentation instructions (`agent/codeDOC.md`)
- Current Map, Docs, Flows, and Inspector implementations
- Existing React Flow nodes, edges, layouts, and workers
- Existing Tauri commands
- Existing tests and fixtures

Determine:

1. Which existing components can be reused.
2. How architecture information should be stored.
3. Whether a new schema field or separate versioned artifact is preferable.
4. How deterministic structure data can support architecture inference.
5. How diagrams should be validated.
6. How to preserve compatibility with existing repositories.

Write a concise implementation plan before editing.

Avoid unrelated refactoring.

## 5. Architecture Data Model

Implement an explicit, versioned architecture representation.

The exact location and schema should follow the repository's existing conventions.

The model must represent:

### Architectural components

Each component should include:

- Stable ID
- Human-readable name
- Component kind
- Short responsibility description
- Referenced source nodes/files/modules
- Optional parent component for hierarchy
- Provenance
- Evidence
- Validation status

### Architectural relationships

Each relationship should include:

- Stable ID
- Source component
- Target component
- Relationship type
- Human-readable label
- Provenance
- Supporting evidence

The representation must remain separate from the low-level call graph while referencing existing Gitvur structure IDs.

Do not duplicate source-code structure unnecessarily.

Do not assign absolute confidence percentages without calibrated evidence.

## 6. Architecture Generation Pipeline

Implement a pipeline with two complementary modes.

### Mode A — Deterministic Fallback

Available without AI.

Use existing indexed structural information to build a conservative high-level component view.

Possible inputs:

- Module hierarchy
- Package boundaries
- File and node relationships
- Verified imports/dependencies
- Existing entry points
- Existing validated flows
- Existing repository metadata

Cluster related modules and files into meaningful structural groups where possible.

When semantic purpose cannot be determined, use neutral names and labels rather than guesses.

Clearly identify this mode as structure-derived.

### Mode B — AI-Enriched Architecture

Use Gitvur's existing agent-based documentation workflow.

Do not introduce an entirely new AI runtime unless absolutely necessary.

Extend the documentation instructions and packet workflow where appropriate so the existing documentation agent can produce:

- Architectural component names
- Responsibility descriptions
- Important subsystem groupings
- Meaningful relationships
- Source-backed explanations

Each AI-generated component and relationship must reference existing structural elements and provide supporting evidence.

Validation must reject broken references and unsupported claims according to clearly documented rules.

AI enrichment should improve the deterministic diagram rather than replace verified structural facts.

## 7. Diagram User Interface

Create a new **Diagram** tab consistent with Gitvur's existing visual language.

### Layout

The interface should provide:

- Diagram canvas
- Repository architecture title and short summary
- Component and relationship visualization
- Zoom controls
- Fit-to-view
- Reset layout
- Selection and highlighting
- Inspector integration
- Optional component filtering
- Clear empty, loading, and error states

Reuse `@xyflow/react` and existing Gitvur layout infrastructure where suitable.

### Visual hierarchy

Use distinct visual treatments for architectural component types.

Support:

- Grouped subsystems
- Nested components when appropriate
- Directional relationships
- Readable relationship labels
- Consistent spacing
- Minimal crossing edges
- Dark and light themes

Optimize the diagram for understanding rather than visual density.

### Interaction

Clicking a component should:

1. Highlight it and its direct relationships.
2. Show its responsibility in the inspector.
3. Show relevant source files and modules.
4. Display supporting evidence.
5. Provide navigation to the corresponding element in Map or Docs.

Clicking a relationship should:

1. Show what the relationship means.
2. Show its source and target.
3. Show provenance and evidence.
4. Allow navigation to related source elements.

Support progressive disclosure for complex repositories.

Do not modify existing Map, Docs, or Flows behavior unless minimal integration is required.

## 8. Export

Support:

- Export as SVG
- Export as PNG
- Copy as Mermaid

The Mermaid representation must preserve major components, grouping, and labeled relationships.

Export files only to an explicitly user-selected destination.

Never write generated export files into the analyzed repository automatically.

## 9. Validation and Compatibility

The implementation must:

- Preserve existing schema compatibility.
- Handle repositories with incomplete documentation.
- Handle repositories without AI annotations.
- Handle repositories with no detectable meaningful components.
- Detect missing source references.
- Detect dangling architecture relationships.
- Track outdated architecture annotations when underlying indexed source changes.
- Avoid changing existing Map, Docs, and Flows artifacts unnecessarily.

If schema changes are required, document migration and backward-compatibility behavior.

## 10. Testing

Implement relevant unit and integration tests covering:

- Architecture model serialization.
- Stable component IDs.
- Deterministic generation.
- Relationship aggregation.
- Component membership.
- Invalid and dangling references.
- AI annotation validation.
- Old repository compatibility.
- Diagram layout.
- Selection and navigation.
- Mermaid export.
- SVG/PNG export.
- Empty and large repositories.

Add Playwright tests following the project's existing patterns.

Use safe, known fixtures for testing.

Never execute the code of an untrusted repository.

## 11. Visual Quality Requirements

The Diagram tab should feel like a finished developer tool, not a prototype.

Review screenshots in both light and dark themes.

Check:

- Can a new developer understand the system in 30 seconds?
- Are the most important components immediately visible?
- Are relationships meaningful rather than merely decorative?
- Is the diagram readable without zooming into every node?
- Does the inspector explain why components and relationships exist?
- Does a large repository remain navigable?
- Is the exported diagram suitable for project documentation?

Fix visual problems discovered during review.

## 12. Execution Strategy

Implement in small, verifiable increments:

1. Inspect the repository and document the design.
2. Implement the architecture model and validation.
3. Implement deterministic architecture extraction.
4. Integrate the existing AI documentation workflow.
5. Build the Diagram UI.
6. Add source navigation and inspector integration.
7. Implement exports.
8. Add tests and perform visual review.
9. Update documentation and `PROGRESS.md`.

Preserve the existing functionality throughout.

Do not silently weaken or remove existing tests to make the feature pass.

Use the project's actual build and test commands discovered during the audit.

## 13. Definition of Done

The feature is complete when:

- The fourth `Diagram` tab is available.
- Existing repositories can generate a useful diagram without AI.
- AI enrichment can produce meaningful, validated architecture descriptions.
- Components and relationships link to real source code.
- The diagram supports zoom, pan, fit, selection, and inspection.
- Mermaid, SVG, and PNG exports work.
- Dark and light modes are visually reviewed.
- Existing Map, Docs, and Flows continue functioning.
- Relevant tests pass.
- `PROGRESS.md` and relevant documentation are updated.

## Final Instructions

Do not recreate GitDiagram's source code or copy its proprietary assets.

Implement an original Gitvur architecture visualization feature inspired by its user experience.

Prioritize correctness, evidence, clarity, and maintainability over unnecessary complexity.

Start by auditing the repository and writing the implementation plan. Then proceed incrementally with implementation and verification.

At the end, report:

- Files changed
- Architecture decisions
- Features implemented
- Tests performed and results
- Known limitations
- Recommended follow-up work


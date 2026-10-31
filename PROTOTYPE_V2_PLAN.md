# Gitvur — Prototype v2 Plan

**Date:** 2026-10-29
**Status:** Plan (not yet implemented)
**Supersedes:** Prototype v0.1 data flow (AI agent produced the full structure)

---

## 1. Goal and scope

Prototype v2 proves one thing: **a structure extracted deterministically from the code, with AI-written annotations layered on top, produces an accurate and useful map of a real repository, and detects on its own when the documentation has gone stale.**

**Core question:** Is the hybrid map accurate enough to trust, and does it make a repository faster to understand than browsing files?

### In scope

- A standalone deterministic extractor, shipped as a CLI, supporting **Python** and **TypeScript**.
- A new data contract (v0.2) that separates *structure* from *annotations*.
- An agent instructions file (`codeDOC.md`) that limits the agent to describing and grouping.
- A validator that checks both layers and detects staleness.
- A viewer that merges both layers, shows the provenance of every relationship, and collapses the tree at file level by default.
- A structural diff between two Git revisions.
- Execution flows (Phase 14 data layer, Phase 15 UI): deterministic entry points and call
  traces, plus agent-curated flows checked by the validator. See "Execution flows" below.

The plan is ordered by sequence and acceptance gates, not by dates; the available time has not been set yet.

---

## 2. What changes from Prototype v0.1

The fundamental change: **structure moves from the AI agent to a deterministic extractor. The agent becomes responsible for meaning only.**

| Aspect | Prototype v0.1 | Prototype v2 |
| --- | --- | --- |
| Who discovers functions and classes | AI agent | Deterministic extractor |
| Who sets line ranges | AI agent | Deterministic extractor |
| Who finds imports and calls | AI agent | Extractor; agent adds hidden ones with evidence |
| Descriptions and logical modules | AI agent | AI agent |
| Metadata files | `nodes.json` + `edges.json`, mixed authorship | Generated `structure.json` + agent-written `annotations.json` |
| Staleness detection | None | Content hash per element |
| Link to a code revision | None | Commit SHA in the manifest |
| Relationship provenance | None | `syntactic` / `semantic` / `ai` |
| Default view | Full tree, fully expanded | Full tree, collapsed at file level |
| Revision comparison | Phase 4 of the roadmap | Inside this prototype |

**Unchanged:** local-first operation, read-only viewer, the selected app stack (Tauri 2, Rust, React + TypeScript, React Flow, Dagre), and the security rules from the v0.1 overview.

---

## 3. Architecture

Four components. Each has one responsibility and writes to exactly one file. The extractor and validator are deterministic programs with no AI. The agent is the only component that can be wrong, so everything it produces passes through the validator.

```text
                    Repository
           (source code + Git history)
               |                  |
               v                  v
        gitvur index          AI agent
   (extracts structure,   (writes descriptions
    no AI)                 and modules only)
               |                  ^      |
               v                  |      v
        structure.json -----------+   annotations.json
         (reads structure)               |
               |                         |
               +-----------+-------------+
                           v
                    gitvur validate
           (checks both layers, detects staleness)
                           |
                           v
                     Gitvur viewer
      (merges and renders; shows provenance of each edge)
```

The viewer still reads source snippets directly from the repository, as in v0.1. The validator writes its results to `report.json`, which the viewer uses to flag stale descriptions.

- **Extractor:** Rust library built on `tree-sitter`. Produces nodes, source ranges, content hashes, imports, and syntactic calls.
- **Agent:** Receives the structure ready-made. Writes logical modules, descriptions, and hidden relationships, each with evidence.
- **Validator:** Checks references and evidence, compares hashes.
- **Viewer:** A new Tauri desktop app in a fresh repository. Calls the extractor and validator libraries directly.

---

## 4. Data contract v0.2

Four files. Each file has exactly one writer. Nobody edits `structure.json` by hand.

```text
.gitvur/
├── manifest.json      # written by the extractor
├── structure.json     # written by the extractor
├── annotations.json   # written by the agent
└── report.json        # written by the validator
```

### 4.1 `manifest.json`

Ties the documentation to a specific revision of the code.

```json
{
  "schemaVersion": "0.2",
  "projectName": "Example Project",
  "commitSha": "9f1c2e7",
  "generatedAt": "2026-10-29T15:00:00Z",
  "extractor": { "name": "gitvur-index", "version": "0.2.0" },
  "languages": ["python", "typescript"]
}
```

### 4.2 `structure.json`

Nodes and static relationships. IDs use the fully qualified name to avoid collisions.

```json
{
  "nodes": [
    {
      "id": "function:src/db/users.ts:UserRepository.findById",
      "type": "function",
      "name": "findById",
      "parentId": "class:src/db/users.ts:UserRepository",
      "source": { "file": "src/db/users.ts", "startLine": 12, "endLine": 24 },
      "contentHash": "sha256:a3f9c2..."
    }
  ],
  "edges": [
    {
      "from": "function:src/auth/login.ts:login",
      "to": "function:src/db/users.ts:UserRepository.findById",
      "type": "calls",
      "provenance": "syntactic",
      "evidence": { "file": "src/auth/login.ts", "line": 8 }
    }
  ]
}
```

### 4.3 `annotations.json`

Logical modules, descriptions, and hidden relationships. Each description is tied to the hash it was written against.

```json
{
  "modules": [
    {
      "id": "module:authentication",
      "name": "Authentication",
      "description": "Handles sign-in and session management.",
      "files": ["file:src/auth/login.ts", "file:src/auth/session.ts"]
    }
  ],
  "descriptions": [
    {
      "id": "function:src/auth/login.ts:login",
      "text": "Checks user credentials and starts a session.",
      "basedOnHash": "sha256:7be01d..."
    }
  ],
  "edges": [
    {
      "from": "function:src/auth/session.ts:createSession",
      "to": "function:src/audit/log.ts:recordLogin",
      "type": "references",
      "provenance": "ai",
      "evidence": { "file": "src/auth/session.ts", "line": 31 },
      "note": "Registered as an event handler for 'session.created'."
    }
  ]
}
```

### 4.4 Contract rules

- The extractor produces `project`, `file`, `class`, and `function` nodes. The agent produces `module` nodes only.
- In `structure.json`, a file's parent is the project. The viewer re-parents each file under its logical module at merge time.
- Allowed `provenance` values: `syntactic | semantic | ai`.
- Every edge with `provenance: "ai"` must include `evidence` with a file and line.
- `contentHash` is computed over the element's text after normalizing line endings, so it is stable across operating systems.
- Lines are 1-based and inclusive; paths are relative to the repository root, as in v0.1.
- Supported edge types (unchanged): `calls`, `imports`, `depends_on`, `references`.

---

## 5. Repository layout

A single repository with a Rust workspace, so the extractor and validator are libraries shared by the CLI and the desktop app without duplication.

```text
gitvur/
├── Cargo.toml                  # Rust workspace
├── crates/
│   ├── gitvur-schema/          # v0.2 contract types + JSON Schema
│   ├── gitvur-index/           # extractor (tree-sitter)
│   │   └── queries/
│   │       ├── python.scm
│   │       └── typescript.scm
│   ├── gitvur-validate/        # validator + staleness detection
│   ├── gitvur-diff/            # structural diff between two revisions
│   ├── gitvur-flow/            # deterministic call traces + flow checks
│   └── gitvur-cli/             # commands: index / validate / stale / packet / diff / trace / flows
├── app/                        # Tauri 2
│   ├── src-tauri/              # calls the crates above
│   └── src/                    # React + TypeScript
├── agent/
│   ├── codeDOC.md              # agent instructions
│   └── annotations.schema.json
└── fixtures/                   # small test repositories
    ├── py-small/
    └── ts-small/
```

Target CLI commands:

```bash
gitvur index    <repo>
gitvur validate <repo>
gitvur stale    <repo>
gitvur diff     <repo> <commitA> <commitB>
gitvur trace    <repo> <entryId|nodeId>
gitvur flows    <repo>
```

The `fixtures/` directory matters: each fixture ships with a hand-written expected `structure.json`, and tests compare the extractor's output against it.

---

## 6. Phases

Seven phases in sequence. Each phase has an acceptance gate that must pass before the next begins. **Exception:** Phase 5 (viewer) may start after Phase 2, using fixture data.

### Phase 1 — Foundation

Contract crate, fixture repositories, and CI.

- [ ] Contract types written in Rust and generating a JSON Schema
- [ ] Two fixture repositories (Python and TypeScript) covering hard cases: same-named methods in two classes, nested functions, aliased imports
- [ ] A hand-written expected `structure.json` for each fixture
- [ ] Tests run automatically on every push

### Phase 2 — Extractor

Python first, to completion; then TypeScript. Nodes, ranges, and hashes first; then imports; then syntactic calls.

- [ ] Extractor output matches the expected file for every fixture exactly
- [ ] Two runs on the same code produce byte-identical output (stable ordering)
- [ ] An ambiguous call (more than one possible target) is recorded as ambiguous, never guessed
- [ ] Ignores dependency directories and files excluded by `.gitignore`
- [ ] Runs without errors on a real medium-sized repository, and records run time

### Phase 3 — Validator and staleness detection

- [ ] Rejects any description or edge that points to a non-existent element
- [ ] Verifies every file belongs to exactly one logical module
- [ ] Verifies that the evidence line of every AI edge contains the target's name
- [ ] Writes a report classifying each element: documented, stale, undocumented
- [ ] Editing one function marks only that function's description as stale, not everything below it in the file

### Phase 4 — Agent instructions (`codeDOC.md`)

The agent receives `structure.json` ready-made and runs in two modes: **initial** (whole repository) and **incremental** (stale elements only).

- [ ] The agent writes `annotations.json` only; it never touches `structure.json` or source code
- [ ] Its output passes the validator with no errors on the fixtures
- [ ] Incremental mode sends only stale elements to the agent and leaves valid descriptions unchanged
- [ ] Runs on an isolated copy of the repository, with writes restricted to `.gitvur/`

### Phase 5 — Viewer

Built from scratch in the new repository; split into Phases 06–09 and 11 of the prompt set.

- [ ] Merges structure and annotations; still works when `annotations.json` is missing (structure without descriptions)
- [ ] Tree collapsed at file level by default, with an "expand all" control
- [ ] Three edge line styles by provenance, with a legend
- [ ] Clear badge on stale descriptions, and a control to open any edge's evidence in the code
- [ ] Rendering stays smooth on Linux with the chosen real repository

### Phase 6 — Revision diff

Run the extractor on two revisions in temporary directories and compare the outputs, with no AI.

- [ ] Classifies each element: added, removed, modified, moved, unchanged
- [ ] Classifies edges: new, removed
- [ ] The viewer colors changes on the map and auto-expands changed branches
- [ ] Never touches the user's working directory

### Phase 7 — Evaluation on a real repository

The gate for the whole prototype. Details in section 8.

---

## 7. Working with coding agents

The agent is used in two separate roles: a **developer** that builds the tool, and a **documenter** that writes annotations. Never mix the two roles in one session.

**Rules for development sessions:**

- One phase, or part of one, per session; each session ends with passing tests.
- Start each phase with the expected output file and a failing test, then ask for the implementation.
- Keep a persistent instructions file at the repository root describing the architecture, the contract, and what is forbidden:

```text
CLAUDE.md
AGENTS.md
```

- Review every change yourself before merging, especially in the extractor and validator — they are the foundation of trust.

**Suggested division of work:**

| Task | Owner | Note |
| --- | --- | --- |
| Expected output files for fixtures | Agent drafts, human reviews | Written by hand-reading the source before any extractor exists; human review is a hard gate |
| `tree-sitter` queries per language | Human with agent | Good chance to learn the tool directly |
| Rust crates and CLI | Agent | Phase by phase, with tests |
| Agent instructions file (`codeDOC.md`) | Human with agent | Improved by trial on the fixtures |
| Viewer | Agent | New app, built phase by phase with screenshot reviews |
| Final evaluation | Human | Must be done by a person |

**Rules for documentation sessions:** same security controls as the v0.1 overview — isolated copy, no secrets in scope, no running repository scripts, and writes restricted to `annotations.json`.

---

## 8. Testing and success criteria

The prototype succeeds if it passes four tests on a real, medium-sized repository not written by the project author. Targets are proposals; adjust them after the first run.

| Test | How it is measured | Proposed target |
| --- | --- | --- |
| Description accuracy | Random sample of 30 elements; rate each description: correct / incomplete / wrong | 90% correct or incomplete, and no misleading errors |
| AI edge accuracy | Review every AI-provenance edge against its evidence | 90% correct |
| Staleness detection | Manually edit 5 functions and run the validator | All 5 flagged, nothing else |
| Comprehension | 5 questions about the repository, half answered with Gitvur and half with a normal editor; measure time | Gitvur clearly faster |

Example comprehension questions:

- Where does the program start?
- Who calls the database save function?
- If I change this class, what is affected?
- What changed structurally between the last two revisions?

Also record these numbers without a fixed target, since they guide later decisions: extractor run time, node count, share of ambiguous calls, cost of initial vs incremental documentation, and viewer smoothness.

**Open question:** Which real repository will be used for evaluation? Preferably an open-source Python or TypeScript project with a long Git history.

---

## 9. Risks and out of scope

| Risk | Impact | Mitigation |
| --- | --- | --- |
| High share of ambiguous syntactic calls | Incomplete or noisy relationships | Record them as ambiguous instead of guessing; add semantic indexers later |
| Import resolution differs per language | Phase 2 takes longer than expected | Finish one language completely before the second |
| Agent exceeds its boundaries and edits other files | Corrupted structure or code | Isolated copy; validator regenerates the structure and compares |
| Viewer slow on Linux with many nodes | Poor user experience | Collapsed default view; measure performance early in Phase 5 |
| Renaming functions breaks IDs and loses descriptions | Unnecessary re-documentation | Diff detects moves by hash and carries the description over |
| Scope grows during the work | Prototype never finishes | Any new feature goes to the out-of-scope list, not into the phases |

**Out of scope for this prototype:**

- Languages other than Python, TypeScript, C and Go (C and Go were added after Phase 15)
- Semantic indexers (e.g. `scip-python`, `scip-typescript`)
- Execution flow UI (Phase 15; data layer introduced in Phase 14)
- Full Git history timeline (start with a two-revision diff only)
- Editing, integrated terminal, contributors page
- Running the agent from inside the app (it stays external)

## Execution flows

A Flows view shows how the code runs: where execution starts and which path it takes. It
keeps the core principle: what can be derived from the code is derived deterministically;
what needs understanding is written by the agent, with evidence, and validated.

| Piece | Who produces it |
| --- | --- |
| Entry points visible in code and config (`__main__`, console scripts, `bin`, npm scripts, top-level calls) | Extractor (`structure.entryPoints`) |
| Call trace from any entry point or function | Deterministic, computed from existing edges (`gitvur-flow::trace`, `gitvur trace`) |
| Framework entry points (HTTP routes, jobs, event handlers) | Agent, with evidence (`annotations.entryPoints`) |
| Curated flows: named, ordered steps with labels | Agent (`annotations.flows`); every step and transition checked by the validator |

The validator reports each flow as `current`, `stale` (a step's code changed) or `broken`
(any error) in `report.flows`. The work packet carries every entry point's trace so the agent
builds flows from real edges. Phase 14 delivers the data layer; the UI is Phase 15.

## Phase 14 contract amendment

The current data contract is v0.3, backward compatible with v0.2: readers accept v0.2
files, whose new arrays default to empty. The v0.2 examples above remain valid compatibility
examples. See `crates/gitvur-schema/README.md` for the additions and
`crates/gitvur-validate/README.md` for the entry point and flow checks.

## Phase 16 — Agent-Generated Architecture Diagrams (implemented contract)

This roadmap amendment adds an independent architecture visualization to Map, Docs and Flows:
`Map | Docs | Flows | Diagram`. It does not replace the full repository map, execution flows,
indexing or documentation. Earlier phase descriptions and compatibility examples above retain
their historical scope; the current agent writer contract is now annotations plus the optional architecture artifact.

Pipeline: **Indexer → Documentation Agent → Architecture Artifact → Validator → Diagram UI**.
The indexer remains the deterministic source of structural facts and code identities. The
Documentation Agent interprets high-level architecture during its normal workflow and will
produce `.gitvur/architecture.json` alongside normal documentation. The validator
checks schema, references, evidence and freshness; it cannot prove every semantic interpretation.
Interactions without deterministic proof remain unresolved. The UI reads saved validated data
without a new AI invocation, and absent architecture leaves existing functionality usable.

The artifact models overview, major components/responsibilities, subsystem groups, typed labeled
relationships, indexed references, evidence, provenance and version/snapshot metadata. Layout
coordinates stay separate. Incremental documentation updates affected architecture and preserves
unaffected components/relationships. Local-first safety and the ban on executing analyzed code
continue to apply.

The existing directory-based Diagram with optional annotation enrichment predates this decision.
Its historical implementation does not complete the revised artifact pipeline. See
[the dedicated implementation plan](PHASE_16_ARCHITECTURE_DIAGRAM.md) for nine workstreams,
explicit acceptance criteria, dependency ordering and compatibility decisions. The revised Phase
16 artifact pipeline is implemented; `PROGRESS.md` records verification and remaining evaluation
limits. Timeline uses Phase 17 in the prompt sequence. Historical planning-only sessions remain
accurately recorded as documentation-only work.

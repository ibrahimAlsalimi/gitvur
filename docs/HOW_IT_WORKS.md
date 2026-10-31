# How Gitvur works

This page explains Gitvur's moving parts with diagrams. For installation and a
step-by-step walkthrough, see the [setup guide](USING_GITVUR.md).

The diagrams use Mermaid, which GitHub renders directly. In Gitvur's own **Docs**
tab, they render as images too.

## The core idea

> **Structure is extracted deterministically. Meaning is written by an AI agent.
> Everything the agent writes is validated.**

Gitvur keeps two kinds of knowledge apart:

| Layer | Written by | Contains | Can it be wrong? |
| --- | --- | --- | --- |
| **Structure** | `gitvur index` (Rust + tree-sitter) | Files, classes, functions, line ranges, content hashes, imports, calls, entry points | Same input → byte-identical output. No AI, no network |
| **Meaning** | An AI coding agent you run yourself | Logical modules, descriptions, hidden relationships, curated flows, architecture map | Yes, so every claim must point at real code and is checked by the validator |

The desktop app merges both layers and always shows where each fact came from.

## The pipeline

```mermaid
flowchart LR
    R[("Your repository<br/>(read-only)")]
    I["gitvur index<br/><i>tree-sitter, deterministic</i>"]
    S["structure.json<br/>manifest.json"]
    P["gitvur packet<br/><i>work list for the agent</i>"]
    A["AI agent<br/><i>follows agent/codeDOC.md</i>"]
    N["annotations.json<br/>architecture.json"]
    V["gitvur validate<br/><i>references, evidence, staleness</i>"]
    REP["report.json"]
    APP["Gitvur desktop app<br/>Map · Docs · Flows · Diagram"]

    R --> I --> S
    S --> P --> A
    R -. reads source as data .-> A
    A --> N
    S --> V
    N --> V
    R -. hashes source .-> V
    V --> REP
    S --> APP
    N --> APP
    REP --> APP
```

Every step except the AI agent is deterministic and offline. The agent step is
optional: without it, you still get a full structural map, call traces and
revision diffs.

## What lives in `.gitvur/`

Each file has exactly one writer. Nothing else in your repository is modified.

```mermaid
flowchart TB
    subgraph G[".gitvur/ inside the analysed repository"]
        M["manifest.json<br/>repo, commit, languages"]
        ST["structure.json<br/>nodes, edges, entry points"]
        AN["annotations.json<br/>modules, descriptions, AI edges, flows"]
        AR["architecture.json<br/>(optional) components, interactions"]
        RE["report.json<br/>status per element, issues, flow status"]
    end
    IDX(["gitvur index"]) --> M & ST
    AG(["AI agent"]) --> AN & AR
    VAL(["gitvur validate"]) --> RE
```

## The node hierarchy

Every element has a stable, readable ID. The agent may only describe IDs the
indexer produced; it can't invent nodes.

```mermaid
flowchart TB
    PR["project:root"]
    MO["module:orders<br/><i>logical module, by the agent</i>"]
    FI["file:shop/orders.py"]
    CL["class:shop/orders.py:OrderService"]
    FN["function:shop/orders.py:OrderService.place"]
    EN["entry:main-guard:app-py<br/><i>entry point</i>"]
    FL["flow:cli-places-order<br/><i>curated flow, by the agent</i>"]

    PR --> MO --> FI --> CL --> FN
    EN -. starts at .-> FN
    FL -. steps through .-> FN
```

Relationships (edges) carry a **provenance**:

| Provenance | Meaning | Drawn as |
| --- | --- | --- |
| `syntactic` | Found by the indexer in the code (an import, a call with exactly one target) | Solid grey line |
| `semantic` | Reserved for deeper, type-aware analysis; the current indexer doesn't emit it | Solid blue line |
| `ai` | Claimed by the agent; must cite a file and line as evidence | Dashed purple line with an **AI** pill |

If a call has two or more possible targets, the indexer records it as
*ambiguous* rather than guessing. If it has no target inside the repository, it
is dropped.

## How staleness is detected

Each node in `structure.json` has a `contentHash` of its source. When the agent
describes a node, it copies that hash into the annotation. On every validation,
Gitvur compares the two.

```mermaid
stateDiagram-v2
    [*] --> Undocumented: indexed, no description
    Undocumented --> Documented: agent writes a description<br/>with the current hash
    Documented --> Stale: source changes,<br/>hash no longer matches
    Stale --> Documented: agent updates the description<br/>(incremental packet)
```

If an element is deleted or renamed, its old description points at an ID that no
longer exists. The validator reports that as a `dangling-ref` error, so the agent
must remove or move it.

Curated flows have their own status: **current**, **stale** (a step's code
changed) or **broken** (a step no longer exists, or the evidence is wrong).

## The documentation loop

Gitvur never calls an AI model itself. You run a coding agent (Claude Code, Codex
or similar) on an isolated copy of the repository, and Gitvur checks its work.

```mermaid
sequenceDiagram
    actor You
    participant CLI as gitvur CLI
    participant Agent as AI agent
    participant Files as .gitvur/

    You->>CLI: gitvur index <repo>
    CLI->>Files: manifest.json, structure.json
    You->>CLI: gitvur packet <repo> --mode initial
    CLI-->>You: packet.json (what to document)
    You->>Agent: "Follow agent/codeDOC.md for this repo"
    loop until zero errors
        Agent->>Files: write annotations.json (+ architecture.json)
        Agent->>CLI: gitvur validate <repo>
        CLI->>Files: report.json
        CLI-->>Agent: errors / warnings
    end
    You->>CLI: open the repo in the Gitvur app
    Note over You,Files: After code changes: index → packet --mode incremental → agent → validate
```

Incremental mode lists only stale and undocumented elements, so unrelated
descriptions, modules and architecture components are preserved.

## Inside the code base

```mermaid
flowchart LR
    subgraph RUST["Rust workspace (crates/)"]
        SCH["gitvur-schema<br/>contract v0.3 types + JSON Schema"]
        IDX["gitvur-index<br/>tree-sitter: Python, TypeScript, C, Go"]
        VAL["gitvur-validate<br/>checks + staleness"]
        DIF["gitvur-diff<br/>structural diff of two revisions"]
        FLO["gitvur-flow<br/>bounded call traces, flow checks"]
        CLI["gitvur-cli<br/><code>gitvur</code> binary"]
    end
    subgraph APP["Desktop app (app/)"]
        TAU["src-tauri<br/>Tauri 2 commands"]
        UI["src<br/>React + TypeScript"]
    end

    IDX --> SCH
    VAL & DIF & FLO --> IDX
    VAL --> FLO
    CLI --> IDX & VAL & DIF & FLO
    TAU --> IDX & VAL & DIF & FLO
    UI -- "invoke()" --> TAU
```

The frontend talks to the backend only through a small set of Tauri commands:

| Group | Commands |
| --- | --- |
| Repository | `open_repository`, `index_repository`, `validate_repository`, `recent_repositories`, `forget_recent` |
| Source | `read_source`, `read_revision_source`, `list_commits`, `diff_revisions` |
| Docs | `list_docs`, `read_doc`, `read_doc_asset` |
| Flows | `get_trace` |
| Export | `write_export` (save dialog only; refuses paths inside the repository) |
| App state | `get_settings`, `set_settings`, `get_view_state`, `set_view_state`, `clear_view_state` |

The UI is organised by tab:

```mermaid
flowchart TB
    TB["Tab bar · Ctrl/Cmd+1-4"]
    TB --> MAP["Map<br/>canvas/ · @xyflow/react + dagre<br/>lenses: Structure, Documentation, Changes"]
    TB --> DOC["Docs<br/>docs/ · safe Markdown, backlinks, Mermaid"]
    TB --> FLW["Flows<br/>flows/ · swimlanes, playback, Trace mode"]
    TB --> DIA["Diagram<br/>diagram/ · agent-authored architecture"]
    MAP & FLW & DIA --> INS["Inspector<br/>description, source, relationships, evidence"]
    MAP & FLW & DIA -.-> WK["Layout worker<br/>(off the main thread)"]
```

## Safety guarantees

- **Never runs your code.** Repositories are read as data: no builds, installs, test
  runners or scripts.
- **Read-only viewer.** The app writes only to `.gitvur/`, and only when you click
  **Index** or **Validate**. Exports go through a save dialog to a folder outside
  the repository.
- **Path safety.** Every path read from `.gitvur/` is resolved against the
  repository root and rejected if it escapes it, including through symlinks.
- **Safe Markdown.** Raw HTML is never rendered. Remote images need a per-document
  opt-in, and external links ask for confirmation.
- **Local only.** No network calls, no telemetry, no AI runtime inside Gitvur.

## Learn more

- [Setup guide](USING_GITVUR.md): installation, indexing, the app and the AI pass.
- [Agent instructions](../agent/codeDOC.md): what the documenting agent must follow.
- [Data contract](../crates/gitvur-schema/README.md): IDs, fields and versions.
- [Indexer rules](../crates/gitvur-index/README.md): per-language resolution rules.
- [Validator rules](../crates/gitvur-validate/README.md): every check and issue code.

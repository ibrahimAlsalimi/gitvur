# Phase 14 — Entry points and execution flows: data layer

## Context

The next feature is a **Flows** tab that shows how the code runs: where execution starts and which path it takes through the modules, similar in spirit to GitDiagram's architecture diagrams. GitDiagram asks a language model to draw the whole diagram. Gitvur keeps its core principle instead:

**What can be derived from the code is derived deterministically. What needs understanding is written by the agent, with evidence, and validated.**

| Piece | Who produces it |
| --- | --- |
| Entry points visible in code and config (`__main__`, console scripts, `bin`, top-level calls) | Extractor |
| Call trace from any entry point or function | Deterministic, computed from existing edges |
| Framework entry points (HTTP routes, jobs, event handlers) | Agent, with evidence |
| Curated flows: named, ordered steps with labels | Agent, every transition checked by the validator |

This phase builds the data layer only. The UI is Phase 15.

"Execution flow and entry points" was out of scope in the plan; this phase brings it in scope.

## Read first

- `CLAUDE.md`, `PROGRESS.md`
- `crates/gitvur-schema/README.md`, `crates/gitvur-index/README.md`, `crates/gitvur-validate/README.md`
- `agent/codeDOC.md`

## Goal

`structure.json` lists deterministic entry points; `annotations.json` can hold agent-written entry points and flows; the validator checks every flow step and transition and reports flow staleness; `gitvur trace` prints a deterministic call tree; the agent instructions explain how to write flows.

## Scope

**Create / modify:**

```text
crates/gitvur-schema/**          # contract v0.3
crates/gitvur-index/**           # entry point detection
crates/gitvur-flow/**            # new crate: trace + flow checks shared by CLI, validator, app
crates/gitvur-validate/**        # flow validation + staleness
crates/gitvur-cli/**             # trace, flows subcommands; packet additions
agent/codeDOC.md                 # new "Execution flows" section
fixtures/py-flows/**             # new fixture
fixtures/ts-flows/**             # new fixture
PROTOTYPE_V2_PLAN.md, CLAUDE.md  # scope and contract updates
```

**Do not touch:** existing fixtures (`py-small`, `ts-small`) and their `expected/` files, app UI (Phase 15).

### Dependencies

```text
toml          # read pyproject.toml as data
serde_json    # read package.json as data (already present)
```

## Part A — Contract v0.3

Bump `schemaVersion` to `"0.3"`. **Readers must accept 0.2 files** (new arrays default to empty) — add a compatibility test that loads the committed 0.2 fixture outputs. Document every rule in `crates/gitvur-schema/README.md`.

### `structure.json` — new array `entryPoints`

```json
{
  "id": "entry:console-script:gitvur",
  "kind": "console-script",
  "name": "gitvur",
  "target": "function:src/gitvur/cli.py:main",
  "raw": "gitvur.cli:main",
  "calls": [],
  "evidence": { "file": "pyproject.toml", "line": 14 },
  "provenance": "syntactic"
}
```

- `id` = `entry:<kind>:<slug>`; slug from `name`, lowercase `[a-z0-9-]`, `#2` suffix on collision.
- `target`: the node where execution enters (function, or file for script-style entries), or `null` when the config points outside the indexed code (e.g. `dist/cli.js`); then `raw` keeps the original value and nothing is guessed.
- `calls`: for script-style entries (top-level code), the in-repo functions called directly from that top-level code, resolved with the existing call rules. Ambiguous calls go to `unresolvedCalls` with `from` set to the entry ID.
- Sorted by `id`.

### Deterministic entry point kinds

| Kind | Language | Rule | `target` |
| --- | --- | --- | --- |
| `main-guard` | Python | `if __name__ == "__main__":` block in a file | file node; `calls` from the block |
| `package-main` | Python | `pkg/__main__.py` | file node; `calls` from top-level code |
| `console-script` | Python | `[project.scripts]`, `[project.gui-scripts]`, `[tool.poetry.scripts]` in `pyproject.toml`, value `module.path:func` | function node |
| `package-bin` | TS | `bin` in `package.json` (string or map) | file node if the path is in the structure, else `null` + `raw` |
| `package-main` | TS | `main` / `module` / `exports["."]` in `package.json` | same as above |
| `npm-script` | TS | `scripts` values matching `(node|ts-node|tsx|bun|deno run)\s+<path>`; extract the path only | same as above |
| `top-level-call` | TS | a top-level statement in a module that calls an in-repo function (e.g. `main();`, `void bootstrap();`) | file node; `calls` from those statements |

Config files are read as data; **no script is ever executed**. Monorepos: read every `package.json` / `pyproject.toml` found by the walker; resolve paths relative to the config file.

### `annotations.json` — new arrays `entryPoints` and `flows`

Agent entry points use the same shape with `provenance: "ai"`, `evidence` required, and kinds:

```text
http-route  cli-command  job  event-handler  test  other
```

Example: `{ "kind": "http-route", "name": "POST /login", "target": "function:src/api/routes.py:login", "evidence": { "file": "src/api/routes.py", "line": 21 }, … }`.

Flows:

```json
{
  "id": "flow:user-sign-in",
  "name": "User signs in",
  "description": "From the login request to a stored session.",
  "entryPoint": "entry:http-route:post-login",
  "steps": [
    { "id": "s1", "node": "function:src/api/routes.py:login", "label": "Receives the sign-in request", "basedOnHash": "sha256:…" },
    { "id": "s2", "node": "function:src/auth/service.py:AuthService.verify", "label": "Checks the password", "basedOnHash": "sha256:…" }
  ],
  "transitions": [
    { "from": "s1", "to": "s2", "kind": "call", "provenance": "syntactic" },
    { "from": "s2", "to": "s3", "kind": "branch", "label": "if the password matches", "provenance": "syntactic" },
    { "from": "s3", "to": "s4", "kind": "event", "label": "session.created", "provenance": "ai",
      "evidence": { "file": "src/auth/session.py", "line": 31 } }
  ]
}
```

- Transition `kind`: `call | return | event | async | branch`. `branch` requires a `label`.
- Step order in `steps` is the reading order; transitions define the actual graph (it may branch and merge).

## Part B — Entry point detection in the extractor

- Implement the table above in each language backend, plus config readers in a small `config.rs`.
- Fixtures — create **new** ones so existing goldens stay untouched:
  - `fixtures/py-flows/`: a tiny CLI + web-style app: `pyproject.toml` with a console script, a `__main__.py`, a module with a `main-guard`, a function registered as an event handler through a dict lookup (something only the agent can see), and a call chain at least 5 functions deep through 3 packages, including one ambiguous call and one recursive function.
  - `fixtures/ts-flows/`: `package.json` with `bin` pointing to a `.ts` file, `main` pointing to `dist/index.js` (must become `target: null`), an `npm-script` running `tsx src/tools/seed.ts`, a file with a top-level `main()` call, an `EventEmitter`-style `on("x", handler)` registration, and a similar deep call chain.
  - For each, write `expected/structure.json` and `NOTES.md` **by reading the source by hand**, as in Phase 01. Then stop for human review before Part C (see "When done").

## Part C — `gitvur-flow` crate: deterministic trace

```rust
pub struct TraceOptions { pub max_depth: u32, pub max_nodes: u32, pub include_semantic: bool }
pub fn trace(structure: &Structure, start: &str, opts: &TraceOptions) -> Trace;
```

- `start` is an entry ID or a node ID. For an entry, the roots are its `target` (if a function) plus its `calls`.
- Follow `calls` edges with provenance `syntactic` (and `semantic` when enabled), breadth-first for depth, children sorted by `(file, startLine)`.
- Output is a **tree**: each node appears expanded once; later occurrences are `ref` stubs pointing to the first. Back-edges are `cycle` stubs. Ambiguous calls from a traced function appear as `ambiguous` stubs listing candidates — never expanded automatically.
- Truncation: when `max_depth` or `max_nodes` is hit, mark the node `truncated: true` with the number of hidden children.
- Defaults: depth 6, nodes 300. Deterministic output; type added to the schema so the app can consume it.

CLI:

```bash
gitvur trace <repo> <entryId|nodeId> [--depth 6] [--max-nodes 300] [--json]
gitvur flows <repo>            # lists entry points and flows with status
```

Text output of `trace` is an indented tree with `↻` for refs, `⟲` for cycles, `?` for ambiguous, `…` for truncation.

## Part D — Validation and staleness

New issue codes (add to the validator README and the UI copy list):

| Code | Severity | Rule |
| --- | --- | --- |
| `entry-dangling-target` | error | entry point target not in the structure |
| `entry-no-evidence` | error | AI entry point without evidence |
| `entry-duplicates-static` | warning | AI entry point duplicates an extractor entry point (same kind + target) |
| `flow-dangling-entry` | error | `entryPoint` not found among static or AI entry points |
| `flow-dangling-step` | error | step `node` not in the structure |
| `flow-duplicate-step-id` | error | duplicate step id in a flow |
| `flow-bad-transition-ref` | error | transition refers to a missing step id |
| `flow-call-unsupported` | error | `call` transition with `provenance` `syntactic`/`semantic` but no matching structure edge from → to |
| `flow-return-unsupported` | error | same for `return`, checked against the reverse edge |
| `flow-transition-no-evidence` | error | `ai` transition without evidence |
| `flow-evidence-out-of-range` | error | evidence file missing or line outside the from-step's node range |
| `flow-evidence-mismatch` | warning | evidence line doesn't contain the to-step's short name or the event label |
| `flow-transition-should-be-static` | warning | `ai` transition that matches an existing structure edge |
| `flow-branch-no-label` | error | `branch` without `label` |
| `flow-unreachable-step` | warning | a step not reachable from the first step |
| `flow-too-long` | warning | more than 25 steps |
| `flow-label-too-long` | warning | step label over 60 characters |

Flow status in `report.json` (add to the schema):

```json
"flows": [ { "id": "flow:user-sign-in", "status": "current | stale | broken", "staleSteps": ["s2"] } ]
```

- `broken`: any error on the flow. `stale`: any step's `basedOnHash` differs from the node's current hash. Otherwise `current`.
- Entry points get `status` in `elements` like other elements (documented / undocumented by whether any flow starts from them).

Tests: one per issue code, plus: edit a function used as step `s2` → flow `stale` with `staleSteps: ["s2"]`, other flows unaffected; delete it → `broken`.

## Part E — Agent instructions and packet

Add a section **"Execution flows"** to `agent/codeDOC.md`:

1. **Agent entry points:** add only framework-level entries the extractor can't see (routes, jobs, handlers, CLI subcommands registered dynamically). Evidence = the registration line.
2. **Choosing flows:** 3–8 flows for a medium repo; cover the main entry points; prefer what a new developer asks first ("what happens when a user signs in", "what does the CLI do on `build`"). Do not write a flow for every function.
3. **Building a flow from the trace:** start from `gitvur trace` output in the packet. Walk real edges; do not invent calls. Use static transitions whenever an edge exists. Use `ai` transitions only for what the extractor can't see (events, dynamic dispatch, callbacks, queues), each with evidence.
4. **Steps:** 3–15 per flow; skip trivial helpers (logging, formatting, small getters); one step per meaningful action. Labels: present tense, plain English, ≤ 60 characters, describing *what happens*, not the function name ("Checks the password", not "calls verify()"). Copy `contentHash` to `basedOnHash`.
5. **Branches:** only for decisions that change the path (auth fails, cache hit); label the condition.
6. **Incremental mode:** update only flows listed as stale or broken in the packet; keep every other flow byte-identical.
7. **Done means:** `gitvur validate` reports zero flow errors.

Extend `gitvur packet`:

- `entryPoints`: all static and AI entry points.
- `traces`: for each entry point, the deterministic trace (depth 6, 300 nodes) as JSON — this is the agent's map; it must not need to read the call graph by hand.
- incremental mode: `staleFlows` and `brokenFlows` with the issue codes.

Then, in a clearly marked documenter section of the session, document `py-flows` and `ts-flows` (descriptions, modules, entry points, 2–3 flows each including one `event` transition and one `branch`) by following `codeDOC.md`, and validate to zero errors. Commit their full `.gitvur/`.

## Part F — Docs updates

- `PROTOTYPE_V2_PLAN.md`: remove "Execution flow and entry points" from out of scope; add a short section "Execution flows" describing the split in the Context table.
- `CLAUDE.md`: contract summary → v0.3, new commands (`trace`, `flows`), new crate in the layout.

## Acceptance criteria

- [ ] Contract v0.3 implemented; 0.2 files still load (tested); schemas regenerated
- [ ] Every entry point kind detected; `py-flows` and `ts-flows` goldens pass after human review; determinism holds
- [ ] Existing `py-small` / `ts-small` goldens unchanged and passing
- [ ] `gitvur-flow::trace` with refs, cycles, ambiguous stubs, truncation; unit tests for each
- [ ] Every new issue code tested; flow staleness scenarios pass
- [ ] `codeDOC.md` section and packet extensions; both new fixtures documented with zero errors
- [ ] Plan and `CLAUDE.md` updated

## Verify

```bash
cargo test --workspace
cargo run -p gitvur-cli -- index fixtures/py-flows --out /tmp/gv-flows
cargo run -p gitvur-cli -- flows fixtures/py-flows
cargo run -p gitvur-cli -- trace fixtures/py-flows entry:console-script:<name>
cargo run -p gitvur-cli -- validate fixtures/ts-flows
```

## When done

This phase has a human gate in the middle. After Part B, write in `PROGRESS.md`:

```text
HUMAN REVIEW REQUIRED before Part C: fixtures/py-flows/expected/, fixtures/ts-flows/expected/
```

and stop. Continue Parts C–F in a new session after the review. At the end, update `PROGRESS.md`. Stop.

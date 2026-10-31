# gitvur-schema — data contract v0.3

Rust types, canonical serialisation and JSON Schema for the files in `<repo>/.gitvur/`.
**The rules in this file are binding for every later phase.** Change them only with a
deliberate contract change, and update the fixtures' `expected/` files in the same change.

| File | Writer | Rust type | Schema |
| --- | --- | --- | --- |
| `manifest.json` | extractor | `Manifest` | `schemas/manifest.schema.json` |
| `structure.json` | extractor | `Structure` | `schemas/structure.schema.json` |
| `annotations.json` | documenting agent | `Annotations` | `schemas/annotations.schema.json` (copy in `agent/`) |
| `report.json` | validator | `Report` | `schemas/report.schema.json` |
| (not stored) `gitvur diff --json` | diff | `StructureDiff` | `schemas/diff.schema.json` |
| (not stored) `gitvur trace --json` | flow | `Trace` | `schemas/trace.schema.json` |

All types use `deny_unknown_fields`. Regenerate schemas with
`cargo run -p gitvur-schema --bin gen-schemas`; a test fails if the committed ones drift.

## 1. Node IDs

```text
project:root
module:<slug>                              # lowercase, [a-z0-9-]+
file:<relpath>
class:<relpath>:<QualifiedName>
function:<relpath>:<QualifiedName>
```

- `<relpath>` is relative to the repo root, `/`-separated, no leading `./`.
- `<QualifiedName>` joins enclosing **class and function** names with `.`: a method is
  `Class.method`; a nested function is `outer.inner`; a method's nested function is
  `Class.method.inner`. Other enclosing blocks (`if`, `try`, `with`, loops) add nothing.
- Duplicate qualified names in one file:
  - TypeScript overload signatures collapse into **one** node whose range is the implementation.
  - Any other duplicate (e.g. a Python redefinition) gets a suffix `#2`, `#3`… in source
    order. The first occurrence has no suffix. `name` never carries the suffix.
- Methods and functions both use `type: "function"`. The extractor emits `project`, `file`,
  `class`, `function`; `module` nodes exist only in `annotations.json`.

### Node fields

| Field | project | file | class / function |
| --- | --- | --- | --- |
| `id`, `type`, `name` | `name` = repo root directory name | `name` = file basename | `name` = declared identifier |
| `parentId` | absent | `project:root` | enclosing class/function, else the file |
| `source` | absent | `{file, startLine: 1, endLine: <line count>}` | the element's lines |
| `contentHash` | absent | hash of the whole file | hash of `source` lines |

`structure.json` always parents files directly under the project; the viewer re-parents them
under logical modules at merge time.

## 2. Lines and content hash

- Lines are 1-based and inclusive. `\r\n` and `\r` count as line breaks.
- A trailing `\n` does not start a new line. An empty file counts as one empty line, so every
  file has `endLine >= 1`.
- `contentHash` = `"sha256:"` + lowercase hex (64 chars) of the UTF-8 bytes of lines
  `[startLine, endLine]`, after converting `\r\n` and `\r` to `\n`, each line terminated by
  `\n`. A file's hash equals the hash of its full line range.
- Helpers: `content_hash(text)`, `extract_lines(text, start, end)`, `line_count(text)`.
  Always hash with `content_hash(&extract_lines(..))`.

## 3. Edges

```json
{ "from": "…", "to": "…", "type": "calls", "provenance": "syntactic",
  "evidence": { "file": "src/a.py", "line": 14 }, "note": "optional" }
```

- `type`: `calls | imports | depends_on | references`.
- `provenance`: `syntactic | semantic | ai`. The extractor emits `syntactic`; the agent emits `ai`.
- `evidence` is **required on every edge** in v0.2: required for `ai`, and the extractor
  always emits it. `note` is optional (used by the agent).
- `imports` edges go **file → file**, only for imports that resolve to a file inside the repo.
  External packages are ignored. **One edge per (importing file, imported file)**; evidence is
  the first import line that produced it.
- `calls` edges go **function → function**, or **function → class** for constructor calls
  (`new Foo()`, `Foo()`). Never to `__init__`/`constructor`. **One edge per (caller, target)**;
  evidence is the first call line. (Unresolved calls, by contrast, are listed per call site.)

## 4. Unresolved calls

`structure.json` has a third top-level array, `unresolvedCalls`, for calls with **two or
more** in-repo candidates:

```json
{
  "from": "function:src/a.py:run",
  "name": "save",
  "evidence": { "file": "src/a.py", "line": 14 },
  "candidates": ["function:src/x.py:Store.save", "function:src/y.py:Cache.save"]
}
```

Calls with zero in-repo candidates are dropped silently. When the callee is resolved by
scope, import or `self` (rules 7.4.1–7.4.3), exactly one candidate → a `calls` edge. When the
receiver is unknown (rule 7.4.4), exactly one candidate is **not** an edge, because the
receiver's type is unknown; it is dropped.

## 5. `report.json`

```json
{
  "schemaVersion": "0.2",
  "commitSha": "9f1c2e7",
  "summary": { "documented": 0, "stale": 0, "undocumented": 0, "errors": 0, "warnings": 0 },
  "elements": [ { "id": "…", "status": "documented | stale | undocumented" } ],
  "issues": [ { "severity": "error | warning", "code": "dangling-ref", "message": "…", "id": "…" } ]
}
```

Elements with `status: "stale"` also carry `childChanged` and `selfChanged` (booleans):

```json
{ "id": "class:src/a.py:Store", "status": "stale", "childChanged": true, "selfChanged": false }
```

Both are omitted for `documented` and `undocumented` elements. How they are computed is
documented in `crates/gitvur-validate/README.md`.

`commitSha` (here and in `manifest.json`) is required: the 7-character short SHA of `HEAD`, or
`"uncommitted"` (`gitvur_schema::UNCOMMITTED`) when the repository is not a Git checkout or has
no commits. `issues[].id` is optional.

## 6. Determinism

- `structure.json`: nodes sorted by `id`. Edges sorted by
  `(from, to, type, evidence.file, evidence.line)`, then `provenance`
  (`syntactic < semantic < ai`) and `note`; exact duplicates removed. Unresolved calls sorted
  by `(from, evidence.line, name)`, then `evidence.file` and `candidates`; candidate lists sorted
  and deduplicated; exact duplicates removed.
- `annotations.json`: modules and descriptions sorted by `id` (descriptions then by
  `basedOnHash`, `text`; exact duplicates removed); each module's `files` sorted;
  edges as above.
- `report.json`: elements by `(id, status)`, exact duplicates removed; issues by `(severity, code, id, message)`, errors first.
- `manifest.json`: `languages` sorted. `generatedAt` is the only time-dependent field anywhere.
- String order is byte-wise (Rust `str` ordering), so uppercase sorts before lowercase.
- JSON: 2-space indent, keys in struct declaration order, `\n` line endings, trailing newline.
  Produce it with `value.canonicalize()` then `to_canonical_json(&value)`.

## 7. Extraction rules

These pin down what the fixtures' expected files assume. Phases 02–03 implement them.

### 7.1 Which files

- Only files with supported extensions become file nodes: `.py`, `.ts`, `.tsx`, `.d.ts`.
  Everything else (JSON, Markdown, `.gitignore`, `.js`) is ignored.
- Always skipped, at any depth (directories only): `.git/`, `.gitvur/`, `node_modules/`,
  `venv/`, `.venv/`, `__pycache__/`, `dist/`, `build/`, `target/`.
- Files excluded by `.gitignore` files inside the repo root are skipped. `.gitignore` files
  above the repo root are not consulted.
- A `.d.ts` file produces its file node only: no class or function nodes, even for
  `declare class` or `declare function`.

### 7.2 Which elements and their ranges

- Python: `def`, `async def` and `class` at any depth. Lambdas are not nodes. A decorated
  definition's range **starts at its first decorator**.
- TypeScript: `class` declarations, methods with a body (including `constructor`), `function`
  declarations, and module-level `const` declarations whose initialiser is an arrow function
  or function expression (named after the variable). Interfaces, type aliases, enums, method
  or function signatures without a body, class fields (including arrow-valued fields) and
  inline callbacks are not nodes.
- A range runs from the first line of the declaration (including `export` / `export default`,
  and for `const` the whole statement) to its last line. Trailing blank lines are excluded.
- Line numbers come from the source after normalising `\r\n` and `\r` to `\n`. The extractor
  parses the normalised text, so parser rows always agree with section 2 even for files with
  lone `\r` characters.

### 7.3 Import resolution

- Python: module search root is the repo root. `import a.b` and `from a.b import x` resolve to
  `a/b.py`, else `a/b/__init__.py`. Relative imports (`from .m import x`) resolve against the
  importing file's package. Only the most specific module gets an edge: `import a.b` does not
  add an edge to `a/__init__.py`. For `from a import m` where `a/m.py` exists, the edge goes to
  `a/m.py`.
- TypeScript: only relative specifiers (`./`, `../`). Try, in order: `<p>.ts`, `<p>.tsx`,
  `<p>.d.ts`, `<p>/index.ts`, `<p>/index.tsx`, `<p>/index.d.ts`. Bare specifiers are external.
  `import type` and re-exports with a specifier (`export { x } from "./y"`) are import edges.

### 7.4 Call resolution

A call is attributed to the innermost enclosing **function node**. Calls outside any function
node (module level, class bodies, field initialisers) are dropped. Callbacks that are not nodes
(lambdas, inline arrows) attribute their calls to the enclosing function node.

The callee is resolved by its syntactic shape:

1. **Bare name** `f()`: look up `f` in, in order: functions nested in the enclosing function
   chain; module-level functions and classes of the same file; names bound by imports
   (following aliases, default imports, and named re-exports through barrel files). A match on
   a class is a constructor call. No match → dropped (builtins, globals, undeclared names).
   Several matches at the first level that has any (e.g. a redefined function `f` / `f#2`) →
   `unresolvedCalls`.
2. **Module member** `mod.f()` / `pkg.mod.f()` / `ns.f()`, where the receiver is a module bound
   by `import`: resolve `f` among that module's top-level functions and classes. An external
   module, or a name not found in the module → dropped. No fallback to name matching.
3. **Self call** `self.m()` / `cls.m()` (Python) / `this.m()` (TypeScript), receiver exactly
   `self`, `cls` or `this`: the method `m` of the enclosing class. No inheritance resolution: if
   that class has no such method, fall through to 4.
4. **Any other attribute call** `x.m()` (receiver unknown, including `self.attr.m()`): the
   candidates are **all in-repo methods named `m`** (functions whose parent is a class). Two or
   more → `unresolvedCalls`; one or none → dropped (one candidate is not enough evidence
   while the receiver's type is unknown). Module-level functions are not candidates.
5. `new X()` (TypeScript) is resolved like a bare name or module member, and only to a class.

## 8. Execution metadata (v0.3)

Writers emit schemaVersion `0.3`; readers accept `0.2` and `0.3`. Missing
`structure.entryPoints`, `annotations.entryPoints`, `annotations.flows` and
`report.flows` default to empty. Empty new arrays are omitted when serialized, so
committed v0.2 bundles round-trip unchanged. Unknown fields remain errors.

Entry points contain `id`, `kind`, `name`, nullable `target`, optional original `raw`,
`calls`, `evidence`, and `provenance`. IDs are `entry:<kind>:<slug>`: ASCII lowercase
letters/digits, other runs become one dash, trimmed; an empty slug becomes `entry`.
Collisions receive `#2`, `#3`, etc. Configuration entries are allocated first by
(file, line, kind, name, raw), then source entries by file and source order.
Entries sort by ID, then remaining fields; calls sort and deduplicate. Exact duplicate
entries are removed. Targets are existing node IDs or explicit null; no build-output
mapping or receiver-type inference is attempted. Script calls are metadata, not
file-to-function graph edges; ambiguous sites use their entry ID in unresolvedCalls.

Static kinds: main-guard, package-main, console-script, package-bin, npm-script,
top-level-call, main-function (C `main`, Go `func main` in `package main`; the target is
the function). Agent kinds: http-route, cli-command, job, event-handler, test, other.
Static provenance is syntactic; agent provenance is ai and requires evidence.
Agents normally use agent kinds; a static kind is allowed for an entry the extractor
cannot read (e.g. a `setup.cfg` console script) and is warned about when it duplicates
an extractor entry. Evidence is optional in Rust so the validator can diagnose omissions.

Flows contain `id` (`flow:<slug>`), `name`, `description`, `entryPoint`, ordered `steps`
and `transitions`. A step has a locally unique `id`, node ID `node`, `label`, and
`basedOnHash` (sha256 of that node when documented). Step reading order is preserved,
including repeated nodes. Transitions contain step IDs `from`/`to`, `kind`
(call, return, event, async, branch), optional `label`, provenance and optional evidence.
Branch transitions require a label (checked by the validator).
Transitions sort by (from, to, kind, label, provenance, evidence), deduplicating exact
matches. Flows sort by (id, name, description, entryPoint). Reports may contain
`flows`: each has `id`, `status` (current, stale, broken), and sorted unique `staleSteps`.
Report flows sort by (id, status, staleSteps), with exact duplicates removed.
Flow checks and statuses are computed by `gitvur-flow::check_flows` through the
validator; see `crates/gitvur-validate/README.md` for every rule.

Existing v0.2 golden graph files remain frozen. Legacy extraction tests compare their
v0.2 projection; new py-flows/ts-flows goldens cover the complete v0.3 structure.

Manifest `languages` values: `c`, `go`, `python`, `typescript` (sorted). `c` and `go` and the
`main-function` entry kind were added within v0.3; older readers reject them, so the app and
validator are updated together.

## 9. Trace output (Phase 14 Part C)

`Trace` contains `start`, occurrence-ID `roots`, breadth-first `nodes`, aggregate
`truncated`, `hiddenRoots`, and nullable `error`. Unknown start IDs set error;
known entries without resolvable execution roots yield an empty successful tree.

`TraceNode` contains occurrence `id` (`trace:<1-based allocation number>`), `kind`
(node/ref/cycle/ambiguous), nullable source `node`, display `name`, `depth`, occurrence-ID
`children`, nullable first-occurrence `reference`, `candidates`, nullable `evidence`,
`truncated` and `hiddenChildren`. Ref/cycle/ambiguous stubs have no children; ambiguous
stubs have null node/reference and sorted unique candidate IDs. Evidence identifies
ambiguous call sites. Every child belongs to one parent; reference links are not children.
This arena represents a tree without recursive JSON, including when limits are large.

Roots have depth zero. Depth/node limits omit immediate child occurrences, recorded
on their parent. Omitted roots are counted separately. All stubs count toward the node
budget. No omission means no truncation even at an exact limit. Missing source locations
sort as empty file/line zero; IDs break source-position ties. See the
[flow crate rules](../gitvur-flow/README.md) for traversal and deterministic ordering.
The output is canonical as constructed; sorting the occurrence array would break IDs.

## Legacy architecture extension (currently supported)

Annotations v0.3 optionally carries `architecture` with independent `version: 1`, summary,
components and relationships. Absent architecture is omitted on serialization: old v0.2/v0.3
repositories need no migration; existing goldens stay unchanged. Older strict readers need
an upgrade to read enriched annotations.

IDs are unique `arch:[a-z0-9-]+` across components and relationships. Sources reference indexed
files/classes/functions with `basedOnHash`. Parents form an acyclic tree. Agent provenance
is `ai`; the viewer generates independent syntactic directory groups and aggregates verified
imports/calls. Status is computed, never an authored confidence score. Findings use
`architecture-*` report issues; packets include `architectureIssues`. The read-only viewer
rechecks evidence at open time, independently of cached reports. It writes no architecture data.
Membership and evidence rules: `agent/codeDOC.md` section 12.

## Proposed Phase 16 standalone architecture artifact (not supported yet)

The revised design proposes `<repo>/.gitvur/architecture.json`, separate from the supported
annotation extension above. No standalone schema, CLI input support or validator capability for
this proposed artifact is claimed here. Existing schema files remain unchanged.

The Documentation Agent will author a repository overview (summary and optional design
characteristics), components (stable ID, name, category, responsibility, indexed code references,
optional parent/group, evidence and provenance), and relationships (stable ID, source/target
components, typed interaction, label, evidence and provenance). Metadata will include schema
version and relevant index/repository snapshot information, with generation metadata only if
consistent with current conventions. Exact fields and version negotiation remain proposed.

Reuse authoritative indexed IDs, copied source hashes, repository-relative paths, 1-based
inclusive evidence locations, provenance distinctions and canonical deterministic serialization.
Validation computes status and checks references/evidence/freshness; valid citations do not
prove AI interpretations. Unsupported relationships remain unresolved without deterministic
proof. Rendering coordinates are separate from semantics; Mermaid/SVG/PNG are derived exports.

See [the dedicated plan](../../PHASE_16_ARCHITECTURE_DIAGRAM.md) for acceptance criteria and
open compatibility decisions, including legacy migration and precedence. Missing architecture
must preserve existing repository functionality; current agent writes and commands stay valid.

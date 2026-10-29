# Phase 01 — Contract types and fixture repositories

## Context

Everything later is tested against two things created here: the **contract types** (the shape of `.gitvur/` files) and the **fixtures** (small repositories with a hand-derived expected `structure.json`). The expected files are the source of truth for the extractor. They must be written **by reading the fixture source by hand**, not by running any tool, because no extractor exists yet.

## Read first

- `CLAUDE.md`
- `PROTOTYPE_V2_PLAN.md` section 4

## Goal

1. `gitvur-schema` defines every type in contract v0.2, serialises deterministically, and generates JSON Schema files.
2. Two fixture repositories exercise the hard cases, each with an expected `structure.json` and notes explaining each tricky decision.

## Scope

**Create / modify:**

```text
crates/gitvur-schema/**
crates/gitvur-schema/README.md        # the precise contract rules (below)
schemas/*.schema.json                 # generated, committed
agent/annotations.schema.json         # copy of the generated annotations schema
fixtures/py-small/**
fixtures/ts-small/**
```

**Do not touch:** other crates (except adding the schema dependency), `app/`.

## Part A — Contract rules to implement and document

Write these rules into `crates/gitvur-schema/README.md`. They are binding for all later phases.

### Node IDs

```text
project:root
module:<slug>                              # lowercase, [a-z0-9-]
file:<relpath>
class:<relpath>:<QualifiedName>
function:<relpath>:<QualifiedName>
```

- `<relpath>` is relative to the repo root, `/`-separated, no leading `./`.
- `<QualifiedName>` joins enclosing class and function names with `.`: a method is `Class.method`; a nested function is `outer.inner`; a method's nested function is `Class.method.inner`.
- Duplicate qualified names in the same file (Python redefinition, TS overload signatures): TS overload signatures collapse into **one** node whose range is the implementation; any other duplicate gets a suffix `#2`, `#3`… in source order.
- Methods and functions both use `type: "function"`.

### Content hash

- `sha256` over the UTF-8 bytes of the element's lines `[startLine, endLine]`, after converting `\r\n` and `\r` to `\n`, with a trailing `\n`.
- Serialised as `"sha256:" + lowercase hex` (full 64 chars).
- File nodes hash the whole file.

### Edges

- Types: `calls`, `imports`, `depends_on`, `references`.
- `provenance`: `syntactic`, `semantic`, `ai`.
- `evidence`: `{ "file": <relpath>, "line": <1-based> }`. Required for `ai`; always emitted by the extractor too.
- `imports` edges go **file → file**, only for imports that resolve to a file inside the repo. External packages are ignored.
- `calls` edges go **function → function** (or function → class for constructor calls, `new Foo()` / `Foo()`).

### Unresolved calls

`structure.json` has a third top-level array, `unresolvedCalls`, for calls with **two or more** in-repo candidates:

```json
{
  "from": "function:src/a.py:run",
  "name": "save",
  "evidence": { "file": "src/a.py", "line": 14 },
  "candidates": ["function:src/x.py:Store.save", "function:src/y.py:Cache.save"]
}
```

Calls with zero in-repo candidates are dropped silently.

### Determinism

- Nodes sorted by `id`. Edges sorted by `(from, to, type, evidence.file, evidence.line)`. Unresolved calls sorted by `(from, evidence.line, name)`. Candidate lists sorted.
- JSON: 2-space indent, keys in struct declaration order, `\n` line endings, trailing newline.

### Files

- `manifest.json`, `structure.json`, `annotations.json`, `report.json` — fields exactly as in the plan section 4, plus `unresolvedCalls` above.
- `report.json` (defined now, produced in Phase 04):

```json
{
  "schemaVersion": "0.2",
  "commitSha": "9f1c2e7",
  "summary": { "documented": 0, "stale": 0, "undocumented": 0, "errors": 0, "warnings": 0 },
  "elements": [ { "id": "…", "status": "documented | stale | undocumented" } ],
  "issues": [ { "severity": "error | warning", "code": "dangling-ref", "message": "…", "id": "…" } ]
}
```

## Part B — Implement the crate

1. Types with `serde` (`Serialize`, `Deserialize`, `deny_unknown_fields`). Use enums for `type`, `provenance`, `status`, `severity`.
2. `fn to_canonical_json<T: Serialize>(&T) -> String` that applies the determinism rules (sorting happens in a `canonicalize()` method on each top-level type).
3. `fn content_hash(lines: &str) -> String` implementing the hash rule.
4. Generate JSON Schemas with `schemars`; a test fails if committed schemas are out of date (regenerate with `cargo run -p gitvur-schema --bin gen-schemas`).
5. Unit tests: round-trip, canonical ordering, hash of `"a\r\nb"` equals hash of `"a\nb"`.

## Part C — Fixtures

Create two small, realistic mini-projects. Plain source only — no `package.json` scripts, no `setup.py`, nothing executable is ever run.

### `fixtures/py-small/` (about 8 files)

Must include:

- Two classes in different files, each with a method named `save` → an ambiguous call site somewhere.
- Two methods with the same name in two classes **in the same file**.
- A nested function inside a function, and one inside a method.
- `from pkg.mod import thing as alias` and later a call to `alias()`.
- `import pkg.mod` and a call `pkg.mod.func()`.
- `self.method()` inside a class.
- A constructor call `Store()`.
- A call to a stdlib/external function (must be dropped).
- A `__init__.py` in a package.
- A `.gitignore` excluding `build/`, plus a `build/` file that must not appear.
- A `venv/` directory with one `.py` file that must not appear (dependency directories are always skipped).

### `fixtures/ts-small/` (about 8 files)

Must include:

- `export class` with methods, including two classes in one file sharing a method name.
- A function with overload signatures plus implementation.
- Arrow functions assigned to `const` at module level (`const handler = () => {}` → a function node named `handler`).
- Named import with alias `import { a as b } from "./x"`, default import, namespace import `import * as ns`.
- Imports of directory index files (`./auth` → `./auth/index.ts`).
- `this.method()` calls, `new Repo()` calls.
- An ambiguous call (same name, two candidates).
- A `node_modules/` directory with one file that must not appear.
- A `.d.ts` file (include it as a file node; its declarations produce no function bodies but signatures are not nodes).

### Expected output

For each fixture, write by hand:

```text
fixtures/<name>/expected/structure.json
fixtures/<name>/expected/NOTES.md
```

- `structure.json` follows every rule above, canonical ordering, real hashes. You may compute hashes with a tiny test helper that calls `gitvur_schema::content_hash` on a given line range — that is the only tool allowed.
- `NOTES.md` lists each tricky case: the source location, the decision taken (node created? edge? unresolved? dropped?), and the rule that justifies it.

## Acceptance criteria

- [ ] All types implemented with `deny_unknown_fields`; schemas generated and committed; schema-drift test passes
- [ ] Canonical JSON and hash helpers tested
- [ ] Both fixtures exist with every case listed above
- [ ] Each expected `structure.json` deserialises with `gitvur-schema` and is already canonical (a test re-serialises it and compares bytes)
- [ ] Each `NOTES.md` covers every listed case
- [ ] No other crate contains logic yet

## Verify

```bash
cargo test -p gitvur-schema
cargo clippy --workspace --all-targets -- -D warnings
```

## When done

Update `PROGRESS.md`. Then **stop and ask the human to review** both `expected/structure.json` files and `NOTES.md`. Write in `PROGRESS.md`:

```text
HUMAN REVIEW REQUIRED before Phase 02: fixtures/*/expected/
```

Do not continue to Phase 02 in the same session.

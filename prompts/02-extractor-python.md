# Phase 02 — Extractor: Python

## Context

The extractor is the foundation of trust. It turns source code into `manifest.json` and `structure.json` with no AI, no network, and byte-identical output across runs. This phase builds the language-independent core and the Python backend. TypeScript follows in Phase 03 on the same core.

## Read first

- `CLAUDE.md`
- `crates/gitvur-schema/README.md` (binding contract rules)
- `fixtures/py-small/expected/structure.json` and `NOTES.md`

## Goal

`gitvur index fixtures/py-small` produces a `structure.json` byte-identical to `fixtures/py-small/expected/structure.json`.

## Scope

**Create / modify:** `crates/gitvur-index/**`, `crates/gitvur-cli/**` (the `index` subcommand only).
**Do not touch:** `fixtures/*/expected/`, `crates/gitvur-schema/` (if the contract seems wrong, stop and report), `app/`.

## Design

Structure the crate so Phase 03 only adds a language module:

```text
crates/gitvur-index/src/
├── lib.rs            # pub fn index(repo: &Path, opts: &IndexOptions) -> Result<IndexOutput>
├── walk.rs           # file discovery
├── lang/mod.rs       # trait LanguageBackend
├── lang/python.rs
├── resolve.rs        # import + call resolution, language-agnostic pieces
├── git.rs            # commit SHA lookup
└── output.rs         # writes .gitvur/manifest.json + structure.json
queries/python.scm    # tree-sitter queries, embedded with include_str!
```

`LanguageBackend` responsibilities: file extensions, parse a file into definitions (classes, functions with qualified names and ranges), imports (raw specifier + bound names), and call sites (callee expression shape + line + enclosing function).

### Dependencies

```text
tree-sitter
tree-sitter-python
ignore            # gitignore-aware walking
gix               # read HEAD commit SHA without spawning git (or `git2`; justify the choice)
sha2              # via gitvur-schema
anyhow / thiserror
```

## Tasks

1. **Walk.** Use `ignore::WalkBuilder` honouring `.gitignore`, plus a hard-coded skip list: `.git`, `.gitvur`, `node_modules`, `venv`, `.venv`, `__pycache__`, `dist`, `build`, `target`. Never follow symlinks out of the repo. Sort paths.
2. **Parse definitions** with tree-sitter queries: `class_definition`, `function_definition` (including `async` and decorated). Ranges: decorators **included** in the range, first line = first decorator. Record this in the crate README.
3. **Qualified names and IDs** exactly per the contract, including `#2` suffixes for duplicates.
4. **Hashes** via `gitvur_schema::content_hash`.
5. **Imports (Python resolution rules):**
    - `import a.b` → file `a/b.py` or `a/b/__init__.py`, relative to repo root.
    - `from a.b import c` → if `a/b/c.py` exists it is a module import; otherwise `c` is a name defined in `a/b.py` / `a/b/__init__.py`.
    - Relative imports `from . import x`, `from ..m import y` resolved against the importing file's package.
    - Aliases (`as`) bind the alias name.
    - One `imports` edge per (importing file, imported file), evidence = first import line.
6. **Calls (syntactic, conservative).** For each call site inside a function, resolve the callee:
    - `name()` → a function/class defined in the same scope chain or same file; else a name bound by an import.
    - `alias()` → follow the import alias.
    - `mod.func()` where `mod` is an imported module → that module's top-level `func`.
    - `self.m()` / `cls.m()` → method `m` of the enclosing class (no inheritance resolution in this phase).
    - `Class()` → edge to the class node.
    - Anything else (`obj.m()` on an unknown receiver): collect every in-repo method named `m`. One candidate → **do not** create an edge (receiver type unknown); two or more → `unresolvedCalls`; zero → drop. Record this rule in the README.
    - Deduplicate edges; keep the first evidence line.
7. **Manifest.** `projectName` = repo directory name; `commitSha` = HEAD short SHA (7 chars) or `"uncommitted"` if not a git repo; `generatedAt` passed in by the caller (the CLI uses now; tests pass a fixed value); `languages` = sorted list of languages found.
8. **Output** canonical JSON via `gitvur-schema` into `<repo>/.gitvur/`. Create the directory if missing. Write atomically (temp file + rename).
9. **CLI.** `gitvur index <repo> [--out <dir>]` prints a one-line summary: files, nodes, edges, unresolved, elapsed ms.
10. **Errors.** A file that fails to parse produces a warning on stderr and is still a file node (no children); the run does not fail.

## Tests

- Golden test: index `fixtures/py-small` into a temp dir, compare `structure.json` bytes with the expected file. On mismatch print a readable diff (use `similar`).
- Determinism: run twice, byte-compare.
- Unit tests per resolution rule using inline snippets.
- `build/` and `venv/` contents absent.

## Acceptance criteria

- [ ] Golden test passes for `py-small` exactly
- [ ] Determinism test passes
- [ ] Ambiguous calls appear in `unresolvedCalls`, never as edges
- [ ] Ignored directories and gitignored files absent
- [ ] `gitvur index` on any real medium Python repo (choose one, e.g. a cloned open-source project in a temp dir) finishes without panicking; record repo, file count, node count, unresolved count, and time in `PROGRESS.md`
- [ ] Crate README documents every resolution rule and the decorator-range rule

## If the golden test disagrees with the expected file

Do not edit the expected file. Decide which side is wrong by re-reading the contract. If the expected file is wrong, write the exact disagreement into `PROGRESS.md` under "Open questions" and stop for human review.

## Verify

```bash
cargo test -p gitvur-index
cargo run -p gitvur-cli -- index fixtures/py-small --out /tmp/gv-out
cargo clippy --workspace --all-targets -- -D warnings
```

## When done

Update `PROGRESS.md` with the real-repo measurements. Stop.

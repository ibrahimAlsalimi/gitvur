# Progress

## Sessions

### 2026-10-29 — Phase 00 — Bootstrap the repository
- Done:
  - Cargo workspace (`resolver = "2"`, edition 2024) with `gitvur-schema`, `gitvur-index`, `gitvur-validate`, `gitvur-diff` (one documented placeholder fn + one unit test each) and `gitvur-cli` (binary `gitvur`; `index`, `validate`, `stale`, `diff` print `not implemented yet` to stderr and exit 2; one clap `debug_assert` test).
  - Shared workspace lints: `unsafe_code = "forbid"`, `clippy::pedantic` = warn; allow-list (`must_use_candidate`, `missing_errors_doc`, `similar_names`) justified in `Cargo.toml`.
  - `rust-toolchain.toml` pins `1.99.1` with rustfmt + clippy.
  - Tauri 2 app in `app/` (React + TS + Vite, pnpm): strict `tsconfig.json`, ESLint flat config (`typescript-eslint` strictTypeChecked, react-hooks, react-refresh, prettier), Prettier, Vitest with one SSR render test. `app/src-tauri` is a workspace member with path deps on the four library crates. Window title `Gitvur`, minimal `core:default` capability, restrictive CSP.
  - `app/src/styles/tokens.css` (empty `:root {}`, filled in Phase 07), imported once from `main.tsx`.
  - Placeholder app icon (generated with ImageMagick, then `tauri icon`); desktop sizes only.
  - `.github/workflows/ci.yml`, `.editorconfig`, `.gitignore`, `LICENSE` (MIT), `README.md`, `agent/.gitkeep`, `fixtures/.gitkeep`.
- Acceptance:
  - [x] `cargo build --workspace` succeeds
  - [x] `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace` pass
  - [x] `cargo run -p gitvur-cli -- index .` prints `not implemented yet`, exit 2
  - [x] `pnpm typecheck && pnpm lint && pnpm test` pass
  - [x] `pnpm tauri dev` opens a window titled `Gitvur` with an empty page (verified via `hyprctl clients`; no errors in the dev log)
  - [x] CI workflow is valid YAML and runs the listed steps (parsed locally; not yet run on GitHub — the directory is not a Git repository yet)
  - [x] `PROGRESS.md` has its first entry
- Dependencies added (exact versions):
  - Rust: `clap` 4.6.7 (derive) — CLI; `tauri` 2.12.5, `tauri-build` 2.7.4 — app. (Manifests use `clap = "4.6"`, `tauri = "2"`; versions above are what `Cargo.lock` resolved.)
  - npm runtime: `react` 19.3.1, `react-dom` 19.3.1, `@tauri-apps/api` 2.12.4, `@xyflow/react` 12.12.0, `@dagrejs/dagre` 3.1.3, `zustand` 5.0.16, `shiki` 4.5.0.
  - npm dev: `@tauri-apps/cli` 2.12.4, `typescript` 6.0.3, `vite` 8.3.5, `@vitejs/plugin-react` 6.1.2, `vitest` 5.0.5, `@types/react` 19.3.0, `@types/react-dom` 19.3.0, `@types/node` 24.19.2, `eslint` 10.13.0, `@eslint/js` 10.0.1, `typescript-eslint` 8.72.1, `eslint-plugin-react-hooks` 7.1.1, `eslint-plugin-react-refresh` 0.5.7, `eslint-config-prettier` 10.1.8, `globals` 17.13.0, `prettier` 3.9.10.
  - Justifications for deps not named in the prompt: `@tauri-apps/api` / `@tauri-apps/cli` — standard Tauri 2 frontend bridge and dev CLI; `@types/node` — types for `vite.config.ts` (also a Vitest peer); `@eslint/js`, `globals`, `eslint-config-prettier`, `eslint-plugin-react-*` — the usual ESLint flat-config set for React + Prettier.
- Deviations:
  - TypeScript pinned to 6.0.3, not the latest 7.x: `typescript-eslint` 8.72.1 requires `typescript <6.1.0`.
  - Toolchain pinned to an exact version (`1.99.1`) rather than the floating `stable` channel, so local and CI results match. Bump deliberately.
  - App identifier `dev.gitvur.viewer` is an assumption (no domain decided).
  - CI uses Node 24 (LTS); local development used Node 26.
  - pnpm was not installed locally; installed `pnpm@12.16.1` into the user-local npm prefix (`~/.local/npm-global`). `packageManager` in `app/package.json` pins it for CI.
- Open questions:
  - Final app icon and app identifier.
  - The directory is not a Git repository yet; CI will run once it is pushed. `gitvur-prompts/` (empty) and `gitvur-prompts.zip` at the root predate this phase and were left untouched — decide whether to keep or remove them.

### 2026-10-29 — Phase 01 — Contract types and fixture repositories

**HUMAN REVIEW REQUIRED before Phase 02: fixtures/*/expected/**

- Done:
  - `gitvur-schema`: all v0.2 types (`Manifest`, `Structure`, `Annotations`, `Report` and their parts) with serde + `deny_unknown_fields`; enums for node type, edge type, provenance, status, severity, language. `canonicalize()` on each top-level type; `to_canonical_json`; `content_hash`, `extract_lines`, `line_count`.
  - JSON Schemas generated with `schemars` into `schemas/*.schema.json` and `agent/annotations.schema.json` (`cargo run -p gitvur-schema --bin gen-schemas`). Schemas also enforce `line >= 1`, the `sha256:` hash pattern, the `module:<slug>` pattern and required-but-nullable `commitSha`. A test fails on drift.
  - `crates/gitvur-schema/README.md`: the binding rules from the prompt, plus section 7 "Extraction rules" (which files, element ranges, import resolution, call resolution). The expected files depend on these, and Phases 02–03 must implement them.
  - Fixtures `py-small` (7 source files + excluded `build/` and `venv/`) and `ts-small` (9 source files incl. `.d.ts` + excluded `node_modules/`), each with a hand-written `expected/structure.json` and `expected/NOTES.md`.
  - Tests: 15 unit tests (round-trip for all four files, canonical ordering, dedup, CRLF/CR hashing, a known sha256 value, line rules, unknown-field rejection, enum spelling). `tests/fixtures.rs` checks each expected file is canonical byte-for-byte, that every hash matches its declared range in the fixture source, and that all referenced IDs exist. The ignored `fill_expected_hashes` helper was used once to fill hashes; spot-checked against `sed | sha256sum`.
- Acceptance:
  - [x] All types use `deny_unknown_fields`; schemas generated and committed; schema-drift test passes
  - [x] Canonical JSON and hash helpers tested
  - [x] Both fixtures exist with every listed case
  - [x] Each expected `structure.json` deserialises and is already canonical (byte comparison test)
  - [x] Each `NOTES.md` covers every listed case (numbered "Required cases" tables) plus other decisions
  - [x] No other crate contains logic yet
  - `cargo fmt --check`, `cargo clippy --workspace --all-targets -D warnings`, `cargo test --workspace` pass.
- Dependencies added (`gitvur-schema` only): `serde` 1.0.229 (derive), `serde_json` 1.0.154, `schemars` 1.2.3 (named in the prompt), `sha2` 0.11.1 (SHA-256 for `contentHash`; no hashing crate was named, and this is the standard RustCrypto implementation).
- Deviations / assumptions:
  - `evidence` is **required on every edge**, not just `ai` ones. The prompt says it is required for `ai` and always emitted by the extractor, so in practice every edge has it; making it required keeps one `Edge` type and a total sort key.
  - Hash rule clarified: every line in the range is terminated by `\n` (so a range ending in an empty line keeps it), and an empty file counts as one empty line (`endLine = 1`). A file's hash equals its full-range hash.
  - Edge sort adds `provenance` then `note` as tie-breakers after the prompt's key, and canonicalisation drops exact duplicate edges. Report issues sort by `(severity, code, id, message)`.
  - `structure.json` has no `schemaVersion` field (the plan's example has none; the manifest carries it).
  - The project node's `name` is the repo root directory name; it has no `source` or `contentHash`.
  - Fixtures include two extra cases not in the prompt: a Python redefinition (`to_amount#2`) and a decorated method (the range starts at the decorator).
  - **Git:** `fixtures/py-small/build/generated.py` is hidden by the fixture's own `.gitignore`, so a plain `git add` skips it. Commit it with `git add -f fixtures/py-small/build/generated.py`; once tracked it stays tracked.
- Open questions (for the reviewer):
  1. **Single-candidate name matching (rule 7.4.4).** With an unknown receiver, one in-repo method with the called name becomes a `calls` edge. This follows CLAUDE.md ("more than one → ambiguous, none → drop") but will produce false positives on real code, e.g. `some_dict.get()` → an in-repo `Cache.get`. The fixtures avoid such collisions on purpose. Options: keep it; record single-candidate unknown-receiver calls as unresolved too; or exclude well-known builtin method names.
  2. Python import root is the repo root only. Projects with a `src/` layout would resolve nothing. Add `src/` as a second root, or make roots configurable?
  3. `self.m()` does not look at base classes; it falls back to name matching. OK for v0.2?
  4. TS class fields holding arrow functions (`handle = () => {}`) are not nodes. Common in React/Angular code. OK for v0.2?
  - Update (Phase 02 session): questions 1 and 3 are answered by `prompts/02-extractor-python.md`; see the Phase 01 amendment below.

### 2026-10-29 — Phase 01 amendment — review fixes and alignment with Phase 02 rules

- `/code-review --fix` on the Phase 01 diff fixed:
  - `commitSha` nullability between the Rust types and the schema (now superseded, see below);
  - three ordering gaps (unresolved calls now sort by candidates too; descriptions and report elements now have full sort keys and dedup);
  - an unnecessary copy in `normalize_newlines`;
  - added tests that the excluded fixture files exist and that expected ranges and evidence are consistent.
- The Phase 02 prompt conflicted with the Phase 01 contract. **Decision (user, 2026-10-29): align Phase 01 to Phase 02**, then implement Phase 02. Changes:
  - Unknown-receiver calls (`obj.m()`) with exactly **one** candidate produce **no edge** (answers open question 1). Removed `main → OrderService.place` from `py-small` and `login → Repo.findById` from `ts-small`.
  - **One `imports` edge per (file, file) pair**, evidence = first import line. `py-small`: `orders.py → utils.py` merged into one edge at line 3.
  - **One `calls` edge per (caller, target)**, evidence = first call line. No fixture change.
  - `commitSha` is a required **string**: short SHA or `"uncommitted"` (`gitvur_schema::UNCOMMITTED`); no longer nullable. Schemas regenerated.
  - Skip list gains `dist/`, `build/`, `target/`; `cls.m()` counts as a self call; no inheritance resolution (answers open question 3).
  - Because `build/` is now always skipped, `py-small` gained `scratch/notes.py`, excluded only by its `.gitignore`, so the `.gitignore` case is still exercised. It also needs `git add -f` when committing.
  - Contract README section 7 now states that the extractor parses line-ending-normalised text, which settles the review's lone-`\r` question.
  - Both `NOTES.md` files updated to match.

**HUMAN REVIEW REQUIRED (still): fixtures/*/expected/ changed in this amendment.**

### 2026-10-29 — Phase 02 — Extractor: Python

- Done:
  - `gitvur-index` with the layout from the prompt: `walk.rs`, `lang/mod.rs` (`LanguageBackend` trait + language-independent `ParsedFile`), `lang/python.rs`, `resolve.rs`, `git.rs`, `output.rs`, and `queries/python.scm` embedded with `include_str!`.
  - Python definitions (incl. `async`, decorated; range starts at the first decorator), qualified names, `#N` suffixes, hashes via `gitvur_schema`.
  - Python imports (absolute, submodule, relative, aliases, star); calls resolved by scope chain, module level, imports with re-export following, module members, `self`/`cls`, and constructors; unknown receivers by name matching with 2+ candidates only.
  - Atomic output; manifest with `"uncommitted"` fallback; syntax-error files become childless file nodes with a warning on stderr.
  - `gitvur index <repo> [--out <dir>]` prints `indexed <repo>: N files, N nodes, N edges, N unresolved, N ms`.
  - Crate README documents every walk, import and call rule and the decorator-range rule.
- Tests (29 in `gitvur-index`, 2 in the CLI):
  - golden `py-small` test with a `similar` unified diff on mismatch;
  - determinism test;
  - excluded-files test;
  - manifest test;
  - 18 resolution tests on inline temp repos: imports and submodules, relative imports, per-pair import edges, scope chain and aliases, constructors, module members, `self`/`cls`, the single-candidate rule, self fallback, `#2` suffixes, call dedup, re-exports, syntax errors, CRLF/lone-CR line numbers, `.gitignore` plus skip list, symlinks, the `"uncommitted"` fallback;
  - 7 backend unit tests.
- Acceptance:
  - [x] Golden test passes for `py-small` exactly. It passed on the first run against the amended expected file; also verified with `cmp` on CLI output in `/tmp/gv-out`.
  - [x] Determinism test passes (also byte-identical across two runs on Flask)
  - [x] Ambiguous calls appear only in `unresolvedCalls`, never as edges
  - [x] Ignored directories and gitignored files absent
  - [x] Real medium Python repos index without panicking (release build; clones were deleted after the run):

    | Repo | Commit | `.py` files found / indexed | Nodes | Edges | Unresolved | Warnings | Time |
    | --- | --- | --- | --- | --- | --- | --- | --- |
    | `pallets/flask` | `d086db8` (2026-10-07) | 83 / 83 | 1,706 | 349 (245 calls, 104 imports) | 714 | 0 | 154–165 ms |
    | `psf/black` | `4ef88cd` (2026-10-29) | 414 / 402 | 3,707 | 892 | 306 | 10 | 1,067 ms |

    - **Flask:** 383 of the 714 unresolved calls are `get`, mostly the test client's `client.get(...)` matching several in-repo `get` methods. Another 72 are `register_blueprint`. Only 98 come from `src/`.
    - **Black:** the 10 warnings are deliberately invalid files in `tests/data/cases/`, each indexed as a childless file node. The 12 files not indexed are Black's own gitignore test data, all matched by nested `.gitignore` patterns, though git tracks them (see open question 2).
  - [x] Crate README documents every resolution rule and the decorator-range rule
  - `cargo fmt --check`, `cargo clippy --workspace --all-targets -D warnings`, `cargo test --workspace`, and the app's `pnpm typecheck && pnpm lint && pnpm test` pass.
- Dependencies added:
  - `gitvur-index`: `tree-sitter` 0.27.1, `tree-sitter-python` 0.25.0, `ignore` 0.4.34, `gix` 0.90.0 (`default-features = false`, `sha1`), `thiserror` 2.0.21; dev: `similar` 3.2.1, `tempfile` 3.27.0.
  - `gitvur-cli`: `anyhow` 1.0.104.
  - `gix` was chosen over `git2` because it is pure Rust (no libgit2/OpenSSL in CI or the Tauri build) and only `discover` + `head_id` are needed. `anyhow` sits in the CLI only; the library uses `thiserror`.
- Deviations:
  - `gitvur-schema` and `fixtures/*/expected/` were modified despite the prompt's "do not touch". This was the explicit, user-approved Phase 01 amendment above, made before any extractor code existed. No expected file was changed to make a test pass.
  - Calls to a redefined name (`f` / `f#2`) and to duplicate methods are recorded as unresolved, consistent with "never guess".
  - `commitSha` uses `gix::discover`, so indexing a subdirectory of a checkout (e.g. `fixtures/py-small`) reports the enclosing checkout's `HEAD`.
  - Hidden files and directories are indexed unless on the skip list or gitignored (`WalkBuilder::hidden(false)`).
  - `generatedAt` is formatted in the CLI with a small date routine instead of adding `chrono`/`time`.
- Open questions:
  1. **Python `src/` layout (Phase 01 question 2), now with evidence.** Flask keeps its package in `src/flask`, so `import flask` / `from flask import …` resolve to nothing. Only relative imports produce edges. A second search root (`src/`) or a configurable root would recover most of them.
  2. **Tracked files matching `.gitignore`.** The extractor follows `.gitignore` patterns literally (it works without git), so tracked files that match a pattern are skipped. Git never ignores tracked files. Black's test data shows the difference.
  3. **Unresolved-call noise.** Common method names (`get`, `post`, `pop`) on unknown receivers dominate `unresolvedCalls`; on Flask, `get` alone is 54%. Should the viewer group them by name, or should the extractor cap candidate lists?

### 2026-10-29 — Phase 03 — Extractor: TypeScript

- Done:
  - `lang/typescript.rs` + `queries/typescript.scm`, compiled once per grammar (`typescript` for `.ts`/`.mts`/`.cts`/`.d.ts`, `tsx` for `.tsx`).
  - Definitions: classes (incl. abstract), class-body methods (incl. `constructor`, getters/setters by plain name with `#2` for the pair), function and generator declarations (overload signatures ignored, so overloads collapse into the implementation), and module-level `const` arrow/function expressions.
  - Ranges include `export`, the whole `const` statement, and decorators, including method decorators, which tree-sitter places as siblings before the method; a unit test caught that.
  - `.d.ts` files: file node and imports only.
  - Imports: named/aliased/default/namespace, `import type`, side-effect, `import x = require()`, `export … from` re-exports (`export { default as X }`, `export * as ns`, `export *`).
  - Relative-only resolution: exact path, `.ts`, `.tsx`, `.d.ts`, `/index.ts`, `/index.tsx`, `/index.d.ts`.
  - Calls: `this.m()`, `new C()` / `new ns.C()` (classes only, never name matching), `ns.f()`, barrel re-export following, default-export resolution.
  - Minimal core changes:
    - `LanguageBackend::parse` now receives the path, to pick the grammar and detect `.d.ts`;
    - a `Callee::New` variant;
    - `ParsedFile::default_export`, resolved under the name `default` in `lookup_export`;
    - a bare-name candidate helper so `new` can keep only classes;
    - position helpers moved from `python.rs` to `lang/mod.rs` and shared.

    Python output is unchanged: the golden test still matches byte for byte.
  - README: TS definitions, imports and calls, plus a "Known limitations" section.
- Tests: 12 new backend unit tests and 10 new TS resolution tests:
  - directory index plus barrel calls;
  - aliased, default and namespace imports;
  - aliased and default re-exports;
  - overload target;
  - `this` and unknown receivers;
  - `new` classes-only;
  - accessor suffixes;
  - type-only and external imports;
  - `.js` and `node_modules` exclusion;
  - a mixed Python/TS repo.

  Plus a `ts-small` golden test, determinism for both fixtures, and `node_modules` absence. The workspace total is 78 passing, 1 ignored (the fixture hash helper).
- Acceptance:
  - [x] Golden tests pass for both fixtures. `ts-small` passed on the first run; both also verified with `cmp` on CLI output (`/tmp/gv-ts`, `/tmp/gv-out`).
  - [x] Determinism passes for both fixtures (and for both real repos below)
  - [x] `node_modules/` absent from output
  - [x] Real TS repos index without panicking (release build; clones deleted afterwards):

    | Repo | Commit | TS files found / indexed | Nodes (class / function) | Edges (calls / imports) | Unresolved | Unresolved share¹ | Parse warnings | Time |
    | --- | --- | --- | --- | --- | --- | --- | --- | --- |
    | `honojs/hono` | `ed1d5f7` (2026-10-28) | 456 / 450 | 1,248 (57 / 740) | 1,618 (649 / 969) | 224 | **25.7%** | 8 | 964–971 ms |
    | `vercel/swr` | `8148ef0` (2026-10-16) | 197 / 197 | 915 (1 / 716) | 477 (292 / 185) | 0 | **0.0%** | 3 | 177–180 ms |

    ¹ unresolved / (calls edges + unresolved).
    - **Hono:** 152 of the 224 unresolved calls are `router.add(...)`, which matches the `add` method of several router implementations, so they are genuinely ambiguous. The 6 files not indexed are under skipped directories.
    - **Parse warnings:** the 11 files are valid TypeScript that tree-sitter-typescript 0.23.2 (the latest release) can't parse: `export type * from` and some multi-line call or overload signatures in type literals. They become childless file nodes, per the Phase 02 error rule.
    - Neither repo uses `.js`-suffixed relative imports, so the known `.js` → `.ts` gap does not affect these numbers.
  - [x] README updated with every TS rule and every known limitation
  - `cargo fmt --check`, `cargo clippy --workspace --all-targets -D warnings`, `cargo test --workspace` pass. `app/` untouched.
- Dependencies added: `tree-sitter-typescript` 0.23.2 (named in the prompt).
- Deviations:
  - The prompt's resolution order lacks `/index.d.ts`, which the Phase 01 contract (section 7.3) lists. I kept it as the last candidate: a strict superset that changes no fixture output.
  - The prompt says "Imports: … `export … from` re-exports all bind names". Re-exports are recorded as bindings of the barrel file, which is how calls follow them. They are not usable as local names inside the barrel itself (TS semantics), but barrels rarely call their own re-exports.
  - `import x = require("./m")` is supported (binds a module); the prompt doesn't mention it.
- Contract follow-ups (`crates/gitvur-schema/` was out of scope this phase): section 7.1 lists `.py`, `.ts`, `.tsx`, `.d.ts`; the extractor now also indexes `.mts` and `.cts`. Section 7.3 should mention the exact-path candidate. Both are additive and leave the fixtures unchanged.
- Open questions:
  1. **Grammar gaps (~1.5–2% of files on real repos).** Options: keep the strict "any syntax error → childless file node" rule; or extract definitions outside `ERROR` subtrees and warn, which would recover most of these files but is a contract-level change.
  2. Map `.js` specifiers to `.ts` sources (NodeNext convention) and support `tsconfig` `paths`? Both are common in real TS repos.

### 2026-10-29 — Phase 04 — Validator and staleness detection

- Done:
  - `gitvur-validate`:
    - `validate(&ValidateInput) -> Report`, the pure core, with the prompt's struct plus a `commit_sha` field for `report.commitSha`;
    - `validate_repo(repo)`: fresh in-memory index, byte comparison with `.gitvur/structure.json`, lenient loading of `annotations.json`, then `validate`;
    - `stale_ids`, `write_report` (atomic), `resolve_in_repo` (path safety), and `codes` with the 12 exact issue codes.
  - Staleness per node (except `project:root`) and per valid module, with `childChanged`/`selfChanged` on stale elements.
  - Schema change, the one allowed this phase: optional `childChanged`/`selfChanged` on `ElementStatus`, included in its sort key. Schemas regenerated; contract README section 5 updated.
  - CLI:
    - `gitvur validate <repo>` writes `.gitvur/report.json`, prints `severity[code]: message` per issue and a summary, and exits 1 on any error;
    - `gitvur stale <repo> [--json]` prints the sorted stale and undocumented IDs and writes nothing.
  - README documents every check, path safety, the staleness rules, and the expected ancestor-staleness behaviour.
  - Root `.gitignore`: `/fixtures/*/.gitvur/` (output of the verify command on the fixture).
- Tests:
  - `gitvur-validate`, 23 tests on a temp copy of `fixtures/py-small`:
    - valid annotations → zero issues and 36 documented;
    - no annotations → all undocumented;
    - deterministic, canonical report;
    - one test per issue code, plus a test that each code constant is used;
    - the three staleness scenarios;
    - `stale_ids`, module status, and path safety (`..`, absolute, backslash, symlinked evidence file, `.gitvur` symlinked outside).
  - `gitvur-cli`, 5 end-to-end tests on the built binary: validate exits 0 on clean input and 1 on errors; warnings alone exit 0; `stale` output and `--json`; `diff` still exits 2.
  - Workspace: 105 passing, 1 ignored.
- Acceptance:
  - [x] Every issue code has a test
  - [x] Staleness scenarios pass:
    - editing `Toy.label` → only it is stale (`selfChanged`); `Toy` and `models.py` are stale with `childChanged: true, selfChanged: false`; everything else documented;
    - blank lines above `slugify` → it stays documented (and `utils.py` is stale, `selfChanged`);
    - deleting `Book.describe` → `dangling-ref`.
  - [x] `report.json` canonical and deterministic
  - [x] `gitvur validate` exits 1 on errors, 0 otherwise. `validate fixtures/py-small` gives 34 undocumented and 1 `structure-out-of-date` warning (no `.gitvur/` yet), exit 0.
  - [x] README documents every check and the staleness rules
  - `cargo fmt --check`, `cargo clippy --workspace --all-targets -D warnings`, `cargo test --workspace` pass. `fixtures/*/expected/`, `gitvur-index` and `app/` untouched.
- Dependencies added:
  - `gitvur-validate`: `serde_json` 1.0.154 (raw-JSON pre-pass), `thiserror` 2.0.21; workspace path deps `gitvur-index` and `gitvur-schema`; dev `tempfile` 3.27.0.
  - `gitvur-cli`: `gitvur-validate` (path); dev `tempfile`, `serde_json`.
- Deviations:
  - **`selfChanged` is approximated.** The prompt's rule needs the element's text from when the description was written, which isn't stored, since descriptions keep only `basedOnHash`. Instead, `childChanged` = some direct child is stale, and `selfChanged` = `!childChanged`. This is exact for the prompt's scenarios and whenever only one level changed. It is wrong when both the element's own lines and a child changed (reports `selfChanged: false`), and child additions or removals show as `selfChanged: true`. Documented in the README.
  - **`ai-edge-no-evidence`:** `evidence` is required by the contract types, so a missing one would otherwise be `schema-invalid`. The loader checks the raw JSON first: such edges get `ai-edge-no-evidence` and are dropped, and the rest is parsed normally.
  - **`schema-invalid` and `structure-out-of-date`** are produced by `validate_repo`, since they need file access; `validate` itself is pure.
  - **`module-not-module`** checks the full `module:<slug>` format, not just the prefix.
  - A module listing a non-file node is reported as `dangling-ref`.
  - **Empty descriptions** count as `undocumented` (and also get `description-empty`), so incremental mode picks them up.
  - **No `tests/data/`:** the prompt allows test fixtures there, but every scenario is built programmatically from a temp copy of `fixtures/py-small`, as its Tests section suggests.
- Open questions:
  1. **Exact `selfChanged`:** add `basedOnSelfHash` (the hash of the element with its direct children's ranges removed) to each description in a future contract version? The agent can't compute it, but `gitvur packet` (Phase 05) could hand it over alongside `contentHash`.

### 2026-10-29/30 — Phase 05 — Agent documentation workflow

#### Developer role

- Done:
  - `gitvur packet <repo> [--mode initial|incremental] [--out file]` (`crates/gitvur-cli/src/packet.rs`):
    - a pure `build(mode, structure, report, annotations)`, plus `for_repo`, which runs a fresh index, `validate_repo`, and lenient loading of the annotations;
    - output: `mode`, `commitSha`, `todo` (sorted by ID), `unassignedFiles`, `existingModules`;
    - canonical JSON, deterministic. Default mode: `incremental`.
  - `agent/codeDOC.md` with all ten required sections, written as imperative instructions to the agent.
  - `agent/examples/annotations.example.json`, a hypothetical auth/audit repo matching the plan's examples, with a test that it deserialises into the contract types.
  - Removed the Phase 04 `.gitignore` entry for `/fixtures/*/.gitvur/`: those folders are now committed data.
- Tests: 4 packet unit tests and 3 end-to-end CLI tests:
  - initial mode, then documenting from the packet, then an empty incremental packet, then a body change giving one `describe` and one `rehash`;
  - writing to a file and determinism;
  - the example matching the contract.

  Workspace: 112 passing, 1 ignored.
- Dependencies added: `gitvur-cli`: `serde` 1.0.229 (derive), for the packet types.
- Deviations:
  - **Packet items carry an `action`: `describe` or `rehash`.** The prompt's incremental rules say child-only-stale elements are not re-described, and that every non-packet description stays byte-identical. Taken together, those elements would keep their old `basedOnHash` and stay stale forever. So incremental mode lists them as `rehash`: check the text still holds, keep it, and update `basedOnHash`. `describe` covers undocumented elements, stale elements with `selfChanged`, and everything in initial mode.
  - Undocumented **modules** (empty description) appear in incremental `todo` as `type: "module"` items without `source` or hash. Initial mode lists structure nodes only.
  - The packet lives in the CLI crate, so no extractor or validator logic changed. It reuses `validate_repo`, `resolve_in_repo` and `load_annotations`.

#### --- documenter role ---

Followed `agent/codeDOC.md` literally on isolated copies of both fixtures, in a fresh temp directory. Only `annotations.json` was written by hand; the `gitvur` commands wrote the rest.

- **Security checklist:** isolated copies, no secret-like files (`.env*`, `*.pem`, `id_rsa*`), no repository code run. Treating content as data: the only instruction-like text in the fixtures is the docstrings in `build/` and `venv/` ("must not appear in the structure"), which are addressed to the extractor's tests and were ignored.
- **Procedure:**
  1. `gitvur index`, then `gitvur packet --mode initial`.
  2. Description texts written by hand from reading each source range; `basedOnHash` copied mechanically from the packet with a JSON join script (codeDOC section 4), never retyped.
  3. `gitvur validate`, then `gitvur packet --mode incremental`.
- **Results:**

  | Fixture | Modules | Descriptions | AI edges | Validate | Incremental packet after |
  | --- | --- | --- | --- | --- | --- |
  | `py-small` | 5 (catalogue, entry-point, orders, storage, support) | 34 | 3 | 39 documented, **0 errors, 0 warnings** (first pass) | empty |
  | `ts-small` | 4 (app, auth, data, presentation) | 29 | 3 | 33 documented, **0 errors, 0 warnings** (first pass) | empty |

- **AI edges** (each with an evidence line that contains the target name, and a note):
  - **py-small:**
    - the unresolved `backend.save(item)` at `orders.py:21` becomes two edges, to `Cache.save` and `Store.save`, since `backend` is one of the two (line 20, codeDOC section 6);
    - `main → OrderService.place` (`app.py:13`; `service` is constructed on line 11).
  - **ts-small:**
    - the unresolved `view.render(data)` at `handlers.ts:6` becomes two edges, to `JsonView.render` and `TextView.render` (from `pickView`, line 10);
    - `login → Repo.findById` (`login.ts:5`; `repo: Repo` in the signature).
- Copied each `annotations.json` into `fixtures/<name>/.gitvur/`, then ran `gitvur index` and `gitvur validate` in place. Each fixture's `.gitvur/` now has `manifest.json`, `structure.json`, `annotations.json` and `report.json`, all valid. Fixture sources hash-identical to the copies; `fixtures/*/expected/` untouched (the golden tests still pass).
- **Incremental simulation** (temp copy of `py-small`): changed `Toy.label`'s body from `self.name.upper()` to `self.name.title()`.
  - The incremental packet listed 3 items: `Toy.label` (`describe`), `class Toy` (`rehash`), `file:shop/models.py` (`rehash`).
  - Decisions: rewrote `Toy.label`. Rewrote `Toy` too, because "upper-case label" had become wrong. Kept `models.py`'s text and updated only its hash.
  - After validating: 39 documented, 0 errors, 0 warnings, empty packet.
  - **Diff of `annotations.json`: exactly those 3 description objects changed.** The other 31 descriptions, all 5 modules and all 3 edges are byte-identical:

    ```diff
    @@ class:shop/models.py:Toy
    -      "text": "A catalogue toy with a name and a price, displayed with an upper-case label.",
    -      "basedOnHash": "sha256:9b1455316344365bb9c2d13750fa5cfa0ec17df86c8b349700fa470ec0cf60c2"
    +      "text": "A catalogue toy with a name and a price, displayed with a title-case label.",
    +      "basedOnHash": "sha256:64fa8f658799bdfae750b292f156c0ab9b7df87105f1642488a0b00570c4077d"
    @@ file:shop/models.py
    -      "basedOnHash": "sha256:1581756568c5728c56632c89bc4b1246ca4e46461e5e0ed6e0edc6521425c0fc"
    +      "basedOnHash": "sha256:823d8ca81be625e1204ac7491e54384146d4a729b4c6dee8c1c8a072ff4be5bd"
    @@ function:shop/models.py:Toy.label
    -      "text": "Returns the toy's name in upper case.",
    -      "basedOnHash": "sha256:fa926ec081bfb7a942b927db1c4cfcaf512e056dc266ab56bf9f1aadab6e74e3"
    +      "text": "Returns the toy's name in title case.",
    +      "basedOnHash": "sha256:47e97a3bbd3601115332de15aceb2428b2dfe30a98d02907e2fb8d8b2d888bcc"
    ```

- **Where codeDOC was unclear while following it, and the fix:**
  1. *What to do with an element that is stale only because of a child.* The prompt's rules left it stale forever; this led to the packet's `rehash` action, and codeDOC section 2 now defines it.
  2. *Whether a call the extractor dropped (one candidate, unknown receiver) may become an AI edge.* Section 5 now lists "dynamic dispatch through a receiver whose type is certain from the same function" explicitly; used for `main → place` and `login → findById`.
  3. *Whether a conditional receiver with two reachable targets counts as "certain".* Section 6 now says to add one edge per reachable target.
  4. *Whether `.d.ts`, `__init__.py` and barrel files need modules and descriptions.* They are file nodes in the packet; section 3 now says every file node, naming them.
  5. **Not fixed (open question 1):** semantic ripple. After the `Toy.label` change, `Toy.describe`'s description ("built from its upper-case label") became wrong. It isn't in the packet because its own code didn't change, and codeDOC section 7 forbids touching it, so it stays subtly wrong.
- Acceptance:
  - [x] `gitvur packet` implemented and tested (initial and incremental)
  - [x] `agent/codeDOC.md` contains all ten sections
  - [x] Both fixtures' annotations pass `gitvur validate` with zero errors (and zero warnings)
  - [x] Incremental simulation changes only the packet items (diff above)
  - [x] Fixture source files and expected files unchanged. `git diff --stat fixtures/*/expected fixtures/*/src` is empty, though trivially, since the fixtures were never committed. Also verified by hashing every source file against the documenter's copies, and by the golden tests.
- Open questions:
  1. **Semantic ripple in incremental mode.** Should the packet add the direct callers of every `describe` item (from static `calls` edges, e.g. `Toy.describe → Toy.label`) as a third action, `review` ("check the text is still true; usually no change")? That catches descriptions that depend on a callee's behaviour, at the cost of a slightly larger packet.
  2. Commit the fixture `.gitvur/` files with their current `commitSha` (the gitvur checkout's `HEAD`, `83c8bd6`)? It changes whenever they are regenerated after a new commit; harmless, but noisy in diffs.

### 2026-10-30 — Review of Phases 01–05 (`/code-review --fix`)

- Fixed (by the review):
  1. **Writes through a symlinked `.gitvur`** (hard rules 4/6). Reads were guarded, writes weren't. New `gitvur_validate::gitvur_dir(repo)` refuses a symlinked `.gitvur`; `gitvur index` (default output) and `gitvur validate` write through it.
  2. **Walk errors** (bad nested `.gitignore` glob, unreadable directory) were fatal; they are now warnings.
  3. **An unreadable file** aborted the whole index; it is now a warning and is skipped. The unused `IndexError::Read`/`Walk` variants are removed.
  4. **Non-object entries in `edges`** were dropped as `ai-edge-no-evidence`; they now reach deserialisation and give `schema-invalid`.
  5. **Python backend:** nameless definition nodes are now removed before indices are assigned. Previously they could shift `parent` and `caller` indices. Not triggered by the fixtures.
  6. **`gitvur packet`** no longer indexes twice. New `gitvur_validate::validate_repo_with_inputs` returns the report with the exact structure and annotations it checked. The per-description hash lookup is now a map instead of O(descriptions × nodes).
- Added (follow-up): regression tests for fix 1 (`index` and `validate` refuse a symlinked `.gitvur`, and nothing is written outside) and fix 4. Removed a stray trailing blank line in `.gitignore`.
- Not changed:
  - `resolve.rs` `children()` re-scans definitions per lookup. A performance clean-up; no wrong output. Parked.
  - Fixture `commitSha` comes from the enclosing checkout, as intended (Phase 05 open question 2).
- State: fmt, clippy (`-D warnings`) and 114 tests pass (1 ignored). Both fixtures still validate with 0 errors and 0 warnings, and their `report.json` is byte-unchanged.

### 2026-10-30 — Phase 06 — App shell and data loading

- Done:
  - **Rust (`app/src-tauri`).** Split into a library plus a thin `main`.
    - `bundle.rs`: `open_repository`, `read_source` and path resolution. Every repo-relative path is canonicalised and kept inside the root; `..`, absolute paths, backslashes and symlink escapes give `path-escape`.
    - `commands.rs`: async Tauri commands using `spawn_blocking`: `open_repository`, `index_repository`, `validate_repository`, `read_source`, `recent_repositories`, plus `get_settings`/`set_settings`.
    - `error.rs`: `AppError` serialises as `{ code, message, detail? }` with the six codes. Warning codes: `annotations-missing`, `annotations-invalid`, `report-missing`, `report-invalid`, `report-stale` (`report.json` older than `structure.json`).
    - `settings.rs`: the recent list (10 entries) and UI settings in the app config dir, never in the repository.
    - Only `index_repository` and `validate_repository` write, and only into `.gitvur/`, through `gitvur_validate::gitvur_dir`, which refuses a symlinked `.gitvur`. Nothing from the repository is executed.
  - **TypeScript contract types generated with ts-rs** into `app/src/generated/contract.ts`: 31 types (21 contract, 10 app), with a drift test. `pnpm gen:types` regenerates them.
  - **`buildModel(bundle)`** (`app/src/model/buildModel.ts`), pure:
    - module nodes from annotations; files re-parented under their module, or under the synthetic `module:__unassigned` ("Unassigned files");
    - descriptions, `docStatus`, `selfChanged`/`childChanged` from the report, or computed with the validator's rules when the report is missing or doesn't cover an element;
    - edges from both layers tagged with `origin` and provenance; `unresolvedCalls` indexed by `from`;
    - `childrenById`, `parentById`, `depthById`, per-module stats, incoming/outgoing indexes, totals.

    `tree.ts`: visible explorer rows, the default expansion (modules open, so the tree is collapsed at file level) and ancestors.
  - **Frame:**
    - top bar: logo, project, commit chip, Index, Validate, and a `⋯` menu with Open, How to document, and Theme;
    - explorer as an ARIA `tree` (`aria-expanded`/`level`/`posinset`/`setsize`, roving focus, arrows/Home/End/Enter);
    - canvas placeholder, inspector (collapsible to a rail), status bar (files · nodes · edges · documented % · warnings · last indexed in UTC);
    - drag- and keyboard-resizable panes (16px steps, Home/End), widths and theme saved to app config;
    - zustand store with `selectedId`, `expandedIds`, `lens`, `theme`;
    - placeholder tokens in `tokens.css` for light and dark; Inter and JetBrains Mono bundled locally.
  - **The five states from Part D**, plus a generic error panel for `not-a-directory`, `path-escape`, `io` and `index-failed`. "Show how to document" opens a dialog with the bundled `agent/codeDOC.md`.
  - **Mock mode:** `pnpm dev:mock` with `?fixture=py-small|ts-small` and `?state=no-gitvur|schema-invalid|structure-only|indexing`. All backend calls go through `app/src/api/`. The mock and its bundled fixtures are dead code in the production build (verified: no fixture strings or `mock://` in `dist/`).
  - **Playwright:** `light`/`dark` projects at 1440×900; `pnpm e2e` writes 22 screenshots into `app/e2e/__screenshots__/{light,dark}/`.
- Tests:
  - **Rust (`gitvur-app`), 13 tests:**
    - opening py-small/ts-small with correct counts;
    - `not-a-directory`, `no-gitvur`, `schema-invalid` (bad structure, wrong schema version);
    - the four optional-file warnings and `report-stale`;
    - `read_source` context, clamping, the 2,000-line cap and language;
    - **path escapes** (`../`, `shop/../`, absolute, `./`, backslash, empty) and **symlinks to outside** (a source file and `.gitvur`);
    - settings and recent list;
    - the bindings drift test.
  - **Vitest, 15 tests:** re-parenting, nesting order, descriptions, edge indexes, module and total counts, the unassigned group, structure-only, **status without a report equals the validator's report for every element of both fixtures**, stale propagation, empty descriptions, tree rows and keyboard model, and the **10k-node benchmark: 9.2 ms** (best of 5; limit 100 ms).
  - **Playwright, 12 tests × 2 themes:** every state; the py-small tree and counts; ts-small; tree keyboard navigation; keyboard resize plus persistence across reload plus collapse; no horizontal scroll at 1280×720 and 2560×1440; a narrow tiled 926×476 window.
- Acceptance:
  - [x] All five commands implemented; path-escape tests pass (`../`, absolute path, symlink to outside)
  - [x] TS contract types generated (ts-rs), not hand-written
  - [x] `buildModel` unit tests: re-parenting, unassigned group, status without report, 10k-node benchmark under 100 ms
  - [x] Frame works from 1280×720 to 2560×1440 with no horizontal scroll, and down to 926×476
  - [x] Every Part D state reachable and screenshotted in light and dark
  - [~] **Opening `fixtures/py-small` in the real app.** `pnpm tauri dev` starts with no errors or warnings in the log, and a capture of the real window confirmed WebKitGTK renders the frame, fonts and dark theme correctly. I can't operate the native folder dialog, so the open itself was verified through the same Rust code path (`open_repository` on `fixtures/py-small`: 7 files, 35 nodes, 18 edges) and through mock mode with the same fixture files (tree with 12 rows, "7 files · 40 nodes · 21 edges · 100% documented"). **Please click Open repository → `fixtures/py-small` once to confirm.**
  - [x] Screenshots reviewed; findings below
  - `cargo fmt --check`, clippy (`-D warnings`), 127 Rust tests (1 ignored); `pnpm typecheck && pnpm lint && pnpm test && pnpm e2e` pass. `fixtures/` untouched.
- **Screenshot review** (all 22 viewed, plus a capture of the real Tauri window). Fixed before finishing:
  1. **Inspector pushed off-screen in narrow windows.** Found on the real app: Hyprland tiled it to 926×476, below the 1280 minimum, because tiling WMs ignore `minWidth`. The fixed side widths overflowed and hid the collapse button. Side panes now give way (`min(chosen, 28vw / 34vw)`, canvas `minmax(0, 1fr)`); the chosen widths are unchanged from 1280px up. New e2e test at 926×476.
  2. **Heavy dividers:** 5px solid grey resize handles looked like bars. They are now a 1px line with the same 5px invisible grab area, turning 2px accent on hover or focus.
  3. **Lone last words in state titles** ("…indexed / yet", "…descriptions / yet"): `text-wrap: balance` on titles and text.
  4. **Off-centre icons:** the `⋯` icon sat above centre because SVGs had no explicit size and aligned to the text baseline. Button SVGs are now a fixed 16px block.
  5. **The panel-collapse icon's chevron touched the frame**; the icon was redrawn.
  6. **Grammar:** a module's file-count label read "1 files".
  - Checked and fine: contrast of muted text, status dots, warning chips, and the danger icon in both themes; title and button balance in state panels; no clipping at 1280×720 or 2560×1440.
  - Not fixed (parked): the help dialog shows `codeDOC.md` as raw Markdown (`**`, backticks). Readable, but unpolished; Phase 11 polish.
- **Bugs found by the tests and fixed:**
  1. Settings loaded at startup overwrote a pane resize made before they arrived.
  2. React StrictMode ran `init()` twice in development, reloading the defaults over a change; `init` now runs once.
  3. A 300 ms debounced settings save was lost on a quick reload or close. Discrete changes (collapse, theme) now save immediately, and a pending drag save is flushed on `pagehide`.
- Dependencies added:
  - **Rust:**
    - `tauri-plugin-dialog` 2.8.4 (named in the prompt);
    - `ts-rs` 12.0.1 (named; chosen over specta because the app needs plain `.ts` declarations rather than specta's command-binding layer, and ts-rs reads the existing serde attributes, so the schema needed only feature-gated derives);
    - `serde` 1.0.229, `serde_json` 1.0.154 (command types, reading `.gitvur/`);
    - `thiserror` 2.0.21 (`AppError`);
    - dev `tempfile` 3.27.0.
  - **npm:** `@tauri-apps/plugin-dialog` 2.8.4, `@fontsource/inter` 5.3.0 and `@fontsource/jetbrains-mono` 5.3.0 (all named); dev `@playwright/test` 1.64.1 (named). Playwright's Chromium headless shell was installed into `~/.cache/ms-playwright`.
- Deviations:
  - **`gitvur-schema` gained a `ts` cargo feature:** `#[cfg_attr(feature = "ts", derive(ts_rs::TS))]` plus `ts(optional)` on fields omitted when empty. These are derive attributes only, no logic change, enabled only by the app. JSON output and schemas are unchanged (drift test passes).
  - Two extra commands, `get_settings`/`set_settings`, so pane widths and theme persist in app config as the prompt asks. In mock mode the same API uses `localStorage`.
  - `annotations.json`/`report.json` that fail to parse are **warnings** (with `null`) rather than errors, so the structure still opens. Only `manifest.json`/`structure.json` problems are `schema-invalid` errors, which show the "Re-index" state.
  - `lens` exists in the store with `"structure" | "coverage"`; the lenses themselves are Phase 07/09.
  - ESLint `restrict-template-expressions` now allows numbers (other types still need `String()`).
  - `pnpm e2e` is not in CI: the prompt's CI step list predates it, and it needs a Playwright browser. It runs locally in about 6 s.
- Open questions:
  1. Add `pnpm e2e` to CI (install the Chromium headless shell, upload screenshots as an artifact)? About 1 minute of extra CI time.

### 2026-10-30 — Phase 07 — Graph rendering and visual language

(Run at the user's request together with Phase 08; Phase 08 depends on this canvas.)

- Done:
  - **Containment layout** (`app/src/layout/`, decision and reasoning in its README):
    - the project header bar on top;
    - module containers placed by Dagre (TB, ranksep 96, nodesep 64, margins 48) along module dependencies aggregated from the extractor's file imports and calls;
    - file cards in a `clamp(1, ceil(sqrt(n×1.6)), 6)`-column grid, row-major by path;
    - class and function rows stacked inside expanded files, with methods and nested functions indented 16px per level.

    The layout is pure, snapped to the 4px grid, and runs in a Web Worker (`layout.worker.ts`, with an inline fallback for tests). Two caches make expansion incremental: module grids, keyed by a per-module signature, and the Dagre ranking, keyed by module widths and edges. Expanding a file recomputes only that module's grid plus a cheap vertical pass at Level 2.
  - **Tokens:**
    - the binding `--gv-*` set for both themes, with dark rebuilt rather than inverted (surfaces step up canvas → surface → raised);
    - eight module identity colours whose hues are kept clear of the status and diff hues;
    - hex values only in `tokens.css`; the Phase 06 CSS migrated to the `--gv-*` names;
    - `pnpm check:contrast` (`scripts/check-contrast.ts`): **243 checks pass**. Text ≥ 4.5:1 on all four surfaces; kind/status/provenance/diff/module colours ≥ 3:1 on `--gv-bg-surface`; module colours ≥ 0.06 apart in OKLab and ≥ 15° from every status and diff hue; and the two copies of the dark theme must be identical.
  - **Node visual language** (`app/src/canvas/`), every kind with its own shape:
    - project: a full-width bar, no border;
    - module: a radius-lg container with a 4px identity band, a ring for documented %, and a dashed grey border for "Unassigned files";
    - file: a raised radius-md card with a language glyph, a middle-truncated directory, a child-count chip, a chevron and a reserved 16px status slot;
    - class: a row tinted with `--gv-kind-class-tint`, with a filled `C` square;
    - function: an unfilled row with an `ƒ` circle, outline-only for methods.

    Every node has hover, selected, focused and (reserved) dimmed states. Glyphs are inline SVG in `glyphs.tsx`.
  - **Interaction:** modules open and files collapsed by default; chevron or Enter on a focused file expands it; Shift+click on a module header toggles all its files.
    - Toolbar: Fit, Zoom in, Zoom out, Expand all, Collapse all, Lens (Structure).
    - Three semantic-zoom levels through a selector that re-renders only when the level changes.
    - Expand/collapse animates over `--gv-motion-base` with `--gv-ease-out`, with no animation under reduced motion.
    - Initial fit with 48px padding, falling back to the top two ranks below zoom 0.2.
    - Explorer and canvas share `expandedIds` and `selectedId`, so they always agree.
  - **Minimap:** a custom one (see Performance). Modules in their identity colours, files as grey blocks, an accent viewport rectangle; click to centre.
  - **`pnpm gen:synthetic`:** a seeded, deterministic generator (defaults 20 modules / 400 files / 5,000 functions, plus one 40-child file) writing `.synthetic/bundle.json`, loaded lazily with `?fixture=synthetic`. The `?perf=1` overlay (or Ctrl+Shift+P) shows FPS, rendered nodes and layout timings. `pnpm e2e:perf` measures the budgets alone.
- **Performance** (synthetic, 5,000 functions; `pnpm e2e:perf`, headless Chromium, 3 isolated runs):

  | Metric | Budget | Measured |
  | --- | --- | --- |
  | First layout, collapsed, in worker | < 400 ms | **86–101 ms** |
  | Expand one file with 40 children, to settled positions | < 50 ms | **24.6–26.9 ms** (0.6 ms of it in the worker) |
  | Pan/zoom | ≥ 50 fps | **61 fps** (headless Chromium) |
  | Memory after load (JS heap) | < 400 MB | **61–74 MB** |

  Three misses fixed along the way:
  1. **Expand took 152 ms in the worker** because Dagre re-ran on every expand (~90–100 ms for 20 modules and 129 module edges). Fixed by caching the ranking, since expanding changes only heights.
  2. **Expand then took ~92 ms on the main thread.** `buildFlow` rebuilt all ~5,600 node objects, and React Flow's own MiniMap redrew one shape per node, rows included, on every change. Fixed with `reuseNodes` (unchanged nodes keep their identity, which React Flow skips) and a custom minimap that draws only modules and files.
  3. **"First layout: 1.1 ms" was a measurement bug.** StrictMode's cancelled first request did the real cold work, and only the warm second one was recorded. The cold result is now recorded even when superseded.

  **Not measured: pan/zoom fps in `pnpm tauri dev` on WebKitGTK.** The real app starts cleanly with the new tokens (log checked, window captured). But opening a repository there needs the native folder dialog, which I can't operate (no input-automation tool on this system), and Playwright's WebKit doesn't install on Arch (host-requirements check fails). Please open `fixtures/py-small` in `pnpm tauri dev` and toggle Ctrl+Shift+P to read FPS while panning.
- **Design review** (screenshots `map-01` … `map-06` in light and dark, plus a greyscale `map-01g`):
  - *Kinds apart in under a second, in greyscale?* Yes. Shape alone separates them: a container with a band, a raised card, a tinted row with a filled square, and a plain row with a circle (outlined for methods).
  - *One focal point?* With a selection, yes: an accent border plus a soft fill, and nothing else uses the accent. Without one, the top-rank module under the header connector draws the eye. The ring is the only other colour in a module header.
  - *Gaps on the 4px grid, containers aligned?* Yes. All boxes are snapped (unit-tested), and modules in a rank share a top edge.
  - *Clipping or overlap?* Names, descriptions and paths truncate with ellipses (middle truncation for paths). The floating toolbar and minimap can cover map content at some viewports, which is standard for floating panels.
  - *Module colours one family, calm next to status?* Yes. All are mid-chroma (OKLab C 0.09–0.17) at similar lightness. The bands are thin (4px), and the minimap uses them at 30% opacity, so the green documented ring stays distinct.
  - *Dark has the same hierarchy?* Yes. Surfaces step up in lightness from canvas to raised, so cards still sit above containers. Borders and shadows are retuned rather than inverted.
  - **Observations, not changed:**
    - Small repos fit width-bound at zoom 0.45–0.6, where LOD 1 shows module descriptions too small to read. The prompt's LOD table puts the full header at 0.35–0.8.
    - The synthetic map is tall and thin: its import chains produce about 15 Dagre ranks. That's a property of the data, not the layout.
- Tests:
  - Vitest, 31 total:
    - layout (10): the column formula, grid packing, tallest-card rows, 4px snapping, dependency direction, no overlapping modules, row depth and indent, expand recomputing one module and reusing the ranking, determinism;
    - canvas builder (6): module colours, nesting, selection identity, `reuseNodes`, LOD mapping, middle truncation.
  - Playwright: the six screenshot sets plus greyscale; the LOD per zoom level; toolbar expand/collapse and Enter on a focused file; Shift+click on a module header; reduced motion; selection syncing explorer and inspector; and the budget test. **44 passing**; the budget test is skipped in the normal run and runs via `e2e:perf`.
- Acceptance:
  - [x] Containment layout implemented and documented; runs in a worker
  - [x] Tokens complete for both themes; `pnpm check:contrast` passes (243 checks)
  - [x] All five node kinds match the visual language table, including greyscale distinguishability
  - [x] Collapse/expand, toolbar, minimap, three LOD levels, reduced-motion behaviour
  - [~] Performance budgets measured and recorded: three of four in Chromium; WebKitGTK fps is a manual step (above)
  - [x] Six screenshot sets captured and reviewed; review answers recorded
  - Rust (127 tests), clippy, fmt; `pnpm typecheck && lint && test && check:contrast && e2e` pass.
- Dependencies added: none (`@xyflow/react` and `@dagrejs/dagre` were installed in Phase 00).
- Deviations:
  - **Minimap:** a small custom component instead of React Flow's `<MiniMap>`, which redrew every row node on every change and cost about 60 ms per expand on the synthetic repo.
  - **Level 2 "re-layout" on expand is the cached Dagre ranking plus a vertical pass.** Rank tops are placed below the previous rank's tallest module (top-aligned, `ranksep` 96). The first layout uses the same rule, so both paths agree.
  - **Dev-only `window.__gitvurMap`** (setViewport, focusNodes, getZoom) for screenshots at exact zoom levels; it is not present in production builds.
  - **The Lens switch lists only "Structure"**, as the prompt says; the store's `Lens` type also has `coverage`, for Phase 09.

### 2026-10-30 — Phase 08 — Inspector and relationships

Two sessions: the first stopped at the usage limit after a WIP checkpoint (`c8b8402`); the second finished the phase.

- Done:
  - **Edge aggregation** (`app/src/model/aggregateEdges.ts`): pure function lifting edges to the nearest visible ancestor (rows → collapsed file → module at low LOD), grouped by (source, target, type, provenance), 1-hop and 2-hop, self-loops dropped; 7 unit tests.
  - **Canvas edges** (`app/src/canvas/edges/`): bezier between facing sides, parallel lines offset; provenance strokes per the prompt's table; "AI" pill; count badge whose hover lists the underlying pairs (each pair opens its evidence); edge type beside the line on hover; 1-hop / 2-hop toggle (2nd hop at 50%); hover preview; dimming to `--gv-opacity-dimmed`; Esc clears; collapsible legend drawn with the real strokes.
  - **Inspector** (`app/src/inspector/Inspector.tsx`, replaces `components/Inspector.tsx`):
    - breadcrumb (ancestors clickable), back/forward buttons, header with kind glyph, status, kind · path · lines and Copy path;
    - description with "AI-written · based on version <6 hex>", or "No description yet" plus the hint;
    - function/class: source, relationship groups (Calls, Called by, Imports, Imported by, References, Referenced by, Depends on, Depended on by; empty groups hidden), each row with glyph · name · file · provenance mark · evidence button, then "Possible targets for `name`" (collapsed by default; expanding draws the candidate lines);
    - file: outline (clickable, nested) and imports in/out; module: counts, documented %, file list.
  - `inspector/relations.ts`: pure grouping, outline, unresolved-in-subtree helpers; 5 unit tests.
  - **Code viewer**: Shiki core with the JS regex engine (no WASM, CSP unchanged), github-light / github-dark with the background overridden by `--gv-bg-sunken`; real line numbers; 3 muted context lines; cache by (file, contentHash); missing file / out-of-range shows the warning with **Re-index**; cap at 60% of the pane height with **Open full**.
  - **Evidence mode**: clicking an edge on the canvas, a badge pair, or a row's `:line` button shows the evidence file at that line, highlighted with `--gv-accent-soft`, headed "Evidence for: main → place (calls, AI)", with the AI note when present, and **← Back**.
  - **Navigation**: relationship rows, outline, module files and breadcrumb call `navigateTo` (reveal ancestors, select, centre over `--gv-motion-base`, zoom to 0.9 when below 0.6, instant with reduced motion). History with Alt+←/→ (`inspector/useHistoryKeys.ts`) and the header buttons. Explorer, canvas and inspector share the store selection.
  - **Fix found by the e2e tests:** React Flow raises edges touching the selected node to z 2000, above the edge-label layer, so where lines crossed, an edge's hit area covered the count badge and its pair list couldn't be hovered. The label layer is now at z 3000. Badges of parallel lines are also stacked 22px apart; they overlapped at the shared midpoint.
  - Mock: `?missing=<relpath>` serves that source as deleted, for the missing-source screenshot.
- Tests:
  - Vitest 43 (12 new: aggregation 7, inspector relations 5).
  - Playwright `e2e/inspector.spec.ts`: the six screenshot sets (`insp-01` … `insp-06`, light and dark), module/file variants and the empty description, relationship links + breadcrumb + Alt+←/→ + back button + Esc keeping explorer, canvas and inspector in sync. **58 passing** in total, 2 skipped (perf budgets, run via `e2e:perf`).
- **Visual review** (screenshots above):
  - *Three provenance styles apart without the legend? In greyscale?* Yes. Syntactic is thin solid, semantic is thick solid, AI is dashed with an open arrow and an "AI" pill, so width and dash alone separate them. The inspector rows repeat the same line samples.
  - *Selected node still the focal point with many edges?* Yes, at py-small scale: the accent-bordered selection is the only accent fill, and everything outside the neighbourhood drops to 0.28. py-small has no node with 15 edges, so that case hasn't been seen. Re-check on the synthetic repo in Phase 11.
  - *Edges crossing node text?* Yes, in two places. (1) A line going from a module's outside to a row inside it crosses the module header's description, and its AI pill or count badge can land on the header text or the documented ring (`insp-05`, `insp-06`). (2) Second-hop lines between adjacent rows of one file are very short vertical curves (`insp-02`). Neither is fixed. Routing around containers is a layout change, out of scope here (Parking lot).
  - *Inspector scannable in five seconds?* Yes. Top to bottom: breadcrumb, name + kind + lines, one-paragraph description, source, then "Calls" / "Called by" with counts.
- Acceptance:
  - [x] Edge styles, hover labels, legend, 1-hop/2-hop, dimming, aggregation with tests
  - [x] Inspector sections for function, class, file, module; empty-description state
  - [x] Code viewer with real line numbers, context, caching, evidence mode, missing-source warning
  - [x] Navigation from lists and breadcrumbs, with history
  - [x] Six screenshot sets reviewed
  - `pnpm typecheck && lint && test && check:contrast && e2e` pass; Rust fmt, clippy, 127 tests pass (no Rust changes).
- Dependencies added: none (`shiki` was installed in Phase 00).
- Deviations / notes:
  - The breadcrumb's project segment is plain text: the project isn't selectable anywhere else (clicking it on the canvas clears the selection).
  - "Referenced by", "Depends on" and "Depended on by" groups added beside the prompt's five, so no edge type goes unlisted; empty groups are hidden.
  - Possible targets: candidate rows have no evidence button (the evidence is the call line, shown in the hint).
  - Edited `app/src/api/mock.ts` and `app/src/App.tsx` (outside the listed scope) for the `?missing=` simulation and to mount the new inspector and the history keys.
  - The browser logs "ResizeObserver loop completed with undelivered notifications" in some inspector tests. It is the benign warning that fires when the inspector's scrollbar appears and the canvas resizes; no test or behaviour is affected.
- Not done: `pnpm tauri dev` against py-small / ts-small. The native folder dialog can't be driven here (same limit as Phase 07). Please select functions in both fixtures there.

### 2026-10-30 — Phase 09 — Trust and coverage UI

- Done:
  - **Model** (`buildModel.ts`): `ModelNode.issues` (report issues about the element, errors first); `ModuleStats` gains `stale`, `undocumented`, `errors` (subtree); `Totals` gains `stale`, `undocumented`, `errors`, `warnings`; `Model.issues` sorted by severity, code, id (issues without one last), message.
  - **Status marks** (`canvas/StatusMark.tsx`) in the 16px slot on file cards and rows:
    - stale with `selfChanged`: filled stale dot; `childChanged` only: hollow ring;
    - validation error: red triangle, which takes precedence over the stale mark;
    - documented and undocumented: no mark.
  - Module headers: an error-count chip, and a ring split into documented / stale / undocumented arcs.
  - **Documentation lens** (Toolbar → "Documentation"; the store value stays `coverage`):
    - CSS tints via `data-lens` / `data-status`: stale at 14%, undocumented dashed with a 10% tint, selection still wins;
    - documented % beside each module ring;
    - summary card (top-right, below the toolbar row): stacked bar and counts with %, and the error count, which opens the issues panel. A segment or count filters the explorer (`filteredRows`: matching elements plus ancestors, all expanded, with a "Showing N … · Show all" bar).
    - The lens is saved per repository in `localStorage` (key `gitvur.lens:<root>`). Storage failures fall back to Structure.
  - **Inspector trust**:
    - status line with the prompt's exact wording (`inspector/trust.ts`);
    - stale descriptions stay visible in secondary text with a "possibly outdated" pill;
    - provenance line "AI-written · based on version <6 hex>" on every description;
    - a "Validation issues" section with code + message;
    - AI edges show their `note` and an "Evidence at file:line" link.
  - **Issues panel** (`panels/issues/`): bottom drawer, toggled by the status-bar error/warning counts or Ctrl+Shift+M.
    - Groups by code, errors first, collapsible with counts.
    - Rows: severity icon (shape differs as well as colour), message, middle-truncated id. Click selects and centres the element; ids not in the map are not clickable and say so on hover.
    - Empty: "No validation issues." (or "Not validated yet." without a report).
  - **Top bar** (`topbar/TrustSummary.tsx`): `29 documented · 5 stale · 5 undocumented · 7 errors` with dots; the error count opens the panel.
  - **Banners** (`topbar/banners.ts`, `Banners.tsx`), stale-tinted, dismissible per session:
    - report missing → "Not validated yet." [Validate];
    - `structure-out-of-date` issue → "The code changed since this map was generated." [Re-index];
    - report older than the map → "Validation results are older than the map." [Validate]. This uses the backend's `report-stale` warning (file mtimes) or report `commitSha` ≠ manifest `commitSha`; the report has no timestamp of its own.
  - **Mock**: `?state=trust` (`api/mockTrust.ts`): hand-crafted py-small results with every status, both stale kinds and one issue of each of the 12 validator codes; undocumented elements also lose their descriptions. `?state=report-stale` for the third banner.
- Tests:
  - Vitest 47 (4 new in `model/trust.test.ts`: totals and per-module counts, stale flags and per-element issues, issue ordering, explorer filtering).
  - Playwright `e2e/trust.spec.ts`: screenshots `trust-01` … `trust-05c` in light and dark, plus behaviour:
    - lens persistence across reload; explorer filter and Show all;
    - exact trust wording for all four cases; stale label; element issues; AI note → evidence;
    - issues panel: shortcut, grouping order, collapse, row navigation, close, status-bar toggle, empty state;
    - banner actions and dismissal; top-bar counts.
  - **70 passing** in total, 2 skipped (perf).
- **Visual review**:
  - *Structure lens still calm?* Yes. On a fully documented repository it looks the same as Phase 08: no marks, a green ring. With the trust data, the marks are 8–9px shapes at the right edge of rows and cards; the brightest elements are the red module chips.
  - *Least-documented module in three seconds in the Documentation lens?* Yes, now. At mid zoom the ring alone was too small to compare, so the lens shows the documented % as text beside the ring (Support 29% stands out). The summary card can cover a module at the top-right, as other floating panels can.
  - *Stale distinct from error in both themes and greyscale?* Yes: stale is a circle (filled or hollow), error a triangle. Panels and status bar use a triangle for errors and a circled `!` for warnings. In colour they are orange and red.
  - *Could an AI description be mistaken for verified fact?* The inspector always carries "AI-written · based on version …" and a status line. Map module headers show the description text without a marker; that's the one place. I made the hover title read "AI-written: …" and left the header text unmarked to keep the map calm. Revisit in Phase 11 if testers read headers as fact.
  - Fixed during review: the summary card collided with the toolbar on narrower canvases (it now sits below the toolbar row). The stale trust line was coloured `--gv-status-stale`, which is marginal for small text (now primary text; the dot carries the colour).
- Acceptance:
  - [x] Status marks, documentation lens, summary card with filtering
  - [x] Inspector trust section with exact wording and provenance line
  - [x] Issues panel with navigation
  - [x] Trust summary and three banner conditions
  - [x] Screenshots reviewed
  - `pnpm typecheck && lint && test && check:contrast && e2e` pass. No Rust changes; Rust fmt, clippy and 127 tests passed earlier in this session.
- Dependencies added: none.
- Deviations / notes:
  - Lens persistence uses `localStorage`, not `Settings`: per-repository settings would change the Rust `Settings` type, and this phase doesn't touch Rust.
  - Error triangles replace the stale mark when both apply. The slot is 16px, and the tooltip names both.
  - `components/SeverityIcon.tsx` is shared by the inspector, the issues panel and the status bar.
  - The issues panel is labelled "Issues panel" (the inspector's section is "Validation issues").
  - Banners have no error-severity case yet: the three conditions are all warnings. The error tint exists in CSS.
  - `components/TopBar.tsx`, `StatusBar.tsx`, `Explorer.tsx`, `App.tsx`, `api/mock.ts` and `store/useAppStore.ts` were edited outside the listed scope to mount the new pieces.
- Not done: the `pnpm tauri dev` check (edit a copy of py-small, Validate, watch the marks). It needs the native folder dialog, as in Phases 07–08. Please run it.

### 2026-10-30 — Phase 10 — Structural diff between two revisions

- Done (Rust):
  - `gitvur-schema`: `StructureDiff`, `ElementChange`, `EdgeChange`, `ChangeKind`, `DiffSummary` (canonical ordering), `schemas/diff.schema.json`.
  - New `tree` module (`children_by_parent`, `child_changed`), now used by both the validator (behaviour unchanged, its tests pass) and the diff.
  - `gitvur-index`: `index_inputs()`, a public predicate (backend-handled paths + `.gitignore`) so a revision copy holds only what indexing reads. Extractor behaviour is unchanged.
  - `gitvur-diff` (README documents the rules):
    - `diff(a, b)`: classification, greedy ID-sorted move pairing by hash, `childChanged`, edge changes keyed after mapping moves.
    - `revision::{index_revision, list_commits, resolve, read_file}`: `gix` reads the commit tree into a `tempfile` dir named like the repo, which is deleted on success and on error; `worktree` indexes in place.
    - `carry_annotations`.
  - CLI: `gitvur diff <repo> <A> <B> [--json] [--carry-annotations]`. The summary is grouped by module (from annotations) → file with `+ − ~ →`, plus a relationships section.
    - Real run on this repo, `HEAD~3 → HEAD`: +115 −3 ~24 →1, 0.87 s, `git status` unchanged.
  - Tauri: `list_commits`, `diff_revisions` (returns `DiffBundle { diff, from, to }`), `read_revision_source`.
    - Commit structures are cached in the app cache dir at `revisions/<hash of repo path>/<sha>-<version>.json`; the working tree is never cached, and cache failures are ignored.
    - `bundle::slice` is factored out of `read_source`. TS bindings regenerated.
- Done (app):
  - `model/diffModel.ts`: the union model (B, plus ghosts for removed elements under their old parent mapped through moves, plus removed edges), `change` on every node, steps in tree order, auto-expansion of changed elements' ancestors only, per-module counts. Edges are tagged added/removed.
  - Store: the `changes` lens swaps in the union model and restores the base model and expansion on exit (the selection is kept and revealed if it still exists). `loadDiff` ignores stale results; `stepChange`; `diffMode`. Changes is never restored from the saved lens.
  - Map, in the Changes lens:
    - classes use colour plus glyph per the prompt's table: added has a 14% fill and solid border, removed a dashed border at 55% with strikethrough, modified a 14% fill, moved a heavy border with a "moved from …" tooltip, unchanged sits at 40%, and child-only changes show a hollow ring;
    - module chips like `+1 −1 →2`;
    - status marks, error chips and rings are hidden;
    - for the selection, added edges are green, removed edges dashed red, unchanged edges at 50%, with matching arrow markers.
  - Top bar: `from [commit ▾] → to [commit ▾]` (defaults HEAD~1 → HEAD; `to` offers "Working tree").
  - Changes panel replaces the explorer: summary bar with relationship counts, changes grouped module → file with glyphs, current change highlighted. N / Shift+N step with wrap-around and centre the camera.
  - Inspector, in the Changes lens:
    - modified: an inline or side-by-side diff (LCS in `inspector/lineDiff.ts`, Shiki on both sides, line numbers from each revision, diff-token tints);
    - moved: From/To locations; removed: the old source from A; added: the source from B;
    - relationship rows tagged added/removed; removed-edge evidence read from A.
  - Mock: `api/mockDiff.json` is **generated from a real Git scenario** by `crates/gitvur-diff/tests/mock_diff.rs`, whose B equals the fixture's committed structure (asserted). The test fails if the JSON is stale.
- Tests:
  - Rust 132 total. `gitvur-diff/tests/revisions.rs` covers:
    - add, remove, modify a body, rename a function, move a function to another file, add an import, and rename a file, each classification asserted;
    - the scenario repo's files (including `.git`) are byte-identical after all revision reads;
    - determinism, worktree, list_commits, bad revision, carry-over rules, read_file.
  - Also: the CLI diff end-to-end (summary, JSON, carry-over, bad-rev exit 1) and the Tauri cache and old-source reads.
  - Vitest 54 (union model 4, line diff 3).
  - Playwright `e2e/changes.spec.ts`: screenshots `changes-01` … `changes-05` in light and dark; moved locations; leaving the lens restores the map. **80 passing**, 2 skipped (perf).
- **Visual review**:
  - *Count a module's changes without opening it?* Yes: the module chip (`+1 −1 →2`) and the Changes panel's grouping.
  - *Removed reads as "not there any more", not as an error?* Yes. The ghost is dashed, at 55%, struck through, with a `−` glyph in the diff red. The validation triangle and error chips are hidden in this lens, so red means only "removed" here.
  - *Unchanged at 40% keeps enough context?* Yes for py-small: names stay legible and module headers keep their bands. Unchanged modules dim as a whole, which makes the changed ones stand out.
  - *Greyscale?* Yes. Glyphs `+ − ~ →` are drawn in every mark, and the borders differ: solid (added), dashed and struck through (removed), heavy (moved), fill only (modified).
  - Fixed during review: side-by-side clipped code in the narrow inspector, so it now scrolls horizontally with a divider between the sides.
- Acceptance:
  - [x] Revisions read via `gix` into temp dirs; working tree untouched (tested)
  - [x] Diff classifications tested for every scenario; deterministic output
  - [x] `--carry-annotations` rewrites only moved IDs with matching hashes
  - [x] Changes lens, union rendering, auto-expand, edge diff, module chips
  - [x] Changes panel, stepping, inline and side-by-side source diff
  - [x] Screenshots reviewed
  - `cargo fmt`, `clippy -D warnings`, `cargo test`, and `pnpm typecheck && lint && test && check:contrast && e2e` all pass.
- Dependencies: `gitvur-diff` now depends on `gix` (same version as `gitvur-index`, adding the `revision` feature for rev-parse and rev-walk), `tempfile` (temp revision copies with cleanup on drop; it was already a dev-dependency elsewhere) and `thiserror` (as in the other crates). `serde_json` is a dev-dependency for the mock generator.
- Deviations / notes:
  - **Renaming a function is `removed` + `added`, not `moved`**: the hash covers the `def` line, so a rename always changes it. The prompt's rule (identical hash) is followed; renamed or moved *files* keep their text and are detected as moves (tested). Detecting renames would need a body-only hash, which is a contract change.
  - Tests build throwaway repositories with the `git` CLI (hooks and global config disabled). The code under test reads Git only through `gix`.
  - `diff()` leaves `fromCommit`/`toCommit` empty; callers fill them (the CLI and Tauri use full SHAs or `worktree`).
  - Ghost elements sort among their siblings by their line in A. That is their old position, so a removed function can appear between B's functions.
  - The status bar's node/edge counts include ghosts while the lens is on.
- Not done: the `pnpm tauri dev` check against a real repository with history (native dialog, as before). Please open a repo there, choose Changes, and step through with N.

### 2026-10-30 — Phase 11 — UX polish: search, keyboard, states, accessibility

- Open items from Phases 06–10, first:
  - Fixed: the help dialog now renders `codeDOC.md` as Markdown. A small parser (`components/markdown.ts`) produces React elements, never HTML strings; 3 tests.
  - Still parked, with reasons:
    - edge routing around module headers (a layout change);
    - an on-canvas AI marker for module descriptions (waiting on testers);
    - the 15-edge focal-point check on the synthetic repo was **not done** this session.
- Done:
  - **Palette** (`search/`):
    - Ctrl/Cmd+K, 640px, near the top, `--gv-shadow-float`;
    - fuzzy search over names, qualified names and paths, plus description words; results grouped by kind with glyph, name (matches highlighted), qualified name, path and status dot;
    - Enter selects and centres, Ctrl+Enter selects only;
    - `>` commands: open, index, validate, the three lenses, expand/collapse all, toggle theme, show issues, shortcuts, reset view, show guide, about.
    - The index is built once per model when it loads. Timing on 5,250 elements: 0.8–12 ms per query (unit test, after one warm-up: median of 5 runs per query < 30 ms; slowest single run < 100 ms).
  - **Keyboard map**, matching the table exactly (the sheet renders `SHORTCUTS` from `copy.ts`):
    - Ctrl/Cmd+O; arrows on the canvas move focus to parent / first child / siblings among nodes on the map, bringing the target into view (Tab focus does too);
    - Enter expands or collapses a file, or folds a class (new map-only `collapsedIds`, threaded through layout, flow and edge lifting);
    - Space selects; Esc closes the guide, then the drawer, then clears the selection (dialogs close natively);
    - F / 0 / + / −; 1 2 3 lenses; ? for the sheet.
    - Toolbar tooltips name their shortcuts.
  - **Persistence**, per repository, in the app data folder (`views/<hash of canonical root>.json`, Tauri commands `get/set/clear_view_state`), never in the repository:
    - saves expanded IDs, folded classes, selection, viewport, lens, diff range and pane widths, debounced on change;
    - restores on open, silently dropping IDs that no longer exist; the Changes lens restores with its saved range when both revisions still exist;
    - ⋯ → Reset view clears the file and returns to the default view.
    - This replaces Phase 09's localStorage lens.
  - **States** (`copy.ts` holds all messages, state texts, banners, trust lines, guide, palette and shortcut texts):
    - every `AppError.code` maps to a title, sentence and action, with the backend text behind a Details disclosure;
    - a lost folder is removed from recents (`forget_recent`) and says so;
    - "No Python or TypeScript files found.";
    - empty search: "No matches for …" with a hint about descriptions;
    - a banner above 20,000 elements suggests the Changes lens;
    - busy states use an indeterminate bar.
  - **First-run guide**: three non-modal coach marks (explorer, map, lens), Skip/Next/Done, no transitions. It shows once (`Settings.guideSeen`, stored in the global settings file) and again from ⋯ → Show guide.
  - **About**: version, Gitvur's build commit (injected by Vite from `git rev-parse` at build time), source URL with Copy link, and the MIT text.
  - **Window title**: `Gitvur — <project>` via the Tauri window API (capability `core:window:allow-set-title`).
  - **Accessibility**:
    - map nodes have `aria-label`s ("function receipt, documented"; "method …" for methods);
    - every control outside the map is at least 24×24 (permanent e2e check);
    - reduced motion removes camera and coach-mark animation, including the toolbar zoom buttons.
    - axe (`@axe-core/playwright`, WCAG 2.1 A/AA tags) reports **zero serious or critical violations** on 7 views in both themes: no repository, map, inspector with selection, trust + issues drawer, Documentation lens, Changes lens, palette.
- Fixed for axe (deviations from earlier phases' specs, for WCAG AA):
  - Receded map context no longer fades text with `opacity`. The selection dimming (Phase 08's 0.28), unchanged nodes in the Changes lens (Phase 10's 40%) and removed ghosts (55%) now share one style: tertiary text (AA), subtle borders, a grey module band, and glyphs and chips at `--gv-opacity-dimmed`.
  - Light `--gv-diff-added` and `--gv-diff-modified` were darkened (#1f8a3d → #1b7f37, #a86a00 → #9c6200): as text on white they were 4.41 and 4.44:1.
- Tests:
  - Rust 134 (view state round trip and reset; forget recent).
  - Vitest 61 (search 4, markdown 3).
  - Playwright `e2e/polish.spec.ts`: palette, keyboard, persistence and reset, error details, lost folder, window title, guide, hit targets, axe × 7 views. **108 passing** in both themes, 2 skipped (perf).
- **Final visual pass** (all screenshot sets from Phases 06–10 re-captured, plus `polish-01` palette, `polish-02` shortcuts, `polish-03` error details, `polish-04` guide step 2, light and dark):
  - *Exactly one accent for interaction?* Yes. `--gv-accent` covers selection, focus rings, primary buttons, the active palette row and match highlight, the guide border and the progress bar. Status, provenance and diff hues carry meaning only.
  - *Type sizes on the token scale?* Yes: no raw `font-size` values in the CSS. SVG glyph text uses viewBox units.
  - *Spacing on the 4px grid?* Now yes. Nine off-grid paddings and gaps (2, 5, 6, 1 px in chips, pills and bars) moved to `--gv-space-1`. The one exception is the 6px padding that gives the 12px summary bar a 24px hit area (commented).
  - *One product or five phases?* Inconsistencies found and fixed:
    1. three different "receded" treatments (now one);
    2. a spinner in busy states but bars elsewhere (now one indeterminate bar);
    3. raw Markdown in help;
    4. coloured counts below AA;
    5. off-grid chip paddings;
    6. the toolbar Fit/zoom ignoring reduced motion while navigation respected it;
    7. the guide card covering the inspector.
  - Remaining, by choice: drawers and banners close with an icon button, dialogs with a text "Close". The compact surfaces use icons; modals use text.
- Acceptance:
  - [x] Palette with search and commands, under 30 ms on synthetic
  - [x] Full keyboard map implemented; shortcuts sheet matches it
  - [x] Per-repo persistence with safe restore
  - [x] Every state in Part D designed; copy centralised
  - [x] First-run guide
  - [x] axe: zero serious/critical violations in both themes
  - [x] Final visual pass recorded and inconsistencies fixed
  - `cargo fmt`, clippy, `cargo test`, `pnpm typecheck && lint && test && check:contrast && e2e` pass.
- Dependencies added: `@axe-core/playwright` 4.11.1 (dev; named in the prompt).
- Deviations / notes:
  - **Indexing progress has no file count**: the extractor reports none, and Rust crates are out of scope this phase. The bar is indeterminate, as the prompt allows when no count is known.
  - `copy.ts` holds every message and sentence. One- or two-word control labels (Fit, Index, Close) stay beside their controls, as the file's header says.
  - The repo link in About is shown and copyable, not opened: opening URLs would need the Tauri opener plugin, and the viewer never navigates its own window.
  - The 24px check excludes map content, which scales with zoom (24px at 100%).
  - Backend changes (allowed for persistence): `ViewState`/`Viewport` types and commands, `Settings.guideSeen`, `forget_recent`, the set-title capability. TS bindings regenerated.
- Not done: the keyboard-only session in `pnpm tauri dev` (native dialog limit, as before). Please run one, including Ctrl+O, which opens the native picker.

### 2026-10-30 — Review of Phase 11 (`/code-review`, fixes)

- Receding (dimmed or unchanged nodes) no longer hides the selection. It also now outranks the Documentation and Changes lens tints and borders: lens cues keep their dashed shape but switch to neutral colours. Glyphs, chips and status dots keep their meaning colour (errors stay red) and only fade.
- Breadcrumbs: dropped `inline-flex`, so long names show "…" again. Kept the 24px height through `min-height`.
- Resize handles: the 24px pointer area reaches only into the canvas, no longer onto the explorer's scrollbar or the inspector's content.
- Summary bar: each segment is a 24px-tall transparent button, and `::before` draws the 12px bar with its fill, outline and pressed ring. The bar's −6px margin keeps the card's spacing. This replaces the padding and `background-clip` hack that broke outlines and corners.
- Hit-target sizes are now set in the original rules. The duplicate overrides at the ends of `canvas.css` and `inspector.css` are removed.
- New `canvas/motion.ts` (`cameraDuration`) is shared by the map, toolbar and minimap. The minimap now respects reduced motion.
- Guide: a card beside a small target flips to the target's left when it would not fit on the right.
- Search perf test: also asserts the slowest single run is < 100 ms.
- `pnpm typecheck && lint && test && check:contrast` pass. `e2e` passes except `states › structure only`, which is flaky (about 1 run in 5, before and after these changes) because `getByText('0% documented')` matches two elements. Review screenshots were regenerated. Not checked in `pnpm tauri dev`.

### 2026-10-30 — Project orientation and merge preparation

- Read the project guide, prototype plan, phase prompts, crate and layout documentation, documenting-agent instructions, fixture notes, and evaluation material.
- Current state: Phases 01–11 are implemented; Phase 12 has evaluation tooling and extraction/diff measurements, but documentation runs, human ratings, staleness results and viewer measurements remain unfinished. The documenter isolation limitation is recorded in `eval/PROTOCOL.md`.
- Preserved the existing Phase 13–16 feature prompts (Docs, flow data, Flows UI, Timeline) and their prompt-index additions as future plans; no feature implementation started.
- Integrated the latest `origin/phases-01-05` evaluation note by fast-forward before preparing the existing pull request for merge into `main`.
- Validation: `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, and `pnpm typecheck && pnpm lint && pnpm test && pnpm check:contrast` pass. Frontend: 61 tests; contrast: 243 checks. No product code changed in this session.
- Open work: finish Phase 12 evaluation and human ratings; future feature prompts are not evidence that those features exist.

### 2026-10-30 — Phase 13 — Docs tab and safe repository Markdown reader

- Done:
  - Accessible Map / Docs tabs with arrow-key navigation, Ctrl/Cmd+1 / 2, palette commands and per-repository persistence. The map stays mounted, so its camera, selection and lens survive tab switches. The last document and reading position persist in the existing app-data view file, with a pagehide flush.
  - `gitvur_index::discover_docs` reuses the existing walker without changing source extraction, the v0.2 contract, validator or map layout. Root README first, then `docs/` / `doc/`, then remaining paths; `.md` and `.markdown`, title from the first 4 KB and file metadata.
  - Generated command bindings for read-only `list_docs`, `read_doc` (2 MB) and `read_doc_asset` (5 MB). Canonical paths stay inside the repository; traversal, absolute escapes, unsupported image types and symlink escapes are rejected. SVG assets are image sources only.
  - react-markdown + GFM + heading slugs + rehype-sanitize, with raw HTML skipped and no rehype-raw. Safe app-handled links and anchors, exact unique code mentions with context cards, innermost source-range navigation, folder filtering and confirmed HTTP(S)/mailto opening through the opener plugin.
  - Shared Shiki engine/themes, fenced-code grammars loaded on demand, copy controls, strict lazy Mermaid rendering with token-based colours. Mermaid resources/config overrides are refused before rendering; the resulting diagram is an image and unsupported diagrams keep their source.
  - Local images use the bounded backend. Remote images require per-document opt-in and send no referrer. The CSP permits HTTP(S) images for this explicit opt-in; Markdown never creates a remote image before it.
  - Folder-grouped document list, pinned README, comfortable prose tokens, heading anchors, h2/h3 outline with scroll-spy and a narrow-window outline button. Tables scroll within the reader; native review led to minimum cell widths to keep narrow column headings readable.
  - Worker-built headings and backlinks, including reference-style Markdown links, capped at 500 documents and 2 MB each. Documents are read in batches of four, with cancellation on repository changes and indexing/error status. Palette searches titles/headings; file/module inspectors link to their first mention.
  - Fixture README, architecture guide and local SVG added; existing fixture source, golden output and `.gitvur/` data remain unchanged. The unsafe Markdown fixture is under `app/e2e/fixtures/`.
- Fixes found during verification:
  - Vite selected a DOM-dependent entity decoder for the Markdown worker. It now resolves the decoder's equivalent DOM-free entry.
  - Restoring a view could overwrite an early interaction or hide a selected file after module assignments changed. Saved state now loads before exposing the model, and the selected element's current ancestors are expanded.
  - Search could close again when reopened immediately after Escape. Its native cancel/close handling now keeps the store and dialog in sync; repeated tests in both themes pass.
  - Added accessible names for read-only task-list checkboxes, adjusted selected-path contrast, and gave backlink buttons a minimum hit area. Existing regression selectors now account for tabs and the extra shortcuts.
- Acceptance:
  - [x] Tabs, shortcuts, preserved map state and saved reader state
  - [x] Shared discovery policy and ordering
  - [x] Sanitized rendering, URL handling and security tests
  - [x] Link resolution, code mentions, confirmation and map navigation
  - [x] Mermaid, Shiki, local assets and explicit remote-image loading
  - [x] Worker backlinks and palette integration
  - [x] States and documentation updates
  - [x] All six screenshot scenes in light/dark at 1440×900 and 1280×720 captured and reviewed
- Visual review:
  - The 72ch reading column and 15px / 1.65 prose feel like a document. Tables stay inside their own scrolling container.
  - Tabs, surfaces, spacing and focus use the existing tokens; the reader shares the app's single interaction accent.
  - Dotted code mentions stay quieter than explicit links. Hover cards fit the reviewed viewports without clipping.
  - Mermaid uses the app's surfaces, borders and text colours in both themes. Its image output cannot execute diagram interactions.
- Validation:
  - Rust fmt, workspace clippy (`-D warnings`) and workspace tests pass, including discovery ordering/ignore policy, byte caps and existing-file symlink escapes. Existing Python/TypeScript goldens and schema/binding drift checks pass.
  - Frontend typecheck, lint, **69 Vitest tests**, and **243 contrast checks** pass. The production build passes; Mermaid/language assets stay dynamically loaded (Vite reports its normal large-chunk advisory).
  - Full Playwright regression: **118 passed, 2 skipped** (the existing opt-in performance checks). Subsequent targeted Docs runs pass after final rendering/security/table refinements. Axe reports zero serious/critical issues in the new reader views.
  - `pnpm tauri dev` launched successfully. Opened the real `fixtures/py-small` with the native picker, switched to Docs, read the repository notes, and used document search to open the architecture guide; its Mermaid diagram and table rendered correctly in WebKitGTK at a narrow tiled window. Browser tests exercise the remaining link types and mocked external opening; no real external browser launch was performed.
- Dependencies:
  - Prompt-named frontend: react-markdown 10.1.0, remark-gfm 4.0.1, rehype-slug 6.0.0, rehype-sanitize 6.0.0, mermaid 12.2.0; opener bridge/plugin 2.7.2.
  - `unified` 11.0.5, `remark-parse` 11.0.0 and `github-slugger` 2.0.0: parse Markdown for the worker and match rendered heading IDs, rather than guessing links/mentions with regular expressions.
  - `decode-named-character-reference` 1.3.0: explicitly resolve the parser's DOM-free decoder for worker compatibility.
  - Rust `base64` 0.22.1: encode bounded image bytes as data URLs without a custom encoder.
- Deviations / assumptions:
  - Phase 12 remains unfinished; Phase 13 is independently implemented as the user requested.
  - Necessary integration edits extend the shell, API/mock adapters, state, palette, copy, tokens and shared highlighter in addition to the phase's named folders. No extractor output, contract schemas, validator or map-layout semantics changed.
  - `modified` crosses the bridge as Unix seconds encoded as a string, formatted locally for display.
  - Safe parent-relative image paths within the repository are allowed; escapes are rejected after normalization/canonicalization. Leading `/` means repository-root-relative, as the prompt specifies.

## Phase 14 — Parts A–B, fixture review checkpoint (2026-10-30)

- Phase 13 pushed and merged: PR #2, https://github.com/ibrahimAlsalimi/gitvur/pull/2,
  merge commit `86e89d35a992832e0d1ea905e485877b93529d2a`. Both CI runs succeeded.
- Branch: `phase-14-entry-points`. Added contract v0.3 entry/flow/report types, schemas,
  and backward compatibility with committed v0.2 bundles. Flow step reading order stays
  intact. Trace, flow validation, packet updates and agent instructions await Parts C–F.
- Added deterministic Python main guards/package main/config console scripts and
  TypeScript package/bin/npm/top-level entries. Configuration is parsed as data, never
  executed. Configs follow the source walker's ignore/symlink policy and are included
  in revision indexing. Unindexed paths stay null; ambiguous calls retain candidates.
- Created py-flows and ts-flows source fixtures and hand-derived expected structures
  BEFORE implementing extraction. A temporary helper only computed hashes of explicitly
  chosen source ranges; it did not parse or extract. Initial entry tests failed as
  expected before implementation; final full-structure comparisons pass without
  rewriting the goldens. Fixture NOTES.md explains each entry and agent-only wiring.
- Compatibility plumbing updates Rust constructors, app bundle version acceptance and
  generated bindings. No app UI features changed. Both existing fixture directories
  remain untouched; old graph tests compare the v0.2 projection, and the browser diff
  snapshot retains its v0.2 scenario. Full v0.3 output has separate new fixture goldens.
- Checks: cargo fmt, workspace Clippy with warnings denied, cargo test --workspace;
  app generated binding check, typecheck, lint and all 69 Vitest tests. Targeted coverage
  includes every static entry kind, deterministic output, exact config evidence,
  ID collisions/source order, nested runtime scope exclusion, malformed/ignored configs,
  escaping paths, shell text never executed, and v0.2/v0.3 bundle compatibility.
- Limits: Python console module lookup is config-directory-relative (no src-layout
  inference). Simple npm runner/path prefixes only; flags before paths, variable
  expansion and spaces inside paths are not interpreted. Conditional exports string
  leaves are supported; arrays are not. Ambiguous-only top-level TS statements retain
  entries so their unresolved sites have stable owners. See schema/index READMEs.

HUMAN REVIEW REQUIRED before Part C: fixtures/py-flows/expected/, fixtures/ts-flows/expected/

The phase prompt explicitly requires stopping here. Review both expected/structure.json
and expected/NOTES.md pairs before continuing Parts C–F in a new session.

## Repository usage guide (2026-10-30)

- Added `docs/USING_GITVUR.md` and linked it from the root README. Covers supported
  languages, one-time CLI/desktop setup, indexing any selected repository root, map/docs
  navigation, optional isolated-copy AI documentation, incremental refresh, structural
  diffs, output ownership and troubleshooting. Clarifies the Phase 14 checkpoint limits.
- Verified commands against the CLI parser/help, UI labels against components, local
  Markdown links and `git diff --check`. Documentation only; no runtime code changed.
- Phase 14's fixture review gate remains pending; no Parts C–F work was started.

## Phase 14 — Part C: deterministic trace (2026-10-30)

- User explicitly requested Part C after the A–B checkpoint. Implemented Part C only;
  Parts D–F and the Flows UI remain pending. Existing/new fixture source and goldens
  remain unchanged.
- Added `gitvur-flow` with `trace(&Structure, start, &TraceOptions)` and defaults depth
  6 / 300 occurrences. Function entry targets plus direct calls form roots. Traversal
  follows syntactic calls, optional semantic calls, never AI edges. BFS allocation
  ensures shorter paths win. Source locations then IDs determine child order.
- Shared nodes produce refs; ancestor back-edges produce cycles; unresolved sites produce
  ambiguous stubs with sorted candidates. Entry-owned ambiguities are retained too.
  Depth/budget omissions record immediate hidden children, or hidden roots for a root
  budget. Zero and exact limits are defined and tested. Unknown IDs return an error.
- Added shared Trace/TraceNode/TraceKind types, `schemas/trace.schema.json` and generated
  TypeScript bindings. Tree JSON uses an occurrence arena with root/child IDs and first
  occurrence refs, avoiding recursive serialization for deep traces. No app UI changed.
- Added read-only CLI `trace` (text/JSON, limits, semantic opt-in) and `flows`. They freshly
  index current source, safely read optional annotations and merge entry IDs. Neither
  writes the target repository. Malformed/outside-root annotations and duplicate entry
  IDs fail explicitly. Agent edges never enter the executable graph.
- Flow listing status is deliberately `unchecked`: accurate current/stale/broken status
  requires Part D. No stale saved report is presented as a fresh flow validation result.
- Verification: seven trace integration tests cover both new fixture chains, recursive
  and shared paths, ambiguity, provenance, shuffled input determinism, source ordering,
  duplicate calls, null/file targets, node/depth limits and a 1,000-node trace round-trip.
  Four CLI integration tests cover text markers, canonical JSON, unknown-ID exit codes,
  limits, AI/static entry listing, external annotation symlinks and absence of writes.
  Workspace fmt/Clippy (warnings denied)/tests passed; generated bindings passed;
  app typecheck/lint and all 69 Vitest tests passed. CLI smoke examples also passed.
- Added the crate README and schema rules; updated CLAUDE.md and the repository usage
  guide with the available commands. The usage guide/README link from the prior request
  is included in this checkpoint. No new third-party dependency version was added;
  the CLI promotes its existing serde_json dev dependency to runtime to read annotations.

## Phase 14 — Parts D–F: flow validation, packet, agent workflow, docs (2026-10-31)

- Branch `phase-14-flows-validation`, from `main` after PR #3 (Parts A–C). Phase 14 is now
  complete. The reviewed py-flows/ts-flows goldens and the py-small/ts-small data are unchanged.
- **Part D.** `gitvur-flow::check_flows` (pure; evidence read through an `EvidenceSource`
  trait) checks agent entry points and flows; the validator wires it in with its path-safe
  file cache and writes `report.flows` (`current | stale | broken` + `staleSteps`). All 17
  prompt codes are implemented and documented in the validator README. Entry points get
  `documented`/`undocumented` elements by whether a flow starts from them. `gitvur flows`
  now shows fresh statuses, stale steps and each broken flow's errors (still writes nothing).
- **Part E.** `codeDOC.md` section 11 "Execution flows" (agent entries, choosing flows,
  building from the trace, steps, branches, incremental mode, done-means); sections 2/8/10
  reference it. `gitvur packet` adds `entryPoints`, one default-limit `traces` entry per
  entry point (static + agent), and in incremental mode `staleFlows`/`brokenFlows` with issue
  codes and messages.
- **Documenter section.** Followed codeDOC on isolated scratch copies: initial packet, read
  every source file, hand-wrote modules (5 each), descriptions (28 py / 25 ts), entries and
  flows; a helper only copied `contentHash` → `basedOnHash` from the packet. Committed the
  resulting `.gitvur/` for both fixtures: **0 errors, 0 warnings**, incremental packet empty,
  every flow `current`; committed `structure.json` is byte-identical to the reviewed golden.
  - py-flows: AI `http-route` POST /orders; flows `cli-places-order` (6 static calls + `saved`
    event), `http-order-request` (call, return, event), `backends-self-check` (AI branch "when
    run as a script" into `Cache.save`, resolving the ambiguous `sink.save`).
  - ts-flows: AI `http-route` POST /orders and `other` countdown; flows `cli-places-order`
    (file → main is backed by the top-level-call entry; `saved` event registered by `bus.on`),
    `http-order-request`, `countdown` (static branch + recursive call).
- **Part F.** Plan: in-scope bullet, "Execution flows" section with the split table, layout
  and CLI updates, Phase 14 amendment refreshed. CLAUDE.md: entry/flow IDs, v0.3 summary,
  flow section replacing the checkpoint note. Schema/flow READMEs and usage guide updated.
- Tests: `gitvur-validate/tests/flows.rs` — zero-issue baseline, every code (29 mutation
  cases, broken status asserted for flow errors), 60-char label boundary, edit `submit` →
  only `flow:cli-order` stale with `["s2"]`, delete it → broken while others stay current,
  determinism, and the committed fixture `.gitvur/` stays issue-free. Packet unit test for
  entries/traces/flow work; CLI tests for current and broken listings.
- Checks: cargo fmt, workspace Clippy (`-D warnings`), **163 Rust tests**; app bindings
  drift check, typecheck, lint, **69 Vitest tests**. Prompt Verify commands run. Re-indexing
  and re-validating both fixtures reproduces `structure.json`/`report.json` byte for byte.

Acceptance criteria:

- [x] Contract v0.3; 0.2 files load (tested in Part A); schemas regenerated
- [x] Every entry kind detected; flow goldens pass after human review; determinism holds
- [x] py-small / ts-small goldens unchanged and passing
- [x] `gitvur-flow::trace` with refs, cycles, ambiguous stubs, truncation (Part C)
- [x] Every new issue code tested; flow staleness scenarios pass
- [x] codeDOC section and packet extensions; both fixtures documented with zero errors
- [x] Plan and CLAUDE.md updated

Deviations / assumptions:

- Static (`syntactic`/`semantic`) `branch`, `event` and `async` transitions must be backed
  by a call edge like `call` (reported as `flow-call-unsupported`); otherwise a "syntactic"
  branch would be a guessed relationship. A static entry's `calls` from its target file
  count as structure calls, so flows can start at a script file.
- Extra safety codes, mirroring the AI-edge ones: `entry-bad-id`, `entry-bad-provenance`,
  `entry-evidence-out-of-range`, `entry-evidence-mismatch`, `flow-bad-id`. Agent entries may
  use a static kind (e.g. a `setup.cfg` script the extractor doesn't read); that is what
  makes `entry-duplicates-static` reachable.
- Entry elements are left out of `summary` counts and `gitvur stale`: not every entry needs
  a flow, so coverage still means nodes and modules. Element IDs start with `entry:`.
- The prompt asks to add the codes to "the UI copy list"; the app has none (issues render
  their message), so nothing changed in the app. Phase 15 can add per-code copy.
- "2–3 flows each including one event and one branch": read as each fixture having both.
  The fixtures' only TS conditional is `countdown`, which has no caller, so ts-flows uses an
  `other` entry for it; codeDOC 11.1 now limits `other` to exported functions with no
  in-repo caller that a flow needs. Fixture sources were not changed.
- A flow with zero steps produces no issue (and is `current`).

Open questions:

- Should `gitvur flows` mark agent vs extractor entries, and should the summary gain flow
  counts? Both are UI-facing; deferred to Phase 15.

## Phase 15 — Flows tab (2026-10-31)

- Branch `phase-15-flows-tab`, stacked on `phase-14-flows-validation` (PR #4, open). The user
  restored `fixtures/py-small/.gitvur/` (rewritten outside this session by an Index/Validate
  run); frozen fixture data is unchanged in every commit.
- **A.** Tauri `get_trace` wraps `gitvur_flow::trace` over the repository's `.gitvur/` plus agent
  entries (limits clamped). `ViewState` saves `flowSelection` and `flowMode`. `model.flows`
  indexes entry points, flows by entry, statuses (report first, hash fallback) and
  `flowsThroughNode`. The mock serves `mockTraces.json`, generated from the real engine by a
  drift-checked test.
- **B.** Third tab (`Ctrl/Cmd+3`): list grouped by entry (kind glyphs, target, AI pill,
  out-of-index entries greyed with `raw`), nested flows with step count and status, filter over
  entry names, flow names and step labels. First visit opens the first listed flow, or an
  entry's trace when there are no flows.
- **C.** `layoutFlow` (pure, layout worker): lanes by first appearance, longest-path ranks,
  DFS back-edges as loop-backs, side-by-side siblings, orthogonal rounded routing, label side
  switching. Step cards (badge, 2-line label, code line, location, stale dot, entry pill + tag,
  terminal bar, ghost card for missing elements); transitions by provenance stroke and kind
  marker (filled, open/thin for return, double chevron, diamond for branch, ⚡ chips, hover
  "calls"/"returns", AI pill). Pinned lane headers, header with summary chip, stale/broken
  banners, collapsible legend drawn with the real styles.
- **D.** Playback machine (`playback.ts`): Next/Previous/Play/Restart, `J K Space Home`,
  branch pauses with the labels plus "otherwise", declined targets dimmed, Play every 1.6 s
  stopping at branches and the end. Rail with forks and jump-to-dot. Active/visited/upcoming
  states, 600 ms travelling dash, camera keeps the active step in the middle third; reduced
  motion drops both. The inspector selects the active step's element and shows Step context:
  "Called from step N · name line L" with the call site (or "AI evidence") highlighted.
- **E.** Trace mode (`T`, badges "Derived from code · no AI" / "AI-curated · validated"), compact
  cards in the same lanes, depth-2 start with `+n` expanders, on-demand `get_trace` grafted
  into truncated subtrees, ref / cycle (dashed loop) / ambiguous stubs with candidates, Copy
  trace as text (byte-identical to `gitvur trace`).
- **F.** Pin to map: numbered badges on each step's visible element, accent path clipped to card
  borders, unrelated nodes dimmed, bottom chip with prev/next/✕. Inspector: "Flows through
  here" (opens the flow at that step) and "Trace from here".
- **G.** Copy as Mermaid (`flowchart TD`, subgraph per lane, dashed AI edges, labelled
  event/async/branch, comment header with repo, commit and status); unit-tested and parsed by
  the bundled mermaid grammar. SVG/PNG at 2× of header + diagram + legend in the current theme,
  written only via the save dialog by `write_export`, which refuses paths inside the repository
  (symlinks resolved) and non-.png/.svg names.
- **H–I.** All state strings in `copy.flows`. Tokens `--gv-flow-lane-alt`, `-step-active`,
  `-visited`, `-rail` in both themes; `check:contrast` now 259 checks (text on the new fills,
  visited/rail as meaning colours). Steps focusable in reading order with the prompt's
  `aria-label`; arrows move along transitions; List view as the text alternative; axe reports
  no serious/critical issues in either view.
- **J.** Unit: layout (lanes, ranks, back-edges, siblings, label sides, budgets), Mermaid,
  playback (linear, call-then-event, return, branch, otherwise, recursion, restart/jump), trace
  view and graft merge, flow index, export encoding. Playwright `e2e/flows.spec.ts` (light and
  dark): every flow of both fixtures played to the end, a branch taken and declined, step
  context, stale/broken states, cycle and ambiguous stubs, expansion, copy trace, pin to map,
  flows through here, trace from here, Mermaid, PNG export, empty and out-of-index states,
  keyboard, list view, axe.
- Checks: cargo fmt, workspace Clippy (`-D warnings`), **168 Rust tests**; app typecheck, lint,
  **100 Vitest tests**, `check:contrast` (259), full Playwright **134 passed, 2 skipped** (the
  existing opt-in performance checks). Regenerated screenshots of existing views now show the
  third tab.
- Budgets (Vitest, Node): a 25-step flow lays out in well under 30 ms; a 300-card trace tree
  in about 45 ms (budget 150 ms). **Not measured:** pan frame rate on Linux, and a native
  `pnpm tauri dev` run (real save dialog, `get_trace` over IPC). Both should be checked by hand.
- Dependency: `html-to-image` 1.11.13 (named by the prompt). Test-only: Vitest aliases
  `dompurify` to a pass-through stub and inlines mermaid, so the real flowchart grammar runs in
  Node (no jsdom added).

Deviations / assumptions:

- Lanes appear only for 2+ modules; a one-module flow is a single centred column without a
  header. Lane header shows the number of steps in the lane.
- The canvas fit keeps zoom ≥ 0.8 so labels stay readable; wider flows start at the top-left
  and pan (wheel pans, pinned lane headers follow). Fit-to-all would drop 4-lane flows to
  about 0.64 at 1440 px with the inspector open.
- The legend starts collapsed (it covered small diagrams) and is opened for exports.
- Back-edges into a lane to the left enter the target's right side; into a lane to the right,
  its top.
- The mock's `?state=flow-stale|flow-broken` edits only its in-memory py-flows copy, for the
  stale/broken screenshots. The fixtures have no trace with a `ref` stub (no shared callee
  under one root), so screenshot 5 shows a cycle and an expanded ambiguous call; refs are
  covered by unit tests of the shared trace code and the click-to-focus wiring.
- "Trace from here" lives in the inspector header (for steps too, via their element) rather
  than a separate context menu.
- `incomingEvidence` takes a static step's call-site line from the structure edge; a step
  reached from a script file through an entry's top-level call has no edge evidence and shows
  "From step N" without a code excerpt.

Visual review (screenshots in `app/e2e/__screenshots__/{light,dark}/flows-0*.png`):

1. *Can you explain the flow at rest in 30 seconds?* Yes for 1–3 lanes. For 4 lanes at
   1440×900 with the inspector open, the last lane needs one pan; the List view or collapsing
   the inspector shows everything. Accepted for readability (see fit above).
2. *Is the step label read before the function name?* Yes: 13 px semibold label above an
   11.5 px tertiary code line; the 2-line clipping found in the review was fixed (card heights).
3. *Code-derived vs AI without the legend, in greyscale?* Yes: AI lines are dashed and carry an
   "AI" pill; static lines are solid. Kind does not depend on colour (markers, ⚡, diamond).
4. *One cursor, or a jumping camera?* One cursor: the camera only moves when the active step
   leaves the middle third, with a 500 ms ease; the travelling dash shows where it came from.
5. *Do lanes help or add noise?* They help from 3 lanes on; single-module flows drop them.
   Alternate fills are subtle; lane bands match the map's module colours.
6. *Is the export README-ready?* After the fix below, yes: header, lanes, typed lines, chips
   and legend in the current theme. The canvas area below short diagrams is kept as is.

Fixed during the review: list play glyph read as a disclosure arrow (now circled); duplicate
file name on file steps; legend over steps; mid-canvas floating diagrams; inspector blank
during playback and step-context spacing; map chip over the map toolbar; map path lines over
card text (now border to border); export lost SVG styles (lines invisible, lanes black, hover
chips shown) because html-to-image clones SVG without computed styles (now inlined before
capture); return edge entering its caller's top over the call line; clipped two-line labels.
No label overlaps were recorded by the layout for the fixture flows.

Also fixed for PR #4 (cherry-picked and pushed to `phase-14-flows-validation`): the committed
fixture report test compared `commitSha`, which changes with every commit.

Open questions / parking lot:

- Map pin does not refit the camera to the pinned path; badges are small at the overview zoom.
- Exports keep the empty canvas area below short diagrams; cropping to the content would
  need a sized off-screen render.
- Forward edges that skip ranks run straight down the target column and can pass behind
  intermediate cards in that lane (not seen in the fixtures).

## C and Go extraction (2026-10-31)

- User request (no phase prompt): add C and Go to the extractor so C repositories such as
  `~/Projects/cprac-git-test2` get maps, traces and flows. Branch `languages-c-go`, stacked on
  `phase-15-flows-tab`.
- Test first: new fixtures `fixtures/c-small` and `fixtures/go-small` with
  `expected/structure.json` and `NOTES.md` written by reading the source **before** the
  backends existed; a helper only hashed declared line ranges. Both goldens passed unchanged on
  the first implementation run. **HUMAN REVIEW REQUIRED:** `fixtures/c-small/expected/`,
  `fixtures/go-small/expected/`.
- Backends `lang/c.rs` (tree-sitter-c 0.24.2) and `lang/go.rs` (tree-sitter-go 0.25.0), tree
  walks rather than `.scm` queries (declarator and receiver unwrapping). Rules in the index
  README: C program-wide linkage with `static` files-only, includes relative then by unique
  path suffix, never bare `<x.h>`; Go package = directory, imports through `go.mod` module paths
  only, method receivers, imports to every file of a package; `main` entry points.
- Shared core: `LanguageBackend::name_scope` (`File` | `Package` | `Program`); `Definition`
  gains `receiver` (Go methods declared apart from their type keep `T.M` IDs) and `internal`
  (C `static`); `ParsedEntry.target` lets an entry target a definition. Python/TypeScript keep
  `File` scope: their goldens and every existing test are unchanged.
- Contract (additive, within v0.3): `manifest.languages` gains `c` and `go`; entry kind
  `main-function`. Schemas and TypeScript bindings regenerated; the Flows list maps the new kind
  to the play glyph. App: C/Go source language, Shiki `c`/`go` grammars, `c`/`go` file marks
  (one shared `languageOf`).
- Real repository: `cprac-git-test2` (written nowhere; indexed into a scratch folder) now gives
  13 files, 18 functions, 4 structs, 15 call and 11 include edges, its `main` entry, and a
  trace across cpu/mem/term/ui with a shared-callee ref stub; no parse warnings.
- Checks: cargo fmt, workspace Clippy (`-D warnings`), **174 Rust tests** (6 new); app
  typecheck, lint, 100 Vitest tests.
- Again found `fixtures/py-small/.gitvur/` rewritten (16:20:45–46, index then validate, as at
  15:31); no test or script in the repository writes there, so it looks like Index/Validate in
  a running app. Restored with `git checkout` as the user asked the first time; not committed.

Open questions:

- Go: the imported package's local name is the path's last segment, not the `package` clause
  (they almost always match in one repository). C: function-like macros and calls through
  function pointers are invisible; headers shared by several programs make same-named
  functions ambiguous by design.
- Partial extraction of files with syntax errors would help C most (macros can confuse the
  parser); still parked.

## Phase 15 — merge and verification follow-up (2026-10-31)

- Read the existing phase records: Phase 15 was already implemented, so resumed its
  verification rather than rebuilding it. Pushed `phase-15-flows-tab` and `languages-c-go`;
  merged PR #5 (Flows tab) and PR #6 (C/Go) into `main`. Local main fast-forwarded to
  `1fd348e`; follow-up branch: `phase-15-verification`.
- Checks: workspace fmt, Clippy and Rust tests pass; frontend typecheck, lint,
  100 unit tests, 259 contrast checks, and all 16 flow browser tests (light/dark) pass.
  An initial concurrent run measured search at 31.4 ms against its 30 ms budget;
  the complete unit suite passed when rerun after browser testing finished.
- Began native verification: `pnpm tauri dev` launches successfully; confirmed the
  Gitvur Wayland window and rendered Map/Docs/Flows shell in a desktop screenshot
  (`/tmp/gitvur-phase15-native.png`, temporary artifact).
- Remaining: native fixture playback and save-dialog export, and Linux pan frame-rate
  measurement. GitHub CI was still running when the locally verified PRs were merged.
  Phase 16 has not been started. Existing untracked `fixtures/c-small/src/.gitvur/`
  data was left untouched. Regenerated browser screenshots were discarded after testing.

## Parking lot

- Indexing progress with a file count needs a progress callback in `gitvur-index` (Phase 11 shows an indeterminate bar).
- Docs: `.mdx` support remains out of scope; the reader discovers `.md` and `.markdown` only.
- Dev rendering: React Flow can emit missing-target-handle warnings and ResizeObserver notifications during Docs-to-Map navigation. The visual/navigation assertions pass; investigate alongside the parked map-edge rendering work.
- Check the selection focal point with ~15 edges on the synthetic repo (Phase 08 review question, not yet done).

- Diff: detect function renames via a body-only hash (needs a `basedOnSelfHash`-style contract addition; see Phase 10 notes).

- Map module headers show AI descriptions without an on-canvas provenance marker (hover title only); revisit with testers (Phase 09 review).

- Edge routing: lines entering a module to reach a row cross the module header text, and their badges can sit on the header or ring; route around container headers, or move badges off headers (Phase 08 review).

- `gitvur-index` `resolve.rs`: precompute a `(file, parent, name) → defs` map instead of scanning all definitions in `children()` per call site (review finding, performance only).

- CI: `actions/checkout`, `actions/setup-node` and `pnpm/action-setup` `@v4` target the deprecated Node 20 runtime (CI warning on the first run); bump to their Node 24 majors. `ubuntu-latest` is migrating to Ubuntu 26 — check the Tauri apt package names still resolve.
- TypeScript `tsconfig.json` `paths` / `baseUrl` aliases for import resolution.
- `export * from "./x"` barrels and Python `from x import *` for call resolution.
- `extract_lines` re-splits the whole file for every node (flagged by the review). It isn't measurable yet: Black's 402 files take ~1 s in total. Revisit with a line-index API in `gitvur-schema` if a large repo is slow.
- `ClassName.method()` calls (static/class methods via the class name) currently fall to name matching; they could resolve directly when `ClassName` is a known class.
- TS: index `.js`/`.jsx`/`.mjs`/`.cjs`; map `./x.js` specifiers to `x.ts`; `tsconfig.json` `paths`/`baseUrl`; follow `export *` for calls; follow local `export { a as b }` renames; qualify names inside `namespace` blocks.
- Partial extraction from files with syntax errors (skip only the `ERROR` subtrees) — see Phase 03 open question 1.

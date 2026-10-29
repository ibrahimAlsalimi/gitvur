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

## Parking lot

- `gitvur-index` `resolve.rs`: precompute a `(file, parent, name) → defs` map instead of scanning all definitions in `children()` per call site (review finding, performance only).

- CI: `actions/checkout`, `actions/setup-node` and `pnpm/action-setup` `@v4` target the deprecated Node 20 runtime (CI warning on the first run); bump to their Node 24 majors. `ubuntu-latest` is migrating to Ubuntu 26 — check the Tauri apt package names still resolve.
- TypeScript `tsconfig.json` `paths` / `baseUrl` aliases for import resolution.
- `export * from "./x"` barrels and Python `from x import *` for call resolution.
- `extract_lines` re-splits the whole file for every node (flagged by the review). It isn't measurable yet: Black's 402 files take ~1 s in total. Revisit with a line-index API in `gitvur-schema` if a large repo is slow.
- `ClassName.method()` calls (static/class methods via the class name) currently fall to name matching; they could resolve directly when `ClassName` is a known class.
- TS: index `.js`/`.jsx`/`.mjs`/`.cjs`; map `./x.js` specifiers to `x.ts`; `tsconfig.json` `paths`/`baseUrl`; follow `export *` for calls; follow local `export { a as b }` renames; qualify names inside `namespace` blocks.
- Partial extraction from files with syntax errors (skip only the `ERROR` subtrees) — see Phase 03 open question 1.

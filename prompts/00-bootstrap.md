# Phase 00 — Bootstrap the repository

## Context

This is a brand-new repository for Gitvur Prototype v2. Nothing exists yet except `CLAUDE.md`, `PROTOTYPE_V2_PLAN.md`, and `prompts/`. This phase creates the skeleton every later phase builds on. No product logic is written here.

## Read first

- `CLAUDE.md`
- `PROTOTYPE_V2_PLAN.md` sections 3 and 5

## Goal

A workspace that builds, lints, and tests cleanly on Linux, with empty crates in the right places, a Tauri 2 app that opens a blank window, and CI that runs everything on every push.

## Scope

**Create:**

```text
Cargo.toml                       # workspace, resolver = "2"
rust-toolchain.toml              # pin stable
crates/gitvur-schema/
crates/gitvur-index/
crates/gitvur-validate/
crates/gitvur-diff/
crates/gitvur-cli/               # binary name: gitvur
app/                             # Tauri 2 + React + TypeScript + Vite, pnpm
agent/                           # empty for now, keep with .gitkeep
fixtures/                        # empty for now, keep with .gitkeep
.github/workflows/ci.yml
.editorconfig
.gitignore
LICENSE                          # MIT
README.md                        # one paragraph + build commands
PROGRESS.md                      # with "Sessions" and "Parking lot" sections
```

**Do not create:** any extraction, validation, or UI logic.

## Tasks

1. Create the Cargo workspace with the five crates. Library crates expose a single placeholder function with a doc comment and one passing unit test. `gitvur-cli` uses `clap` (derive) and defines four subcommands — `index`, `validate`, `stale`, `diff` — that each print `not implemented yet` and exit with code 2.
2. Set shared workspace lints: `unsafe_code = "forbid"`, `clippy::pedantic` at warn level with a short allow-list you justify in a comment.
3. Scaffold the Tauri 2 app in `app/` with React + TypeScript + Vite, using pnpm. Strict TypeScript. Add ESLint and Prettier. Add Vitest with one passing test.
4. Make `app/src-tauri` a member of the Cargo workspace and add path dependencies on `gitvur-schema`, `gitvur-index`, `gitvur-validate`, `gitvur-diff` (unused for now is fine).
5. Add frontend dependencies now so later phases do not churn the lockfile:

```text
@xyflow/react
@dagrejs/dagre
zustand
shiki
```

6. Create `app/src/styles/tokens.css` with an empty `:root {}` and a comment saying Phase 07 fills it. Import it once from `main.tsx`.
7. Write the CI workflow for `ubuntu-latest`: install Tauri Linux system dependencies, cache Cargo and pnpm, run `cargo fmt --check`, `clippy -D warnings`, `cargo test --workspace`, then `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`. Do not build Tauri release bundles in CI.
8. Create `PROGRESS.md` with this structure:

```markdown
# Progress

## Sessions

### YYYY-MM-DD — Phase NN — title
- Done:
- Acceptance:
- Deviations:
- Open questions:

## Parking lot
```

## Acceptance criteria

- [ ] `cargo build --workspace` succeeds
- [ ] `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace` all pass
- [ ] `cargo run -p gitvur-cli -- index .` prints `not implemented yet` and exits 2
- [ ] From `app/`: `pnpm typecheck && pnpm lint && pnpm test` pass
- [ ] `pnpm tauri dev` opens a window titled `Gitvur` with an empty page
- [ ] CI workflow file is valid YAML and runs the steps above
- [ ] `PROGRESS.md` has its first entry

## Verify

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo run -p gitvur-cli -- index . ; echo "exit=$?"
cd app && pnpm typecheck && pnpm lint && pnpm test
```

## When done

Append the session to `PROGRESS.md`. List every dependency added with its version. Stop.

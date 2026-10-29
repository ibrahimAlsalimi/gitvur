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

## Parking lot

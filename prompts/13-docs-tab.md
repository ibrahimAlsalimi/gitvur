# Phase 13 — Docs tab: browse and read the repository's Markdown

## Context

Prototype v2 is built (Phases 00–12). The app has one main view, the map, with lenses (Structure, Documentation, Changes). This phase adds **top-level tabs** and a second tab, **Docs**, which lists every Markdown file in the analysed repository and renders it as a comfortable reading view that is linked to the map.

The repository being analysed is **untrusted data**. Its Markdown can contain raw HTML, scripts, `javascript:` links, tracking images, and paths that try to escape the repository. Rendering must be safe by construction.

## Read first

- `CLAUDE.md`, `PROGRESS.md` (the real state of the code may differ from the earlier prompts; follow the code and record deviations)
- `app/src/` structure, `app/src/styles/tokens.css`, `app/src/api/`, the inspector code viewer
- `crates/gitvur-index/src/walk.rs` (file discovery and skip rules)

## Goal

The user clicks the **Docs** tab, sees all Markdown files grouped by folder with the root README first, opens one, and reads it with a table of contents, highlighted code, rendered diagrams, working links between docs, and links that jump from the doc to the matching element on the map.

## Scope

**Create / modify:** `app/src/tabs/**`, `app/src/docs/**`, `app/src-tauri/**` (new commands), `crates/gitvur-index/` (expose a discovery function only; no change to `structure.json`), `app/e2e/**`, `CLAUDE.md`, `prompts/README.md`.
**Do not touch:** the data contract, extractor output, validator, map layout.

### Dependencies

```text
# Frontend
react-markdown
remark-gfm
rehype-slug
rehype-sanitize
mermaid                    # lazy-loaded only when a doc contains a mermaid block
# Rust / Tauri
tauri-plugin-opener        # open external links in the system browser after confirmation
```

Do **not** add `rehype-raw`. Raw HTML in Markdown is never rendered.

## Part A — Top-level tabs

- Add a tab bar in the top bar, left of the project name area: **Map** · **Docs**. (Phase 15 adds **Flows**; leave the design ready for a third tab.)
- Tabs keep their own state; switching back to Map restores its viewport, selection, and lens exactly.
- Shortcuts: `Ctrl/Cmd+1` Map, `Ctrl/Cmd+2` Docs. Add them to the shortcuts sheet and command palette.
- Tab bar is a proper `role="tablist"` with arrow-key navigation.
- Active tab persisted per repository.

## Part B — Rust commands

Reuse the extractor's walker so the skip rules and `.gitignore` handling are identical. Expose from `gitvur-index`:

```rust
pub fn discover_docs(repo: &Path) -> Result<Vec<DocEntry>>;
```

Tauri commands:

```text
list_docs(path)                       -> Vec<DocEntry>
read_doc(path, docPath)               -> DocContent
read_doc_asset(path, docPath, href)   -> AssetData
```

```ts
type DocEntry = { path: string; title: string; sizeBytes: number; modified: string };
type DocContent = { path: string; text: string; truncated: boolean };
type AssetData = { mime: string; dataUrl: string };
```

Rules:

- Extensions: `.md`, `.markdown`. `.mdx` goes to the Parking lot.
- `title` = first `# ` heading in the first 4 KB, else the file name.
- Order: root `README.md` first, then files under `docs/` (or `doc/`), then the rest; alphabetical by path within each group.
- `read_doc` caps at 2 MB; larger files return `truncated: true` with the first 2 MB.
- `read_doc_asset` resolves `href` **relative to the doc's directory** (or to the repo root if it starts with `/`), canonicalises, rejects anything outside the repo root (`path-escape`), allows only `png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`, caps at 5 MB, and returns a data URL. SVG is only ever used as an `<img>` source, never inlined, so scripts inside it cannot run.
- Nothing is executed and nothing is written.

## Part C — Safe rendering

Pipeline: `react-markdown` → `remark-gfm` → `rehype-slug` → `rehype-sanitize`.

- Sanitizer schema: start from the default; allow heading `id`s, `className` on `code` only for `language-*`, `input[type=checkbox][disabled]` for task lists. Nothing else.
- URLs: allow `http:`, `https:`, `mailto:`, relative paths, and `#anchors`. Drop every other protocol, including `javascript:`, `data:`, `file:`, `vbscript:`.
- **Code blocks:** highlighted with the same `shiki` themes as the inspector, with a copy button and the language label.
- **Mermaid blocks:** lazy-load `mermaid`, `securityLevel: "strict"`, `startOnLoad: false`, theme variables taken from tokens for both themes. If parsing fails, show the code block with a small note "Diagram couldn't be rendered" — never an error page.
- **Images:** relative images load through `read_doc_asset`. **Remote images are blocked by default** (they can track the reader). Show a neutral placeholder with the host name and a per-document **Load remote images** button; the choice is not persisted.
- Tables scroll horizontally inside their own container; the page never scrolls sideways.

## Part D — Links

Write link resolution as a pure, unit-tested module `app/src/docs/resolveLink.ts`:

| Link | Behaviour |
| --- | --- |
| `#heading` | Scroll to the heading in the same doc |
| `other.md`, `../guide/setup.md#install` | Open that doc in the Docs tab, then scroll to the anchor |
| Path to a source file in the structure, optionally `#L12` or `#L12-L30` | Rendered with a small map glyph; click → switch to Map tab, select the file, or the innermost function/class containing that line |
| Path to a folder | Open the Docs list filtered to that folder |
| `http(s):` / `mailto:` | Popover "Open in your browser?" showing the full URL; opens with `tauri-plugin-opener` only after the click |
| Anything else | Rendered as plain text with a tooltip "Link not supported" |

The webview never navigates away from the app.

### Code mentions

Inline code spans whose text **exactly** matches one known element become subtle links (dotted underline):

- a file path in the structure (`src/auth/login.py`)
- a qualified name that is unique in the repo (`UserRepository.findById`)
- a short name that is unique in the repo (`findById` only if exactly one element has it)

Ambiguous matches stay plain text — never guess. Hover shows a small card: kind glyph, qualified name, file:lines, first line of its description and its doc status. Click → show on map.

## Part E — Layout and visual design

```text
┌───────────────┬──────────────────────────────────────┬──────────────┐
│ Docs list     │ Reader                               │ On this page │
│ 260px         │ centred column, max 72ch (~760px)    │ 220px, sticky│
│ filter box    │ breadcrumb path · last modified      │ h2/h3 outline│
│ folder tree   │ rendered document                    │ scroll-spy   │
└───────────────┴──────────────────────────────────────┴──────────────┘
```

- **Docs list:** filter box on top (matches path and title), folder tree, each item: doc glyph, title (semibold), path (tertiary, middle-truncated). The root README is pinned at the top with a small "README" tag.
- **Reader typography:** add prose tokens to `tokens.css`: body 15px / 1.65 line height, h1 28, h2 22, h3 18, h4 15 semibold; paragraph spacing 12px; heading top margin 32px (h2) / 24px (h3); inline code on `--gv-bg-sunken` with radius-sm; blockquotes with a 3px `--gv-border-strong` left rule; tables with hairline rows and a sunken header. Text colour primary, line length capped by the column.
- **Heading anchors:** a `#` appears on hover to the left of each heading; click copies a link and updates the outline.
- **On this page:** h2 and h3 only, current section highlighted by scroll-spy; hidden below 1280px window width, available from a button in the reader header.
- **Reader header:** breadcrumb of the doc path, last modified, and two actions: **Copy path**, **Show folder on map** (selects the module that owns most code files in that folder, if any).
- **Map integration:** in the Map inspector, files and modules get a **Mentioned in docs** section listing docs that link to them or mention them by an exact code mention, each opening the doc scrolled to the first mention. Build this index in a Web Worker after the docs list loads; cap at 500 docs and 2 MB each; show "Indexing docs…" in the status bar while running.
- **Command palette:** include doc titles and h2/h3 headings, grouped under "Docs".

## Part F — States

Write strings in `app/src/copy.ts`:

| State | Message | Action |
| --- | --- | --- |
| No Markdown files | No Markdown files in this repository. | — |
| Doc truncated | This document is larger than 2 MB; showing the beginning. | — |
| Doc missing (deleted since listing) | This document no longer exists. | Refresh list |
| Asset blocked by path rules | Image outside the repository was not loaded. | — |
| Remote images present | Remote images are blocked. | Load remote images |

Persist per repository: last opened doc and its scroll position.

## Part G — Tests

- Unit: `resolveLink` (every row of the table), code-mention matching (unique, ambiguous, no match), docs ordering.
- Security (Vitest + Playwright): a fixture doc containing `<script>`, `<img src=x onerror=…>`, `<iframe>`, `[x](javascript:alert(1))`, `[x](data:text/html,…)`, an image `../../../../etc/passwd`, and an absolute path image; assert none execute, none load, and no navigation happens.
- Rust: `read_doc_asset` rejects `..`, absolute paths outside the repo, and symlinks pointing outside.
- Add `fixtures/py-small/README.md` and `fixtures/py-small/docs/architecture.md` (with a mermaid block, a table, a task list, a relative link, a code-file link with `#L` range, and code mentions). These are new files; do not change existing fixture source or `expected/` files. Put the security test doc under `app/e2e/fixtures/`, not in `fixtures/`.

## Part H — Visual review

Playwright screenshots, light and dark, 1440×900 and 1280×720:

1. Docs tab with README open
2. `architecture.md` with mermaid diagram, table, and outline
3. Code-mention hover card
4. External-link confirmation popover
5. Remote image placeholder
6. Map inspector showing "Mentioned in docs"

Open them and review; record answers in `PROGRESS.md`:

- Does the reader feel like a calm document, not an app panel? Is the line length comfortable?
- Do the tab bar and the reader match the rest of the app (tokens, spacing, accent use)?
- Are code-mention links noticeable but quieter than real links?
- Does the mermaid diagram follow the app theme in dark mode?

## Acceptance criteria

- [ ] Tab bar with Map and Docs; state preserved across switches; shortcuts work
- [ ] Docs discovered with the extractor's walker; ordering rules followed
- [ ] Rendering pipeline sanitised; every security test passes
- [ ] Links, anchors, code-file links, code mentions, external-link confirmation
- [ ] Mermaid, shiki code blocks, local images, blocked remote images
- [ ] "Mentioned in docs" in the map inspector, built in a worker
- [ ] States, persistence, palette integration
- [ ] Screenshots reviewed
- [ ] `CLAUDE.md` updated (tabs, docs commands, "raw HTML is never rendered" as a hard rule); `prompts/README.md` table updated

## Verify

```bash
cargo test --workspace
cd app && pnpm typecheck && pnpm lint && pnpm test && pnpm e2e
pnpm tauri dev   # open fixtures/py-small, read both docs, follow every link type
```

## When done

Update `PROGRESS.md`. Stop.

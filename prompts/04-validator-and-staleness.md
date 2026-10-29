# Phase 04 — Validator and staleness detection

## Context

The validator is the gate between the AI agent's output and the viewer. It is deterministic and never trusts `annotations.json`. It also tells the user, per element, whether its description is current.

## Read first

- `CLAUDE.md`
- `crates/gitvur-schema/README.md` (the `report.json` shape)

## Goal

`gitvur validate <repo>` writes `report.json`; `gitvur stale <repo>` prints the IDs of stale and undocumented elements (the input list for the agent's incremental mode).

## Scope

**Create / modify:** `crates/gitvur-validate/**`, `crates/gitvur-cli/**` (`validate`, `stale` subcommands), test fixtures under `crates/gitvur-validate/tests/data/`.
**Do not touch:** `fixtures/*/expected/`, `crates/gitvur-index/` behaviour, `app/`.

## Design

```rust
pub struct ValidateInput { structure: Structure, annotations: Option<Annotations>, repo_root: PathBuf }
pub fn validate(input: &ValidateInput) -> Report;
```

Validation always runs against a **freshly generated** structure: the CLI calls `gitvur_index::index` first (in memory), then compares with the `structure.json` on disk. If they differ, emit a warning `structure-out-of-date` — the on-disk structure is never trusted blindly.

## Checks

Use these exact issue codes (they are shown in the UI later):

| Code | Severity | Rule |
| --- | --- | --- |
| `schema-invalid` | error | `annotations.json` fails to deserialize |
| `dangling-ref` | error | description, module file, or AI edge refers to an ID not in the structure |
| `module-not-module` | error | a module ID does not start with `module:` |
| `file-unassigned` | warning | a file node belongs to no module |
| `file-multi-assigned` | error | a file appears in more than one module |
| `ai-edge-no-evidence` | error | AI edge missing evidence |
| `ai-edge-evidence-out-of-range` | error | evidence file missing or line outside the file |
| `ai-edge-evidence-mismatch` | warning | evidence line does not contain the target's short name |
| `ai-edge-duplicates-static` | warning | AI edge duplicates an extractor edge (same from/to/type) |
| `ai-edge-bad-provenance` | error | an edge in `annotations.json` has provenance other than `ai` |
| `structure-out-of-date` | warning | on-disk structure differs from a fresh index |
| `description-empty` | warning | description text is empty or only whitespace |

## Staleness

For every node in the fresh structure (except `project:root`):

- no description → `undocumented`
- description exists and `basedOnHash == node.contentHash` → `documented`
- otherwise → `stale`

Modules are `documented` if they have a non-empty description, else `undocumented`. Because each function has its own hash, editing one function must not mark others stale — but **its enclosing class and file will be stale** (their text changed). Record this in the README as expected behaviour; the UI will distinguish "stale because a child changed" in Phase 09 using a `childChanged` flag:

```json
{ "id": "class:src/a.py:Store", "status": "stale", "childChanged": true, "selfChanged": false }
```

`selfChanged` is true when the element's hash differs even after removing the text ranges of its direct child nodes. Add these two optional fields to the report element type in `gitvur-schema` (this is the one allowed schema change in this phase; regenerate schemas).

## CLI

```bash
gitvur validate <repo>           # writes .gitvur/report.json, prints summary, exit 1 if any error
gitvur stale <repo> [--json]     # prints stale + undocumented IDs, one per line, sorted
```

## Tests

Build scenarios in `crates/gitvur-validate/tests/` by copying `fixtures/py-small` to a temp dir and writing annotations programmatically:

- Valid annotations → zero errors.
- One test per issue code.
- Edit the body of one method → only that method `stale` with `selfChanged`, its class and file `stale` with `childChanged` and `selfChanged: false`, every other method `documented`.
- Insert blank lines **above** a function → that function stays `documented` (hash is over its own text, not line numbers).
- Delete a function → its description becomes `dangling-ref`.

## Acceptance criteria

- [ ] Every issue code has a test
- [ ] Staleness scenarios above pass
- [ ] `report.json` canonical and deterministic
- [ ] `gitvur validate` exits 1 on errors, 0 otherwise
- [ ] README documents every check and the staleness rules

## Verify

```bash
cargo test -p gitvur-validate
cargo run -p gitvur-cli -- validate fixtures/py-small
cargo clippy --workspace --all-targets -- -D warnings
```

## When done

Update `PROGRESS.md`. Stop.

# gitvur-validate — validator and staleness detection

The gate between the documenting agent's output and the viewer. Deterministic, read-only, and
it never trusts `annotations.json`. It doesn't trust the on-disk `structure.json` either: every
run re-indexes the repository in memory and checks against that.

```rust
validate_repo(repo) -> Result<Report, ValidateError>   // what the CLI uses
validate(&ValidateInput) -> Report                      // pure core: parsed inputs only
stale_ids(&Report) -> Vec<String>                        // input list for incremental mode
write_report(dir, &Report)                               // atomic write of report.json
gitvur_dir(repo)                                         // <repo>/.gitvur for writing; refuses a symlinked .gitvur
```

`validate_repo`:

1. Indexes the repository afresh with `gitvur_index::index`.
2. Compares `.gitvur/structure.json` with the fresh structure's canonical bytes
   (`structure-out-of-date`).
3. Loads `.gitvur/annotations.json` leniently (`schema-invalid`, `ai-edge-no-evidence`). A
   missing file means "no annotations"; that is not an issue.
4. Runs `validate` with the fresh structure, the parsed annotations, the canonical repository
   root, and the fresh `commitSha`.
5. Merges the issues and returns a canonical report whose summary matches its contents.

## CLI

```bash
gitvur validate <repo>        # writes <repo>/.gitvur/report.json, prints the summary and each issue
gitvur stale <repo> [--json]  # stale + undocumented IDs, one per line (or a JSON array), sorted
```

`validate` exits **1 if the report has any error**, or if validation could not run. Warnings
alone exit 0. `stale` writes nothing.

## Checks

Annotation checks run only when `annotations.json` exists and parses. The issue `id` is the
element the issue is about: the description, module or file ID, or an edge's `from`.

| Code | Severity | Rule |
| --- | --- | --- |
| `schema-invalid` | error | `annotations.json` is not JSON, does not deserialise into the contract types (unknown fields, wrong types, bad enum values), or resolves outside the repository. The annotations are then ignored, so every element is `undocumented` |
| `dangling-ref` | error | A description ID, a module's file, or an AI edge's `from`/`to` is not in the fresh structure. A module's file entry that names a non-file node (e.g. a function) also counts. Descriptions and edges may also refer to the annotations' own valid module IDs |
| `module-not-module` | error | A module ID is not `module:<slug>` with slug `[a-z0-9-]+`. Such a module gets no status |
| `file-unassigned` | warning | A file node belongs to no module |
| `file-multi-assigned` | error | A file appears in more than one module (listing it twice in one module is not an error) |
| `ai-edge-no-evidence` | error | An edge in `annotations.json` has no `evidence` (or `null`). Detected on the raw JSON before deserialisation; the edge is dropped and the rest of the file is still used |
| `ai-edge-evidence-out-of-range` | error | The evidence file does not exist or fails the path-safety check, or the line is `0` or past the end of the file |
| `ai-edge-evidence-mismatch` | warning | The evidence line does not contain the target's short name: the node's `name`. A file also matches on its stem (`login.ts` → `login`), and a module on its slug or display name. Case-sensitive substring match |
| `ai-edge-duplicates-static` | warning | An AI edge has the same `(from, to, type)` as an extractor edge |
| `ai-edge-bad-provenance` | error | An edge in `annotations.json` has provenance other than `ai` |
| `structure-out-of-date` | warning | `.gitvur/structure.json` is missing, unreadable, outside the repository, or not byte-identical to a fresh index |
| `description-empty` | warning | A description's text is empty or only whitespace |

### Path safety

Every path the validator reads is resolved against the canonical repository root by
`resolve_in_repo`, which applies to `.gitvur/*.json` and evidence files. It rejects:
- empty paths, absolute paths and backslashes;
- `.` and `..` components;
- missing files;
- anything whose canonical path (after following symlinks) is outside the root.

## Staleness

Every node of the fresh structure except `project:root` gets one status:

| Status | Rule |
| --- | --- |
| `undocumented` | no description with non-empty text |
| `documented` | a non-empty description whose `basedOnHash` equals the node's current `contentHash` |
| `stale` | non-empty description(s), none matching the current hash |

- Modules (valid IDs only) are `documented` if their own `description` is non-empty, else
  `undocumented`. They are never stale.
- Descriptions with empty text are ignored for status, so the element shows as
  `undocumented` and appears in `gitvur stale`. That counts as needing documentation, and the
  issue is also reported as `description-empty`.
- If several descriptions exist for one ID, the element is `documented` when any of them
  matches the current hash.
- Descriptions for IDs that no longer exist (deleted or renamed elements) produce `dangling-ref`
  and no element.

### Expected behaviour: ancestors go stale with their children

Hashes are per element, over the element's own lines. So:

- Editing one function's body makes **that function** stale and leaves its siblings documented.
- Its **enclosing class and file** become stale too, because their text contains the edited
  lines. This is expected.
- Moving a function down by inserting blank lines above it leaves it **documented**: the hash
  covers its text, not its line numbers. Its file becomes stale.

### `childChanged` / `selfChanged`

Every `stale` element carries both flags; other elements carry neither.

- `childChanged` = at least one **direct child** of the element is `stale`.
- `selfChanged` = `!childChanged`.

The prompt's intended rule ("the hash still differs after removing the direct children's
ranges") can't be evaluated exactly. That needs the element's text *at the time the description
was written*, and a description stores only the full-text hash (`basedOnHash`). The rule above
is exact in the common cases:

- only a child changed: `childChanged: true, selfChanged: false`, on every ancestor up to the
  file;
- only the element's own lines changed (a signature, a class attribute, blank lines in a file):
  `childChanged: false, selfChanged: true`.

Known inaccuracies:

- If both the element's own lines **and** a child changed, it reports `selfChanged: false`.
- Adding or removing a child, and changes to undocumented children, show as `selfChanged: true`,
  because no direct child is stale.

An exact version needs the agent to also record a hash of the element with its children's
ranges removed (e.g. a `basedOnSelfHash` in each description). That is a contract change and is
proposed in `PROGRESS.md`.

## Determinism

The report is built with `Report::canonicalize()` and written with `to_canonical_json`. It has
no timestamps, so the same repository and annotations give byte-identical `report.json`.

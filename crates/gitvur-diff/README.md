# gitvur-diff — structural diff between two revisions

Answers "what changed?" without AI: index both revisions and compare. Deterministic,
read-only with respect to the repository.

```rust
diff(&a, &b) -> StructureDiff                       // pure; caller fills fromCommit/toCommit
revision::index_revision(repo, rev) -> Revision      // rev: HEAD~1, branch, SHA, or "worktree"
revision::list_commits(repo, limit) -> Vec<Commit>   // newest first
revision::read_file(repo, rev, relpath)              // blob bytes at a revision
carry_annotations(&annotations, &diff, &b)           // follow moved IDs
```

## Revisions without a checkout

`index_revision` opens the repository with `gix`, resolves `rev` to a commit, walks its tree,
and writes into a fresh temporary directory only the blobs indexing needs (what a language
backend handles, plus `.gitignore` files; never symlinks, submodules, directories in
`SKIPPED_DIRS`, non-UTF-8 paths, or components like `..`). It then runs
`gitvur_index::index` on that directory and deletes it, also on error (`tempfile`).
The copy lives in a folder named like the repository, so the project node matches.

The working tree, index, `HEAD` and refs are never written. `worktree` indexes the files on
disk in place, which is also read-only. Tests check this byte-for-byte.

## Classification

Per element (the project node is not an element):

| Class | Rule |
| --- | --- |
| `added` | ID only in B, not paired as moved |
| `removed` | ID only in A, not paired as moved |
| `modified` | ID in both, hashes differ |
| `moved` | ID only in A paired with an ID only in B with the identical `contentHash`; candidates sorted by ID on both sides, matched greedily |
| `unchanged` | ID in both, same hash (left out of `elements`, counted in `summary`) |

- `childChanged` (on `modified`, and on unchanged containers if that ever happens): a direct
  child is added, modified or moved in B, or removed, moved away or modified in A. The child
  check is `gitvur_schema::tree::child_changed`, shared with the validator.
- Hashes cover an element's own lines, including its `def`/`class` line. **Renaming a
  function changes its hash, so a rename is `removed` + `added`**, not `moved`. A move to
  another file, or a renamed file, keeps the text and is detected as `moved`.
- Edges are keyed by `(from, to, type)`, with A's endpoints mapped through the moves first;
  keys only in B are `added`, only in A `removed` (A's evidence).

## `--carry-annotations`

Rewrites, in `annotations.json`, the IDs of moved elements from A to B:

- a description only when its `basedOnHash` equals the element's hash in B;
- module file lists and AI edge endpoints for every move, and AI edge evidence files for
  moved files (their lines are identical).

It is the only write `gitvur diff` performs.

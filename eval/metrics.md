# Metrics

Repository: `psf/black` at `408211f4ae4ec7f119aae8a773ad14bcc6a17cba`. Machine: Linux 6.18,
8 cores. `gitvur` is a release build of this repository at Phase 11 (`f37a074`).

## 1. Extraction (step 2)

`python3 -I eval/scripts/index_metrics.py target/release/gitvur <black>`:

| Metric | Value |
| --- | --- |
| Files | 404 |
| Nodes (all) | 3,718 |
| Nodes: project | 1 |
| Nodes: file | 404 |
| Nodes: class | 505 |
| Nodes: function | 2,808 |
| Edges (all) | 894 |
| Edges: calls | 873 |
| Edges: imports | 21 |
| Unresolved calls | 306 |
| Unresolved share (unresolved / (call edges + unresolved)) | 26.0% |
| Extractor warnings | 10 |
| Run time, median of 3 (ms) | 821 (runs: 822, 821, 819) |

- 416 `.py` files are tracked and 404 indexed. The 12 not indexed are Black's own gitignore
  test data, matched by nested `.gitignore` patterns (Phase 02, open question 2). The 10
  warnings are deliberately invalid files in `tests/data/`, each indexed as a file without
  children.
- 2,470 of the 3,717 elements (66%) are in `tests/data/`, Black's formatter test inputs.
- Unresolved calls: 96 from `src/`, 210 from elsewhere (tests, scripts, docs).

### Effect of the `src/` layout

Black keeps its packages in `src/` (`src/black`, `src/blackd`, `src/blib2to3`). The extractor
resolves Python imports from the repository root only (`crates/gitvur-index/README.md`), so
`from black.nodes import is_docstring` resolves to nothing. The import edge is dropped, and so
is every call through an imported name, because a call with no in-repo target is dropped, not
recorded as unresolved (hard rule 3).

| | Count |
| --- | --- |
| Top-level `from black… / blackd… / blib2to3… import` lines (all files) | 123 |
| Import edges extracted | 21 (all relative imports, or same-folder imports in `tests/`) |
| Call edges from `src/` | 595 |
| … of which cross a file boundary | **8** |

So the structural map of `src/` is almost entirely made of calls within one file.
Cross-module dependencies (for example `linegen.py` → `nodes.py`, or `__init__.py` →
`files.py`) aren't on the map unless the documenter adds them as AI edges. Section 4 shows a
concrete case.

## 2. Initial documentation (step 3)

_Pending: the documenter session's `eval/documenter/initial/RUN.md`._

| Metric | Value |
| --- | --- |
| Elements to document (initial packet) | 3,717 (404 files, 505 classes, 2,808 functions), plus 404 unassigned files |
| Wall-clock time | |
| Tokens / cost | |
| Modules created | |
| Descriptions written | |
| AI edges added | |
| Validation: errors | |
| Validation: warnings by code | |

## 3. Incremental documentation (step 7)

_Pending: runs on the staleness copy after step 6._

| Metric | Initial | Incremental |
| --- | --- | --- |
| Packet items | 3,717 + 404 files | |
| Wall-clock time | | |
| Tokens / cost | | |

## 4. Structural diff over the last 10 commits (step 8)

`gitvur diff <black> HEAD~10 HEAD` (`6f8e43f` → `408211f`):

```text
+37 added · −0 removed · ~27 modified · →0 moved · edges +7 −0
```

Per commit (`gitvur diff <black> HEAD~(n+1) HEAD~n`):

| Commit | Subject | Added | Removed | Modified | Moved | Edges |
| --- | --- | --- | --- | --- | --- | --- |
| `9a1f64e` | Resolve Pytest deprecation | 0 | 0 | 2 | 0 | +0 −0 |
| `c61c1db` | Fix crash on fmt: skip after the last base of a skipped class header | 8 | 0 | 3 | 0 | +0 −0 |
| `ad56c60` | Preserve trailing blank lines at EOF in unclosed fmt: off blocks | 4 | 0 | 4 | 0 | +2 −0 |
| `2231c38` | Fix --line-ranges crash on clauses with their body on the same line | 10 | 0 | 4 | 0 | +2 −0 |
| `7d21b9b` | Warn before formatting the filesystem root | 4 | 0 | 5 | 0 | +1 −0 |
| `4ef88cd` | Expand guidance for adopting Black in existing projects | 0 | 0 | 3 | 0 | +0 −0 |
| `9d4fefb` | Keep optional parens for commented assignment RHS | 1 | 0 | 2 | 0 | +0 −0 |
| `a74759e` | Fix B045 loop variable shadowing in `_iter_nameescape_slices` | 0 | 0 | 3 | 0 | +0 −0 |
| `d169466` | Don't rewrite IPython help syntax and prompts in notebooks | 2 | 0 | 4 | 0 | +1 −0 |
| `408211f` | Fix crash on two `# fmt: skip` statements in a row | 8 | 0 | 2 | 0 | +1 −0 |

### Spot check: 5 changes against `git diff`

| # | Change reported by Gitvur | `git diff` shows | Verdict |
| --- | --- | --- | --- |
| 1 | `scripts/release.py`: `SourceFiles.__init__` modified; class and file modified with a changed child (from the docs commit `4ef88cd`) | One path in `__init__` changed (`source_version_control.md` → `pre-commit.md`). The commit is mostly docs, but it does touch this script | Correct |
| 2 | `src/black/files.py`: `is_filesystem_root` added | New 7-line function | Correct |
| 3 | `src/black/trans.py`: `BaseStringSplitter._iter_nameescape_slices` modified | Loop variables renamed inside the method | Correct |
| 4 | `src/black/comments.py`: `_get_endmarker_and_dedents` added; `_handle_regular_fmt_block` modified with a changed child; nested `stringify_standalone_comment` modified; call edges to `_get_endmarker_and_dedents` and `list_comments` added | All present. `_handle_regular_fmt_block` also gained 16 lines of its own, which the diff can't show: `childChanged` doesn't say whether the element's own lines changed as well (a known limit, see the validator README) | Correct, with the known limit |
| 5 | `src/black/__init__.py`: `main` modified | `main` gained a loop calling `is_filesystem_root`, imported from `black.files` | Element correct. **Edge missed**: no `main → files.py:is_filesystem_root` call edge is added, and the call isn't listed as unresolved either. The cause is the `src/` layout limitation (section 1) |

No element was misclassified. One relationship change was missed, for the reason in section 1.

## 5. Viewer (step 9)

_Pending: measured once the annotations are in._

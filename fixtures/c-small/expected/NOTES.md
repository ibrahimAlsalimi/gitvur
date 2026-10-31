# c-small — hand-written expectations (C support)

**HUMAN REVIEW REQUIRED.** Written by reading the source before the C backend existed. A
helper only hashed explicitly declared line ranges; it did not parse C. Nothing here is
compiled or run.

Totals: 5 files, 2 classes, 10 functions, 1 project; 2 import edges, 6 call edges; 1 ambiguous
call; 2 entry points.

## Nodes

- `.c` and `.h` files are file nodes. Function **definitions** (with a body) are function nodes,
  `static` or not; prototypes and macros are not nodes.
- Struct/union **definitions with a body** are class nodes: `struct item {…}` by its tag, the
  anonymous `typedef struct {…} stats_t` by its typedef name. A function returning a pointer
  (`char *tool_name(void)`) is named by its declarator.
- Two programs live in one tree, so `log_line` and `main` exist twice; IDs differ by path.

## Includes

- `#include "../include/store.h"` (src/store.c:2) resolves relative to the including file.
- `#include "store.h"` (src/main.c:1) has no `src/store.h`; exactly one indexed file ends with
  `/store.h` (`include/store.h`), standing in for a `-I include` flag the extractor never reads.
  Two such files would resolve to nothing.
- `<stdio.h>` names no indexed file and is dropped.

## Calls (C links names program-wide)

1. A definition in the same file wins (`static` ones included): `fact` (recursion, line 4),
   `run`, `validate`, and `tools/log_b.c` main → its own `log_line`.
2. Otherwise every non-`static` function of that name in any indexed C file: `main` →
   `store_save` (one candidate, an edge). `store_save` → `log_line` (src/store.c:15) has two
   (`src/log_a.c`, `tools/log_b.c`): ambiguous, no edge.
3. Nothing else: `printf`/`fprintf` (outside the repo) and `cb()` (a function-pointer
   parameter, src/main.c:8) are dropped.

## Entry points

`int main(...)` defined at file level (not `static`) is a `main-function` entry named by the
file path, targeting the function: `src/main.c:11`, `tools/log_b.c:11`.

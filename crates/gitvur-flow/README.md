# gitvur-flow — deterministic call traces

Pure, read-only traversal of a `gitvur_schema::Structure`. No repository code is
executed. CLI indexing and annotation loading live outside this crate.

```rust
use gitvur_flow::{trace, TraceOptions};
// let tree = trace(&structure, "entry:console-script:flow-shop", &TraceOptions::default());
```

## Roots and edges

- A node ID starts at that node, including file/class nodes. It does not infer calls
  from source text or discover matching entries for a file.
- An entry starts at its function target plus its direct `calls`, deduplicated and
  ordered by `(source.file, source.startLine, id)`. File targets are not execution
  roots. Null targets are valid and may produce an empty trace.
- Entry-owned unresolved sites appear as ambiguous roots after resolved roots.
- Only `calls` edges with `syntactic` provenance are followed. `include_semantic`
  additionally follows `semantic`; `ai` edges are never followed. Duplicate edges
  to the same target collapse. Dangling targets are omitted; Part D checks validity.
- Children sort by target `(file, startLine, id)`. Ambiguous sites join that order
  using their evidence location, after resolved children on a location tie. Candidate
  IDs sort and deduplicate, but never become automatic traversal targets.

## Tree and limits

The traversal allocates occurrences breadth-first. The first occurrence of a node
expands once. A later occurrence is a `ref` pointing to that first occurrence, except
when the target is on the current occurrence's ancestor path: then it is a `cycle`.
This makes shorter paths win even when a deeper path sorts earlier in a text tree.

Defaults: depth 6, 300 occurrences. Roots have depth zero. `max_nodes` counts every
occurrence, including refs, cycles and ambiguities. Depth zero retains roots and hides
all their children; node budget zero emits no roots. A node with omitted outgoing
occurrences has `truncated: true` and `hiddenChildren` counts those immediate children,
not all descendants. Omitted roots use `Trace.hiddenRoots`. Hitting a limit exactly
without omitting anything is not truncation. The top-level `truncated` aggregates both.

The schema stores this occurrence tree as an arena: `roots` and `children` contain
`trace:1`, `trace:2`, etc.; `nodes` is in breadth-first allocation order. Each occurrence
has exactly one parent, unless it is a root. `reference` points to a prior occurrence;
it is not another child. This avoids recursive serialization and supports long traces.
An unknown start returns a non-null `error`; a known entry with no executable roots
returns an empty tree with null error.

Traversal is bounded by the options; building adjacency examines the input graph once.
Memory includes the graph indexes and the bounded result. Ancestor checks walk parent
links rather than using recursion. Text rendering is also iterative.

## CLI

```bash
cargo run -p gitvur-cli -- flows fixtures/py-flows
cargo run -p gitvur-cli -- trace fixtures/py-flows entry:console-script:flow-shop
cargo run -p gitvur-cli -- trace fixtures/ts-flows entry:top-level-call:src-cli-ts --depth 3 --max-nodes 50 --json
```

`--include-semantic` enables semantic structure edges. Text uses `↻` for refs, `⟲`
for cycles, `?` for ambiguities, and `…` for truncation. JSON conforms to
`schemas/trace.schema.json`. Unknown starts exit 1 (JSON retains the trace error).

Both commands index current source in memory and read optional annotations without
writing `.gitvur`. AI entries are merged by ID; conflicting IDs and malformed or
outside-repository annotation files cause an error. Agent edges are not merged into
the executable graph. `flows` lists static/AI entries and curated flows; statuses are
explicitly `unchecked` until Part D provides validation, rather than trusting an old
report or claiming that a parsed flow is current. Entry listing shows unresolved
config targets explicitly. No app UI is added in Part C.

# gitvur-index — deterministic structure extractor

Turns a repository into `.gitvur/manifest.json` and `.gitvur/structure.json` with no AI, no
network, and no execution of repository code. The same input always gives byte-identical output
(except `manifest.generatedAt`, which the caller passes in).

The contract (ID format, hashing, ordering) is in `crates/gitvur-schema/README.md`. This file
documents how the extractor applies it. Supported: **Python** (`.py`), **TypeScript** (`.ts`,
`.tsx`, `.mts`, `.cts`, `.d.ts`), **C** (`.c`, `.h`) and **Go** (`.go`). Each language is a
`LanguageBackend`; the core in `resolve.rs` is shared. A backend declares how far bare names
reach (`NameScope`): the file and its imports (Python, TypeScript), the package directory
(Go), or the whole program (C linkage).

```text
src/
├── lib.rs          index(repo, opts) -> IndexOutput
├── walk.rs         file discovery
├── lang/mod.rs     LanguageBackend trait + language-independent ParsedFile
├── lang/python.rs  Python backend
├── lang/typescript.rs  TypeScript / TSX backend
├── resolve.rs      IDs, duplicate suffixes, import edges, call resolution
├── git.rs          HEAD short SHA via gix
└── output.rs       atomic write of manifest.json + structure.json
queries/python.scm      tree-sitter captures, embedded with include_str!
queries/typescript.scm  (compiled once per grammar: typescript, tsx)
```

## Files

- Walks with `ignore::WalkBuilder`. Only `.gitignore` files **inside the repo root** are honoured,
  whether or not the directory is a Git checkout. The global gitignore, `.git/info/exclude` and
  `.ignore` files are not used, because they are machine-specific. Hidden files are not skipped
  for being hidden.
- Patterns apply to tracked files too. Git itself never ignores a tracked file, but the
  extractor reads only the patterns, so a tracked file matching a `.gitignore` pattern is skipped.
- Directories always skipped, at any depth: `.git`, `.gitvur`, `node_modules`, `venv`, `.venv`,
  `__pycache__`, `dist`, `build`, `target`.
- Symlinks are never followed and never indexed (neither symlinked files nor directories), so
  nothing outside the repository is read.
- Non-UTF-8 paths are skipped with a warning. Non-UTF-8 file contents are decoded lossily with
  a warning.
- Paths are `/`-separated, relative to the root, and sorted.
- Line endings are normalised (`\r\n`, `\r` → `\n`) **before parsing**, so tree-sitter rows match
  the contract's line numbers.
- A file with a syntax error (any tree-sitter `ERROR` or `MISSING` node) produces a warning
  and becomes a file node **without children**: no definitions, imports or calls are taken
  from it. The run does not fail.

## Definitions (Python)

- `class_definition` and `function_definition` (including `async def`) at any depth. Lambdas are
  not nodes.
- **Decorator range rule:** a decorated definition's range starts at its **first decorator**
  (the `decorated_definition` node) and ends at the last line of the body.
- The parent is the nearest enclosing class or function; otherwise the file.
- Qualified names join enclosing class/function names with `.`. A duplicate qualified name in
  one file gets `#2`, `#3`… in source order. Children of a suffixed definition are qualified
  under the suffixed name (`f#2.inner`).

## Imports (Python)

Each `import` / `from … import` statement binds local names and yields `imports` edges.

| Statement | Binds | Edge to |
| --- | --- | --- |
| `import a.b` | `a.b` → module | `a/b.py`, else `a/b/__init__.py` |
| `import a.b as x` | `x` → module | same |
| `from a.b import c` where `a/b/c.py` or `a/b/c/__init__.py` exists | `c` → that module | the submodule file |
| `from a.b import c` otherwise | `c` → name `c` in `a/b.py` / `a/b/__init__.py` | that file |
| `from a.b import c as d` | `d` → as above | as above |
| `from a.b import *` | nothing | `a/b.py` / `a/b/__init__.py` |
| `from . import x`, `from ..m import y` | as above | resolved against the importing file's package; one extra dot per level up. Going above the root resolves to nothing |

- The module search root is the repository root.
- Only files that are indexed count. External packages (`json`, `requests`) produce no edge, but
  their bindings are remembered so that `json.dump()` is known to be external.
- **One edge per (importing file, imported file)**; evidence = the first import line. No
  self-edges. Parent packages get no edge (`import a.b` does not link `a/__init__.py`).
- A later import of the same local name replaces the earlier binding.

## Calls (syntactic, conservative)

Only calls inside a function definition are considered. A call is attributed to the innermost
enclosing **function**. Lambdas and comprehensions are not nodes, so their calls belong to the
enclosing function. Calls at module level, in class bodies, or in decorators of a top-level
definition are dropped.

The callee is resolved by its shape. **Exactly one candidate → `calls` edge, two or more →
`unresolvedCalls`, none → dropped**, except where noted in rule 5.

1. **`name()`** — look up `name`, in order:
   1. definitions nested directly in the caller, then in each enclosing *function* (a class
      scope is not visible to its methods, so the walk stops at a class);
   2. module-level functions and classes of the same file;
   3. a name bound by `from m import name [as alias]`: the module-level definition `name` in `m`,
      following re-exports (if `m` does not define it but itself imports it from another in-repo
      module, follow that binding; cycles stop).

   A module binding (`import x; x()`) or anything else → dropped (builtins such as `print`,
   `open`, `float`). Several matches at the first level that has any (e.g. `f` and `f#2`) →
   unresolved.
2. **`alias()`** — covered by 1.3: the alias is followed to the original name.
3. **`mod.func()` / `pkg.mod.func()`** — when the receiver's dotted text is exactly a local name
   bound to a module: that module's module-level `func` (following re-exports). External module
   or no such name → dropped, with no fallback to name matching.
4. **`self.m()` / `cls.m()`** — receiver is exactly the identifier `self` or `cls`: methods
   named `m` defined directly in the nearest enclosing class. No inheritance resolution: if the
   class has no `m`, fall through to rule 5.
5. **Anything else** (`obj.m()`, `self.attr.m()`, `f().m()`, `"x".join()`): collect every
   in-repo method (a function whose parent is a class) named `m`. **One candidate → no edge**,
   because the receiver's type is unknown; two or more → `unresolvedCalls`; zero → dropped.
   Module-level functions are never candidates.
6. **`Class()`** — any rule above that lands on a class yields an edge to the **class node**
   (never to `__init__`).

Deduplication: one `calls` edge per (caller, target), evidence = the first call line. The
evidence line is the line of the called name (the attribute name for `a.b()`). Unresolved calls
are kept per call site.

## Definitions (TypeScript)

- Grammars: `tsx` for `.tsx`; `typescript` for `.ts`, `.mts`, `.cts` and declaration files.
- `class_declaration` and `abstract_class_declaration`, exported or not → class node.
- `method_definition` **directly in a class body** → function node `Class.method`, including
  `constructor`. Object-literal methods are not nodes. Abstract methods and method signatures
  (no body) are not nodes. Getters and setters use the plain property name (`size`, not
  `get size`), so a `get`/`set` pair becomes `C.size` and `C.size#2` under the duplicate rule.
- `function_declaration` and `generator_function_declaration` at any depth → function node.
  Overload signatures are separate `function_signature` nodes and are ignored, so overloads
  collapse into the implementation, and its range is the implementation only.
- Module-level `const x = () => …` / `const x = function () …` (also exported) → function node
  `x`. `let`/`var`, non-module-level `const`, inline callbacks, and class fields holding arrow
  functions are **not** nodes; calls inside them belong to the enclosing function node.
- Ranges include `export` / `export default` (the `export_statement`). For `const`, the range is
  the whole statement. **Decorators are included**: class decorators are inside the class or
  export node; method decorators precede the method in the class body, and the range starts at
  the first of them.
- **Declaration files** (`.d.ts`, `.d.mts`, `.d.cts`): file node only. No class or function nodes
  (not even for `declare class` / `declare function`) and no calls, but their imports still
  produce `imports` edges.

## Imports (TypeScript)

| Statement | Binds |
| --- | --- |
| `import D from "./m"` | `D` → the default export of `m` |
| `import { a } from "./m"` / `import { a as b } from "./m"` | `a` / `b` → name `a` in `m` |
| `import * as ns from "./m"` | `ns` → module `m` |
| `import x = require("./m")` | `x` → module `m` |
| `import type …`, `import { type a } …` | as above; still an `imports` edge |
| `import "./m"` | nothing; still an `imports` edge |
| `export { a as b } from "./m"` | `b` → name `a` in `m` (a re-export: followed by call resolution) |
| `export { default as X } from "./m"` | `X` → the default export of `m` |
| `export * as ns from "./m"` | `ns` → module `m` |
| `export * from "./m"` | nothing; still an `imports` edge |

- Only relative specifiers resolve: `.`, `..`, `./…`, `../…`. Bare specifiers (packages) are
  external and ignored. **`tsconfig.json` `paths` / `baseUrl` aliases are out of scope.**
- Resolution order, relative to the importing file's directory: the exact path, then `+.ts`,
  `+.tsx`, `+.d.ts`, `+/index.ts`, `+/index.tsx`, `+/index.d.ts`. Only indexed files count.
  Going above the root resolves to nothing.
- Default exports: `export default class C` / `export default function f` → that definition;
  `export default name;` → whatever `name` resolves to in that file. Anonymous default exports
  (`export default () => …`, `export default class {}`) have no node and resolve to nothing.

## Calls (TypeScript)

The rules in "Calls" above apply unchanged, with these shapes:

- `f()` → rule 1. `alias()` → rule 2. Named imports follow re-exports through barrel files, so
  `import { login } from "./auth"` + `login()` links to the definition in `auth/login.ts`, while
  the `imports` edge points at `auth/index.ts`.
- `ns.f()` with `import * as ns` (or `import ns = require`) → rule 3.
- `this.m()` → rule 4 (receiver exactly `this`, nearest enclosing class; works inside arrow
  callbacks, which are not nodes). `super.m()` and `this.x.m()` → rule 5.
- `new C()` / `new ns.C()` → resolved like `C()` / `ns.C()` but **only classes** are kept, and
  never by method-name matching (`new Map()`, `new Error()` → dropped).
- `obj.m()` → rule 5 (unknown receiver; two or more in-repo methods named `m` → unresolved).
- Dynamic `import()`, calls on call results (`f()()`) and subscript calls are ignored. Calls in
  class field initialisers and at module level are dropped.

## C

- **Nodes.** `.c` and `.h` files. Function definitions with a body are functions (`static` ones
  are marked internal); prototypes, macros and `extern` declarations are not nodes. Struct and
  union definitions with a body are classes, named by their tag, or by the typedef name for
  `typedef struct { … } name;`. Definitions inside `#if`/`#ifdef`/`#else` blocks (header guards)
  count; nothing is preprocessed, compiled or run. Nested and anonymous records are not nodes.
- **Includes.** `#include "p"`: the path relative to the including file; otherwise the single
  indexed file whose path ends with `/p` (standing in for `-I` flags, which are never read). Two
  or more such files resolve to nothing. `#include <p>` resolves only when `p` has a directory
  (`<lib/x.h>`), by the same unique-suffix rule; `<stdio.h>`-style names never resolve. Includes
  create `imports` edges only; they bind no names.
- **Calls.** `name()`: a definition in the same file (including `static`), else every non-`static`
  function of that name in any indexed C file (one → edge, two or more → unresolved). `x.f()` /
  `x->f()` (function pointers in structs) and `(*fp)()` have no known target and are dropped.
- **Entry points.** `int main(…)` defined at file level and not `static`: `main-function`, named by
  the file path, targeting the function.

## Go

- **Nodes.** `.go` files (tests included). `type T struct{…}` / `type T interface{…}` are
  classes (the type spec's lines); other type declarations are not nodes. `func F` is a
  function. A method `func (r *T) M` (pointer, parenthesised and generic receivers unwrapped) is a
  child of class `T` when `T` is declared **earlier in the same file**; otherwise it stays at file
  level with ID `function:<file>:T.M` (name `M`), so a definition never precedes its parent.
- **Imports.** Read from every `go.mod` (`module` directive only): an import path equal to or
  under a module path names the directory after that prefix (longest module path wins). The
  package's first file by path stands for it in bindings; `imports` edges go to **every file of
  the package**. Without a matching module nothing resolves, and directory names alone are
  never matched (a local `log/` is not the standard `log`). The local name is the alias, else the
  last path segment; `_` and `.` imports bind nothing.
- **Calls.** `F()`: the same file, then the package (every `.go` file in the directory), then
  nothing. `pkg.F()` through an import: package-wide lookup. `r.M()` where `r` is the method's own
  receiver: methods of the receiver's type anywhere in the package. Any other `x.M()`: the
  unknown-receiver rule (two or more methods named `M` → unresolved, otherwise dropped);
  interface method specs are not candidates. Calls inside function literals belong to the
  enclosing function.
- **Entry points.** `func main()` in a `package main` file: `main-function`, named by the
  package directory (the file path at the root), targeting the function.

## Known limitations

- **`.js`, `.jsx`, `.mjs`, `.cjs` are not indexed** in this prototype.
- `.js` specifiers that point at `.ts` sources (`import "./x.js"` for `x.ts`, the
  NodeNext/ESM convention) are not mapped and resolve to nothing.
- `tsconfig.json` path aliases, `baseUrl` and project references are ignored.
- `export *` barrels are import edges only; names are not followed through them for calls.
- `export { a as b }` without `from` (a local rename) is not followed; `b` resolves to nothing.
- Namespaces (`namespace X { … }`) and `declare module` blocks don't qualify names; functions
  inside them are qualified as if at their enclosing level.
- No type information: `const r: Repo = …; r.find()` is an unknown-receiver call.
- **Grammar gaps:** a file the grammar can't parse becomes a childless file node with a
  warning. With tree-sitter-typescript 0.23.2 (the latest release), this hits `export type * from`
  and some multi-line call or overload signatures inside type literals. On Hono, 8 of 450 files;
  on SWR, 3 of 197.
- Python: the module search root is the repository root only (`src/` layouts don't resolve).

## Manifest

`projectName` = the repo directory name. `commitSha` = 7-character `HEAD` SHA of the repository
containing the indexed directory (found with `gix::discover`, so a subdirectory of a checkout
reports that checkout's `HEAD`), or `"uncommitted"`. `generatedAt` comes from the caller.
`languages` = the sorted set of languages with at least one indexed file.

## Output

`write_output(dir, &output)` creates `dir` and writes each file to a temporary file
(`.<name>.tmp`) that is then renamed into place.

## Dependencies

- `tree-sitter`, `tree-sitter-python`, `tree-sitter-typescript` (`typescript` + `tsx` grammars),
  `tree-sitter-c`, `tree-sitter-go`: parsing.
- `ignore`: `.gitignore`-aware walking.
- `gix` (`default-features = false`, `sha1`): reads `HEAD` without spawning `git`. Chosen over
  `git2` because it is pure Rust (no libgit2 / C toolchain or OpenSSL for CI and the Tauri build),
  and only `discover` + `head_id` are needed.
- `thiserror`: the library error type.
- Dev: `similar` (readable golden-test diffs), `tempfile`.

## Entry points (v0.3, Phase 14 Parts A–B)

Python main guards compare __name__ to the literal __main__ in either order;
parentheses are allowed. Each guard produces a file-target entry with direct calls
from its block. Package __main__.py produces a package-main entry with top-level calls.
Calls inside nested functions, classes and lambdas are excluded from script entries.
TypeScript groups calls by their top-level statement, emitting one entry per statement
with resolved in-repo calls or ambiguous in-repo candidates. Inline callbacks and class
bodies are excluded. Declaration files produce no entries. Calls use the existing
resolver; unknown receivers remain ambiguous and external calls remain absent.

Every package.json and pyproject.toml found under the existing walker policy is read
as data. Config files do not become graph nodes; historical indexing includes them.
Python reads project.scripts, project.gui-scripts and tool.poetry.scripts string values;
module:function targets resolve relative to the config directory (no src-layout search).
TypeScript reads string/map bin, main, module and exports["."] string or conditional
string leaves. Npm scripts recognize an anchored node, ts-node, tsx, bun or deno run,
then a path token; shell operators end that token. Flags before the path, variable
expansion and paths containing spaces are not interpreted. Nothing is executed.
All config paths resolve lexically relative to their config; escaping the repository,
ignored files, dependencies, symlinks and unindexed build output cannot become targets.
Unresolvable declared targets remain null with raw values intact. Invalid config emits
a warning and indexing continues. Evidence lines refer to each exact parsed value,
including duplicate values. TOML spans and borrowed JSON values preserve those locations.

New hand-written goldens: fixtures/py-flows/expected and fixtures/ts-flows/expected.
Their NOTES.md files explain the expected calls and intentionally unresolved cases.
Dependencies added: toml for data parsing; serde_json raw_value for exact evidence.

# Phase 03 — Extractor: TypeScript

## Context

The core from Phase 02 is in place. This phase adds a TypeScript backend without changing the core's behaviour for Python.

## Read first

- `CLAUDE.md`
- `crates/gitvur-schema/README.md`
- `crates/gitvur-index/README.md` (rules from Phase 02)
- `fixtures/ts-small/expected/structure.json` and `NOTES.md`

## Goal

`gitvur index fixtures/ts-small` produces a `structure.json` byte-identical to the expected file, and the Python golden test still passes.

## Scope

**Create / modify:** `crates/gitvur-index/src/lang/typescript.rs`, `crates/gitvur-index/queries/typescript.scm`, minimal changes to the core if the trait needs them.
**Do not touch:** `fixtures/*/expected/`, `crates/gitvur-schema/`, `app/`.

### Dependencies

```text
tree-sitter-typescript   # use the `typescript` grammar for .ts and the `tsx` grammar for .tsx
```

## Tasks

1. **Extensions:** `.ts`, `.tsx`, `.mts`, `.cts`, `.d.ts`. Skip `.js` in this prototype (record in README).
2. **Definitions:**
    - `class_declaration` (exported or not, including `abstract`) → class node.
    - `method_definition` inside a class → function node `Class.method`. Getters/setters: name `get name` / `set name` is **not** used; record them as `name` and suffix duplicates per the contract.
    - `function_declaration` → function node. Overload signatures collapse into the implementation node.
    - `const x = () => {}` / `const x = function () {}` at module level → function node `x`. Nested arrow functions inside functions are **not** nodes in this phase (record in README).
    - `.d.ts` files: file node only.
    - Decorators included in the range, as in Python.
3. **Imports (TS resolution rules):**
    - Only relative specifiers (`./`, `../`) resolve. Bare specifiers (packages) are external → ignored. `tsconfig` path aliases are **out of scope** (record in README).
    - Try, in order: exact path, `+.ts`, `+.tsx`, `+.d.ts`, `/index.ts`, `/index.tsx`.
    - Named, aliased, default, namespace imports, and `export … from` re-exports all bind names.
    - Type-only imports (`import type`) still produce `imports` edges.
4. **Calls:** same conservative rules as Python, with `this.m()` for the enclosing class, `new C()` → class node, `ns.f()` for namespace imports.
5. Keep the Python behaviour unchanged.

## Tests

- Golden test for `ts-small`.
- Python golden test still passes.
- Determinism for both.
- Unit tests for each resolution rule (index files, overloads, aliased imports, re-exports).

## Acceptance criteria

- [ ] Golden tests pass for both fixtures
- [ ] Determinism passes for both
- [ ] `node_modules/` absent from output
- [ ] Runs on a real medium TypeScript repo without panicking; measurements recorded in `PROGRESS.md`
- [ ] README updated with every TS rule and every known limitation

## Verify

```bash
cargo test -p gitvur-index
cargo run -p gitvur-cli -- index fixtures/ts-small --out /tmp/gv-ts
cargo clippy --workspace --all-targets -- -D warnings
```

## When done

Update `PROGRESS.md`, including the share of unresolved calls on the real repo (unresolved / (edges of type calls + unresolved)). Stop.

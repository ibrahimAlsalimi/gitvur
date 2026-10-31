# go-small — hand-written expectations (Go support)

**HUMAN REVIEW REQUIRED.** Written by reading the source before the Go backend existed. A
helper only hashed explicitly declared line ranges; it did not parse Go. Nothing here is built
or run.

Totals: 5 files, 4 classes, 11 functions, 1 project; 4 import edges, 7 call edges; 1 ambiguous
call; 1 entry point.

## Nodes

- `.go` files are file nodes; `go.mod` is configuration only.
- `type T struct{…}` and `type T interface{…}` are class nodes (range of the type spec).
- `func F` is a function. A method `func (r *T) M` is `T.M`: a child of class `T` when `T` is
  declared earlier in the same file (`Repo.Save`, `Service.Place`), otherwise a file-level
  function that keeps the `T.` qualifier (`count.go`: `Service.Count`, name `Count`).

## Imports (packages are directories)

- `go.mod` declares `module example.com/shop`; an import path under it names the directory
  after the prefix. `example.com/shop/internal/orders` (cmd/shop/main.go:3) imports every file
  of that package: one edge per file. Without a matching `go.mod` module nothing resolves;
  directory names are never matched on their own (a local `log/` is not the standard `log`).
- `fmt` and `errors` are outside the repository and dropped.

## Calls

1. Same file, then the same package (directory): `Submit` → `NewService`; `Place` →
   `validate` in validate.go (line 23); `countdown` recursion; `Count` → `countdown`.
2. `pkg.F()` through an imported package: `orders.Submit` (main.go:6).
3. A call on the method's own receiver resolves in the receiver's type: `r.flush()`
   (store.go:10) → `Repo.flush`.
4. Any other receiver is unknown: two or more methods with that name are ambiguous
   (`s.repo.Save`, orders.go:26 → `Cache.Save`, `Repo.Save`; the interface's `Save` is a method
   spec, not a definition); one or none is dropped (`s.Place`, orders.go:19).

## Entry points

`func main()` in a `package main` file is a `main-function` entry named by the package
directory (`cmd/shop`), targeting the function (main.go:5).

#!/usr/bin/env python3
"""Automated staleness test: edit 5 function bodies in a copy and check the validator's verdict.

Usage: staleness_test.py <gitvur-binary> <annotated-repo> <work-dir>

1. Copies <annotated-repo> (with its .gitvur/) to <work-dir>/stale-copy, then runs
   `gitvur index` and `gitvur validate` there for the baseline statuses.
2. Picks 5 functions with `random.Random(2026)`: candidate IDs are sorted, shuffled and taken in
   order. A function is eligible if it and all its ancestors are `documented`, it is neither an
   ancestor nor a descendant of an earlier pick, its file parses with Python's `ast` (parsing
   only; nothing is executed), the `ast` node ends on the extractor's `endLine`, and its body
   starts on its own space-indented line.
3. Appends `pass  # gitvur-eval` after the last statement of each body, at the body's
   indentation, then re-runs `gitvur index` and `gitvur validate`.
4. Checks: the 5 are `stale` with `selfChanged`; each of their ancestors up to the file is
   `stale` with `childChanged` only; every other element keeps its baseline status.

Prints the result as Markdown and exits 1 if any check fails. Stdlib only.
"""

import ast
import json
import random
import shutil
import subprocess
import sys
from pathlib import Path

SEED = 2026
PICKS = 5
STATEMENT = "pass  # gitvur-eval"


def run(gitvur: str, *args: str) -> None:
    subprocess.run([gitvur, *args], capture_output=True, text=True, check=False)


def statuses(repo: Path) -> dict[str, dict]:
    report = json.loads((repo / ".gitvur" / "report.json").read_text())
    return {e["id"]: e for e in report["elements"]}


def short_name(node_id: str) -> str:
    return node_id.rsplit(":", 1)[1].rsplit(".", 1)[-1].split("#", 1)[0]


def find_def(tree: ast.AST, name: str, end_line: int) -> ast.AST | None:
    for node in ast.walk(tree):
        if (
            isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and node.name == name
            and node.end_lineno == end_line
        ):
            return node
    return None


def main() -> None:
    gitvur, source, work = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
    copy = work / "stale-copy"
    if copy.exists():
        shutil.rmtree(copy)
    shutil.copytree(source, copy, symlinks=True)

    run(gitvur, "index", str(copy))
    run(gitvur, "validate", str(copy))
    before = statuses(copy)
    structure = json.loads((copy / ".gitvur" / "structure.json").read_text())
    nodes = {n["id"]: n for n in structure["nodes"]}

    def ancestors(node_id: str) -> list[str]:
        out = []
        parent = nodes[node_id].get("parentId")
        while parent and parent in nodes and nodes[parent]["type"] != "project":
            out.append(parent)
            parent = nodes[parent].get("parentId")
        return out

    def documented(node_id: str) -> bool:
        return before.get(node_id, {}).get("status") == "documented"

    candidates = sorted(i for i, n in nodes.items() if n["type"] == "function")
    rng = random.Random(SEED)
    rng.shuffle(candidates)

    picks: list[tuple[str, int, str]] = []  # (id, insert after line, indentation)
    skipped: dict[str, int] = {}
    parsed: dict[str, ast.AST | None] = {}
    for node_id in candidates:
        if len(picks) == PICKS:
            break
        chain = ancestors(node_id)
        taken = [p[0] for p in picks]
        if not documented(node_id) or not all(documented(a) for a in chain):
            skipped["not documented"] = skipped.get("not documented", 0) + 1
            continue
        if any(t in chain or node_id in ancestors(t) for t in taken):
            skipped["nested with an earlier pick"] = skipped.get("nested with an earlier pick", 0) + 1
            continue
        src = nodes[node_id]["source"]
        path = copy / src["file"]
        if src["file"] not in parsed:
            try:
                parsed[src["file"]] = ast.parse(path.read_text(encoding="utf-8"))
            except (SyntaxError, UnicodeDecodeError, ValueError):
                parsed[src["file"]] = None
        tree = parsed[src["file"]]
        found = find_def(tree, short_name(node_id), src["endLine"]) if tree else None
        if found is None:
            skipped["file does not parse or no matching def"] = (
                skipped.get("file does not parse or no matching def", 0) + 1
            )
            continue
        lines = path.read_text(encoding="utf-8").splitlines()
        first = found.body[0]
        indent = lines[first.lineno - 1][: first.col_offset]
        if first.lineno == found.lineno or indent.strip(" ") or not indent:
            skipped["one-line or tab-indented body"] = skipped.get("one-line or tab-indented body", 0) + 1
            continue
        picks.append((node_id, found.body[-1].end_lineno, indent))

    # Edit bottom-up within each file so earlier insert points stay valid.
    for node_id, after, indent in sorted(picks, key=lambda p: (nodes[p[0]]["source"]["file"], -p[1])):
        path = copy / nodes[node_id]["source"]["file"]
        text = path.read_text(encoding="utf-8")
        lines = text.splitlines(keepends=True)
        newline = "\r\n" if lines[after - 1].endswith("\r\n") else "\n"
        if not lines[after - 1].endswith(("\n", "\r")):
            lines[after - 1] += newline
        lines.insert(after, f"{indent}{STATEMENT}{newline}")
        path.write_text("".join(lines), encoding="utf-8")
        ast.parse("".join(lines))  # the edit must keep the file valid Python

    run(gitvur, "index", str(copy))
    run(gitvur, "validate", str(copy))
    after_status = statuses(copy)

    expected: dict[str, tuple[str, bool | None, bool | None]] = {}
    for node_id, _, _ in picks:
        expected[node_id] = ("stale", False, True)
    for node_id, _, _ in picks:
        for a in ancestors(node_id):
            expected.setdefault(a, ("stale", True, False))

    def actual(node_id: str) -> tuple[str, bool | None, bool | None]:
        e = after_status.get(node_id, {})
        return (e.get("status", "missing"), e.get("childChanged"), e.get("selfChanged"))

    problems = []
    for node_id, want in sorted(expected.items()):
        if actual(node_id) != want:
            problems.append(f"`{node_id}`: expected {want}, got {actual(node_id)}")
    for node_id in sorted(set(before) | set(after_status)):
        if node_id in expected:
            continue
        b = before.get(node_id, {}).get("status", "missing")
        a = after_status.get(node_id, {}).get("status", "missing")
        if a != b:
            problems.append(f"`{node_id}`: unexpected change {b} → {a}")

    print("| Edited function | Inserted after line | Status after | childChanged | selfChanged |")
    print("| --- | --- | --- | --- | --- |")
    for node_id, line, _ in picks:
        s, c, f = actual(node_id)
        print(f"| `{node_id}` | {line} | {s} | {c} | {f} |")
    print()
    print("| Container | Status after | childChanged | selfChanged |")
    print("| --- | --- | --- | --- |")
    for node_id in sorted(k for k, v in expected.items() if v[1]):
        s, c, f = actual(node_id)
        print(f"| `{node_id}` | {s} | {c} | {f} |")
    print()
    print(f"- Elements compared: {len(set(before) | set(after_status)):,}")
    print(f"- Expected to change: {len(expected)}")
    print(f"- Candidates skipped before the {len(picks)} picks: " + (
        ", ".join(f"{k}: {v}" for k, v in sorted(skipped.items())) or "none"
    ))
    print(f"- Discrepancies: {len(problems)}")
    for p in problems:
        print(f"  - {p}")
    print()
    ok = len(picks) == PICKS and not problems
    print(f"**Result: {'PASS' if ok else 'FAIL'}**")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()

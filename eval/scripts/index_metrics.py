#!/usr/bin/env python3
"""Run `gitvur index` three times on a repository and print the counts as Markdown.

Usage: index_metrics.py <gitvur-binary> <repo>

Only the gitvur binary is executed; nothing in <repo> is run. Counts are read from
<repo>/.gitvur/structure.json after the last run. Stdlib only.
"""

import json
import statistics
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path


def main() -> None:
    gitvur, repo = sys.argv[1], Path(sys.argv[2])
    times_ms = []
    stderr = ""
    for _ in range(3):
        start = time.perf_counter()
        run = subprocess.run([gitvur, "index", str(repo)], capture_output=True, text=True, check=True)
        times_ms.append((time.perf_counter() - start) * 1000)
        stderr = run.stderr

    structure = json.loads((repo / ".gitvur" / "structure.json").read_text())
    nodes = structure["nodes"]
    edges = structure["edges"]
    unresolved = structure["unresolvedCalls"]
    node_types = Counter(n["type"] for n in nodes)
    edge_types = Counter(e["type"] for e in edges)
    calls = edge_types.get("calls", 0)
    warnings = [line for line in stderr.splitlines() if line.startswith("warning:")]

    print("| Metric | Value |")
    print("| --- | --- |")
    print(f"| Files | {node_types['file']:,} |")
    print(f"| Nodes (all) | {len(nodes):,} |")
    for kind in ("project", "file", "class", "function"):
        print(f"| Nodes: {kind} | {node_types[kind]:,} |")
    print(f"| Edges (all) | {len(edges):,} |")
    for kind in sorted(edge_types):
        print(f"| Edges: {kind} | {edge_types[kind]:,} |")
    print(f"| Unresolved calls | {len(unresolved):,} |")
    share = len(unresolved) / (calls + len(unresolved)) if calls + len(unresolved) else 0.0
    print(f"| Unresolved share (unresolved / (call edges + unresolved)) | {share:.1%} |")
    print(f"| Extractor warnings | {len(warnings)} |")
    runs = ", ".join(f"{t:.0f}" for t in times_ms)
    print(f"| Run time, median of 3 (ms) | {statistics.median(times_ms):.0f} (runs: {runs}) |")


if __name__ == "__main__":
    main()

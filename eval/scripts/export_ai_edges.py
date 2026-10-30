#!/usr/bin/env python3
"""Write every AI-provenance edge from annotations.json to CSV for human rating.

Usage: export_ai_edges.py <repo> <out.csv>

`evidence_text` is the evidence line read from <repo>, after checking that the path stays
inside the repository root (symlinks included). Rows are sorted by (from, to, type). The
rating and comment columns are left empty. Stdlib only; nothing in <repo> is executed.
"""

import csv
import json
import sys
from pathlib import Path

COLUMNS = (
    "from",
    "to",
    "type",
    "evidence_file",
    "evidence_line",
    "evidence_text",
    "note",
    "rating",
    "comment",
)


def evidence_line(root: Path, rel: str, line: int) -> str:
    path = (root / rel).resolve()
    if root not in path.parents or not path.is_file():
        return "<path rejected>"
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    return lines[line - 1].strip() if 1 <= line <= len(lines) else "<line out of range>"


def main() -> None:
    repo, out = Path(sys.argv[1]), Path(sys.argv[2])
    root = repo.resolve()
    annotations = json.loads((repo / ".gitvur" / "annotations.json").read_text())
    edges = sorted(
        (e for e in annotations["edges"] if e.get("provenance") == "ai"),
        key=lambda e: (e["from"], e["to"], e["type"]),
    )
    with out.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS, lineterminator="\n")
        writer.writeheader()
        for e in edges:
            ev = e.get("evidence") or {}
            writer.writerow(
                {
                    "from": e["from"],
                    "to": e["to"],
                    "type": e["type"],
                    "evidence_file": ev.get("file", ""),
                    "evidence_line": ev.get("line", ""),
                    "evidence_text": evidence_line(root, ev["file"], ev["line"]) if ev else "",
                    "note": e.get("note", ""),
                    "rating": "",
                    "comment": "",
                }
            )
    print(f"wrote {len(edges)} rows to {out}")


if __name__ == "__main__":
    main()

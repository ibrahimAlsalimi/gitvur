#!/usr/bin/env python3
"""Pick the description sample for human rating and write it as CSV.

Usage: sample_descriptions.py <repo> <out.csv>

Reads <repo>/.gitvur/structure.json and annotations.json. Picks, with `random.Random(2026)`,
5 modules, 5 files, 5 classes and 15 functions among the elements that have a non-empty
description. Candidates are sorted by ID before sampling, so the sample depends only on the
seed and the two input files. The rating, misleading and comment columns are left empty.
Stdlib only; nothing in <repo> is executed.
"""

import csv
import json
import random
import sys
from pathlib import Path

SEED = 2026
STRATA = (("module", 5), ("file", 5), ("class", 5), ("function", 15))
COLUMNS = ("id", "type", "file", "lines", "description", "rating", "misleading", "comment")


def main() -> None:
    repo, out = Path(sys.argv[1]), Path(sys.argv[2])
    gitvur = repo / ".gitvur"
    structure = json.loads((gitvur / "structure.json").read_text())
    annotations = json.loads((gitvur / "annotations.json").read_text())

    nodes = {n["id"]: n for n in structure["nodes"]}
    text = {}
    for d in annotations["descriptions"]:
        if d["text"].strip() and d["id"] in nodes:
            text.setdefault(d["id"], d["text"])
    modules = {m["id"]: m for m in annotations["modules"] if m.get("description", "").strip()}

    rng = random.Random(SEED)
    rows = []
    for kind, count in STRATA:
        if kind == "module":
            pool = sorted(modules)
        else:
            pool = sorted(i for i, n in nodes.items() if n["type"] == kind and i in text)
        for element_id in rng.sample(pool, min(count, len(pool))):
            if kind == "module":
                module = modules[element_id]
                rows.append(
                    {
                        "id": element_id,
                        "type": kind,
                        "file": f"{len(module['files'])} files",
                        "lines": "",
                        "description": module["description"],
                    }
                )
            else:
                source = nodes[element_id]["source"]
                rows.append(
                    {
                        "id": element_id,
                        "type": kind,
                        "file": source["file"],
                        "lines": f"{source['startLine']}-{source['endLine']}",
                        "description": text[element_id],
                    }
                )

    with out.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS, lineterminator="\n")
        writer.writeheader()
        for row in rows:
            writer.writerow({c: row.get(c, "") for c in COLUMNS})
    print(f"wrote {len(rows)} rows to {out}")


if __name__ == "__main__":
    main()

/** One line of a two-way diff. Indices point into the old (`a`) and new (`b`) arrays. */
export type DiffOp =
  { kind: "same"; a: number; b: number } | { kind: "del"; a: number } | { kind: "add"; b: number };

/** Longer inputs are compared as one replaced block instead (keeps the table bounded). */
const MAX_CELLS = 4_000_000;

/**
 * Line diff by longest common subsequence. Ties prefer deletions before additions, so a
 * changed line reads as `- old` then `+ new`.
 */
export function diffLines(a: readonly string[], b: readonly string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  if (n * m > MAX_CELLS) {
    return [
      ...a.map((_, i) => ({ kind: "del", a: i }) as const),
      ...b.map((_, j) => ({ kind: "add", b: j }) as const),
    ];
  }
  // lcs[i][j] = LCS length of a[i..] and b[j..], flattened.
  const lcs = new Uint32Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[at(i, j)] =
        a[i] === b[j]
          ? (lcs[at(i + 1, j + 1)] ?? 0) + 1
          : Math.max(lcs[at(i + 1, j)] ?? 0, lcs[at(i, j + 1)] ?? 0);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      ops.push({ kind: "same", a: i, b: j });
      i += 1;
      j += 1;
    } else if (i < n && (j >= m || (lcs[at(i + 1, j)] ?? 0) >= (lcs[at(i, j + 1)] ?? 0))) {
      ops.push({ kind: "del", a: i });
      i += 1;
    } else {
      ops.push({ kind: "add", b: j });
      j += 1;
    }
  }
  return ops;
}

/** Side-by-side rows: unchanged lines pair up; a run of deletions pairs with the following
 * run of additions, row by row, with blanks for the shorter side. */
export function sideBySide(ops: readonly DiffOp[]): { left?: number; right?: number }[] {
  const rows: { left?: number; right?: number }[] = [];
  let k = 0;
  while (k < ops.length) {
    const op = ops[k] as DiffOp;
    if (op.kind === "same") {
      rows.push({ left: op.a, right: op.b });
      k += 1;
      continue;
    }
    const dels: number[] = [];
    const adds: number[] = [];
    while (k < ops.length && ops[k]?.kind === "del") {
      dels.push((ops[k] as { a: number }).a);
      k += 1;
    }
    while (k < ops.length && ops[k]?.kind === "add") {
      adds.push((ops[k] as { b: number }).b);
      k += 1;
    }
    for (let r = 0; r < Math.max(dels.length, adds.length); r += 1) {
      const row: { left?: number; right?: number } = {};
      const left = dels[r];
      const right = adds[r];
      if (left !== undefined) row.left = left;
      if (right !== undefined) row.right = right;
      rows.push(row);
    }
  }
  return rows;
}

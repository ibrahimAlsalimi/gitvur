import { describe, expect, it } from "vitest";

import { diffLines, sideBySide } from "./lineDiff";

const show = (a: string[], b: string[]) =>
  diffLines(a, b).map((op) =>
    op.kind === "same"
      ? `  ${a[op.a] ?? ""}`
      : op.kind === "del"
        ? `- ${a[op.a] ?? ""}`
        : `+ ${b[op.b] ?? ""}`,
  );

describe("diffLines", () => {
  it("keeps common lines and shows a change as deletion then addition", () => {
    expect(
      show(["def f():", "    x = 1", "    return x"], ["def f():", "    x = 2", "    return x"]),
    ).toEqual(["  def f():", "-     x = 1", "+     x = 2", "      return x"]);
  });

  it("handles pure additions, deletions and empty sides", () => {
    expect(show(["a", "c"], ["a", "b", "c"])).toEqual(["  a", "+ b", "  c"]);
    expect(show(["a", "b"], ["b"])).toEqual(["- a", "  b"]);
    expect(show([], ["x"])).toEqual(["+ x"]);
    expect(show(["x"], [])).toEqual(["- x"]);
  });
});

describe("sideBySide", () => {
  it("pairs a deletion run with the following addition run", () => {
    const ops = diffLines(["a", "b", "c", "d"], ["a", "B", "C", "X", "d"]);
    expect(sideBySide(ops)).toEqual([
      { left: 0, right: 0 },
      { left: 1, right: 1 },
      { left: 2, right: 2 },
      { right: 3 },
      { left: 3, right: 4 },
    ]);
  });
});

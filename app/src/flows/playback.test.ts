import { describe, expect, it } from "vitest";

import type { Flow, FlowTransition, TransitionKind } from "../generated/contract";
import { REST, choose, declined, jumpTo, next, visited } from "./playback";

const t = (from: string, to: string, kind: TransitionKind = "call", label?: string) =>
  ({ from, to, kind, provenance: "syntactic", ...(label ? { label } : {}) }) as FlowTransition;

const flow = (ids: string[], transitions: FlowTransition[]): Flow => ({
  id: "flow:x",
  name: "X",
  description: "",
  entryPoint: "entry:x",
  steps: ids.map((id) => ({ id, node: `function:a.py:${id}`, label: id, basedOnHash: "h" })),
  transitions,
});

const run = (f: Flow, steps: number) => {
  let s = REST;
  for (let i = 0; i < steps; i++) s = next(f, s);
  return s;
};

describe("playback", () => {
  it("walks a linear flow and ends", () => {
    const f = flow(["s1", "s2", "s3"], [t("s1", "s2"), t("s2", "s3")]);
    expect(run(f, 1).current).toBe("s1");
    const end = run(f, 3);
    expect(end.current).toBe("s3");
    expect([...visited(end)]).toEqual(["s1", "s2", "s3"]);
    expect(next(f, end).done).toBe(true);
    expect(next(f, next(f, end))).toEqual(next(f, end));
  });

  it("finishes a call chain before an event, resuming from the caller", () => {
    // s2 calls s3 (which calls s4), then fires an event to s5.
    const f = flow(
      ["s1", "s2", "s3", "s4", "s5"],
      [t("s1", "s2"), t("s2", "s3"), t("s3", "s4"), t("s2", "s5", "event", "saved")],
    );
    const order = [];
    let s = REST;
    for (;;) {
      s = next(f, s);
      if (s.done) break;
      order.push(s.current);
    }
    expect(order).toEqual(["s1", "s2", "s3", "s4", "s5"]);
    expect(s.path.at(-1)).toEqual({ step: "s5", via: 3 });
  });

  it("follows a return back to the caller as a step", () => {
    const f = flow(["s1", "s2", "s3"], [t("s1", "s2"), t("s2", "s1", "return"), t("s1", "s3")]);
    expect([1, 2, 3, 4].map((n) => run(f, n).current)).toEqual(["s1", "s2", "s1", "s3"]);
  });

  it("pauses at a branch and follows the chosen path, dimming the other", () => {
    const f = flow(
      ["s1", "s2", "s3", "s4"],
      [t("s1", "s2"), t("s2", "s3", "branch", "if ok"), t("s2", "s4", "branch", "if not")],
    );
    const paused = run(f, 3);
    expect(paused.current).toBe("s2");
    expect(paused.options).toEqual([1, 2]);
    expect(next(f, paused)).toBe(paused); // Next waits for a choice
    const chosen = choose(f, paused, 2);
    expect(chosen.current).toBe("s4");
    expect([...declined(f, chosen)]).toEqual(["s3"]);
    expect(next(f, chosen).done).toBe(true);
  });

  it("declines a lone branch with 'otherwise' after the unconditional path", () => {
    // s1 always calls s2; only when run as a script does it branch to s3.
    const f = flow(["s1", "s2", "s3"], [t("s1", "s2"), t("s1", "s3", "branch", "as a script")]);
    const paused = run(f, 3);
    expect(paused.current).toBe("s1");
    expect(paused.options).toEqual([1]);
    const out = choose(f, paused, null);
    expect(out.done).toBe(true);
    expect([...declined(f, out)]).toEqual(["s3"]);
  });

  it("loops through recursion once and ends", () => {
    const f = flow(["s1", "s2"], [t("s1", "s2", "branch", "while n > 0"), t("s2", "s1")]);
    const paused = run(f, 2);
    expect(paused.options).toEqual([0]);
    const s = next(f, choose(f, paused, 0));
    expect(s.current).toBe("s1");
    expect(next(f, s).done).toBe(true);
  });

  it("restarts from rest and jumps to a step through branches", () => {
    const f = flow(
      ["s1", "s2", "s3", "s4"],
      [t("s1", "s2"), t("s2", "s3", "branch", "a"), t("s2", "s4", "branch", "b")],
    );
    const at = jumpTo(f, "s4");
    expect(at.current).toBe("s4");
    expect([...visited(at)]).toEqual(["s1", "s2", "s4"]);
    expect(jumpTo(f, "s1").path).toEqual([{ step: "s1", via: null }]);
    const lone = flow(["s1", "s2"], []);
    expect(jumpTo(lone, "s2").current).toBe("s2");
    expect(next(flow([], []), REST).done).toBe(true);
  });
});

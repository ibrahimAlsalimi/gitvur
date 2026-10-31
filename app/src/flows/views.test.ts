import { describe, expect, it } from "vitest";

import type { RepoBundle, Trace } from "../generated/contract";
import mockTraces from "../api/mockTraces.json";
import pyAnnotations from "../../../fixtures/py-flows/.gitvur/annotations.json";
import pyManifest from "../../../fixtures/py-flows/.gitvur/manifest.json";
import pyReport from "../../../fixtures/py-flows/.gitvur/report.json";
import pyStructure from "../../../fixtures/py-flows/.gitvur/structure.json";
import tsAnnotations from "../../../fixtures/ts-flows/.gitvur/annotations.json";
import tsManifest from "../../../fixtures/ts-flows/.gitvur/manifest.json";
import tsReport from "../../../fixtures/ts-flows/.gitvur/report.json";
import tsStructure from "../../../fixtures/ts-flows/.gitvur/structure.json";
import { buildModel } from "../model/buildModel";
import { flowView } from "./flowView";
import { graftTrace, initialExpanded, traceText, traceView } from "./traceView";

const traces = mockTraces as unknown as Record<string, Trace>;
const trace = (key: string): Trace => {
  const t = traces[key];
  if (!t) throw new Error(`no mock trace ${key}`);
  return t;
};
const model = (which: "py" | "ts") =>
  buildModel({
    root: "/r",
    warnings: [],
    ...(which === "py"
      ? {
          manifest: pyManifest,
          structure: pyStructure,
          annotations: pyAnnotations,
          report: pyReport,
        }
      : {
          manifest: tsManifest,
          structure: tsStructure,
          annotations: tsAnnotations,
          report: tsReport,
        }),
  } as RepoBundle);

describe("flowView", () => {
  it("puts steps in module lanes, marks the entry, terminals and branch sources", () => {
    const m = model("py");
    const flow = m.flows.flowsById.get("flow:cli-places-order");
    if (!flow) throw new Error("fixture changed");
    const view = flowView(m, flow, m.flows.flowStatusById.get(flow.id));
    expect([...new Set(view.steps.map((s) => s.laneName))]).toEqual([
      "Entry points",
      "Order service",
      "Domain rules",
      "Storage",
    ]);
    expect(view.steps[0]?.entry).toBe(true);
    expect(view.steps.filter((s) => s.terminal).map((s) => s.id)).toEqual(["s6", "s7"]);
    expect(view.steps[1]).toMatchObject({ qualified: "submit", location: "orders.py:5" });
    expect([view.fromCode, view.ai]).toEqual([5, 1]);
    expect(view.transitions.find((t) => t.transition.kind === "event")?.text).toBe("⚡ saved");
    const backends = m.flows.flowsById.get("flow:backends-self-check");
    if (!backends) throw new Error("fixture changed");
    const b = flowView(m, backends, undefined);
    expect(b.steps[0]).toMatchObject({
      branches: true,
      qualified: "backends.py",
      location: "backends.py",
    });
  });

  it("keeps a step whose element is gone, in its own lane", () => {
    const m = model("py");
    const flow = structuredClone(m.flows.flowsById.get("flow:http-order-request"));
    if (!flow?.steps[1]) throw new Error("fixture changed");
    flow.steps[1].node = "function:flowapp/gone.py:x";
    const view = flowView(m, flow, undefined);
    expect(view.steps[1]).toMatchObject({
      node: undefined,
      qualified: "x",
      laneName: "No longer in the code",
    });
  });
});

describe("traceView", () => {
  it("prints exactly the CLI's text format", () => {
    expect(traceText(trace("ts-flows|entry:top-level-call:src-backends-ts#2"))).toBe(
      "entry:top-level-call:src-backends-ts#2\n" +
        "  ? save [function:src/backends.ts:Cache.save, function:src/backends.ts:Disk.save]\n",
    );
    expect(traceText(trace("ts-flows|function:src/backends.ts:countdown"))).toBe(
      "function:src/backends.ts:countdown\n" +
        "  function:src/backends.ts:countdown [trace:1]\n" +
        "    ⟲ function:src/backends.ts:countdown → trace:1\n",
    );
  });

  it("starts expanded to depth 2 with +n expanders below", () => {
    const m = model("py");
    const t = trace("py-flows|entry:console-script:flow-shop");
    const view = traceView(m, t, initialExpanded(t), new Set());
    expect(view.cards.map((c) => c.title)).toEqual(["main", "submit", "validate"]);
    expect(view.cards[2]).toMatchObject({ hidden: 1, expanded: false });
    expect(view.edges.map((e) => e.provenance)).toEqual(["syntactic", "syntactic"]);
  });

  it("draws cycles as loops back to the first occurrence and opens ambiguous candidates", () => {
    const m = model("ts");
    const cyc = trace("ts-flows|function:src/backends.ts:countdown");
    const view = traceView(m, cyc, initialExpanded(cyc), new Set());
    expect(view.cards.map((c) => c.kind)).toEqual(["node", "cycle"]);
    expect(view.edges.find((e) => e.loop)).toMatchObject({ from: "trace:2", to: "trace:1" });

    const amb = trace("ts-flows|entry:top-level-call:src-backends-ts#2");
    const closed = traceView(m, amb, new Set(), new Set());
    expect(closed.cards.map((c) => c.kind)).toEqual(["ambiguous"]);
    const open = traceView(m, amb, new Set(), new Set(["trace:1"]));
    expect(open.cards.map((c) => [c.kind, c.title])).toEqual([
      ["ambiguous", "save"],
      ["candidate", "Cache.save"],
      ["candidate", "Disk.save"],
    ]);
    expect(open.edges.every((e) => e.provenance === "candidate")).toBe(true);
  });

  it("grafts a deeper trace in place of a truncated subtree", () => {
    // What `get_trace(..., depth 2)` returns for the console script.
    const base: Trace = {
      start: "entry:console-script:flow-shop",
      roots: ["trace:1"],
      truncated: true,
      hiddenRoots: 0,
      error: null,
      nodes: [
        ["trace:1", "function:flowapp/cli.py:main", 0, ["trace:2"]],
        ["trace:2", "function:flowapp/service/orders.py:submit", 1, ["trace:3"]],
        ["trace:3", "function:flowapp/domain/rules.py:validate", 2, []],
      ].map(([id, node, depth, children]) => ({
        id: id as string,
        kind: "node" as const,
        node: node as string,
        name: (node as string).split(":").at(-1) ?? "",
        depth: depth as number,
        children: children as string[],
        reference: null,
        candidates: [],
        evidence: null,
        truncated: id === "trace:3",
        hiddenChildren: id === "trace:3" ? 1 : 0,
      })),
    };
    const sub = trace("py-flows|function:flowapp/domain/rules.py:validate");
    const merged = graftTrace(base, "trace:3", sub);
    expect(merged.truncated).toBe(false);
    const full = traceText(trace("py-flows|entry:console-script:flow-shop"));
    // Same tree as the full trace; only grafted occurrence IDs differ.
    expect(traceText(merged).replace(/\[trace:[^\]]*\]/g, "[]")).toBe(
      full.replace(/\[trace:[^\]]*\]/g, "[]"),
    );
    expect(merged.nodes.find((n) => n.id === "trace:3")?.children).toEqual(["trace:3/trace:2"]);
    expect(graftTrace(base, "trace:2", sub)).toBe(base); // a different node: no graft
  });
});

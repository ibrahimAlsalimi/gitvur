import { describe, expect, it } from "vitest";

import type { RepoBundle } from "../generated/contract";
import pyAnnotations from "../../../fixtures/py-flows/.gitvur/annotations.json";
import pyManifest from "../../../fixtures/py-flows/.gitvur/manifest.json";
import pyReport from "../../../fixtures/py-flows/.gitvur/report.json";
import pyStructure from "../../../fixtures/py-flows/.gitvur/structure.json";
import { buildModel } from "../model/buildModel";
import { indexFlows } from "./flowModel";

function bundle(overrides: Partial<RepoBundle> = {}): RepoBundle {
  return {
    root: "/r",
    manifest: pyManifest,
    structure: pyStructure,
    annotations: pyAnnotations,
    report: pyReport,
    warnings: [],
    ...overrides,
  } as RepoBundle;
}

describe("indexFlows", () => {
  it("merges static and agent entry points and groups flows by entry", () => {
    const index = indexFlows(bundle());
    expect(index.entryPoints.map((e) => e.id)).toContain("entry:http-route:post-orders");
    expect(index.entryPoints.map((e) => e.id)).toEqual(
      [...index.entryPoints.map((e) => e.id)].sort(),
    );
    expect(index.flowsByEntry.get("entry:console-script:flow-shop")?.map((f) => f.id)).toEqual([
      "flow:cli-places-order",
    ]);
    expect(index.flowStatusById.get("flow:cli-places-order")?.status).toBe("current");
  });

  it("lists every step that shows a node, in flow then reading order", () => {
    const refs = indexFlows(bundle()).flowsThroughNode.get(
      "function:flowapp/service/orders.py:submit",
    );
    expect(refs).toEqual([
      { flowId: "flow:cli-places-order", stepId: "s2", index: 1 },
      { flowId: "flow:http-order-request", stepId: "s2", index: 1 },
    ]);
  });

  it("computes status from hashes when the report has none", () => {
    const annotations = structuredClone(pyAnnotations) as RepoBundle["annotations"];
    const flow = annotations?.flows?.find((f) => f.id === "flow:cli-places-order");
    if (!flow?.steps[1] || !flow.steps[2]) throw new Error("fixture changed");
    flow.steps[1].basedOnHash = "sha256:old";
    flow.steps[2].node = "function:flowapp/gone.py:x";
    const index = indexFlows(bundle({ annotations, report: null }));
    expect(index.flowStatusById.get("flow:cli-places-order")).toEqual({
      id: "flow:cli-places-order",
      status: "broken",
      staleSteps: ["s2"],
    });
    expect(index.flowStatusById.get("flow:http-order-request")?.status).toBe("current");
  });

  it("is attached to the model", () => {
    expect(buildModel(bundle()).flows.flows).toHaveLength(3);
  });
});

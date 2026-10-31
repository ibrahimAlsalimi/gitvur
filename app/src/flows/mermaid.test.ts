import mermaid from "mermaid";
import { describe, expect, it } from "vitest";

import type { RepoBundle } from "../generated/contract";
import pyAnnotations from "../../../fixtures/py-flows/.gitvur/annotations.json";
import pyManifest from "../../../fixtures/py-flows/.gitvur/manifest.json";
import pyReport from "../../../fixtures/py-flows/.gitvur/report.json";
import pyStructure from "../../../fixtures/py-flows/.gitvur/structure.json";
import { buildModel } from "../model/buildModel";
import { flowView } from "./flowView";
import { flowToMermaid } from "./mermaid";

const model = buildModel({
  root: "/r",
  warnings: [],
  manifest: pyManifest,
  structure: pyStructure,
  annotations: pyAnnotations,
  report: pyReport,
} as RepoBundle);

function mermaidOf(id: string) {
  const flow = model.flows.flowsById.get(id);
  if (!flow) throw new Error(`no ${id}`);
  return flowToMermaid(flowView(model, flow, undefined), {
    repo: "py-flows",
    commit: "abc1234",
    flowName: flow.name,
    status: "current",
  });
}

describe("flowToMermaid", () => {
  it("writes one subgraph per lane, numbered nodes and typed edges", () => {
    expect(mermaidOf("flow:http-order-request")).toBe(
      [
        "%% HTTP order request",
        "%% py-flows @ abc1234 · flow status: current",
        "flowchart TD",
        '  subgraph L1["Entry points"]',
        '    n1["1. Receives the order request"]',
        "  end",
        '  subgraph L2["Order service"]',
        '    n2["2. Coordinates the order"]',
        "  end",
        '  subgraph L3["Domain rules"]',
        '    n3["3. Validates and stores the item"]',
        "  end",
        '  subgraph L4["Storage"]',
        '    n4["4. Handles the saved event"]',
        "  end",
        "  n1 --> n2",
        "  n2 --> n3",
        "  n3 --> n2",
        '  n2 -.->|"⚡ saved"| n4',
        "",
      ].join("\n"),
    );
    expect(mermaidOf("flow:backends-self-check")).toContain('  n1 -.->|"when run as a script"| n3');
  });

  it("escapes quotes and markup in labels", () => {
    const flow = structuredClone(model.flows.flowsById.get("flow:http-order-request"));
    if (!flow?.steps[0]) throw new Error("fixture changed");
    flow.steps[0].label = 'Reads "x" <y> #1';
    const out = flowToMermaid(flowView(model, flow, undefined), {
      repo: "r",
      commit: "c",
      flowName: "F",
      status: "stale",
    });
    expect(out).toContain('n1["1. Reads #quot;x#quot; #lt;y#gt; #35;1"]');
  });

  it("parses with the bundled mermaid parser", async () => {
    for (const id of model.flows.flowsById.keys()) {
      await expect(mermaid.parse(mermaidOf(id))).resolves.toMatchObject({
        diagramType: "flowchart-v2",
      });
    }
    await expect(mermaid.parse("flowchart TD\n  n1 -->|unclosed n2")).rejects.toThrow();
  });
});

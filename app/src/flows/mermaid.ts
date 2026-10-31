/** `flowchart TD` text for a flow: one subgraph per lane, dashed lines for AI transitions. */
import type { FlowState } from "../generated/contract";
import type { FlowView } from "./flowView";

/** Mermaid string content: quotes and markup characters become entity codes. */
function text(s: string): string {
  return s
    .replace(/#/g, "#35;")
    .replace(/"/g, "#quot;")
    .replace(/</g, "#lt;")
    .replace(/>/g, "#gt;")
    .replace(/[\r\n]+/g, " ");
}

export interface MermaidHeader {
  repo: string;
  commit: string;
  flowName: string;
  status: FlowState;
}

export function flowToMermaid(view: FlowView, header: MermaidHeader): string {
  const lines = [
    `%% ${header.flowName.replace(/[\r\n]+/g, " ")}`,
    `%% ${header.repo} @ ${header.commit} · flow status: ${header.status}`,
    "flowchart TD",
  ];
  const nodeId = new Map(view.steps.map((s) => [s.id, `n${String(s.index + 1)}`] as const));
  const lanes = new Map<string, { name: string; steps: typeof view.steps }>();
  for (const s of view.steps) {
    const lane = lanes.get(s.lane);
    if (lane) lane.steps.push(s);
    else lanes.set(s.lane, { name: s.laneName, steps: [s] });
  }
  let laneNo = 0;
  for (const { name, steps } of lanes.values()) {
    laneNo += 1;
    lines.push(`  subgraph L${String(laneNo)}["${text(name)}"]`);
    for (const s of steps) {
      lines.push(`    ${nodeId.get(s.id) ?? ""}["${String(s.index + 1)}. ${text(s.step.label)}"]`);
    }
    lines.push("  end");
  }
  for (const t of view.transitions) {
    const from = nodeId.get(t.transition.from);
    const to = nodeId.get(t.transition.to);
    if (!from || !to) continue;
    const arrow = t.transition.provenance === "ai" ? "-.->" : "-->";
    const label = t.text ? `|"${text(t.text)}"|` : "";
    lines.push(`  ${from} ${arrow}${label} ${to}`);
  }
  return `${lines.join("\n")}\n`;
}

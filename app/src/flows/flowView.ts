/** Turns a flow into render data and layout input. Pure. */
import type { Flow, FlowStatus, FlowStep, FlowTransition } from "../generated/contract";
import type { Model, ModelNode } from "../model/buildModel";
import { UNASSIGNED_MODULE_ID } from "../model/buildModel";
import type { FlowLayoutInput } from "./layoutFlow";

export const STEP_WIDTH = 220;
export const STEP_HEIGHT_ONE_LINE = 68;
export const STEP_HEIGHT_TWO_LINES = 88;
/** Characters of a 13px semibold label that fit on one line of a step card. */
const LABEL_LINE_CHARS = 26;
const CHIP_CHAR_PX = 6.6;
const CHIP_PAD_PX = 16;
const AI_PILL_PX = 24;
export const CHIP_HEIGHT = 22;

export const MISSING_LANE = "module:__missing";
const MISSING_LANE_NAME = "No longer in the code";

export interface StepView {
  id: string;
  /** 0-based position in reading order; the badge shows `index + 1`. */
  index: number;
  step: FlowStep;
  /** Undefined when the step's element no longer exists. */
  node: ModelNode | undefined;
  lane: string;
  laneName: string;
  /** Qualified name for the code line (`AuthService.verify`), or the file name. */
  qualified: string;
  /** `file.py:12`, when the element has a source. */
  location: string | undefined;
  stale: boolean;
  entry: boolean;
  terminal: boolean;
  /** The step is the source of a `branch` transition (draws the diamond). */
  branches: boolean;
  height: number;
}

export interface TransitionView {
  /** `t<index>` (index into `flow.transitions`). */
  id: string;
  index: number;
  transition: FlowTransition;
  /** Text always shown beside the line (event, async, branch); hover-only kinds have none. */
  text: string | undefined;
}

export interface FlowView {
  steps: StepView[];
  stepsById: Map<string, StepView>;
  transitions: TransitionView[];
  input: FlowLayoutInput;
  /** Static (syntactic/semantic) and AI transitions with resolvable ends. */
  fromCode: number;
  ai: number;
}

/** The module a node belongs to (itself for a module), or undefined. */
export function moduleOf(model: Model, id: string): ModelNode | undefined {
  let current: string | null | undefined = id;
  while (current) {
    const node = model.nodes.get(current);
    if (!node) return undefined;
    if (node.kind === "module") return node;
    current = model.parentById.get(current) ?? null;
  }
  return undefined;
}

/** `class:a/b.py:Store.save` → `Store.save`; a file → its name. */
export function qualifiedName(node: ModelNode): string {
  if (node.kind === "class" || node.kind === "function") {
    const at = node.id.indexOf(":", node.id.indexOf(":") + 1);
    return at > 0 ? node.id.slice(at + 1) : node.name;
  }
  return node.name;
}

export function locationOf(node: ModelNode | undefined): string | undefined {
  if (!node?.source) return undefined;
  const file = node.source.file.split("/").at(-1) ?? node.source.file;
  return node.kind === "file" ? file : `${file}:${String(node.source.startLine)}`;
}

export function laneOf(model: Model, nodeId: string): { lane: string; laneName: string } {
  const module = moduleOf(model, nodeId);
  if (!module) return { lane: MISSING_LANE, laneName: MISSING_LANE_NAME };
  return {
    lane: module.id,
    laneName: module.id === UNASSIGNED_MODULE_ID ? "Unassigned" : module.name,
  };
}

/** Text shown beside a transition line, by kind. */
export function transitionText(t: FlowTransition): string | undefined {
  switch (t.kind) {
    case "event":
      return `⚡ ${t.label ?? "event"}`;
    case "async":
      return t.label ? `⏵⏵ ${t.label}` : "⏵⏵";
    case "branch":
      return t.label ?? "";
    case "call":
    case "return":
      return undefined;
  }
}

export function chipSize(text: string | undefined, ai: boolean) {
  if (text === undefined && !ai) return undefined;
  const textPx = text ? text.length * CHIP_CHAR_PX : 0;
  return {
    width: Math.ceil(CHIP_PAD_PX + textPx + (ai ? AI_PILL_PX : 0) - (text ? 0 : 8)),
    height: CHIP_HEIGHT,
  };
}

export function flowView(model: Model, flow: Flow, status: FlowStatus | undefined): FlowView {
  const stale = new Set(status?.staleSteps ?? []);
  const outgoing = new Set(flow.transitions.map((t) => t.from));
  const branching = new Set(flow.transitions.filter((t) => t.kind === "branch").map((t) => t.from));
  const seen = new Set<string>();
  const steps: StepView[] = [];
  flow.steps.forEach((step, index) => {
    if (seen.has(step.id)) return; // duplicate step IDs keep the first (validator error)
    seen.add(step.id);
    const node = model.nodes.get(step.node);
    const lane = laneOf(model, step.node);
    steps.push({
      id: step.id,
      index,
      step,
      node,
      ...lane,
      qualified: node ? qualifiedName(node) : (step.node.split(":").at(-1) ?? step.node),
      location: locationOf(node),
      stale: stale.has(step.id),
      entry: index === 0,
      terminal: !outgoing.has(step.id),
      branches: branching.has(step.id),
      height: step.label.length > LABEL_LINE_CHARS ? STEP_HEIGHT_TWO_LINES : STEP_HEIGHT_ONE_LINE,
    });
  });
  const stepsById = new Map(steps.map((s) => [s.id, s] as const));
  const transitions: TransitionView[] = [];
  let fromCode = 0;
  let ai = 0;
  flow.transitions.forEach((transition, index) => {
    if (!stepsById.has(transition.from) || !stepsById.has(transition.to)) return;
    if (transition.provenance === "ai") ai += 1;
    else fromCode += 1;
    transitions.push({
      id: `t${String(index)}`,
      index,
      transition,
      text: transitionText(transition),
    });
  });
  const input: FlowLayoutInput = {
    nodes: steps.map((s) => ({
      id: s.id,
      lane: s.lane,
      laneName: s.laneName,
      width: STEP_WIDTH,
      height: s.height,
    })),
    edges: transitions.map((t) => {
      const label = chipSize(t.text, t.transition.provenance === "ai");
      return {
        id: t.id,
        from: t.transition.from,
        to: t.transition.to,
        ...(label ? { label } : {}),
      };
    }),
    options: { top: 96 },
  };
  return { steps, stepsById, transitions, input, fromCode, ai };
}

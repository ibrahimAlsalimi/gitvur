/** React Flow node renderers for the Flows canvas. */
import type { Node, NodeProps } from "@xyflow/react";
import type { CSSProperties } from "react";

import { ClassGlyph, FunctionGlyph, LanguageGlyph } from "../canvas/glyphs";
import { middleTruncate } from "../canvas/text";
import { copy } from "../copy";
import type { EntryPoint, Provenance, TransitionKind } from "../generated/contract";
import type { ModelNode } from "../model/buildModel";
import type { StepView } from "./flowView";
import { EntryGlyph } from "./glyphs";
import type { FlowLayout, Point } from "./layoutFlow";
import { pathLength, roundedPath } from "./paths";
import type { TraceCard } from "./traceView";
import { useFlowsStore } from "./useFlowsStore";

/** Playback appearance of a step. */
export type StepState = "default" | "active" | "visited" | "upcoming" | "dimmed";

export interface StepData extends Record<string, unknown> {
  view: StepView;
  total: number;
  state: StepState;
  selected: boolean;
  entry: EntryPoint | undefined;
}

export interface TraceCardData extends Record<string, unknown> {
  card: TraceCard;
  selected: boolean;
  fetching: boolean;
}

/** One drawn line of the backdrop. */
export interface BackdropEdge {
  id: string;
  points: Point[];
  provenance: Provenance | "candidate";
  kind: TransitionKind;
  back: boolean;
  /** Always-visible text (event, async, branch). */
  text: string | undefined;
  /** Hover text for call / return. */
  hover: string | undefined;
  label: { x: number; y: number; width: number; height: number } | undefined;
  /** Playback: the line was followed, or is not on the chosen path. */
  state: "default" | "taken" | "dimmed";
}

export interface BackdropData extends Record<string, unknown> {
  layout: FlowLayout;
  edges: BackdropEdge[];
  /** Module colour per lane. */
  colors: Record<string, string>;
  /** The line the playback cursor just travelled along, and a key to restart the dash. */
  travel: { id: string; key: string } | null;
}

export type StepNode = Node<StepData, "step">;
export type TraceCardNode = Node<TraceCardData, "trace">;
export type BackdropNode = Node<BackdropData, "backdrop">;
export type FlowCanvasNode = StepNode | TraceCardNode | BackdropNode;

/** Where a hover-only chip goes: beside the middle of the last segment. */
function hoverAnchor(points: readonly Point[]): { x: number; y: number } {
  const a = points.at(-2) ?? [0, 0];
  const b = points.at(-1) ?? [0, 0];
  return { x: (a[0] + b[0]) / 2 + 6, y: (a[1] + b[1]) / 2 - 11 };
}

function markerFor(e: BackdropEdge): string | undefined {
  const prov = e.provenance === "candidate" ? "candidate" : e.provenance;
  if (e.kind === "return") return `url(#gv-flow-open-${prov})`;
  if (e.kind === "async") return `url(#gv-flow-chevron-${prov})`;
  return `url(#gv-flow-arrow-${prov})`;
}

/** Arrow, open arrow and double-chevron markers for every provenance. */
export function FlowMarkers() {
  const provs = ["syntactic", "semantic", "ai", "candidate"] as const;
  return (
    <svg className="gv-markers" aria-hidden="true" width="0" height="0">
      <defs>
        {provs.map((p) => (
          <g key={p}>
            <marker
              id={`gv-flow-arrow-${p}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className={`gv-flow-marker`} data-prov={p} />
            </marker>
            <marker
              id={`gv-flow-open-${p}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path
                d="M 1 1 L 9 5 L 1 9"
                className="gv-flow-marker gv-flow-marker-open"
                data-prov={p}
              />
            </marker>
            <marker
              id={`gv-flow-chevron-${p}`}
              viewBox="0 0 16 10"
              refX="15"
              refY="5"
              markerWidth="11"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path
                d="M 1 1 L 7 5 L 1 9 M 8 1 L 14 5 L 8 9"
                className="gv-flow-marker gv-flow-marker-open"
                data-prov={p}
              />
            </marker>
          </g>
        ))}
      </defs>
    </svg>
  );
}

function Chip({ edge, x, y, hover }: { edge: BackdropEdge; x: number; y: number; hover: boolean }) {
  const text = hover ? edge.hover : edge.text;
  return (
    <foreignObject
      x={x}
      y={y}
      width={Math.max(edge.label?.width ?? 0, 72)}
      height={edge.label?.height ?? 22}
      className={hover ? "gv-flow-chip-slot gv-flow-chip-hover" : "gv-flow-chip-slot"}
    >
      <span className="gv-flow-chip" data-kind={edge.kind}>
        {text ? <span className="gv-flow-chip-text">{text}</span> : null}
        {edge.provenance === "ai" && !hover && <span className="gv-ai-pill">AI</span>}
      </span>
    </foreignObject>
  );
}

/** Lanes, lines, branch diamonds and label chips, under the cards. */
export function BackdropRenderer({ data }: NodeProps<BackdropNode>) {
  const { layout, edges, colors, travel } = data;
  const single = layout.lanes.length === 1;
  return (
    <svg
      className="gv-flow-backdrop"
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${String(layout.width)} ${String(layout.height)}`}
    >
      {layout.lanes.map((lane, i) => (
        <rect
          key={lane.id}
          className="gv-flow-lane"
          data-alt={i % 2 === 1 || undefined}
          data-single={single || undefined}
          x={lane.x}
          y={0}
          width={lane.width}
          height={lane.height}
          rx={8}
          style={{ "--gv-lane-color": colors[lane.id] } as CSSProperties}
        />
      ))}
      {edges.map((e) => {
        const d = roundedPath(e.points);
        const start = e.points[0];
        const anchor = hoverAnchor(e.points);
        return (
          <g
            key={e.id}
            className="gv-flow-edge"
            data-prov={e.provenance}
            data-kind={e.kind}
            data-back={e.back || undefined}
            data-state={e.state}
          >
            <path className="gv-flow-edge-hit" d={d} />
            <path className="gv-flow-edge-line" d={d} markerEnd={markerFor(e)} />
            {e.kind === "branch" && start && (
              <path
                className="gv-flow-diamond"
                d={`M ${String(start[0])} ${String(start[1] - 5)} l 5 5 l -5 5 l -5 -5 z`}
              />
            )}
            {travel?.id === e.id && (
              <path
                key={travel.key}
                className="gv-flow-travel"
                d={d}
                style={{ "--gv-travel-length": String(pathLength(e.points)) } as CSSProperties}
              />
            )}
            {e.label && (e.text !== undefined || e.provenance === "ai") && (
              <Chip edge={e} x={e.label.x} y={e.label.y} hover={false} />
            )}
            {e.hover && <Chip edge={e} x={anchor.x} y={anchor.y} hover />}
          </g>
        );
      })}
    </svg>
  );
}

export function NodeGlyph({ node }: { node: ModelNode | undefined }) {
  if (!node) return <span className="gv-glyph" />;
  if (node.kind === "class") return <ClassGlyph />;
  if (node.kind === "function")
    return <FunctionGlyph method={node.id.split(":").at(-1)?.includes(".") ?? false} />;
  const ext = node.name.split(".").at(-1);
  return (
    <LanguageGlyph language={ext === "py" ? "py" : ext === "ts" || ext === "tsx" ? "ts" : "file"} />
  );
}

export function StepRenderer({ data }: NodeProps<StepNode>) {
  const { view, state, selected, entry } = data;
  const broken = view.node === undefined;
  return (
    <div
      className="gv-step"
      data-state={state}
      data-selected={selected || undefined}
      data-entry={view.entry || undefined}
      data-broken={broken || undefined}
      style={{ height: view.height }}
    >
      {view.entry && entry && (
        <span className="gv-step-tag">
          <EntryGlyph kind={entry.kind} />
          <span>{entry.name}</span>
        </span>
      )}
      <span className="gv-step-badge" aria-hidden="true">
        {state === "visited" ? "✓" : view.index + 1}
      </span>
      {view.stale && <span className="gv-step-stale" title="Changed since this step was written" />}
      <span className="gv-step-label">{view.step.label}</span>
      <span className="gv-step-code">
        {broken ? (
          <span className="gv-step-gone">{copy.flows.gone}</span>
        ) : (
          <>
            <NodeGlyph node={view.node} />
            <span className="gv-step-name">{middleTruncate(view.qualified, 22)}</span>
            {view.location && <span className="gv-step-loc">{view.location}</span>}
          </>
        )}
      </span>
      {view.terminal && <span className="gv-step-stop" aria-hidden="true" />}
    </div>
  );
}

export function TraceCardRenderer({ data }: NodeProps<TraceCardNode>) {
  const { card, selected, fetching } = data;
  const store = useFlowsStore.getState();
  if (card.kind === "ref" || card.kind === "cycle") {
    return (
      <button
        type="button"
        className="gv-trace-stub nodrag"
        data-kind={card.kind}
        title={card.nodeId}
        onClick={(e) => {
          e.stopPropagation();
          if (card.reference) store.requestFocus(card.reference);
        }}
      >
        {card.kind === "ref" ? copy.flows.refShown : copy.flows.recursion(card.title)}
      </button>
    );
  }
  if (card.kind === "ambiguous") {
    const n = card.occurrence.candidates.length;
    return (
      <button
        type="button"
        className="gv-trace-card gv-trace-ambiguous nodrag"
        title={copy.flows.ambiguousNote}
        onClick={(e) => {
          e.stopPropagation();
          store.toggleAmbiguous(card.id);
        }}
      >
        <span className="gv-trace-title">{copy.flows.ambiguous(card.title, n)}</span>
        <span className="gv-trace-loc">
          {card.occurrence.evidence
            ? `${card.occurrence.evidence.file.split("/").at(-1) ?? ""}:${String(card.occurrence.evidence.line)}`
            : ""}
        </span>
      </button>
    );
  }
  return (
    <div className="gv-trace-card" data-kind={card.kind} data-selected={selected || undefined}>
      <span className="gv-trace-title">{middleTruncate(card.title, 24)}</span>
      {card.location && <span className="gv-trace-loc">{card.location}</span>}
      {card.kind === "node" && (card.hidden > 0 || card.expanded) && (
        <button
          type="button"
          className="gv-trace-more nodrag"
          aria-expanded={card.expanded}
          aria-label={card.expanded ? "Collapse calls" : `Show ${String(card.hidden)} more calls`}
          onClick={(e) => {
            e.stopPropagation();
            void store.toggleExpand(card.id);
          }}
        >
          {fetching ? "…" : card.expanded ? "−" : copy.flows.more(card.hidden)}
        </button>
      )}
    </div>
  );
}

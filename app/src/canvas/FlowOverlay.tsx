/**
 * A flow pinned onto the map: numbered badges on each step's element (or its visible
 * ancestor), the path drawn in accent between them, and a chip to step through or remove it.
 */
import { Panel, ViewportPortal, useReactFlow, useStore } from "@xyflow/react";
import { useEffect, useMemo } from "react";

import { copy } from "../copy";
import type { Model } from "../model/buildModel";
import { visibleAncestor } from "../model/aggregateEdges";
import { useAppStore } from "../store/useAppStore";
import { cameraDuration } from "./motion";
import { exitPoint } from "../flows/paths";
import { pinnedLayout } from "./pinnedFlow";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function FlowOverlay({ model, lod }: { model: Model; lod: 0 | 1 | 2 }) {
  const pinned = useAppStore((s) => s.pinnedFlow);
  const expandedIds = useAppStore((s) => s.expandedIds);
  const collapsedIds = useAppStore((s) => s.collapsedIds);
  const lookup = useStore((s) => s.nodeLookup);
  const rf = useReactFlow();
  const flow = pinned ? model.flows.flowsById.get(pinned.flowId) : undefined;
  const layout = useMemo(
    () =>
      flow
        ? pinnedLayout(model, flow, visibleAncestor(model, expandedIds, lod, collapsedIds))
        : undefined,
    [model, flow, expandedIds, collapsedIds, lod],
  );
  const box = (id: string): Box | undefined => {
    const n = lookup.get(id);
    if (!n) return undefined;
    const { x, y } = n.internals.positionAbsolute;
    return { x, y, w: n.measured.width ?? n.width ?? 0, h: n.measured.height ?? n.height ?? 0 };
  };

  const activeAt = layout?.steps.find((s) => s.index === pinned?.index)?.at;
  useEffect(() => {
    if (!activeAt) return;
    const n = rf.getInternalNode(activeAt);
    if (!n) return;
    const { x, y } = n.internals.positionAbsolute;
    const w = n.measured.width ?? 0;
    const h = n.measured.height ?? 0;
    void rf.setCenter(x + w / 2, y + h / 2, { zoom: rf.getZoom(), duration: cameraDuration(400) });
  }, [activeAt, rf]);

  if (!pinned || !flow || !layout) return null;
  // Badges per map node: several steps can land on one element.
  const badges = new Map<string, number[]>();
  for (const s of layout.steps) badges.set(s.at, [...(badges.get(s.at) ?? []), s.index]);
  const move = (delta: number) => {
    const index = Math.min(flow.steps.length - 1, Math.max(0, pinned.index + delta));
    useAppStore.getState().setPinnedFlow({ flowId: flow.id, index });
  };
  return (
    <>
      <ViewportPortal>
        <svg className="gv-pin-paths" aria-hidden="true">
          {layout.path.map(([a, b]) => {
            const p = box(a);
            const q = box(b);
            if (!p || !q) return null;
            // From border to border, so the line never runs over the cards' text.
            const [x1, y1] = exitPoint(p, q);
            const [x2, y2] = exitPoint(q, p);
            return (
              <line
                key={`${a}>${b}`}
                className="gv-pin-path"
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                markerEnd="url(#gv-pin-arrow)"
              />
            );
          })}
          <defs>
            <marker
              id="gv-pin-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="gv-pin-arrowhead" />
            </marker>
          </defs>
        </svg>
        {[...badges].map(([at, indexes]) => {
          const b = box(at);
          if (!b) return null;
          return (
            <span
              key={at}
              className="gv-pin-badges"
              style={{ transform: `translate(${String(b.x - 10)}px, ${String(b.y - 10)}px)` }}
            >
              {indexes.map((i) => (
                <span
                  key={i}
                  className="gv-step-badge gv-pin-badge"
                  data-active={i === pinned.index || undefined}
                >
                  {i + 1}
                </span>
              ))}
            </span>
          );
        })}
      </ViewportPortal>
      <Panel
        position="bottom-center"
        className="gv-pin-chip"
        aria-label={copy.flows.pinned(flow.name)}
      >
        <button
          type="button"
          className="button button-ghost"
          aria-label="Previous step"
          disabled={pinned.index === 0}
          onClick={() => {
            move(-1);
          }}
        >
          ◀
        </button>
        <span className="gv-pin-name">
          {copy.flows.pinned(flow.name)} · {pinned.index + 1}/{flow.steps.length}
        </span>
        <button
          type="button"
          className="button button-ghost"
          aria-label="Next step"
          disabled={pinned.index >= flow.steps.length - 1}
          onClick={() => {
            move(1);
          }}
        >
          ▶
        </button>
        <button
          type="button"
          className="button button-ghost"
          aria-label={copy.flows.unpin}
          title={copy.flows.unpin}
          onClick={() => {
            useAppStore.getState().setPinnedFlow(null);
          }}
        >
          ✕
        </button>
      </Panel>
    </>
  );
}

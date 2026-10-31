import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useViewport,
  type NodeMouseHandler,
} from "@xyflow/react";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getApi } from "../api";
import { moduleColors } from "../canvas/buildFlow";
import { cameraDuration } from "../canvas/motion";
import { copy } from "../copy";
import type { EntryPoint, Flow } from "../generated/contract";
import { typingIn } from "../keys/typing";
import { runFlowLayout } from "../layout/runLayout";
import type { Model } from "../model/buildModel";
import { useAppStore } from "../store/useAppStore";
import { captureDiagram } from "./exportImage";
import { FlowHeader, TraceHeader } from "./FlowHeader";
import { FlowLegend } from "./FlowLegend";
import { FlowListView } from "./FlowListView";
import { type BackdropEdge, type FlowCanvasNode, FlowMarkers, type StepState } from "./FlowNodes";
import { flowNodeTypes } from "./flowNodeTypes";
import { fitViewport } from "./paths";
import { FlowToolbar } from "./FlowToolbar";
import { type FlowView, flowView, qualifiedName } from "./flowView";
import type { FlowSubject } from "./subject";
import type { FlowLayout } from "./layoutFlow";
import { flowToMermaid } from "./mermaid";
import { PlaybackRail } from "./PlaybackRail";
import { declined, visited } from "./playback";
import { type TraceView, traceText, traceView } from "./traceView";
import { PLAY_INTERVAL_MS, TRACE_MAX_NODES, useFlowsStore } from "./useFlowsStore";

const HOVER_TEXT = { call: "calls", return: "returns" } as const;

/** Lane headers pinned to the top of the canvas, following the camera horizontally. */
function LaneHeaders({ layout, colors }: { layout: FlowLayout; colors: Record<string, string> }) {
  const { x, zoom } = useViewport();
  if (layout.lanes.length < 2) return null;
  return (
    <div className="gv-lane-headers" aria-hidden="true">
      {layout.lanes.map((lane) => (
        <div
          key={lane.id}
          className="gv-lane-header"
          style={
            {
              left: lane.x * zoom + x,
              width: lane.width * zoom,
              "--gv-lane-color": colors[lane.id],
            } as CSSProperties
          }
        >
          <span className="gv-lane-name">{lane.name}</span>
          <span className="gv-lane-count">{lane.count}</span>
        </div>
      ))}
    </div>
  );
}

function stepStates(flow: Flow, view: FlowView): Map<string, StepState> {
  const playback = useFlowsStore.getState().playback;
  const states = new Map<string, StepState>();
  if (playback.current === null) return states;
  const seen = visited(playback);
  const dim = declined(flow, playback);
  for (const s of view.steps) {
    states.set(
      s.id,
      s.id === playback.current
        ? "active"
        : dim.has(s.id)
          ? "dimmed"
          : seen.has(s.id)
            ? "visited"
            : "upcoming",
    );
  }
  return states;
}

function flowNodes(
  model: Model,
  flow: Flow,
  view: FlowView,
  layout: FlowLayout,
  entry: EntryPoint | undefined,
  selectedId: string | null,
  inspected: string | null,
): FlowCanvasNode[] {
  const playback = useFlowsStore.getState().playback;
  const states = stepStates(flow, view);
  const taken = new Set(playback.taken);
  const skipped = new Set(playback.skipped);
  const colors = Object.fromEntries(moduleColors(model));
  const edges: BackdropEdge[] = layout.edges.map((e) => {
    const t = view.transitions.find((x) => x.id === e.id);
    const kind = t?.transition.kind ?? "call";
    const dimmed =
      t !== undefined && (skipped.has(t.index) || states.get(t.transition.to) === "dimmed");
    return {
      id: e.id,
      points: e.points,
      provenance: t?.transition.provenance ?? "syntactic",
      kind,
      back: e.back,
      text: t?.text,
      hover: kind === "call" || kind === "return" ? HOVER_TEXT[kind] : undefined,
      label: e.label,
      state: dimmed ? "dimmed" : t && taken.has(t.index) ? "taken" : "default",
    };
  });
  const last = playback.path.at(-1);
  const travel =
    last?.via !== null && last?.via !== undefined
      ? { id: `t${String(last.via)}`, key: String(playback.path.length) }
      : null;
  const nodes: FlowCanvasNode[] = [
    {
      id: "__backdrop",
      type: "backdrop",
      position: { x: 0, y: 0 },
      data: { layout, edges, colors, travel },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: -1,
      className: "gv-flow-backdrop-node",
      style: { width: layout.width, height: layout.height },
    },
  ];
  for (const s of view.steps) {
    const box = layout.nodes[s.id];
    if (!box) continue;
    nodes.push({
      id: s.id,
      type: "step",
      position: { x: box.x, y: box.y },
      data: {
        view: s,
        total: view.steps.length,
        state: states.get(s.id) ?? "default",
        selected: inspected === s.id || (inspected === null && s.node?.id === selectedId),
        entry,
      },
      draggable: false,
      selectable: false,
      ariaLabel: copy.flows.stepAria(
        s.index + 1,
        view.steps.length,
        s.step.label,
        s.qualified,
        s.laneName,
      ),
      style: { width: box.width, height: box.height },
    });
  }
  return nodes;
}

function traceNodes(
  model: Model,
  view: TraceView,
  layout: FlowLayout,
  selectedId: string | null,
  fetching: ReadonlySet<string>,
): FlowCanvasNode[] {
  const colors = Object.fromEntries(moduleColors(model));
  const edges: BackdropEdge[] = layout.edges.map((e) => {
    const t = view.edges.find((x) => x.id === e.id);
    return {
      id: e.id,
      points: e.points,
      provenance: t?.provenance ?? "syntactic",
      kind: "call",
      back: e.back || (t?.loop ?? false),
      text: undefined,
      hover: undefined,
      label: e.label,
      state: "default",
    };
  });
  const nodes: FlowCanvasNode[] = [
    {
      id: "__backdrop",
      type: "backdrop",
      position: { x: 0, y: 0 },
      data: { layout, edges, colors, travel: null },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: -1,
      className: "gv-flow-backdrop-node",
      style: { width: layout.width, height: layout.height },
    },
  ];
  for (const c of view.cards) {
    const box = layout.nodes[c.id];
    if (!box) continue;
    nodes.push({
      id: c.id,
      type: "trace",
      position: { x: box.x, y: box.y },
      data: { card: c, selected: c.nodeId === selectedId, fetching: fetching.has(c.id) },
      draggable: false,
      selectable: false,
      ariaLabel: `${c.kind === "node" ? "" : `${c.kind}: `}${c.title}${c.location ? `, ${c.location}` : ""}, in module ${c.laneName}`,
      style: { width: box.width, height: box.height },
    });
  }
  return nodes;
}

function useLayout(input: Parameters<typeof runFlowLayout>[0] | undefined) {
  const [layout, setLayout] = useState<{ input: unknown; layout: FlowLayout } | null>(null);
  useEffect(() => {
    if (!input) return;
    let cancelled = false;
    void runFlowLayout(input).then(({ result, ms }) => {
      if (cancelled) return;
      if (import.meta.env.DEV) console.debug(`[gitvur] flow layout ${ms.toFixed(1)} ms`);
      setLayout({ input, layout: result });
    });
    return () => {
      cancelled = true;
    };
  }, [input]);
  return layout && layout.input === input ? layout.layout : null;
}

function Inner({ model, subject }: { model: Model; subject: FlowSubject }) {
  const mode = useAppStore((s) => s.flowMode);
  const selectedId = useAppStore((s) => s.selectedId);
  const active = useAppStore((s) => s.activeTab === "flows");
  const bundle = useAppStore((s) => s.bundle);
  const playback = useFlowsStore((s) => s.playback);
  const playing = useFlowsStore((s) => s.playing);
  const trace = useFlowsStore((s) => s.trace);
  const focus = useFlowsStore((s) => s.focus);
  const listView = useFlowsStore((s) => s.listView);
  const inspected = useFlowsStore((s) => s.inspected);
  const rf = useReactFlow<FlowCanvasNode>();
  const wrapRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const { flow, entry, traceStart } = subject;
  const showFlow = mode === "flow" && flow !== undefined;

  const status = flow ? model.flows.flowStatusById.get(flow.id) : undefined;
  const fview = useMemo(
    () => (flow ? flowView(model, flow, status) : undefined),
    [model, flow, status],
  );
  useEffect(() => {
    if (flow) useFlowsStore.getState().usePlaybackOf(flow.id);
  }, [flow]);
  useEffect(() => {
    if (!showFlow && traceStart && active) void useFlowsStore.getState().loadTrace(traceStart);
  }, [showFlow, traceStart, active]);

  const tview = useMemo(
    () =>
      !showFlow && trace?.trace && trace.start === traceStart
        ? traceView(model, trace.trace, trace.expanded, trace.ambiguous)
        : undefined,
    [model, showFlow, trace, traceStart],
  );
  const input = showFlow ? fview?.input : tview?.input;
  const layout = useLayout(input);

  const nodes = useMemo(() => {
    if (!layout) return [];
    if (showFlow && fview) {
      return flowNodes(model, flow, fview, layout, entry, selectedId, inspected);
    }
    if (tview) return traceNodes(model, tview, layout, selectedId, trace?.fetching ?? new Set());
    return [];
    // `playback` is read inside flowNodes; listing it re-renders on every step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, showFlow, flow, fview, tview, model, entry, selectedId, inspected, playback, trace]);

  // Fit when a different subject or mode appears; not when a trace grows.
  const fitted = useRef<string | null>(null);
  const subjectKey = showFlow ? `flow|${flow.id}` : `trace|${traceStart ?? ""}`;
  const fit = useCallback(
    (duration: number) => {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!layout || !rect) return Promise.resolve(false);
      return rf.setViewport(fitViewport(layout, rect.width, rect.height), { duration });
    },
    [layout, rf],
  );
  useEffect(() => {
    if (!layout || fitted.current === subjectKey) return;
    fitted.current = subjectKey;
    requestAnimationFrame(() => {
      void fit(cameraDuration(250));
    });
  }, [layout, subjectKey, fit]);

  // Playback shows the active step's element in the inspector.
  const activeNode = showFlow ? flow.steps.find((s) => s.id === playback.current)?.node : undefined;
  useEffect(() => {
    if (activeNode && model.nodes.has(activeNode)) useAppStore.getState().select(activeNode);
  }, [activeNode, model]);

  // Keep the focused element in the middle third of the viewport.
  useEffect(() => {
    if (!focus || !layout) return;
    const box = layout.nodes[focus.id];
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!box || !rect) return;
    const { x, y, zoom } = rf.getViewport();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const sx = cx * zoom + x;
    const sy = cy * zoom + y;
    const inside =
      sx > rect.width / 3 &&
      sx < (rect.width * 2) / 3 &&
      sy > rect.height / 3 &&
      sy < (rect.height * 2) / 3;
    if (!inside) void rf.setCenter(cx, cy, { zoom, duration: cameraDuration(500) });
    document
      .querySelector<HTMLElement>(
        `.gv-flow-canvas .react-flow__node[data-id="${CSS.escape(focus.id)}"]`,
      )
      ?.focus({ preventScroll: true });
  }, [focus, layout, rf]);

  // Play: advance every interval until a branch or the end.
  useEffect(() => {
    if (!playing || !flow) return;
    const timer = setInterval(() => {
      useFlowsStore.getState().stepNext(flow);
    }, PLAY_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [playing, flow]);

  const onNext = useCallback(() => {
    if (flow) useFlowsStore.getState().stepNext(flow);
  }, [flow]);
  const onPlay = useCallback(() => {
    const store = useFlowsStore.getState();
    if (!flow) return;
    if (store.playing) {
      store.setPlaying(false);
      return;
    }
    if (store.playback.done) store.restart();
    store.setPlaying(true);
    store.stepNext(flow);
  }, [flow]);

  // Keyboard: J / K / Space / Home / T, and arrows along transitions.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typingIn(e.target)) return;
      if (useAppStore.getState().paletteOpen) return;
      const store = useFlowsStore.getState();
      const key = e.key;
      if (key === "t" || key === "T") {
        e.preventDefault();
        const app = useAppStore.getState();
        app.setFlowMode(app.flowMode === "flow" && traceStart ? "trace" : flow ? "flow" : "trace");
        return;
      }
      if (!showFlow || !fview) return;
      if (key === "j" || key === "J") {
        e.preventDefault();
        store.stepNext(flow);
      } else if (key === "k" || key === "K") {
        e.preventDefault();
        store.stepPrev();
      } else if (key === " " && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        onPlay();
      } else if (key === "Home") {
        e.preventDefault();
        store.restart();
      } else if (key.startsWith("Arrow")) {
        const focused = (document.activeElement as HTMLElement | null)
          ?.closest(".react-flow__node")
          ?.getAttribute("data-id");
        if (!focused || !fview.stepsById.has(focused)) return;
        const out = fview.transitions.filter((t) => t.transition.from === focused);
        const incoming = fview.transitions.filter((t) => t.transition.to === focused);
        let target: string | undefined;
        if (key === "ArrowDown") target = out[0]?.transition.to;
        else if (key === "ArrowUp") target = incoming[0]?.transition.from;
        else {
          // Between targets of the same source (branch siblings).
          const parent = incoming[0]?.transition.from;
          const siblings = fview.transitions
            .filter((t) => t.transition.from === parent)
            .map((t) => t.transition.to);
          const at = siblings.indexOf(focused);
          target = siblings[at + (key === "ArrowRight" ? 1 : -1)];
        }
        if (target) {
          e.preventDefault();
          store.requestFocus(target);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [active, showFlow, flow, fview, traceStart, onPlay]);

  const onNodeClick: NodeMouseHandler<FlowCanvasNode> = useCallback(
    (_, node) => {
      if (node.type === "step") {
        useFlowsStore.setState({ inspected: node.id });
        const id = node.data.view.node?.id;
        if (id) useAppStore.getState().select(id);
      } else if (node.type === "trace") {
        const id = node.data.card.nodeId;
        if (id && model.nodes.has(id)) useAppStore.getState().select(id);
      }
    },
    [model],
  );

  const onExport = useCallback(
    async (kind: "png" | "svg") => {
      const el = exportRef.current;
      if (!el || !bundle) return;
      const legend = useFlowsStore.getState().legendOpen;
      useFlowsStore.setState({ legendOpen: true });
      await fit(0);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      try {
        const data = await captureDiagram(el, kind);
        const base = (flow?.id ?? traceStart ?? "trace").replace(/[^a-z0-9-]+/gi, "-");
        const api = await getApi();
        await api.saveExport(bundle.root, `${base}.${kind}`, kind, data);
      } catch {
        window.alert(copy.flows.exportFailed);
      } finally {
        useFlowsStore.setState({ legendOpen: legend });
      }
    },
    [fit, bundle, flow, traceStart],
  );

  const colors = useMemo(() => Object.fromEntries(moduleColors(model)), [model]);
  const flowIssues = flow ? model.issues.filter((i) => i.id === flow.id) : [];
  const traceTitle = (() => {
    if (!traceStart) return "";
    const e = model.flows.entryPointsById.get(traceStart);
    if (e) return e.name;
    const n = model.nodes.get(traceStart);
    return n ? qualifiedName(n) : traceStart;
  })();
  const traceNotice =
    entry?.target === null && !showFlow
      ? copy.flows.outside(entry.raw ?? "")
      : trace?.trace?.truncated && tview
        ? `${copy.flows.truncated(TRACE_MAX_NODES)} ${copy.flows.truncatedAction}.`
        : trace?.status === "error"
          ? (trace.error ?? copy.flows.traceFailed)
          : undefined;

  return (
    <div className="gv-flow-main">
      <FlowToolbar
        mode={showFlow ? "flow" : "trace"}
        hasFlow={flow !== undefined}
        canTrace={traceStart !== undefined}
        onNext={onNext}
        onPlay={onPlay}
        onCopyMermaid={
          showFlow && fview
            ? () =>
                navigator.clipboard.writeText(
                  flowToMermaid(fview, {
                    repo: model.projectName,
                    commit: bundle?.manifest.commitSha ?? "",
                    flowName: flow.name,
                    status: status?.status ?? "current",
                  }),
                )
            : undefined
        }
        onCopyTrace={
          !showFlow && trace?.trace
            ? () =>
                navigator.clipboard.writeText(
                  traceText(trace.trace as NonNullable<typeof trace.trace>),
                )
            : undefined
        }
        onExport={onExport}
        onPin={
          showFlow
            ? () => {
                const index = Math.max(
                  0,
                  flow.steps.findIndex((s) => s.id === playback.current),
                );
                useAppStore.getState().setPinnedFlow({ flowId: flow.id, index });
                useAppStore.getState().setActiveTab("map");
              }
            : undefined
        }
      />
      <div className="gv-flow-export" ref={exportRef}>
        {showFlow && fview ? (
          <FlowHeader flow={flow} view={fview} status={status} issues={flowIssues} />
        ) : (
          <TraceHeader
            title={traceTitle}
            subtitle={traceStart && traceStart !== traceTitle ? traceStart : undefined}
            notice={traceNotice}
          />
        )}
        {showFlow && fview && listView ? (
          <div className="gv-flow-listview-wrap">
            <FlowListView flow={flow} view={fview} />
          </div>
        ) : (
          <div className="gv-flow-canvas" ref={wrapRef}>
            <FlowMarkers />
            <ReactFlow<FlowCanvasNode>
              nodes={nodes}
              edges={[]}
              nodeTypes={flowNodeTypes}
              onNodeClick={onNodeClick}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              nodesFocusable
              minZoom={0.1}
              maxZoom={2}
              proOptions={{ hideAttribution: true }}
              aria-label={showFlow ? `Flow diagram: ${flow.name}` : `Call tree: ${traceTitle}`}
            />
            {layout && <LaneHeaders layout={layout} colors={colors} />}
            <FlowLegend />
          </div>
        )}
      </div>
      {showFlow && fview && !listView && <PlaybackRail flow={flow} view={fview} />}
    </div>
  );
}

export function FlowCanvas({ model, subject }: { model: Model; subject: FlowSubject }) {
  return (
    <ReactFlowProvider>
      <Inner model={model} subject={subject} />
    </ReactFlowProvider>
  );
}

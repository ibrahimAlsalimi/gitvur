import {
  type Edge,
  type Node,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Viewport,
} from "@xyflow/react";
import {
  type FocusEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { buildLayoutRequest, moduleEdges } from "../layout/fromModel";
import { runLayout } from "../layout/runLayout";
import { ancestors } from "../model/tree";
import { subtree, visibleAncestor } from "../model/aggregateEdges";
import { FlowOverlay } from "./FlowOverlay";
import { pinnedLayout } from "./pinnedFlow";
import type { LayoutResult } from "../layout/types";
import { typingIn } from "../keys/typing";
import { useAppStore } from "../store/useAppStore";
import { ConnectorEdge } from "./ConnectorEdge";
import { applyFocus, buildFlow, reuseNodes } from "./buildFlow";
import { EdgeMarkers } from "./edges/Markers";
import { Legend } from "./edges/Legend";
import { RelationEdge } from "./edges/RelationEdge";
import { relationEdges } from "./edges/relationEdges";
import { lodSelector } from "./lod";
import { Minimap } from "./Minimap";
import { minimapRects } from "./minimapRects";
import { nodeTypes } from "./nodeTypes";
import { PerfOverlay } from "./PerfOverlay";
import { usePerf } from "./perf";
import { SummaryCard } from "./SummaryCard";
import { cameraDuration } from "./motion";
import { Toolbar } from "./Toolbar";
import type { MapEdge, MapNode } from "./types";

const edgeTypes = { connector: ConnectorEdge, relation: RelationEdge };
const proOptions = { hideAttribution: true };
const FIT_PADDING = "48px";

const MIN_FIT_ZOOM = 0.2;

const perfEnabledByUrl =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).get("perf") === "1";

/** The map: containment layout of the merged model, drawn with React Flow. */
export function MapCanvas() {
  return (
    <ReactFlowProvider>
      <MapInner />
    </ReactFlowProvider>
  );
}

interface Flow {
  nodes: MapNode[];
  edges: MapEdge[];
  layout: LayoutResult;
  root: string;
}

function MapInner() {
  const model = useAppStore((s) => s.model);
  const bundle = useAppStore((s) => s.bundle);
  const expandedIds = useAppStore((s) => s.expandedIds);
  const collapsedIds = useAppStore((s) => s.collapsedIds);
  const selectedId = useAppStore((s) => s.selectedId);
  const hops = useAppStore((s) => s.hops);
  const lens = useAppStore((s) => s.lens);
  const ambiguousOpen = useAppStore((s) => s.ambiguousOpen);
  const navigation = useAppStore((s) => s.navigation);
  const lod = useStore(lodSelector);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const handledNavigation = useRef(0);
  const rf = useReactFlow();
  const [flow, setFlow] = useState<Flow | null>(null);
  const [animate, setAnimate] = useState(false);
  const [perfOpen, setPerfOpen] = useState(perfEnabledByUrl);
  const fittedRoot = useRef<string | null>(null);
  const previousNodes = useRef<Map<string, MapNode>>(new Map());
  const firstRecordedFor = useRef<string | null>(null);
  const deps = useMemo(() => (model ? moduleEdges(model) : []), [model]);

  // Lay out in the worker whenever the model or the expansion changes.
  useEffect(() => {
    if (!model || !bundle) return;
    let cancelled = false;
    const started = performance.now();
    void runLayout(buildLayoutRequest(model, expandedIds, deps, collapsedIds)).then(
      ({ result, ms }) => {
        // The first layout of a repository is the cold one; record it even if a newer
        // request superseded it (StrictMode, or a quick expand), so the metric is honest.
        const first = firstRecordedFor.current !== bundle.root;
        if (first) firstRecordedFor.current = bundle.root;
        if (cancelled) {
          if (first) usePerf.getState().record(ms, performance.now() - started, true);
          return;
        }
        const built = buildFlow(
          model,
          result,
          expandedIds,
          { commitSha: bundle.manifest.commitSha, languages: bundle.manifest.languages },
          collapsedIds,
        );
        const nodes = reuseNodes(previousNodes.current, built.nodes);
        previousNodes.current = new Map(nodes.map((n) => [n.id, n]));
        setFlow({ nodes, edges: built.edges, layout: result, root: bundle.root });
        requestAnimationFrame(() => {
          usePerf.getState().record(ms, performance.now() - started, first);
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [model, bundle, expandedIds, collapsedIds, deps]);

  // Fit once per repository: the whole map, or the top two ranks if that would be tiny.
  useEffect(() => {
    if (!flow || fittedRoot.current === flow.root) return;
    fittedRoot.current = flow.root;
    setAnimate(false);
    const saved = useAppStore.getState().restoreViewport;
    if (saved) {
      // A saved camera from the last visit wins over fitting.
      useAppStore.setState({ restoreViewport: null });
      requestAnimationFrame(() => {
        void rf.setViewport(saved).then(() => {
          setAnimate(true);
        });
      });
      return;
    }
    requestAnimationFrame(() => {
      void rf
        .fitView({ padding: FIT_PADDING })
        .then(() => {
          if (rf.getZoom() < MIN_FIT_ZOOM) {
            const top = flow.nodes.filter(
              (n) => n.type === "module" && (flow.layout.ranks[n.id] ?? 99) <= 1,
            );
            return rf.fitView({ nodes: top.map((n) => ({ id: n.id })), padding: FIT_PADDING });
          }
          return true;
        })
        .then(() => {
          setAnimate(true);
        });
    });
  }, [flow, rf]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (useAppStore.getState().activeTab !== "map") return;
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setPerfOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__gitvurMap = {
      setViewport: (viewport) => rf.setViewport(viewport),
      focusNodes: async (ids, zoom) => {
        await rf.fitView({ nodes: ids.map((id) => ({ id })), padding: FIT_PADDING });
        if (zoom === undefined) return true;
        const { x, y, zoom: current } = rf.getViewport();
        const pane = document.querySelector(".react-flow")?.getBoundingClientRect();
        const cx = (pane?.width ?? 0) / 2;
        const cy = (pane?.height ?? 0) / 2;
        // Zoom around the pane centre.
        return rf.setViewport({
          x: cx - ((cx - x) * zoom) / current,
          y: cy - ((cy - y) * zoom) / current,
          zoom,
        });
      },
      getZoom: () => rf.getZoom(),
    };
    return () => {
      delete window.__gitvurMap;
    };
  }, [rf]);

  const visibleOf = useMemo(
    () => (model ? visibleAncestor(model, expandedIds, lod, collapsedIds) : () => undefined),
    [model, expandedIds, lod, collapsedIds],
  );
  const relations = useMemo(
    () =>
      model
        ? relationEdges({ model, visibleOf, selectedId, hoverId, hops, ambiguousOpen })
        : { edges: [], endpoints: new Set<string>() },
    [model, visibleOf, selectedId, hoverId, hops, ambiguousOpen],
  );
  // Dimming: everything but the selection (with its subtree), its ancestors, and its
  // relationship endpoints.
  const focus = useMemo(() => {
    if (!model || selectedId === null || !model.nodes.has(selectedId)) return null;
    const keep = new Set<string>([
      model.rootId,
      ...subtree(model, selectedId),
      ...ancestors(model, selectedId),
    ]);
    for (const id of relations.endpoints) keep.add(id);
    return keep;
  }, [model, selectedId, relations.endpoints]);
  // A pinned flow dims everything that is not on its path (or an ancestor of it).
  const pinned = useAppStore((s) => s.pinnedFlow);
  const pinnedKeep = useMemo(() => {
    const pinnedFlow = pinned ? model?.flows.flowsById.get(pinned.flowId) : undefined;
    if (!model || !pinnedFlow) return null;
    const resolve = visibleAncestor(model, expandedIds, lod, collapsedIds);
    const keep = new Set<string>([model.rootId]);
    for (const step of pinnedLayout(model, pinnedFlow, resolve).steps) {
      keep.add(step.at);
      for (const a of ancestors(model, step.at)) keep.add(a);
    }
    return keep;
  }, [model, pinned, expandedIds, collapsedIds, lod]);
  const nodes = useMemo(() => {
    const focused = flow ? applyFocus(flow.nodes, selectedId, focus) : [];
    if (!pinnedKeep) return focused;
    return focused.map((n) =>
      pinnedKeep.has(n.id) ? n : { ...n, className: `${n.className ?? ""} gv-pin-dim`.trim() },
    );
  }, [flow, selectedId, focus, pinnedKeep]);
  const edges = useMemo<Edge[]>(
    () => [...(flow?.edges ?? []), ...relations.edges],
    [flow, relations.edges],
  );

  // Fly to a node requested by the inspector (relationship lists, breadcrumb, history).
  useEffect(() => {
    if (!navigation || handledNavigation.current === navigation.seq || !flow) return;
    const node = rf.getInternalNode(navigation.id);
    if (!node) return; // not laid out yet; retried when `flow` changes
    handledNavigation.current = navigation.seq;
    const { x, y } = node.internals.positionAbsolute;
    const width = node.measured.width ?? node.width ?? 0;
    const height = node.measured.height ?? node.height ?? 0;
    const zoom = rf.getZoom() < 0.6 ? 0.9 : rf.getZoom();
    void rf.setCenter(x + width / 2, y + height / 2, { zoom, duration: cameraDuration(180) });
  }, [navigation, flow, rf]);

  // Fit on request (toolbar, F, Reset view).
  const fitSeq = useAppStore((s) => s.fitSeq);
  useEffect(() => {
    if (fitSeq === 0) return;
    void rf.fitView({ padding: FIT_PADDING, duration: cameraDuration(180) });
  }, [fitSeq, rf]);

  // F fit · 0 reset zoom · + / - zoom (outside text fields and dialogs).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (useAppStore.getState().activeTab !== "map") return;
      if (e.ctrlKey || e.metaKey || e.altKey || typingIn(e.target)) return;
      const duration = cameraDuration(120);
      if (e.key === "f" || e.key === "F") useAppStore.getState().requestFit();
      else if (e.key === "0") void rf.zoomTo(1, { duration });
      else if (e.key === "+" || e.key === "=") void rf.zoomIn({ duration });
      else if (e.key === "-" || e.key === "_") void rf.zoomOut({ duration });
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [rf]);

  /** Focuses a map node, first bringing it into view (keeping the zoom) if it is outside. */
  const focusNode = useCallback(
    (id: string) => {
      const node = rf.getInternalNode(id);
      if (!node) return;
      const focus = () =>
        document
          .querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`)
          ?.focus({ preventScroll: true });
      const { x, y } = node.internals.positionAbsolute;
      const width = node.measured.width ?? node.width ?? 0;
      const height = node.measured.height ?? node.height ?? 0;
      const { x: vx, y: vy, zoom } = rf.getViewport();
      const pane = document.querySelector(".gv-map .react-flow")?.getBoundingClientRect();
      const inView =
        pane !== undefined &&
        x * zoom + vx >= 0 &&
        y * zoom + vy >= 0 &&
        (x + width) * zoom + vx <= pane.width &&
        (y + Math.min(height, 200)) * zoom + vy <= pane.height;
      if (inView) {
        focus();
        return;
      }
      void rf
        .setCenter(x + width / 2, y + Math.min(height, 200) / 2, {
          zoom,
          duration: cameraDuration(180),
        })
        .then(() => requestAnimationFrame(focus));
    },
    [rf],
  );

  const miniRects = useMemo(() => (flow ? minimapRects(flow.nodes) : []), [flow]);

  const onNodeClick = useCallback((_: unknown, node: Node) => {
    const store = useAppStore.getState();
    store.select(node.type === "project" ? null : node.id);
  }, []);
  const onNodeEnter = useCallback((_: unknown, node: Node) => {
    setHoverId(node.type === "project" ? null : node.id);
  }, []);
  const onNodeLeave = useCallback(() => {
    setHoverId(null);
  }, []);
  const onMoveEnd = useCallback((_: unknown, viewport: Viewport) => {
    useAppStore.getState().setViewport(viewport);
  }, []);
  const onPaneClick = useCallback(() => {
    useAppStore.getState().select(null);
  }, []);

  // React Flow focuses the node wrapper, so keys are handled here: Enter expands a file
  // (or selects anything else); Space selects.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".react-flow__node");
    const id = el?.dataset.id;
    if (!id || !model || !flow) return;
    const kind = model.nodes.get(id)?.kind;
    if (kind === undefined || kind === "project") return;
    const store = useAppStore.getState();
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (e.key === "Enter" && kind === "file") store.toggle(id);
      else if (e.key === "Enter" && kind === "class") store.toggleCollapsed(id);
      else store.select(id);
      return;
    }
    if (!e.key.startsWith("Arrow") || e.altKey || e.ctrlKey || e.metaKey) return;
    // Targets are nodes on the map now; rows only at full detail, where they render.
    const onMap = new Set(
      flow.nodes
        .filter((n) => n.type !== "project" && (n.type !== "row" || lod === 2))
        .map((n) => n.id),
    );
    const parent = model.parentById.get(id) ?? null;
    const siblings = (model.childrenById.get(parent ?? "") ?? []).filter((s) => onMap.has(s));
    let target: string | undefined;
    if (e.key === "ArrowUp") target = parent !== null && onMap.has(parent) ? parent : undefined;
    else if (e.key === "ArrowDown")
      target = (model.childrenById.get(id) ?? []).find((c) => onMap.has(c));
    else {
      const at = siblings.indexOf(id);
      target = siblings[at + (e.key === "ArrowRight" ? 1 : -1)];
    }
    e.preventDefault();
    if (target !== undefined) focusNode(target);
  };

  /** Tab or arrow focus on a node outside the view brings it into view. */
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>(".react-flow__node")?.dataset.id;
    if (id && e.target === e.target.closest(".react-flow__node")) focusNode(id);
  };

  return (
    <div
      className="gv-map"
      data-lens={lens}
      data-animate={animate}
      data-focus={focus !== null}
      data-pinned={pinnedKeep !== null || undefined}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
    >
      <EdgeMarkers />
      <ReactFlow<MapNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onNodeMouseEnter={onNodeEnter}
        onNodeMouseLeave={onNodeLeave}
        onMoveEnd={onMoveEnd}
        onlyRenderVisibleElements
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        nodesFocusable
        edgesFocusable={false}
        minZoom={0.05}
        maxZoom={2.5}
        proOptions={proOptions}
        aria-label="Repository map"
      >
        <Toolbar />
        <Legend />
        {lens === "coverage" && <SummaryCard />}
        {flow && (
          <Minimap rects={miniRects} width={flow.layout.width} height={flow.layout.height} />
        )}
        {perfOpen && <PerfOverlay />}
        {model && <FlowOverlay model={model} lod={lod} />}
      </ReactFlow>
    </div>
  );
}

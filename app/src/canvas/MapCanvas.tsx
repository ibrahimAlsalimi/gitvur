import {
  type Edge,
  type Node,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { buildLayoutRequest, moduleEdges } from "../layout/fromModel";
import { runLayout } from "../layout/runLayout";
import { ancestors } from "../model/tree";
import { subtree, visibleAncestor } from "../model/aggregateEdges";
import type { LayoutResult } from "../layout/types";
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
import { Toolbar } from "./Toolbar";
import type { MapEdge, MapNode } from "./types";

const edgeTypes = { connector: ConnectorEdge, relation: RelationEdge };
const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
  const selectedId = useAppStore((s) => s.selectedId);
  const hops = useAppStore((s) => s.hops);
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
    void runLayout(buildLayoutRequest(model, expandedIds, deps)).then(({ result, ms }) => {
      // The first layout of a repository is the cold one; record it even if a newer
      // request superseded it (StrictMode, or a quick expand), so the metric is honest.
      const first = firstRecordedFor.current !== bundle.root;
      if (first) firstRecordedFor.current = bundle.root;
      if (cancelled) {
        if (first) usePerf.getState().record(ms, performance.now() - started, true);
        return;
      }
      const built = buildFlow(model, result, expandedIds, {
        commitSha: bundle.manifest.commitSha,
        languages: bundle.manifest.languages,
      });
      const nodes = reuseNodes(previousNodes.current, built.nodes);
      previousNodes.current = new Map(nodes.map((n) => [n.id, n]));
      setFlow({ nodes, edges: built.edges, layout: result, root: bundle.root });
      requestAnimationFrame(() => {
        usePerf.getState().record(ms, performance.now() - started, first);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [model, bundle, expandedIds, deps]);

  // Fit once per repository: the whole map, or the top two ranks if that would be tiny.
  useEffect(() => {
    if (!flow || fittedRoot.current === flow.root) return;
    fittedRoot.current = flow.root;
    setAnimate(false);
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
    () => (model ? visibleAncestor(model, expandedIds, lod) : () => undefined),
    [model, expandedIds, lod],
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
  const nodes = useMemo(
    () => (flow ? applyFocus(flow.nodes, selectedId, focus) : []),
    [flow, selectedId, focus],
  );
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
    void rf.setCenter(x + width / 2, y + height / 2, { zoom, duration: reducedMotion() ? 0 : 180 });
  }, [navigation, flow, rf]);

  // Esc clears the selection (outside text fields and dialogs).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, dialog")) return;
      useAppStore.getState().select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

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
  const onPaneClick = useCallback(() => {
    useAppStore.getState().select(null);
  }, []);

  // React Flow focuses the node wrapper, so keys are handled here: Enter expands a file
  // (or selects anything else); Space selects.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const el = (e.target as HTMLElement).closest<HTMLElement>(".react-flow__node");
    const id = el?.dataset.id;
    if (!id || !model) return;
    const kind = model.nodes.get(id)?.kind;
    if (kind === undefined || kind === "project") return;
    e.preventDefault();
    const store = useAppStore.getState();
    if (e.key === "Enter" && kind === "file") store.toggle(id);
    else store.select(id);
  };

  return (
    <div
      className="gv-map"
      data-animate={animate}
      data-focus={focus !== null}
      onKeyDown={onKeyDown}
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
        {flow && (
          <Minimap rects={miniRects} width={flow.layout.width} height={flow.layout.height} />
        )}
        {perfOpen && <PerfOverlay />}
      </ReactFlow>
    </div>
  );
}

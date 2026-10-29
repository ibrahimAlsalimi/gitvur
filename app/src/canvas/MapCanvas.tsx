import { type Node, ReactFlow, ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { buildLayoutRequest, moduleEdges } from "../layout/fromModel";
import { runLayout } from "../layout/runLayout";
import type { LayoutResult } from "../layout/types";
import { useAppStore } from "../store/useAppStore";
import { ConnectorEdge } from "./ConnectorEdge";
import { applySelection, buildFlow, reuseNodes } from "./buildFlow";
import { Minimap } from "./Minimap";
import { minimapRects } from "./minimapRects";
import { nodeTypes } from "./nodeTypes";
import { PerfOverlay } from "./PerfOverlay";
import { usePerf } from "./perf";
import { Toolbar } from "./Toolbar";
import type { MapEdge, MapNode } from "./types";

const edgeTypes = { connector: ConnectorEdge };
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

  const nodes = useMemo(
    () => (flow ? applySelection(flow.nodes, selectedId) : []),
    [flow, selectedId],
  );

  const miniRects = useMemo(() => (flow ? minimapRects(flow.nodes) : []), [flow]);

  const onNodeClick = useCallback((_: unknown, node: Node) => {
    const store = useAppStore.getState();
    store.select(node.type === "project" ? null : node.id);
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
    <div className="gv-map" data-animate={animate} onKeyDown={onKeyDown}>
      <ReactFlow<MapNode, MapEdge>
        nodes={nodes}
        edges={flow?.edges ?? []}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
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
        {flow && (
          <Minimap rects={miniRects} width={flow.layout.width} height={flow.layout.height} />
        )}
        {perfOpen && <PerfOverlay />}
      </ReactFlow>
    </div>
  );
}

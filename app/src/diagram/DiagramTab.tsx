import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import { getApi } from "../api";
import { captureDiagram } from "../flows/exportImage";
import { MentionedInDocs } from "../docs/DocsTab";
import { Inspector, InspectorRail } from "../inspector/Inspector";
import { CodeViewer } from "../inspector/CodeViewer";
import { runDiagramLayout } from "../layout/runLayout";
import { useAppStore } from "../store/useAppStore";
import type { RepoBundle } from "../generated/contract";
import {
  buildArchitecture,
  projectArchitecture,
  type Component,
  type Diagram,
  type Relationship,
} from "./model";
import { CARD_HEIGHT, CARD_WIDTH, type DiagramPositions } from "./layout";
import { RelationshipEdge, type ArchitectureEdge } from "./RelationshipEdge";
import { ComponentNode, type ArchitectureNode } from "./ComponentNode";
import { diagramToMermaid } from "./mermaid";
import "./diagram.css";
const nodeTypes = { architecture: ComponentNode };
const edgeTypes = { architectureRelationship: RelationshipEdge };

function Context({
  item,
  diagram,
  onExplore,
}: {
  item: Component | Relationship | undefined;
  diagram: Diagram;
  onExplore: (id: string) => void;
}) {
  if (!item)
    return (
      <section className="gv-insp-section">
        <h3>Architecture</h3>
        <p>Select a component or relationship to inspect its sources and evidence.</p>
      </section>
    );
  const component = "sources" in item;
  const sources = component
    ? item.sources
    : diagram.components
        .filter((c) => c.id === item.from || c.id === item.to)
        .flatMap((c) => c.sources);
  return (
    <section className="gv-insp-section gv-architecture-context" aria-label="Architecture context">
      <h3>{component ? item.name : item.label}</h3>
      <p>
        {component
          ? item.responsibility
          : `${diagram.components.find((c) => c.id === item.from)?.name ?? item.from} → ${diagram.components.find((c) => c.id === item.to)?.name ?? item.to}`}
      </p>
      <p className="gv-architecture-muted">
        {item.provenance === "ai"
          ? "AI interpretation · source-validated · current"
          : "Structure-derived · verified indexed dependencies"}
      </p>
      {component && diagram.components.some((c) => c.parent === item.id) && (
        <button
          className="button"
          onClick={() => {
            onExplore(item.id);
          }}
        >
          Explore components
        </button>
      )}
      <h4>Source references</h4>
      <div className="gv-architecture-sources">
        {sources.map((s) => (
          <button
            className="gv-insp-link"
            key={s.node}
            onClick={() => {
              const app = useAppStore.getState();
              app.select(s.node);
              app.navigateTo(s.node);
              app.setActiveTab("map");
            }}
          >
            {s.node.replace(/^(file|function|class):/, "")} · Map
          </button>
        ))}
      </div>
      <button
        className="button"
        onClick={() => {
          useAppStore.getState().setActiveTab("docs");
        }}
      >
        Open Docs
      </button>
      {sources.map((s) => (
        <MentionedInDocs key={s.node} id={s.node} />
      ))}
      <h4>Supporting evidence</h4>
      <div className="gv-architecture-sources">
        {item.evidence.map((e) => (
          <details key={`${e.file}:${String(e.line)}`}>
            <summary>
              {e.file}:{e.line}
            </summary>
            <CodeViewer
              key={`${e.file}:${String(e.line)}`}
              file={e.file}
              start={e.line}
              end={e.line}
              highlightLine={e.line}
              cacheKey={`${e.file}:${String(e.line)}`}
            />
          </details>
        ))}
      </div>
    </section>
  );
}
function DiagramCanvas({ bundle }: { bundle: RepoBundle }) {
  const collapsed = useAppStore((s) => s.settings.inspectorCollapsed);
  const [structureOnly, setStructureOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [positions, setPositions] = useState<DiagramPositions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [reset, setReset] = useState(0);
  const capture = useRef<HTMLDivElement>(null);
  const rf = useReactFlow<ArchitectureNode>();
  // Enrichment is only used after fresh backend validation, never based on cached reports.
  const trusted = bundle.architectureIssues !== undefined;
  const architecture = useMemo(
    () =>
      buildArchitecture(
        bundle.structure,
        structureOnly || !trusted ? null : bundle.annotations?.architecture,
        bundle.architectureIssues ?? [],
      ),
    [bundle, structureOnly, trusted],
  );
  const diagram = useMemo(
    () => projectArchitecture(architecture, focus, query),
    [architecture, focus, query],
  );
  const [layoutKey, setLayoutKey] = useState<Diagram | null>(null);
  useEffect(() => {
    let cancelled = false;
    void runDiagramLayout(diagram)
      .then((p) => {
        if (cancelled) return;
        setPositions(p);
        setLayoutKey(diagram);
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError("Could not lay out this diagram. Reset layout to retry.");
      });
    return () => {
      cancelled = true;
    };
  }, [diagram, reset]);
  useEffect(() => {
    if (!positions || layoutKey !== diagram) return;
    const timer = requestAnimationFrame(() => {
      void rf.fitView({ padding: 0.18, duration: 0 });
    });
    return () => {
      cancelAnimationFrame(timer);
    };
  }, [positions, layoutKey, diagram, rf]);
  const selectedEdge = diagram.relationships.find((r) => r.id === selected);
  const neighbours = new Set([selected]);
  for (const r of diagram.relationships)
    if (r.from === selected || r.to === selected || r.id === selected) {
      neighbours.add(r.from);
      neighbours.add(r.to);
    }
  const nodes: ArchitectureNode[] = diagram.components.map((c) => ({
    id: c.id,
    type: "architecture",
    position: positions?.[c.id] ?? { x: 0, y: 0 },
    selected: selected === c.id,
    data: {
      component: c,
      children: architecture.components.filter((s) => s.parent === c.id).length,
      dimmed: selected !== null && !neighbours.has(c.id),
    },
    style: { width: CARD_WIDTH, height: CARD_HEIGHT },
  }));
  const edges: ArchitectureEdge[] = diagram.relationships.map((r) => {
    const parallel = diagram.relationships.filter((s) => s.from === r.from && s.to === r.to);
    return {
      id: r.id,
      source: r.from,
      target: r.to,
      type: "architectureRelationship",
      data: {
        offset: (parallel.findIndex((s) => s.id === r.id) - (parallel.length - 1) / 2) * 100,
      },
      label: r.label,
      ariaLabel: `Relationship: ${r.label}`,
      selected: r.id === selected,
      className: `gv-architecture-edge${selected && !neighbours.has(r.from) && !neighbours.has(r.to) ? " dimmed" : ""}`,
      style: { strokeDasharray: r.provenance === "ai" ? "5 4" : undefined },
      markerEnd: { type: MarkerType.ArrowClosed },
      interactionWidth: 24,
    };
  });
  const exportImage = useCallback(
    async (kind: "png" | "svg") => {
      if (!capture.current) return;
      const viewport = rf.getViewport();
      try {
        await rf.fitView({ padding: 0.18, duration: 0 });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const data = await captureDiagram(capture.current, kind);
        const saved = await (
          await getApi()
        ).saveExport(bundle.root, `architecture.${kind}`, kind, data);
        setNotice(saved ? `Saved ${kind.toUpperCase()}` : "Export cancelled");
      } catch {
        setNotice("Export failed. Try again.");
      } finally {
        await rf.setViewport(viewport);
      }
    },
    [bundle.root, rf],
  );
  const selectedItem = selectedEdge ?? architecture.components.find((c) => c.id === selected);
  const explore = (id: string) => {
    setFocus(id);
    setSelected(null);
    setQuery("");
  };
  return (
    <>
      <div className="gv-architecture-main">
        <div className="gv-architecture-toolbar" role="toolbar" aria-label="Architecture tools">
          <button
            className="button"
            onClick={() => {
              void rf.fitView({ padding: 0.18 });
            }}
          >
            Fit diagram
          </button>
          <button
            className="button"
            onClick={() => {
              setReset((n) => n + 1);
            }}
          >
            Reset layout
          </button>
          <label>
            <input
              type="checkbox"
              checked={structureOnly}
              onChange={(e) => {
                setStructureOnly(e.target.checked);
                setFocus(null);
                setSelected(null);
              }}
            />
            Structure only
          </label>
          <label className="gv-architecture-filter">
            Filter components
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelected(null);
              }}
            />
          </label>
          <button
            className="button"
            onClick={() => {
              void navigator.clipboard
                .writeText(diagramToMermaid(architecture))
                .then(() => {
                  setNotice("Copied Mermaid");
                })
                .catch(() => {
                  setNotice("Could not access clipboard");
                });
            }}
          >
            Copy Mermaid
          </button>
          <button
            className="button"
            onClick={() => {
              void exportImage("svg");
            }}
          >
            Export SVG
          </button>
          <button
            className="button"
            onClick={() => {
              void exportImage("png");
            }}
          >
            Export PNG
          </button>
        </div>
        <div className="gv-architecture-export" ref={capture}>
          <header className="gv-architecture-header" role="presentation">
            <div className="gv-architecture-eyebrow">
              REPOSITORY ARCHITECTURE <span>{architecture.mode}</span>
            </div>
            <h2>{bundle.manifest.projectName}</h2>
            <p>{architecture.summary}</p>
            <div className="gv-architecture-meta">
              {diagram.components.length} components · {diagram.relationships.length} relationships
              · solid: indexed · dashed: AI
            </div>
            {bundle.annotations?.architecture && (bundle.architectureIssues?.length || !trusted) ? (
              <p role="status">
                Some architecture annotations need validation or review. Structural fallback is
                available.
              </p>
            ) : null}
            {focus && (
              <nav aria-label="Architecture hierarchy" data-export="skip">
                <button
                  className="button"
                  onClick={() => {
                    setFocus(architecture.components.find((c) => c.id === focus)?.parent ?? null);
                    setSelected(null);
                  }}
                >
                  ← Up one level
                </button>{" "}
                <span>{architecture.components.find((c) => c.id === focus)?.name}</span>
              </nav>
            )}
          </header>
          <div className="gv-architecture-canvas">
            {error ? (
              <p role="alert">{error}</p>
            ) : !diagram.components.length ? (
              <div className="gv-architecture-empty">
                {query
                  ? "No matching components. Clear the filter to see the diagram."
                  : "No indexed source components. Index the repository to build its architecture."}
              </div>
            ) : layoutKey !== diagram ? (
              <p role="status">Laying out architecture…</p>
            ) : (
              <ReactFlow<ArchitectureNode>
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                nodesDraggable={false}
                nodesConnectable={false}
                minZoom={0.05}
                maxZoom={2}
                fitView
                onNodeClick={(_, node) => {
                  setSelected(node.id);
                  const source = node.data.component.sources[0];
                  if (source) useAppStore.getState().select(source.node);
                }}
                onNodeDoubleClick={(_, node) => {
                  if (architecture.components.some((c) => c.parent === node.id)) explore(node.id);
                }}
                onEdgeClick={(_, edge) => {
                  setSelected(edge.id);
                }}
                onPaneClick={() => {
                  setSelected(null);
                }}
                proOptions={{ hideAttribution: true }}
                aria-label="Repository architecture diagram"
              >
                <Background />
                <Controls showInteractive={false} />
              </ReactFlow>
            )}
          </div>
        </div>
        <div className="gv-architecture-notice" role="status">
          {notice}
        </div>
      </div>
      {collapsed ? (
        <InspectorRail />
      ) : (
        <Inspector
          top={<Context item={selectedItem} diagram={architecture} onExplore={explore} />}
        />
      )}
    </>
  );
}
export function DiagramTab() {
  const active = useAppStore((s) => s.activeTab === "diagram");
  const bundle = useAppStore((s) => s.bundle);
  const settings = useAppStore((s) => s.settings);
  return (
    <section
      role="tabpanel"
      id="panel-diagram"
      aria-labelledby="tab-diagram"
      className={`gv-architecture-panel${active ? "" : " gv-tab-hidden"}`}
      style={
        {
          "--gv-architecture-inspector": settings.inspectorCollapsed
            ? "var(--gv-layout-rail)"
            : `${String(settings.inspectorWidth)}px`,
        } as CSSProperties
      }
      inert={!active}
    >
      {active && bundle && (
        <ReactFlowProvider key={bundle.root}>
          <DiagramCanvas bundle={bundle} />
        </ReactFlowProvider>
      )}
    </section>
  );
}

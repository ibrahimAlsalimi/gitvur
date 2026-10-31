import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeChange,
  type EdgeChange,
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
  buildStructureDiagram,
  savedArchitecture,
  filterArchitecture,
  componentSources,
  referencesNode,
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
  bundle,
}: {
  item: Component | Relationship | undefined;
  diagram: Diagram;
  bundle: RepoBundle;
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
  const relatedSources = component
    ? componentSources(diagram, item.id)
    : diagram.components
        .filter((c) => c.id === item.from || c.id === item.to)
        .flatMap((c) => componentSources(diagram, c.id));
  const sources = [...new Map(relatedSources.map((s) => [s.node, s])).values()];
  const includesNode = (id: string | null | undefined) =>
    referencesNode(bundle.structure, sources, id);
  const entries = [
    ...(bundle.structure.entryPoints ?? []),
    ...(bundle.annotations?.entryPoints ?? []),
  ].filter((e) => includesNode(e.target));
  const flows = (bundle.annotations?.flows ?? []).filter((f) =>
    f.steps.some((step) => includesNode(step.node)),
  );
  const parent =
    component && item.parent ? diagram.components.find((c) => c.id === item.parent) : null;
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
          ? `AI interpretation · ${!component && item.support === "unresolved" ? "unresolved interaction" : component && item.status === "stale" ? "source changed" : "references checked; semantics need review"}`
          : "Structure-backed · indexed relationships"}
      </p>
      {parent && <p className="gv-architecture-muted">Subsystem · {parent.name}</p>}
      {component &&
        diagram.mode === "Structure-derived" &&
        diagram.components.some((c) => c.parent === item.id) && (
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
        <MentionedInDocs key={s.node} id={s.node} label={`Architecture docs for ${s.node}`} />
      ))}
      {entries.length > 0 && (
        <>
          <h4>Entry points</h4>
          {entries.map((e) => (
            <p key={e.id}>{e.name}</p>
          ))}
        </>
      )}
      {flows.length > 0 && (
        <>
          <h4>Related flows</h4>
          {flows.map((f) => (
            <button
              className="gv-insp-link"
              key={f.id}
              onClick={() => {
                const app = useAppStore.getState();
                app.selectFlow(f.id);
                app.setActiveTab("flows");
              }}
            >
              {f.name} · Flows
            </button>
          ))}
        </>
      )}
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
              cacheKey={`${bundle.architectureIndexHash ?? bundle.manifest.generatedAt}:${e.file}:${String(e.line)}`}
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
  const trusted = bundle.architectureIssues !== undefined;
  const saved = useMemo(() => savedArchitecture(bundle), [bundle]);
  const empty: Diagram = useMemo(
    () => ({
      version: 1,
      summary: "",
      mode: "Architecture map",
      components: [],
      relationships: [],
    }),
    [],
  );
  const architecture = useMemo(
    () => (structureOnly ? buildStructureDiagram(bundle.structure) : (saved ?? empty)),
    [bundle.structure, structureOnly, saved, empty],
  );
  const diagram = useMemo(
    () =>
      structureOnly
        ? projectArchitecture(architecture, focus, query)
        : filterArchitecture(architecture, query),
    [architecture, focus, query, structureOnly],
  );
  const entries = [
    ...(bundle.structure.entryPoints ?? []),
    ...(bundle.annotations?.entryPoints ?? []),
  ];
  const entryNames = (c: Component) =>
    entries
      .filter((e) =>
        referencesNode(bundle.structure, componentSources(architecture, c.id), e.target),
      )
      .map((e) => e.name);
  const findings = bundle.architectureIssues ?? [];
  const needsReview = findings.length > 0;
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
      void rf.fitView({ padding: 0.12, duration: 0 });
    });
    return () => {
      cancelAnimationFrame(timer);
    };
  }, [positions, layoutKey, diagram, rf]);
  const handleChanges = useCallback(
    (changes: (NodeChange<ArchitectureNode> | EdgeChange<ArchitectureEdge>)[]) => {
      const selections = changes.filter((change) => change.type === "select");
      setSelected(
        (current) =>
          selections.find((change) => change.selected)?.id ??
          (selections.some((change) => change.id === current && !change.selected) ? null : current),
      );
    },
    [],
  );
  useEffect(() => {
    const component = architecture.components.find((c) => c.id === selected);
    const source = component ? componentSources(architecture, component.id)[0] : undefined;
    if (source) useAppStore.getState().select(source.node);
  }, [selected, architecture]);
  const selectedEdge = diagram.relationships.find((r) => r.id === selected);
  const neighbours = new Set([selected]);
  for (const r of diagram.relationships)
    if (r.from === selected || r.to === selected || r.id === selected) {
      neighbours.add(r.from);
      neighbours.add(r.to);
    }
  const depth = (c: Component) => {
    let d = 0,
      parent = c.parent;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      d++;
      parent = diagram.components.find((s) => s.id === parent)?.parent;
    }
    return d;
  };
  const nodes: ArchitectureNode[] = [...diagram.components]
    .sort((a, b) => depth(a) - depth(b))
    .map((c) => ({
      id: c.id,
      type: "architecture",
      zIndex: architecture.components.some((child) => child.parent === c.id) ? 0 : 3,
      ...(c.parent && !structureOnly ? { parentId: c.parent, extent: "parent" as const } : {}),
      position: positions?.[c.id] ?? { x: 0, y: 0 },
      selected: selected === c.id,
      data: {
        component: c,
        children: architecture.components.filter((s) => s.parent === c.id).length,
        dimmed: selected !== null && !neighbours.has(c.id),
        entryPoints: entryNames(c),
      },
      style: {
        width: positions?.[c.id]?.width ?? CARD_WIDTH,
        height: positions?.[c.id]?.height ?? CARD_HEIGHT,
      },
    }));
  const absolute = (id: string) => {
    const p = positions?.[id];
    let x = p?.x ?? 0,
      y = p?.y ?? 0;
    let parent = diagram.components.find((c) => c.id === id)?.parent;
    const seen = new Set<string>();
    while (parent && !seen.has(parent) && !structureOnly) {
      seen.add(parent);
      x += positions?.[parent]?.x ?? 0;
      y += positions?.[parent]?.y ?? 0;
      parent = diagram.components.find((c) => c.id === parent)?.parent;
    }
    return { x, y };
  };
  const edges: ArchitectureEdge[] = diagram.relationships.map((r) => {
    const from = absolute(r.from),
      to = absolute(r.to);
    let ancestor = diagram.components.find((c) => c.id === r.to)?.parent;
    const seen = new Set<string>();
    let internalGroup = false;
    while (ancestor && !seen.has(ancestor) && !structureOnly) {
      seen.add(ancestor);
      if (ancestor === r.from) {
        internalGroup = true;
        break;
      }
      ancestor = diagram.components.find((c) => c.id === ancestor)?.parent;
    }
    const vertical = Math.abs(to.x - from.x) < CARD_WIDTH / 2 && to.y > from.y + CARD_HEIGHT;
    const reverse = to.x < from.x;

    const parallel = diagram.relationships.filter((s) => s.from === r.from && s.to === r.to);
    return {
      id: r.id,
      source: r.from,
      target: r.to,
      zIndex: 2,
      sourceHandle: internalGroup
        ? "out-group"
        : vertical
          ? "out-bottom"
          : reverse
            ? "out-left"
            : "out-right",
      targetHandle: internalGroup
        ? "in-top"
        : vertical
          ? "in-top"
          : reverse
            ? "in-right"
            : "in-left",
      type: "architectureRelationship",
      data: {
        ...(internalGroup ? { routeX: from.x + 12 } : {}),
        offset: (parallel.findIndex((s) => s.id === r.id) - (parallel.length - 1) / 2) * 100,
      },
      label: `${r.label}${r.support === "unresolved" ? " · unresolved" : ""}`,
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
      const element = capture.current;
      if (!element) return;
      const viewport = rf.getViewport();
      element.dataset.exporting = "true";
      try {
        await rf.fitView({ padding: 0.12, duration: 0 });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const data = await captureDiagram(element, kind);
        const saved = await (
          await getApi()
        ).saveExport(bundle.root, `architecture.${kind}`, kind, data);
        setNotice(saved ? `Saved ${kind.toUpperCase()}` : "Export cancelled");
      } catch {
        setNotice("Export failed. Try again.");
      } finally {
        delete element.dataset.exporting;
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
              void rf.fitView({ padding: 0.12 });
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
          <div className="gv-architecture-modes" role="group" aria-label="Diagram view">
            {[false, true].map((raw) => (
              <button
                className="button"
                key={String(raw)}
                aria-pressed={structureOnly === raw}
                onClick={() => {
                  setStructureOnly(raw);
                  setFocus(null);
                  setSelected(null);
                  setQuery("");
                }}
              >
                {raw ? "Raw structure" : "Architecture"}
              </button>
            ))}
          </div>
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
            disabled={!architecture.components.length}
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
            disabled={!diagram.components.length}
            onClick={() => {
              void exportImage("svg");
            }}
          >
            Export SVG
          </button>
          <button
            className="button"
            disabled={!diagram.components.length}
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
              {structureOnly ? "SOURCE EXPLORATION" : "SYSTEM OVERVIEW"}{" "}
              <span>{architecture.mode}</span>
            </div>
            <h2>{bundle.manifest.projectName}</h2>
            <p>{architecture.summary}</p>
            <div className="gv-architecture-meta">
              {diagram.components.length} components · {diagram.relationships.length} relationships
              · {structureOnly ? "indexed dependencies" : "dashed: AI interpretation"}
            </div>
            {!!bundle.architecture?.designNotes?.length && (
              <details className="gv-architecture-findings">
                <summary>Design notes</summary>
                {bundle.architecture.designNotes.map((note) => (
                  <p key={note}>{note}</p>
                ))}
              </details>
            )}
            {!structureOnly && saved?.mode === "Legacy architecture" && (
              <p className="gv-architecture-muted">
                Legacy saved architecture · regenerate documentation to create architecture.json.
              </p>
            )}
            {!structureOnly && needsReview && (
              <details className="gv-architecture-findings">
                <summary>Architecture needs review · {findings.length} findings</summary>
                <ul>
                  {findings.map((issue, i) => (
                    <li key={`${issue.code}:${String(i)}`}>
                      {issue.id}: {issue.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}
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
            {!structureOnly && !saved ? (
              <div className="gv-architecture-empty">
                <h3>
                  {needsReview
                    ? "Architecture needs repair"
                    : "Architecture has not been generated yet"}
                </h3>
                <p>
                  {needsReview
                    ? "The saved architecture could not pass validation. Review the findings and update repository documentation."
                    : "Document this repository with the Documentation Agent to save its system summary, major components and interactions."}
                </p>
                <p>Opening Diagram reads saved documentation and does not invoke AI.</p>
                {!trusted && <p>Fresh architecture validation is unavailable for this bundle.</p>}
                <button
                  className="button"
                  onClick={() => {
                    setStructureOnly(true);
                  }}
                >
                  Explore raw structure
                </button>
              </div>
            ) : error ? (
              <p role="alert">{error}</p>
            ) : !diagram.components.length ? (
              <div className="gv-architecture-empty">
                {query
                  ? "No matching components. Clear the filter to see the diagram."
                  : structureOnly
                    ? "No indexed source components. Index the repository to explore its raw structure."
                    : "No architecture components were documented for this repository."}
              </div>
            ) : layoutKey !== diagram ? (
              <p role="status">Laying out architecture…</p>
            ) : (
              <ReactFlow<ArchitectureNode, ArchitectureEdge>
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                nodesDraggable={false}
                elevateNodesOnSelect={false}
                nodesConnectable={false}
                minZoom={0.05}
                maxZoom={1.5}
                fitView
                onNodesChange={handleChanges}
                onEdgesChange={handleChanges}
                deleteKeyCode={null}
                onNodeClick={(_, node) => {
                  setSelected(node.id);
                }}
                onNodeDoubleClick={(_, node) => {
                  if (structureOnly && architecture.components.some((c) => c.parent === node.id))
                    explore(node.id);
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
          top={
            <Context
              item={selectedItem}
              diagram={architecture}
              bundle={bundle}
              onExplore={explore}
            />
          }
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

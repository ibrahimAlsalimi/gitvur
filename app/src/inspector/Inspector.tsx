import { useEffect, useState } from "react";

import { unresolvedKey } from "../canvas/edges/relationEdges";
import { ClassGlyph, FunctionGlyph, LanguageGlyph, PercentRing } from "../canvas/glyphs";
import { middleTruncate } from "../canvas/text";
import { PanelIcon } from "../components/Icons";
import type { UnresolvedCall } from "../generated/contract";
import type { Model, ModelEdge, ModelNode } from "../model/buildModel";
import { ancestors } from "../model/tree";
import { useAppStore } from "../store/useAppStore";
import { CodeViewer } from "./CodeViewer";
import {
  type RelationItem,
  fileOf,
  isMethod,
  outline,
  relationGroups,
  shortHash,
  unresolvedIn,
} from "./relations";

const KIND_LABEL = {
  project: "project",
  module: "module",
  file: "file",
  class: "class",
  function: "function",
} as const;
const STATUS_LABEL = {
  documented: "Documented",
  stale: "Out of date",
  undocumented: "No description",
} as const;
const PROVENANCE_LABEL = { syntactic: "syntactic", semantic: "semantic", ai: "AI" } as const;
/** Lines of context around an evidence line. */
const EVIDENCE_CONTEXT = 4;

const svg = { "aria-hidden": true, focusable: false } as const;

function ModuleGlyph() {
  return (
    <svg {...svg} className="gv-glyph" viewBox="0 0 16 16">
      <rect
        x="1.75"
        y="1.75"
        width="12.5"
        height="12.5"
        rx="2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M1.75 5.5h12.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function KindGlyph({ model, node }: { model: Model; node: ModelNode }) {
  const glyph =
    node.kind === "class" ? (
      <ClassGlyph />
    ) : node.kind === "function" ? (
      <FunctionGlyph method={isMethod(model, node)} />
    ) : node.kind === "file" ? (
      <LanguageGlyph
        language={node.id.endsWith(".py") ? "py" : node.id.endsWith(".ts") ? "ts" : "file"}
      />
    ) : (
      <ModuleGlyph />
    );
  return (
    <span className="gv-insp-glyph" data-kind={node.kind}>
      {glyph}
    </span>
  );
}

/** The provenance line style as a tiny sample, so lists match the canvas. */
function ProvenanceMark({ provenance }: { provenance: ModelEdge["provenance"] }) {
  return (
    <span className="gv-insp-prov" title={`${PROVENANCE_LABEL[provenance]} relationship`}>
      <svg {...svg} viewBox="0 0 20 8" className="gv-insp-prov-line">
        <g className="gv-edge" data-prov={provenance}>
          <path className="gv-edge-line" d="M 1 4 L 19 4" />
        </g>
      </svg>
      {provenance === "ai" ? (
        <span className="gv-ai-pill">AI</span>
      ) : (
        <span className="visually-hidden">{PROVENANCE_LABEL[provenance]}</span>
      )}
    </span>
  );
}

/** Glyph, name and file of another node; activating it flies the map there. */
function NodeLink({ model, id }: { model: Model; id: string }) {
  const node = model.nodes.get(id);
  if (!node) return <span className="gv-insp-missing">{id}</span>;
  const file = node.kind === "module" ? undefined : fileOf(model, id);
  return (
    <button
      type="button"
      className="gv-insp-link"
      onClick={() => {
        useAppStore.getState().navigateTo(id);
      }}
    >
      <KindGlyph model={model} node={node} />
      <span className="gv-insp-link-name">{node.name}</span>
      {file && file.id !== id && (
        <span className="gv-insp-link-file">{middleTruncate(file.name, 28)}</span>
      )}
    </button>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="gv-insp-section" aria-label={title}>
      <h3 className="gv-insp-heading">
        {title}
        {count !== undefined && <span className="gv-insp-count">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

function Breadcrumb({ model, node }: { model: Model; node: ModelNode }) {
  const chain = ancestors(model, node.id).reverse();
  return (
    <nav aria-label="Breadcrumb" className="gv-crumbs">
      <ol>
        <li>
          <span className="gv-crumb-root">{model.projectName}</span>
        </li>
        {chain.map((id) => (
          <li key={id}>
            <button
              type="button"
              className="gv-crumb"
              onClick={() => {
                useAppStore.getState().navigateTo(id);
              }}
            >
              {model.nodes.get(id)?.name ?? id}
            </button>
          </li>
        ))}
        <li>
          <span className="gv-crumb-current" aria-current="page">
            {node.name}
          </span>
        </li>
      </ol>
    </nav>
  );
}

function HistoryButtons() {
  const canBack = useAppStore((s) => s.historyIndex > 0);
  const canForward = useAppStore((s) => s.historyIndex < s.history.length - 1);
  const { back, forward } = useAppStore.getState();
  return (
    <div className="gv-insp-history">
      <button
        type="button"
        className="button button-icon button-ghost"
        aria-label="Back (Alt+←)"
        title="Back (Alt+←)"
        disabled={!canBack}
        onClick={back}
      >
        <svg {...svg} viewBox="0 0 16 16">
          <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
      <button
        type="button"
        className="button button-icon button-ghost"
        aria-label="Forward (Alt+→)"
        title="Forward (Alt+→)"
        disabled={!canForward}
        onClick={forward}
      >
        <svg {...svg} viewBox="0 0 16 16">
          <path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
    </div>
  );
}

function CopyPath({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => {
      setCopied(false);
    }, 1200);
    return () => {
      clearTimeout(t);
    };
  }, [copied]);
  return (
    <button
      type="button"
      className="gv-link"
      aria-label={`Copy path ${path}`}
      onClick={() => {
        void navigator.clipboard
          .writeText(path)
          .then(() => {
            setCopied(true);
          })
          .catch(() => undefined);
      }}
    >
      {copied ? "Copied" : "Copy path"}
    </button>
  );
}

function Header({ model, node }: { model: Model; node: ModelNode }) {
  const range = node.source;
  const lines =
    range && node.kind !== "file"
      ? range.startLine === range.endLine
        ? `line ${String(range.startLine)}`
        : `lines ${String(range.startLine)}–${String(range.endLine)}`
      : undefined;
  return (
    <header className="gv-insp-header">
      <div className="gv-insp-title-row">
        <KindGlyph model={model} node={node} />
        <h2 className="inspector-title">{node.name}</h2>
        {!node.synthetic && (
          <span className="status-label gv-insp-status">
            <span className="status-dot" data-status={node.docStatus} aria-hidden="true" />
            {STATUS_LABEL[node.docStatus]}
          </span>
        )}
      </div>
      <div className="gv-insp-meta">
        <span>{isMethod(model, node) ? "method" : KIND_LABEL[node.kind]}</span>
        {range && (
          <>
            <span aria-hidden="true">·</span>
            <span className="inline-code gv-insp-path">{range.file}</span>
          </>
        )}
        {lines && (
          <>
            <span aria-hidden="true">·</span>
            <span>{lines}</span>
          </>
        )}
        {range && <CopyPath path={range.file} />}
      </div>
    </header>
  );
}

function DescriptionBlock({ node }: { node: ModelNode }) {
  if (node.description === undefined) {
    return (
      <div className="gv-insp-description" data-empty="true">
        <p>No description yet</p>
        <p className="gv-insp-hint">Run the documentation agent to add one.</p>
      </div>
    );
  }
  return (
    <div className="gv-insp-description">
      <p>{node.description}</p>
      <p className="gv-insp-hint">
        AI-written
        {node.descriptionHash !== undefined &&
          ` · based on version ${shortHash(node.descriptionHash)}`}
        {node.docStatus === "stale" &&
          (node.childChanged ? " · a child changed since" : " · the code changed since")}
      </p>
    </div>
  );
}

function RelationRow({ model, item }: { model: Model; item: RelationItem }) {
  const { edge } = item;
  return (
    <li className="gv-insp-row">
      <NodeLink model={model} id={item.otherId} />
      <ProvenanceMark provenance={edge.provenance} />
      <button
        type="button"
        className="gv-insp-evidence"
        aria-label={`Show evidence at ${edge.evidence.file}:${String(edge.evidence.line)}`}
        title="Show evidence"
        onClick={() => {
          useAppStore.getState().showEvidence(edge);
        }}
      >
        :{edge.evidence.line}
      </button>
    </li>
  );
}

function Relationships({ model, node }: { model: Model; node: ModelNode }) {
  const groups = relationGroups(model, node.id);
  if (groups.length === 0) return null;
  return (
    <>
      {groups.map((g) => (
        <Section key={g.key} title={g.label} count={g.items.length}>
          <ul className="gv-insp-list">
            {g.items.map((item) => (
              <RelationRow
                key={`${item.otherId}|${item.edge.provenance}|${String(item.edge.evidence.line)}`}
                model={model}
                item={item}
              />
            ))}
          </ul>
        </Section>
      ))}
    </>
  );
}

function Ambiguous({ model, calls }: { model: Model; calls: UnresolvedCall[] }) {
  const open = useAppStore((s) => s.ambiguousOpen);
  if (calls.length === 0) return null;
  return (
    <section className="gv-insp-section" aria-label="Possible targets">
      {calls.map((u) => {
        const key = unresolvedKey(u);
        const expanded = open.has(key);
        return (
          <div key={key} className="gv-insp-ambiguous">
            <button
              type="button"
              className="gv-insp-disclosure"
              aria-expanded={expanded}
              onClick={() => {
                useAppStore.getState().toggleAmbiguous(key);
              }}
            >
              <svg
                {...svg}
                viewBox="0 0 16 16"
                className="gv-glyph gv-chevron"
                data-expanded={expanded}
              >
                <path d="m6 4 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" />
              </svg>
              Possible targets for <code className="inline-code">{u.name}</code>
              <span className="gv-insp-count">{u.candidates.length}</span>
            </button>
            {expanded && (
              <>
                <p className="gv-insp-hint">
                  Called at {u.evidence.file}:{u.evidence.line}. The parser found more than one
                  match.
                </p>
                <ul className="gv-insp-list">
                  {u.candidates.map((c) => (
                    <li key={c} className="gv-insp-row">
                      <NodeLink model={model} id={c} />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}

function SourceSection({ node }: { node: ModelNode }) {
  if (!node.source) return null;
  const { file, startLine, endLine } = node.source;
  return (
    <Section title="Source">
      <CodeViewer
        key={node.id}
        file={file}
        start={startLine}
        end={endLine}
        cacheKey={node.contentHash ?? node.id}
      />
    </Section>
  );
}

function ModuleBody({ model, node }: { model: Model; node: ModelNode }) {
  const stats = model.moduleStats.get(node.id);
  const files = model.childrenById.get(node.id) ?? [];
  return (
    <>
      {stats && (
        <Section title="Contents">
          <div className="gv-insp-stats">
            <span>
              {stats.files} files · {stats.classes} classes · {stats.functions} functions
            </span>
            <span className="status-label">
              <PercentRing value={stats.documentedPct} />
              {stats.documentedPct}% documented
            </span>
          </div>
        </Section>
      )}
      <Section title="Files" count={files.length}>
        <ul className="gv-insp-list">
          {files.map((id) => (
            <li key={id} className="gv-insp-row">
              <NodeLink model={model} id={id} />
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

function FileBody({ model, node }: { model: Model; node: ModelNode }) {
  const items = outline(model, node.id);
  return (
    <>
      {items.length > 0 && (
        <Section title="Outline" count={items.length}>
          <ul className="gv-insp-list">
            {items.map(({ node: child, depth }) => (
              <li
                key={child.id}
                className="gv-insp-row"
                style={{ paddingLeft: `calc(${String(depth)} * var(--gv-layout-tree-indent))` }}
              >
                <NodeLink model={model} id={child.id} />
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Relationships model={model} node={node} />
    </>
  );
}

/** Code at an edge's evidence line, with a header naming the relationship and a Back link. */
function EvidenceView({ model, edge }: { model: Model; edge: ModelEdge }) {
  const name = (id: string) => model.nodes.get(id)?.name ?? id;
  const { file, line } = edge.evidence;
  const fileNode = model.nodes.get(`file:${file}`);
  return (
    <div className="gv-insp-evidence-view">
      <div className="gv-insp-evidence-header">
        <button
          type="button"
          className="gv-link"
          onClick={() => {
            useAppStore.getState().showEvidence(null);
          }}
        >
          ← Back
        </button>
        <h3 className="gv-insp-heading">
          Evidence for: {name(edge.from)} → {name(edge.to)}{" "}
          <span className="gv-insp-evidence-kind">
            ({edge.type}, {PROVENANCE_LABEL[edge.provenance]})
          </span>
        </h3>
        {edge.note !== undefined && <p className="gv-insp-note">{edge.note}</p>}
      </div>
      <CodeViewer
        key={`${file}:${String(line)}`}
        file={file}
        start={line}
        end={line}
        highlightLine={line}
        context={EVIDENCE_CONTEXT}
        cacheKey={fileNode?.contentHash ?? "evidence"}
      />
    </div>
  );
}

function NodeDetails({ model, node }: { model: Model; node: ModelNode }) {
  const evidence = useAppStore((s) => s.evidence);
  return (
    <div className="gv-insp">
      <div className="gv-insp-top">
        <Breadcrumb model={model} node={node} />
        <HistoryButtons />
      </div>
      <Header model={model} node={node} />
      <DescriptionBlock node={node} />
      {evidence ? (
        <EvidenceView model={model} edge={evidence} />
      ) : node.kind === "module" ? (
        <ModuleBody model={model} node={node} />
      ) : node.kind === "file" ? (
        <FileBody model={model} node={node} />
      ) : (
        <>
          <SourceSection node={node} />
          <Relationships model={model} node={node} />
          <Ambiguous model={model} calls={unresolvedIn(model, node.id)} />
        </>
      )}
    </div>
  );
}

/** Details of the selected element: description, source, relationships. */
export function Inspector() {
  const model = useAppStore((s) => s.model);
  const bundle = useAppStore((s) => s.bundle);
  const selectedId = useAppStore((s) => s.selectedId);
  const node = selectedId !== null ? model?.nodes.get(selectedId) : undefined;

  return (
    <aside className="pane" aria-label="Inspector">
      <div className="pane-header">
        <span>Inspector</span>
        <button
          type="button"
          className="button button-icon button-ghost"
          aria-label="Collapse inspector"
          onClick={() => {
            useAppStore.getState().setInspectorCollapsed(true);
          }}
        >
          <PanelIcon side="close" />
        </button>
      </div>
      <div className="pane-body">
        {model && node && node.kind !== "project" ? (
          <NodeDetails key={node.id} model={model} node={node} />
        ) : (
          <div className="inspector-body">
            <p className="inspector-description" data-empty="true">
              {model ? "Select an element to see its details." : "Nothing selected."}
            </p>
            {bundle && bundle.warnings.length > 0 && (
              <ul className="warning-list" aria-label="Warnings">
                {bundle.warnings.map((w) => (
                  <li key={w.code} className="warning-item">
                    {w.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

export function InspectorRail() {
  return (
    <div className="inspector-rail">
      <button
        type="button"
        className="button button-icon button-ghost"
        aria-label="Expand inspector"
        onClick={() => {
          useAppStore.getState().setInspectorCollapsed(false);
        }}
      >
        <PanelIcon side="open" />
      </button>
    </div>
  );
}

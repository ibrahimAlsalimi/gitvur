import { useEffect, useMemo, useRef, useState } from "react";
import { middleTruncate } from "../canvas/text";
import { getApi, toAppError } from "../api";
import { copy } from "../copy";
import type { DocContent, DocEntry } from "../generated/contract";
import { buildModel } from "../model/buildModel";
import type { ModelNode } from "../model/buildModel";
import { useAppStore } from "../store/useAppStore";
import { showOnMap } from "./navigation";
import { MarkdownReader } from "./MarkdownReader";
import { type DocLink, externalUrl } from "./resolveLink";
import { indexDocs } from "./indexDocs";
import { useDarkTheme, useDocsStore } from "./useDocsStore";

export function DocsTab() {
  const bundle = useAppStore((s) => s.bundle);
  const path = useAppStore((s) => s.docPath);
  const active = useAppStore((s) => s.activeTab === "docs");
  const { entries, loading, error, filter, indexError, refreshSeq } = useDocsStore();
  const nodes = useMemo(() => (bundle ? [...buildModel(bundle).nodes.values()] : []), [bundle]);
  useEffect(() => {
    if (!path && entries[0]) useAppStore.setState({ docPath: entries[0].path, docScroll: 0 });
  }, [path, entries]);
  const filtered = entries.filter((e) =>
    `${e.path} ${e.title}`.toLowerCase().includes(filter.toLowerCase()),
  );
  const pinned = filtered.find((entry) => entry.path.toLowerCase() === "readme.md");
  const groups = new Map<string, DocEntry[]>();
  for (const entry of filtered) {
    if (entry === pinned) continue;
    const folder = entry.path.includes("/")
      ? entry.path.slice(0, entry.path.lastIndexOf("/"))
      : "Repository";
    const group = groups.get(folder) ?? [];
    group.push(entry);
    groups.set(folder, group);
  }
  return (
    <section
      id="panel-docs"
      role="tabpanel"
      aria-labelledby="tab-docs"
      className={`gv-docs-panel${active ? "" : " gv-tab-hidden"}`}
      inert={!active}
    >
      <nav className="gv-doc-list" aria-label="Documents">
        <div className="gv-doc-list-head">
          <h2>Documents</h2>
          <button
            type="button"
            className="button button-ghost"
            aria-label={copy.docs.refresh}
            onClick={() => {
              useDocsStore.getState().refresh();
            }}
          >
            ↻
          </button>
        </div>
        <label className="gv-doc-filter">
          <span className="visually-hidden">Filter documents</span>
          <input
            placeholder="Filter documents…"
            value={filter}
            onChange={(e) => {
              useDocsStore.getState().setFilter(e.target.value);
            }}
          />
        </label>
        <div className="gv-doc-list-scroll">
          {loading && (
            <p className="gv-doc-note" aria-live="polite">
              {copy.docs.loading}
            </p>
          )}
          {error && <p role="alert">{copy.docs.listFailed}</p>}
          {!loading && !error && entries.length === 0 && (
            <p className="gv-doc-note">{copy.docs.empty}</p>
          )}
          {filtered.length === 0 && entries.length > 0 && (
            <p className="gv-doc-note">{copy.search.noMatches(filter)}</p>
          )}
          {pinned && <DocListItem entry={pinned} selected={path === pinned.path} />}
          {[...groups].map(([folder, items]) => (
            <details open key={folder} className="gv-doc-folder">
              <summary>{folder}</summary>
              {items.map((entry) => (
                <DocListItem key={entry.path} entry={entry} selected={path === entry.path} />
              ))}
            </details>
          ))}
          {entries.length > 500 && <p className="gv-doc-note">{copy.docs.indexLimit}</p>}
          {indexError && <p className="gv-doc-note">{copy.docs.indexFailed}</p>}
        </div>
      </nav>
      {bundle && path ? (
        <Document
          key={`${bundle.root}:${path}:${String(refreshSeq)}`}
          root={bundle.root}
          path={path}
          entries={entries}
          nodes={nodes}
        />
      ) : (
        <div className="gv-doc-empty">{!loading && copy.docs.empty}</div>
      )}
    </section>
  );
}

function DocListItem({ entry, selected }: { entry: DocEntry; selected: boolean }) {
  return (
    <button
      type="button"
      className="gv-doc-list-item"
      aria-current={selected ? "page" : undefined}
      onClick={() => {
        useAppStore.getState().openDoc(entry.path);
      }}
      title={entry.path}
    >
      <span aria-hidden="true">▤</span>
      <span>
        <strong>{entry.title}</strong>
        <span className="gv-doc-path">{middleTruncate(entry.path, 34)}</span>
      </span>
      {entry.path.toLowerCase() === "readme.md" && <span className="chip">README</span>}
    </button>
  );
}

function Document({
  root,
  path,
  entries,
  nodes,
}: {
  root: string;
  path: string;
  entries: DocEntry[];
  nodes: ModelNode[];
}) {
  const [content, setContent] = useState<DocContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getApi()
      .then((api) => api.readDoc(root, path))
      .then((value) => {
        if (!cancelled) setContent(value);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(
            toAppError(err).message.includes("no longer exists")
              ? copy.docs.missing
              : copy.docs.failed,
          );
      });
    return () => {
      cancelled = true;
    };
  }, [root, path]);
  if (error)
    return (
      <div className="gv-doc-empty" role="alert">
        <p>{error}</p>
        <button
          type="button"
          className="button"
          onClick={() => {
            useDocsStore.getState().refresh();
            useAppStore.setState({ docPath: null });
          }}
        >
          {copy.docs.refresh}
        </button>
      </div>
    );
  if (!content)
    return (
      <div className="gv-doc-empty" aria-busy="true">
        {copy.docs.loading}
      </div>
    );
  return <DocumentBody content={content} root={root} path={path} entries={entries} nodes={nodes} />;
}

function DocumentBody({
  content,
  root,
  path,
  entries,
  nodes,
}: {
  content: DocContent;
  root: string;
  path: string;
  entries: DocEntry[];
  nodes: ModelNode[];
}) {
  const dark = useDarkTheme();
  const [allowRemote, setAllowRemote] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [external, setExternal] = useState<string | null>(null);
  const [externalError, setExternalError] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const target = useAppStore((s) => s.docTarget);
  const savedScroll = useRef(useAppStore.getState().docScroll);
  // Parse just this document for immediate outline; the cross-repository index stays in the worker.
  const headings = useMemo(
    () => indexDocs([{ path, title: "", text: content.text }], []).docs[0]?.headings ?? [],
    [path, content.text],
  );
  const scrollTo = (anchor: string) => {
    const id = anchor.startsWith("user-content-") ? anchor : `user-content-${anchor}`;
    const element = document.getElementById(id);
    element?.scrollIntoView({ block: "start" });
  };
  useEffect(() => {
    const reader = scroller.current;
    if (!reader) return;
    const match = target?.nodeId
      ? [...reader.querySelectorAll<HTMLElement>("[data-mention]")].find(
          (e) => e.dataset.mention === target.nodeId,
        )
      : null;
    if (match) match.scrollIntoView({ block: "center" });
    else if (target?.anchor) scrollTo(target.anchor);
    else reader.scrollTop = savedScroll.current;
  }, [target]);
  const action = (link: DocLink) => {
    if (link.kind === "anchor") scrollTo(link.anchor);
    if (link.kind === "doc") useAppStore.getState().openDoc(link.path, link.anchor);
    if (link.kind === "source") showOnMap(link.id);
    if (link.kind === "folder") useDocsStore.getState().setFilter(link.path);
    if (link.kind === "external") {
      setExternal(link.url);
      setExternalError(false);
    }
  };
  const metadata = entries.find((e) => e.path === path);
  const folder = path.split("/").slice(0, -1).join("/");
  const counts = new Map<string, number>();
  for (const node of nodes)
    if (
      node.kind === "file" &&
      node.parentId &&
      node.source &&
      (!folder || node.source.file.startsWith(`${folder}/`))
    )
      counts.set(node.parentId, (counts.get(node.parentId) ?? 0) + 1);
  const moduleId = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  const remotePresent = /!\[[^\]]*\]\(https?:|^\s*\[[^\]]+\]:\s*https?:/im.test(content.text);
  const outline = (
    <>
      <h2>{copy.docs.outline}</h2>
      {headings.map((h) => (
        <button
          key={h.id}
          type="button"
          data-depth={h.depth}
          aria-current={current === h.id ? "location" : undefined}
          onClick={() => {
            scrollTo(h.id);
            setOutlineOpen(false);
          }}
        >
          {h.text}
        </button>
      ))}
    </>
  );
  return (
    <>
      <div className="gv-doc-reader">
        <header className="gv-doc-reader-header">
          <div>
            <span className="gv-doc-breadcrumb">{path.split("/").join(" / ")}</span>
            {metadata?.modified && (
              <span className="gv-doc-modified">
                Modified {new Date(Number(metadata.modified) * 1000).toLocaleDateString()}
              </span>
            )}
          </div>
          <div className="gv-doc-reader-actions">
            <button
              type="button"
              className="button button-ghost"
              onClick={() => {
                void navigator.clipboard.writeText(path).catch(() => undefined);
              }}
            >
              Copy path
            </button>
            <button
              type="button"
              className="button button-ghost"
              disabled={!moduleId}
              onClick={() => {
                if (moduleId) showOnMap(moduleId);
              }}
            >
              Show folder on map
            </button>
            <button
              type="button"
              className="button button-ghost gv-doc-outline-toggle"
              aria-expanded={outlineOpen}
              onClick={() => {
                setOutlineOpen(!outlineOpen);
              }}
            >
              {copy.docs.outline}
            </button>
          </div>
        </header>
        {content.truncated && <p className="gv-doc-banner">{copy.docs.truncated}</p>}
        {remotePresent && !allowRemote && (
          <div className="gv-doc-banner">
            {copy.docs.remoteBlocked}
            <button
              className="button button-ghost"
              type="button"
              onClick={() => {
                setAllowRemote(true);
              }}
            >
              {copy.docs.loadRemote}
            </button>
          </div>
        )}
        <div
          ref={scroller}
          className="gv-doc-reader-scroll"
          onScroll={() => {
            const reader = scroller.current;
            if (!reader) return;
            useAppStore.getState().setDocScroll(reader.scrollTop);
            const top = reader.getBoundingClientRect().top;
            const visible = headings
              .filter(
                (h) =>
                  (document.getElementById(h.id)?.getBoundingClientRect().top ?? Infinity) <=
                  top + 90,
              )
              .at(-1);
            setCurrent(visible?.id ?? headings[0]?.id ?? "");
          }}
        >
          <article className="gv-doc-prose">
            <MarkdownReader
              text={content.text}
              root={root}
              path={path}
              docs={entries.map((e) => e.path)}
              nodes={nodes}
              dark={dark}
              allowRemote={allowRemote}
              onAction={action}
            />
          </article>
        </div>
        {external && (
          <div
            className="gv-doc-external"
            role="dialog"
            aria-modal="false"
            aria-label={copy.docs.externalPrompt}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setExternal(null);
              }
            }}
          >
            <strong>{copy.docs.externalPrompt}</strong>
            <p>{external}</p>
            {externalError && <p role="alert">{copy.docs.externalFailed}</p>}
            <div>
              <button
                autoFocus
                className="button"
                type="button"
                onClick={() => {
                  setExternal(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button button-primary"
                onClick={() => {
                  const url = externalUrl(external);
                  if (!url) return;
                  void getApi()
                    .then((api) => api.openExternal(url))
                    .then(() => {
                      setExternal(null);
                    })
                    .catch(() => {
                      setExternalError(true);
                    });
                }}
              >
                Open in browser
              </button>
            </div>
          </div>
        )}
      </div>
      <aside
        className={`gv-doc-outline${outlineOpen ? " gv-doc-outline-open" : ""}`}
        aria-label={copy.docs.outline}
      >
        {outline}
      </aside>
    </>
  );
}

export function MentionedInDocs({ id }: { id: string }) {
  const mentions = useDocsStore((s) => s.index.mentions[id]);
  if (!mentions?.length) return null;
  return (
    <section className="gv-insp-section" aria-label={copy.docs.mentioned}>
      <h3 className="gv-insp-heading">{copy.docs.mentioned}</h3>
      {mentions.map((m) => (
        <button
          key={m.path}
          type="button"
          className="gv-insp-link gv-doc-backlink"
          onClick={() => {
            useAppStore.getState().openDoc(m.path, m.anchor, m.nodeId);
          }}
        >
          ▤ {m.title}
          <span className="gv-insp-link-file">{m.path}</span>
        </button>
      ))}
    </section>
  );
}

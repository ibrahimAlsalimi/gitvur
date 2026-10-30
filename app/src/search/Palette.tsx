import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { useDocsStore } from "../docs/useDocsStore";
import { showOnMap } from "../docs/navigation";
import { copy } from "../copy";
import { KindGlyph } from "../components/KindGlyph";
import type { NodeKind } from "../model/buildModel";
import { useAppStore } from "../store/useAppStore";
import { type SearchHit, fuzzy, search, searchIndex } from "./searchIndex";

interface Command {
  id: string;
  label: string;
  run: () => void;
  enabled: boolean;
}

function commands(): Command[] {
  const s = useAppStore.getState();
  const hasModel = s.model !== null;
  const c = copy.commands;
  return [
    {
      id: "tab-map",
      label: copy.docs.map,
      run: () => {
        s.setActiveTab("map");
      },
      enabled: hasModel,
    },
    {
      id: "tab-docs",
      label: copy.docs.tab,
      run: () => {
        s.setActiveTab("docs");
      },
      enabled: hasModel,
    },
    { id: "open", label: c.open, run: () => void s.chooseAndOpen(), enabled: true },
    { id: "index", label: c.index, run: () => void s.index(), enabled: s.path !== null },
    { id: "validate", label: c.validate, run: () => void s.validate(), enabled: s.bundle !== null },
    {
      id: "lens-structure",
      label: c.lensStructure,
      run: () => {
        s.setLens("structure");
      },
      enabled: hasModel,
    },
    {
      id: "lens-documentation",
      label: c.lensDocumentation,
      run: () => {
        s.setLens("coverage");
      },
      enabled: hasModel,
    },
    {
      id: "lens-changes",
      label: c.lensChanges,
      run: () => {
        s.setLens("changes");
      },
      enabled: hasModel,
    },
    {
      id: "expand",
      label: c.expandAll,
      run: () => {
        s.expandAllFiles();
      },
      enabled: hasModel,
    },
    {
      id: "collapse",
      label: c.collapseAll,
      run: () => {
        s.collapseAllFiles();
      },
      enabled: hasModel,
    },
    {
      id: "theme",
      label: c.toggleTheme,
      run: () => {
        s.toggleTheme();
      },
      enabled: true,
    },
    {
      id: "issues",
      label: c.showIssues,
      run: () => {
        s.setIssuesOpen(true);
      },
      enabled: hasModel,
    },
    {
      id: "shortcuts",
      label: c.shortcuts,
      run: () => {
        s.setShortcutsOpen(true);
      },
      enabled: true,
    },
    { id: "reset", label: c.resetView, run: () => void s.resetView(), enabled: hasModel },
    {
      id: "guide",
      label: c.showGuide,
      run: () => {
        s.setGuideStep(0);
      },
      enabled: true,
    },
    {
      id: "about",
      label: c.about,
      run: () => {
        s.setAboutOpen(true);
      },
      enabled: true,
    },
  ].filter((cmd) => cmd.enabled);
}

const GROUPS = ["module", "file", "class", "function"] as const satisfies readonly NodeKind[];

/** `name` with the matched positions wrapped in <mark>. */
function highlight(name: string, positions: readonly number[]): ReactNode {
  if (positions.length === 0) return name;
  const set = new Set(positions);
  const parts: ReactNode[] = [];
  let run = "";
  let marked = false;
  const flush = (i: number) => {
    if (run === "") return;
    parts.push(marked ? <mark key={i}>{run}</mark> : run);
    run = "";
  };
  for (let i = 0; i < name.length; i += 1) {
    const m = set.has(i);
    if (m !== marked) {
      flush(i);
      marked = m;
    }
    run += name[i] ?? "";
  }
  flush(name.length);
  return parts;
}

type Row =
  | { kind: "doc"; path: string; label: string; anchor: string }
  | { kind: "hit"; hit: SearchHit }
  | { kind: "command"; command: Command; positions: number[] };

/**
 * Ctrl/Cmd+K: fuzzy search over names, qualified names, paths and descriptions, or
 * commands after `>`. Enter selects and centres; Ctrl+Enter selects without moving.
 */
export function Palette() {
  const open = useAppStore((s) => s.paletteOpen);
  const docsIndex = useDocsStore((s) => s.index);
  const model = useAppStore((s) => s.model);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      setQuery("");
      setActive(0);
      input.current?.focus();
    }
    if (!open && el.open) el.close();
  }, [open]);

  const isCommand = query.startsWith(">");
  const rows = useMemo<Row[]>(() => {
    if (!open) return [];
    if (isCommand) {
      const q = query.slice(1).trim().toLowerCase();
      return commands()
        .map((command) => {
          const m =
            q === ""
              ? { score: 0, positions: [] }
              : fuzzy(q.replace(/\s+/g, ""), command.label.toLowerCase(), command.label);
          return m
            ? { kind: "command" as const, command, positions: m.positions, score: m.score }
            : null;
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .sort((a, b) => b.score - a.score)
        .map(({ kind, command, positions }) => ({ kind, command, positions }));
    }
    if (!model) return [];
    const hits = search(searchIndex(model), query);
    // Grouped by kind, best first within each group.
    const codeRows: Row[] = GROUPS.flatMap((g) =>
      hits.filter((h) => h.entry.node.kind === g).map((hit) => ({ kind: "hit" as const, hit })),
    );
    const q = query.trim().toLowerCase();
    const docRows: Row[] = q
      ? docsIndex.docs
          .flatMap((doc) => [
            { kind: "doc" as const, path: doc.path, label: doc.title, anchor: "" },
            ...doc.headings.map((h) => ({
              kind: "doc" as const,
              path: doc.path,
              label: h.text,
              anchor: h.id,
            })),
          ])
          .filter((row) => `${row.label} ${row.path}`.toLowerCase().includes(q))
          .slice(0, 30)
      : [];
    return [...codeRows, ...docRows];
  }, [open, query, isCommand, model, docsIndex]);

  const close = () => {
    useAppStore.getState().setPaletteOpen(false);
  };
  const choose = (row: Row | undefined, moveCamera: boolean) => {
    if (!row) return;
    close();
    if (row.kind === "command") {
      row.command.run();
      return;
    }
    const store = useAppStore.getState();
    if (row.kind === "doc") {
      store.openDoc(row.path, row.anchor);
      return;
    }
    store.setActiveTab("map");
    if (moveCamera) showOnMap(row.hit.entry.node.id);
    else store.select(row.hit.entry.node.id);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (rows.length === 0) return;
      const next = (active + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
      setActive(next);
      list.current
        ?.querySelector<HTMLElement>(`[data-index="${String(next)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(rows[active], !(e.ctrlKey || e.metaKey));
    }
  };

  // Rows render in `rows` order (grouped by kind), so a row's index is its position there.
  const option = (row: Row, content: ReactNode, key: string) => {
    const i = rows.indexOf(row);
    return (
      <div
        key={key}
        id={`palette-option-${String(i)}`}
        role="option"
        aria-selected={i === active}
        data-index={i}
        className="palette-option"
        onMouseMove={() => {
          if (i !== active) setActive(i);
        }}
        onClick={(e) => {
          choose(row, !(e.ctrlKey || e.metaKey));
        }}
      >
        {content}
      </div>
    );
  };

  let body: ReactNode;
  if (query.trim() === "" && !isCommand) {
    body = <p className="palette-empty">{copy.search.hint}</p>;
  } else if (rows.length === 0) {
    body = isCommand ? (
      <p className="palette-empty">{copy.search.noCommands(query.slice(1).trim())}</p>
    ) : (
      <div className="palette-empty">
        <p>{copy.search.noMatches(query.trim())}</p>
        <p className="palette-hint">{copy.search.noMatchesHint}</p>
      </div>
    );
  } else if (isCommand) {
    body = (
      <div role="group" aria-label={copy.search.groups.command}>
        <div className="palette-group">{copy.search.groups.command}</div>
        {rows.map((row) =>
          row.kind === "command"
            ? option(
                row,
                <span className="palette-name">{highlight(row.command.label, row.positions)}</span>,
                row.command.id,
              )
            : null,
        )}
      </div>
    );
  } else {
    body = (
      <>
        {GROUPS.map((g) => {
          const groupRows = rows.filter((r) => r.kind === "hit" && r.hit.entry.node.kind === g);
          if (groupRows.length === 0) return null;
          return (
            <div key={g} role="group" aria-label={copy.search.groups[g]}>
              <div className="palette-group">{copy.search.groups[g]}</div>
              {groupRows.map((row) => {
                if (row.kind !== "hit" || !model) return null;
                const { entry, field, positions } = row.hit;
                const node = entry.node;
                return option(
                  row,
                  <>
                    <KindGlyph model={model} node={node} />
                    <span className="palette-name">
                      {highlight(node.name, field === "name" ? positions : [])}
                    </span>
                    {node.kind !== "module" &&
                      node.kind !== "file" &&
                      entry.qualified !== node.name && (
                        <span className="palette-qualified">{entry.qualified}</span>
                      )}
                    <span className="palette-path">
                      {field === "description" ? (node.description ?? "") : entry.path}
                    </span>
                    {!node.synthetic && (
                      <span
                        className="status-dot"
                        data-status={node.docStatus}
                        aria-hidden="true"
                      />
                    )}
                  </>,
                  node.id,
                );
              })}
            </div>
          );
        })}
        {rows.some((r) => r.kind === "doc") && (
          <div role="group" aria-label="Docs">
            <div className="palette-group">Docs</div>
            {rows.map((row) =>
              row.kind === "doc"
                ? option(
                    row,
                    <>
                      <span aria-hidden="true">▤</span>
                      <span className="palette-name">{row.label}</span>
                      <span className="palette-path">{row.path}</span>
                    </>,
                    `${row.path}#${row.anchor}`,
                  )
                : null,
            )}
          </div>
        )}
      </>
    );
  }

  return (
    <dialog
      ref={dialog}
      className="palette"
      aria-label={copy.search.label}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClose={() => {
        if (!dialog.current?.open) close();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) close(); // backdrop
      }}
    >
      <input
        ref={input}
        className="palette-input"
        type="text"
        role="combobox"
        aria-expanded={rows.length > 0}
        aria-controls="palette-list"
        aria-activedescendant={rows.length > 0 ? `palette-option-${String(active)}` : undefined}
        aria-label={copy.search.label}
        placeholder={copy.search.placeholder}
        spellCheck={false}
        autoComplete="off"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      <div
        ref={list}
        id="palette-list"
        role="listbox"
        className="palette-list"
        aria-label={copy.search.label}
      >
        {body}
      </div>
    </dialog>
  );
}

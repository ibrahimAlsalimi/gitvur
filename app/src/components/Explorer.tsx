import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ModelNode } from "../model/buildModel";
import { type TreeRow, visibleRows } from "../model/tree";
import { useAppStore } from "../store/useAppStore";
import { ChevronRight } from "./Icons";

const KIND_BADGE: Record<ModelNode["kind"], string> = {
  project: "P",
  module: "M",
  file: "F",
  class: "C",
  function: "ƒ",
};

const STATUS_LABEL = {
  documented: "Documented",
  stale: "Description out of date",
  undocumented: "No description",
} as const;

/** Modules → files → classes → functions, as an ARIA tree with roving focus. */
export function Explorer() {
  const model = useAppStore((s) => s.model);
  const expandedIds = useAppStore((s) => s.expandedIds);
  const selectedId = useAppStore((s) => s.selectedId);
  const rows = useMemo(() => (model ? visibleRows(model, expandedIds) : []), [model, expandedIds]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const tree = useRef<HTMLUListElement>(null);
  const focusAfterRender = useRef(false);

  const activeId =
    focusedId !== null && rows.some((r) => r.node.id === focusedId)
      ? focusedId
      : (selectedId ?? rows[0]?.node.id ?? null);

  useEffect(() => {
    if (!focusAfterRender.current || activeId === null) return;
    focusAfterRender.current = false;
    tree.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(activeId)}"]`)?.focus();
  }, [activeId, rows]);

  if (!model) {
    return <p className="explorer-empty">No repository open.</p>;
  }

  const { select, toggle } = useAppStore.getState();
  const moveTo = (id: string | undefined) => {
    if (id === undefined) return;
    focusAfterRender.current = true;
    setFocusedId(id);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const index = rows.findIndex((r) => r.node.id === activeId);
    const row = rows[index];
    if (!row) return;
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    switch (e.key) {
      case "ArrowDown":
        handled();
        moveTo(rows[index + 1]?.node.id);
        break;
      case "ArrowUp":
        handled();
        moveTo(rows[index - 1]?.node.id);
        break;
      case "Home":
        handled();
        moveTo(rows[0]?.node.id);
        break;
      case "End":
        handled();
        moveTo(rows[rows.length - 1]?.node.id);
        break;
      case "ArrowRight":
        handled();
        if (row.hasChildren && !row.expanded) toggle(row.node.id, true);
        else if (row.expanded) moveTo(rows[index + 1]?.node.id);
        break;
      case "ArrowLeft": {
        handled();
        if (row.expanded) toggle(row.node.id, false);
        else {
          const parent = row.node.parentId;
          if (parent !== null && parent !== model.rootId) moveTo(parent);
        }
        break;
      }
      case "Enter":
      case " ":
        handled();
        select(row.node.id);
        break;
      default:
    }
  };

  return (
    <ul
      className="tree"
      role="tree"
      aria-label="Repository explorer"
      ref={tree}
      onKeyDown={onKeyDown}
    >
      {rows.map((row) => (
        <TreeItem
          key={row.node.id}
          row={row}
          focusable={row.node.id === activeId}
          selected={row.node.id === selectedId}
          meta={row.node.kind === "module" ? model.moduleStats.get(row.node.id)?.files : undefined}
          onSelect={() => {
            setFocusedId(row.node.id);
            select(row.node.id);
          }}
          onToggle={() => {
            toggle(row.node.id);
          }}
        />
      ))}
    </ul>
  );
}

interface TreeItemProps {
  row: TreeRow;
  focusable: boolean;
  selected: boolean;
  meta: number | undefined;
  onSelect: () => void;
  onToggle: () => void;
}

function TreeItem({ row, focusable, selected, meta, onSelect, onToggle }: TreeItemProps) {
  const { node } = row;
  const status = node.synthetic ? null : node.docStatus;
  return (
    <li
      className="tree-row"
      role="treeitem"
      data-id={node.id}
      data-kind={node.kind}
      aria-level={row.level}
      aria-posinset={row.posInSet}
      aria-setsize={row.setSize}
      aria-selected={selected}
      aria-expanded={row.hasChildren ? row.expanded : undefined}
      tabIndex={focusable ? 0 : -1}
      style={{ "--level": row.level } as CSSProperties}
      onClick={onSelect}
      onDoubleClick={row.hasChildren ? onToggle : undefined}
    >
      <span
        className="tree-twisty"
        data-expanded={row.expanded}
        onClick={(e) => {
          if (!row.hasChildren) return;
          e.stopPropagation();
          onToggle();
        }}
      >
        {row.hasChildren && <ChevronRight />}
      </span>
      <span className="kind-badge" data-kind={node.kind} aria-hidden="true">
        {KIND_BADGE[node.kind]}
      </span>
      <span className="tree-label">{node.name}</span>
      {meta !== undefined && (
        <span className="tree-meta" aria-label={meta === 1 ? "1 file" : `${String(meta)} files`}>
          {meta}
        </span>
      )}
      {status && (
        <span
          className="status-dot"
          data-status={status}
          title={STATUS_LABEL[status]}
          role="img"
          aria-label={STATUS_LABEL[status]}
        />
      )}
    </li>
  );
}

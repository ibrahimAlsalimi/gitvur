import type { MapNode } from "./types";

export interface MinimapRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Identity colour for modules; files are drawn grey. */
  color?: string;
}

/** Absolute rectangles of modules and files (never rows), from the laid-out flow nodes. */
export function minimapRects(nodes: readonly MapNode[]): MinimapRect[] {
  const modules = new Map<string, MinimapRect>();
  const rects: MinimapRect[] = [];
  for (const n of nodes) {
    if (n.type !== "module") continue;
    const rect = {
      id: n.id,
      x: n.position.x,
      y: n.position.y,
      width: n.width ?? 0,
      height: n.height ?? 0,
      color: n.data.color,
    };
    modules.set(n.id, rect);
    rects.push(rect);
  }
  for (const n of nodes) {
    if (n.type !== "file" || n.parentId === undefined) continue;
    const parent = modules.get(n.parentId);
    if (!parent) continue;
    rects.push({
      id: n.id,
      x: parent.x + n.position.x,
      y: parent.y + n.position.y,
      width: n.width ?? 0,
      height: n.height ?? 0,
    });
  }
  return rects;
}

/** Geometry for orthogonal flow lines. */
import type { FlowLayout, Point } from "./layoutFlow";

const RADIUS = 8;

/** An orthogonal polyline as a path with rounded corners. */
export function roundedPath(points: readonly Point[], radius = RADIUS): string {
  const first = points[0];
  if (!first) return "";
  let d = `M ${String(first[0])} ${String(first[1])}`;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const prev = points[i - 1];
    const nextPoint = points[i + 1];
    if (!p || !prev) continue;
    if (!nextPoint) {
      d += ` L ${String(p[0])} ${String(p[1])}`;
      continue;
    }
    const inLen = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    const outLen = Math.hypot(nextPoint[0] - p[0], nextPoint[1] - p[1]);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const ax = p[0] - Math.sign(p[0] - prev[0]) * r;
    const ay = p[1] - Math.sign(p[1] - prev[1]) * r;
    const bx = p[0] + Math.sign(nextPoint[0] - p[0]) * r;
    const by = p[1] + Math.sign(nextPoint[1] - p[1]) * r;
    d += ` L ${String(ax)} ${String(ay)} Q ${String(p[0])} ${String(p[1])} ${String(bx)} ${String(by)}`;
  }
  return d;
}

export function pathLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b) total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return total;
}

/** Below this zoom step labels get too small to read; the view pans instead. */
export const MIN_READABLE_ZOOM = 0.8;

/**
 * Fits the whole diagram when that keeps labels readable (zoom ≤ 1). Otherwise uses
 * `MIN_READABLE_ZOOM` and starts at the top-left, where the flow begins; the camera follows
 * playback and the lane headers stay pinned while panning.
 */
export function fitViewport(layout: FlowLayout, width: number, height: number) {
  const pad = 32;
  const all = Math.min(
    1,
    (width - 2 * pad) / Math.max(1, layout.width),
    (height - pad) / Math.max(1, layout.height),
  );
  const zoom = Math.max(all, Math.min(1, MIN_READABLE_ZOOM));
  const x = layout.width * zoom <= width - 2 * pad ? (width - layout.width * zoom) / 2 : pad;
  const y = layout.height * zoom < height - pad ? 8 : 0;
  return { x, y, zoom };
}

/** Where the segment from `a`'s centre towards `b`'s centre leaves rectangle `a`. */
export function exitPoint(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): [number, number] {
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  const dx = b.x + b.w / 2 - ax;
  const dy = b.y + b.h / 2 - ay;
  if (dx === 0 && dy === 0) return [ax, ay];
  const t = Math.min(
    dx === 0 ? Infinity : a.w / 2 / Math.abs(dx),
    dy === 0 ? Infinity : a.h / 2 / Math.abs(dy),
  );
  return [ax + dx * t, ay + dy * t];
}

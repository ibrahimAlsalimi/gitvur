/** Geometry for orthogonal flow lines. */
import type { Point } from "./layoutFlow";

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

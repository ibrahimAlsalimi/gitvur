import { getApi } from "../api";
import type { SourceSlice } from "../generated/contract";

/** Context lines shown above and below an element. */
export const CONTEXT_LINES = 3;

const cache = new Map<string, Promise<SourceSlice>>();

/**
 * Source for `file` lines `start..=end` (+ context), cached by (file, contentHash), so a
 * re-index that changes the element fetches fresh text. Failures are not cached.
 */
export function loadSource(
  repo: string,
  file: string,
  start: number,
  end: number,
  key: string,
  context = CONTEXT_LINES,
): Promise<SourceSlice> {
  const id = `${repo}\u0000${file}\u0000${key}\u0000${String(start)}-${String(end)}+${String(context)}`;
  let hit = cache.get(id);
  if (!hit) {
    hit = getApi().then((api) => api.readSource(repo, file, start, end, context));
    hit.catch(() => cache.delete(id));
    cache.set(id, hit);
  }
  return hit;
}

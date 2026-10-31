import type { EntryPoint, Flow } from "../generated/contract";
import type { Model } from "../model/buildModel";

/** Entry points (with their flows nested) that match `filter`, in ID order. */
export function filterEntries(
  model: Model,
  filter: string,
): { entry: EntryPoint | undefined; id: string; flows: Flow[] }[] {
  const q = filter.trim().toLowerCase();
  const has = (text: string) => text.toLowerCase().includes(q);
  const { entryPoints, flowsByEntry, entryPointsById } = model.flows;
  const groups: { entry: EntryPoint | undefined; id: string; flows: Flow[] }[] = entryPoints.map(
    (entry) => ({
      entry,
      id: entry.id,
      flows: flowsByEntry.get(entry.id) ?? [],
    }),
  );
  // Flows whose entry point no longer exists are still listed, under their dangling ID.
  for (const [id, flows] of flowsByEntry) {
    if (!entryPointsById.has(id)) groups.push({ entry: undefined, id, flows });
  }
  if (!q) return groups;
  return groups
    .map((g) => {
      const entryMatch = g.entry ? has(g.entry.name) || has(g.entry.id) : has(g.id);
      const flows = entryMatch
        ? g.flows
        : g.flows.filter((f) => has(f.name) || f.steps.some((s) => has(s.label)));
      return { ...g, flows, keep: entryMatch || flows.length > 0 };
    })
    .filter((g) => g.keep);
}

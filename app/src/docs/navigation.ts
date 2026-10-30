import { useAppStore } from "../store/useAppStore";

export function showOnMap(id: string) {
  const state = useAppStore.getState();
  if (!state.model?.nodes.has(id)) state.setLens("structure");
  state.setActiveTab("map");
  state.navigateTo(id);
}

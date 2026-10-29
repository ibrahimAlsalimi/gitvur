import { create } from "zustand";

import { DEFAULT_SETTINGS, getApi, toAppError } from "../api";
import type { AppError, RecentRepo, RepoBundle, Settings, Theme } from "../generated/contract";
import { type Model, type ModelEdge, buildModel } from "../model/buildModel";
import { ancestors, defaultExpanded } from "../model/tree";

/** What the app is doing right now. Drives the canvas state panels. */
export type Phase = "idle" | "opening" | "indexing" | "validating" | "ready" | "error";

/** How the map colours nodes. Only `structure` exists until Phase 09. */
export type Lens = "structure" | "coverage";

export const PANE_LIMITS = {
  explorer: { min: 200, max: 480 },
  inspector: { min: 280, max: 560 },
} as const;

interface AppState {
  phase: Phase;
  /** The repository being shown or last attempted. */
  path: string | null;
  bundle: RepoBundle | null;
  model: Model | null;
  error: AppError | null;
  recent: RecentRepo[];
  settings: Settings;
  helpOpen: boolean;

  selectedId: string | null;
  expandedIds: Set<string>;
  /** Relationship depth drawn for the selection. */
  hops: 1 | 2;
  /** The edge whose evidence the code viewer shows, if any. */
  evidence: ModelEdge | null;
  /** Unresolved calls (by "from|line|name") whose possible targets are shown. */
  ambiguousOpen: Set<string>;
  /** Selection history for Alt+←/→. */
  history: string[];
  historyIndex: number;
  /** Ask the canvas to centre a node; `seq` changes on every request. */
  navigation: { id: string; seq: number } | null;
  lens: Lens;
  theme: Theme;

  init: () => Promise<void>;
  chooseAndOpen: () => Promise<void>;
  open: (path: string) => Promise<void>;
  index: () => Promise<void>;
  validate: () => Promise<void>;
  select: (id: string | null) => void;
  /** Select `id`, reveal it everywhere, and fly the canvas to it. */
  navigateTo: (id: string) => void;
  back: () => void;
  forward: () => void;
  setHops: (hops: 1 | 2) => void;
  showEvidence: (edge: ModelEdge | null) => void;
  toggleAmbiguous: (key: string) => void;
  toggle: (id: string, expanded?: boolean) => void;
  /** Expands all of `ids` unless they are all expanded already, in which case collapses them. */
  toggleFiles: (ids: string[]) => void;
  expandAllFiles: () => void;
  collapseAllFiles: () => void;
  setLens: (lens: Lens) => void;
  setTheme: (theme: Theme) => void;
  setPane: (pane: "explorer" | "inspector", width: number) => void;
  setInspectorCollapsed: (collapsed: boolean) => void;
  setHelpOpen: (open: boolean) => void;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(value)));

let saveTimer: ReturnType<typeof setTimeout> | undefined;
/** Settings changed before `init` finished loading the saved ones; they win over the saved values. */
let earlyChanges: Partial<Settings> | null = {};
let initOnce: Promise<void> | undefined;

export const useAppStore = create<AppState>()((set, get) => {
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    void getApi().then((api) => api.setSettings(get().settings));
  };
  // A debounced save still pending when the window goes away is written immediately.
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", () => {
      if (saveTimer !== undefined) save();
    });
  }

  /** Discrete changes save at once; `debounced` is for continuous ones such as dragging. */
  const updateSettings = (patch: Partial<Settings>, debounced = false) => {
    if (earlyChanges !== null) Object.assign(earlyChanges, patch);
    set((s) => ({ settings: { ...s.settings, ...patch } }));
    if (debounced) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 300);
    } else {
      save();
    }
  };

  /** Loads a bundle, keeping the selection and expansion when it is the same repository. */
  const load = async (path: string, phase: Phase, run: (path: string) => Promise<RepoBundle>) => {
    set({ phase, path, error: null });
    try {
      const bundle = await run(path);
      const model = buildModel(bundle);
      const previous = get();
      const sameRepo = previous.bundle?.root === bundle.root;
      const selectedId =
        sameRepo && previous.selectedId !== null && model.nodes.has(previous.selectedId)
          ? previous.selectedId
          : null;
      set({
        phase: "ready",
        bundle,
        model,
        selectedId,
        expandedIds: sameRepo
          ? new Set([...previous.expandedIds].filter((id) => model.nodes.has(id)))
          : defaultExpanded(model),
        ...(sameRepo
          ? {}
          : {
              history: [],
              historyIndex: -1,
              evidence: null,
              ambiguousOpen: new Set<string>(),
              navigation: null,
            }),
      });
      const api = await getApi();
      set({ recent: await api.recentRepositories().catch(() => get().recent) });
    } catch (err) {
      set({ phase: "error", error: toAppError(err), bundle: null, model: null, selectedId: null });
    }
  };

  /** Moves through the selection history without recording a new entry. */
  const goTo = (index: number) => {
    const { history, model } = get();
    const id = history[index];
    if (id === undefined || !model?.nodes.has(id)) return;
    const expanded = new Set(get().expandedIds);
    for (const a of ancestors(model, id)) expanded.add(a);
    set({
      selectedId: id,
      historyIndex: index,
      expandedIds: expanded,
      evidence: null,
      navigation: { id, seq: (get().navigation?.seq ?? 0) + 1 },
    });
  };

  return {
    phase: "idle",
    path: null,
    bundle: null,
    model: null,
    error: null,
    recent: [],
    settings: DEFAULT_SETTINGS,
    helpOpen: false,
    selectedId: null,
    expandedIds: new Set(),
    hops: 1,
    evidence: null,
    ambiguousOpen: new Set(),
    history: [],
    historyIndex: -1,
    navigation: null,
    lens: "structure",
    theme: DEFAULT_SETTINGS.theme,

    init() {
      // Once per app lifetime: StrictMode runs effects twice in development, and a second
      // run would reload the saved settings over changes made since the first.
      initOnce ??= (async () => {
        const api = await getApi();
        const [settings, recent] = await Promise.all([
          api.getSettings().catch(() => DEFAULT_SETTINGS),
          api.recentRepositories().catch(() => []),
        ]);
        const merged = { ...settings, ...earlyChanges };
        earlyChanges = null;
        set({ settings: merged, theme: merged.theme, recent });
        const initial = api.initialPath();
        if (initial !== null) await get().open(initial);
      })();
      return initOnce;
    },

    async chooseAndOpen() {
      const api = await getApi();
      const path = await api.pickFolder();
      if (path !== null) await get().open(path);
    },

    async open(path) {
      const api = await getApi();
      await load(path, "opening", (p) => api.openRepository(p));
    },

    async index() {
      const { path } = get();
      if (path === null) return;
      const api = await getApi();
      await load(path, "indexing", (p) => api.indexRepository(p));
    },

    async validate() {
      const { path } = get();
      if (path === null) return;
      const api = await getApi();
      await load(path, "validating", (p) => api.validateRepository(p));
    },

    select(id) {
      const { model, expandedIds, history, historyIndex, selectedId } = get();
      if (id === null || model === null || !model.nodes.has(id)) {
        set({ selectedId: null, evidence: null });
        return;
      }
      // Reveal the selection in the explorer and on the canvas.
      const expanded = new Set(expandedIds);
      for (const a of ancestors(model, id)) expanded.add(a);
      const kept = history.slice(0, historyIndex + 1);
      const nextHistory =
        id === selectedId || kept[kept.length - 1] === id ? kept : [...kept, id].slice(-100);
      set({
        selectedId: id,
        expandedIds: expanded,
        evidence: id === selectedId ? get().evidence : null,
        history: nextHistory,
        historyIndex: nextHistory.length - 1,
      });
    },

    navigateTo(id) {
      get().select(id);
      if (get().selectedId === id)
        set({ navigation: { id, seq: (get().navigation?.seq ?? 0) + 1 } });
    },

    back() {
      goTo(get().historyIndex - 1);
    },

    forward() {
      goTo(get().historyIndex + 1);
    },

    setHops(hops) {
      set({ hops });
    },

    showEvidence(edge) {
      set({ evidence: edge });
    },

    toggleAmbiguous(key) {
      const next = new Set(get().ambiguousOpen);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      set({ ambiguousOpen: next });
    },

    toggle(id, expanded) {
      const next = new Set(get().expandedIds);
      const open = expanded ?? !next.has(id);
      if (open) next.add(id);
      else next.delete(id);
      set({ expandedIds: next });
    },

    toggleFiles(ids) {
      const next = new Set(get().expandedIds);
      const allOpen = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allOpen) next.delete(id);
        else next.add(id);
      }
      set({ expandedIds: next });
    },

    expandAllFiles() {
      const { model, expandedIds } = get();
      if (!model) return;
      const next = new Set(expandedIds);
      for (const node of model.nodes.values()) if (node.kind === "file") next.add(node.id);
      set({ expandedIds: next });
    },

    collapseAllFiles() {
      const { model, expandedIds } = get();
      if (!model) return;
      const kept = [...expandedIds].filter((id) => model.nodes.get(id)?.kind === "module");
      set({ expandedIds: new Set(kept) });
    },

    setLens(lens) {
      set({ lens });
    },

    setTheme(theme) {
      set({ theme });
      updateSettings({ theme });
    },

    setPane(pane, width) {
      const limits = PANE_LIMITS[pane];
      const value = clamp(width, limits.min, limits.max);
      updateSettings(
        pane === "explorer" ? { explorerWidth: value } : { inspectorWidth: value },
        true,
      );
    },

    setInspectorCollapsed(collapsed) {
      updateSettings({ inspectorCollapsed: collapsed });
    },

    setHelpOpen(open) {
      set({ helpOpen: open });
    },
  };
});

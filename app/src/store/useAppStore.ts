import { create } from "zustand";

import { DEFAULT_SETTINGS, getApi, toAppError } from "../api";
import type {
  AppError,
  CommitInfo,
  ViewState,
  Viewport,
  RecentRepo,
  RepoBundle,
  Settings,
  Status,
  Theme,
} from "../generated/contract";
import { type Model, type ModelEdge, buildModel } from "../model/buildModel";
import { type DiffView, buildDiffView } from "../model/diffModel";
import { ancestors, defaultExpanded } from "../model/tree";

/** What the app is doing right now. Drives the canvas state panels. */
export type Phase = "idle" | "opening" | "indexing" | "validating" | "ready" | "error";

/** How the map colours nodes: plain, tinted by documentation status, or by changes. */
export type Lens = "structure" | "coverage" | "changes";

/** The Changes lens's diff between two revisions (full SHAs, or `worktree`). */
export interface DiffState {
  from: string;
  to: string;
  status: "loading" | "ready" | "error";
  view?: DiffView;
  error?: AppError;
}

/** Revision name for the files on disk. */
export const WORKTREE = "worktree";

/** Banners the user can dismiss for the session. */
export type BannerId = "report-missing" | "structure-out-of-date" | "report-stale" | "large-repo";

const LENSES: readonly Lens[] = ["structure", "coverage", "changes"];

/** Debounce for saving the per-repository view. */
const VIEW_SAVE_MS = 400;

export const PANE_LIMITS = {
  explorer: { min: 200, max: 480 },
  inspector: { min: 280, max: 560 },
} as const;

interface AppState {
  activeTab: "map" | "docs";
  docPath: string | null;
  docScroll: number;
  docTarget: { anchor: string; nodeId?: string; seq: number } | null;
  setActiveTab: (tab: "map" | "docs") => void;
  openDoc: (path: string, anchor?: string, nodeId?: string) => void;
  setDocScroll: (scroll: number) => void;
  phase: Phase;
  /** The repository being shown or last attempted. */
  path: string | null;
  bundle: RepoBundle | null;
  model: Model | null;
  error: AppError | null;
  /** The last open failed because the folder is gone, and it was dropped from recents. */
  lostRemoved: boolean;
  recent: RecentRepo[];
  settings: Settings;
  helpOpen: boolean;
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  aboutOpen: boolean;
  /** Current first-run guide step (0-based), or null when the guide is not showing. */
  guideStep: number | null;

  selectedId: string | null;
  expandedIds: Set<string>;
  /** Classes folded on the map (their method rows hidden). */
  collapsedIds: Set<string>;
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
  /** Explorer shows only elements with this status (and their ancestors). */
  statusFilter: Status | null;
  /** Commits for the revision picker, newest first. */
  commits: CommitInfo[];
  diff: DiffState | null;
  /** How the inspector shows a modified element's source diff. */
  diffMode: "inline" | "split";
  /** The camera as last reported by the map (saved with the view; not rendered from). */
  viewport: Viewport | null;
  /** A saved camera for the map to apply instead of fitting, once. */
  restoreViewport: Viewport | null;
  /** Ask the map to fit; changes on every request. */
  fitSeq: number;
  /** A saved diff range to use when the Changes lens starts. */
  pendingDiff: { from: string; to: string } | null;
  /** The model and expansion to restore when leaving the Changes lens. */
  base: { model: Model; expandedIds: Set<string> } | null;
  issuesOpen: boolean;
  dismissedBanners: Set<BannerId>;
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
  /** Folds or unfolds a class on the map. */
  toggleCollapsed: (id: string) => void;
  /** Expands all of `ids` unless they are all expanded already, in which case collapses them. */
  toggleFiles: (ids: string[]) => void;
  expandAllFiles: () => void;
  collapseAllFiles: () => void;
  setLens: (lens: Lens) => void;
  setStatusFilter: (status: Status | null) => void;
  /** Diffs two revisions and shows the union on the map (Changes lens). */
  loadDiff: (from: string, to: string) => Promise<void>;
  /** Selects the next (1) or previous (-1) change and flies to it. */
  stepChange: (direction: 1 | -1) => void;
  setDiffMode: (mode: "inline" | "split") => void;
  setViewport: (viewport: Viewport) => void;
  requestFit: () => void;
  /** Forgets the saved view of this repository and returns to the default view. */
  resetView: () => Promise<void>;
  setIssuesOpen: (open: boolean) => void;
  dismissBanner: (id: BannerId) => void;
  setTheme: (theme: Theme) => void;
  setPane: (pane: "explorer" | "inspector", width: number) => void;
  setInspectorCollapsed: (collapsed: boolean) => void;
  setHelpOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setAboutOpen: (open: boolean) => void;
  /** Shows a guide step; null ends the guide and remembers it was seen. */
  setGuideStep: (step: number | null) => void;
  toggleTheme: () => void;
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
    set({ phase, path, error: null, lostRemoved: false });
    try {
      const bundle = await run(path);
      const model = buildModel(bundle);
      const previous = get();
      const sameRepo = previous.bundle?.root === bundle.root;
      // A reload replaces the model, so the Changes lens (which swaps it) ends.
      const leaveChanges =
        previous.lens === "changes" ? { lens: "structure" as const, diff: null, base: null } : {};
      const selectedId =
        sameRepo && previous.selectedId !== null && model.nodes.has(previous.selectedId)
          ? previous.selectedId
          : null;
      // Restore before exposing the model so an early interaction cannot be overwritten.
      const api = await getApi();
      const savedView = sameRepo ? null : await api.getViewState(bundle.root).catch(() => null);
      set({
        phase: "ready",
        bundle,
        model,
        selectedId,
        expandedIds: sameRepo
          ? new Set([...previous.expandedIds].filter((id) => model.nodes.has(id)))
          : defaultExpanded(model),
        ...leaveChanges,
        ...(sameRepo
          ? {}
          : {
              activeTab: "map" as const,
              docPath: null,
              docScroll: 0,
              docTarget: null,
              lens: "structure" as const,
              collapsedIds: new Set<string>(),
              viewport: null,
              restoreViewport: null,
              pendingDiff: null,
              commits: [],
              diff: null,
              base: null,
              statusFilter: null,
              dismissedBanners: new Set<BannerId>(),
              history: [],
              historyIndex: -1,
              evidence: null,
              ambiguousOpen: new Set<string>(),
              navigation: null,
            }),
      });
      if (savedView) applyView(savedView, model);
      set({ recent: await api.recentRepositories().catch(() => get().recent) });
    } catch (err) {
      const error = toAppError(err);
      set({ phase: "error", error, bundle: null, model: null, selectedId: null });
      // A recent repository that moved or was deleted leaves the recent list.
      if (error.code === "not-a-directory" && get().recent.some((r) => r.path === path)) {
        const api = await getApi();
        await api.forgetRecent(path).catch(() => undefined);
        set({ recent: get().recent.filter((r) => r.path !== path), lostRemoved: true });
      }
    }
  };

  /** Restores a saved view, silently dropping IDs that no longer exist. */
  const applyView = (view: ViewState, model: Model) => {
    const exists = (id: string) => model.nodes.has(id);
    const selected =
      view.selectedId !== undefined && exists(view.selectedId) ? view.selectedId : null;
    set({
      activeTab: view.activeTab === "docs" ? "docs" : "map",
      docPath: view.docPath ?? null,
      docScroll: Math.max(0, view.docScroll ?? 0),
      expandedIds: new Set([
        ...view.expandedIds.filter(exists),
        ...(selected ? ancestors(model, selected) : []),
      ]),
      collapsedIds: new Set(
        view.collapsedIds.filter((id) => model.nodes.get(id)?.kind === "class"),
      ),
      selectedId: selected,
      history: selected !== null ? [selected] : [],
      historyIndex: selected !== null ? 0 : -1,
      restoreViewport: view.viewport ?? null,
      pendingDiff:
        view.diffFrom !== undefined && view.diffTo !== undefined
          ? { from: view.diffFrom, to: view.diffTo }
          : null,
    });
    const widths: Partial<Settings> = {};
    if (view.explorerWidth !== undefined)
      widths.explorerWidth = clamp(
        view.explorerWidth,
        PANE_LIMITS.explorer.min,
        PANE_LIMITS.explorer.max,
      );
    if (view.inspectorWidth !== undefined)
      widths.inspectorWidth = clamp(
        view.inspectorWidth,
        PANE_LIMITS.inspector.min,
        PANE_LIMITS.inspector.max,
      );
    if (Object.keys(widths).length > 0) set((s) => ({ settings: { ...s.settings, ...widths } }));
    const lens = LENSES.find((l) => l === view.lens);
    if (lens && lens !== "structure") get().setLens(lens);
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
    activeTab: "map",
    docPath: null,
    docScroll: 0,
    docTarget: null,
    setActiveTab(activeTab) {
      set({ activeTab });
    },
    openDoc(docPath, anchor = "", nodeId) {
      set({
        activeTab: "docs",
        docPath,
        docScroll: 0,
        docTarget: { anchor, ...(nodeId ? { nodeId } : {}), seq: (get().docTarget?.seq ?? 0) + 1 },
      });
    },
    setDocScroll(docScroll) {
      set({ docScroll });
    },
    phase: "idle",
    path: null,
    bundle: null,
    model: null,
    error: null,
    lostRemoved: false,
    recent: [],
    settings: DEFAULT_SETTINGS,
    helpOpen: false,
    paletteOpen: false,
    shortcutsOpen: false,
    aboutOpen: false,
    guideStep: null,
    selectedId: null,
    expandedIds: new Set(),
    collapsedIds: new Set(),
    hops: 1,
    evidence: null,
    ambiguousOpen: new Set(),
    history: [],
    historyIndex: -1,
    navigation: null,
    lens: "structure",
    statusFilter: null,
    commits: [],
    diff: null,
    diffMode: "inline",
    viewport: null,
    restoreViewport: null,
    fitSeq: 0,
    pendingDiff: null,
    base: null,
    issuesOpen: false,
    dismissedBanners: new Set(),
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
        if (!merged.guideSeen) set({ guideStep: 0 });
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

    toggleCollapsed(id) {
      const next = new Set(get().collapsedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      set({ collapsedIds: next });
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
      const { bundle, base, model, expandedIds, selectedId } = get();
      if (lens === get().lens) return;
      if (base) {
        // Leaving Changes: back to the repository's own model, keeping the selection (and
        // revealing it) when it still exists there.
        const keep = selectedId !== null && base.model.nodes.has(selectedId) ? selectedId : null;
        const expanded = new Set(base.expandedIds);
        if (keep !== null) for (const a of ancestors(base.model, keep)) expanded.add(a);
        set({
          model: base.model,
          expandedIds: expanded,
          base: null,
          diff: null,
          evidence: null,
          selectedId: keep,
        });
      }
      set({ lens, ...(lens === "coverage" ? {} : { statusFilter: null }) });
      if (lens !== "changes" || !model || !bundle) return;
      set({ base: { model, expandedIds } });
      void (async () => {
        const api = await getApi();
        try {
          const commits = await api.listCommits(get().path ?? bundle.root, 50);
          set({ commits });
          const to = commits[0]?.sha;
          if (to === undefined) {
            set({
              diff: {
                from: WORKTREE,
                to: WORKTREE,
                status: "error",
                error: { code: "io", message: "This repository has no commits to compare." },
              },
            });
            return;
          }
          // A saved range is used when its revisions are still there.
          const known = (rev: string) => rev === WORKTREE || commits.some((c) => c.sha === rev);
          const saved = get().pendingDiff;
          set({ pendingDiff: null });
          if (saved && known(saved.from) && known(saved.to))
            await get().loadDiff(saved.from, saved.to);
          else await get().loadDiff(commits[1]?.sha ?? to, to);
        } catch (err) {
          set({ diff: { from: "", to: "", status: "error", error: toAppError(err) } });
        }
      })();
    },

    async loadDiff(from, to) {
      const { bundle } = get();
      if (!bundle || get().lens !== "changes") return;
      set({ diff: { from, to, status: "loading" } });
      try {
        const api = await getApi();
        const result = await api.diffRevisions(get().path ?? bundle.root, from, to);
        const current = get();
        // Ignore a result the user has moved on from.
        if (current.lens !== "changes" || current.diff?.from !== from || current.diff.to !== to)
          return;
        const view = buildDiffView(result, bundle);
        set({
          model: view.model,
          expandedIds: view.expanded,
          selectedId: null,
          evidence: null,
          diff: { from, to, status: "ready", view },
        });
      } catch (err) {
        if (get().diff?.from === from && get().diff?.to === to)
          set({ diff: { from, to, status: "error", error: toAppError(err) } });
      }
    },

    stepChange(direction) {
      const { diff, selectedId } = get();
      const steps = diff?.view?.steps ?? [];
      if (steps.length === 0) return;
      const at = selectedId === null ? -1 : steps.indexOf(selectedId);
      const next =
        at < 0
          ? direction > 0
            ? 0
            : steps.length - 1
          : (at + direction + steps.length) % steps.length;
      const id = steps[next];
      if (id !== undefined) get().navigateTo(id);
    },

    setDiffMode(mode) {
      set({ diffMode: mode });
    },

    setViewport(viewport) {
      set({ viewport });
    },

    requestFit() {
      set({ fitSeq: get().fitSeq + 1 });
    },

    async resetView() {
      const { bundle } = get();
      if (!bundle) return;
      if (get().lens !== "structure") get().setLens("structure");
      const model = get().model;
      if (!model) return;
      set({
        activeTab: "map",
        docPath: null,
        docScroll: 0,
        docTarget: null,
        expandedIds: defaultExpanded(model),
        collapsedIds: new Set(),
        selectedId: null,
        evidence: null,
        statusFilter: null,
        restoreViewport: null,
        pendingDiff: null,
      });
      get().requestFit();
      // The default view is not saved back: the saved file is simply gone.
      clearTimeout(viewTimer);
      const api = await getApi();
      await api.clearViewState(bundle.root).catch(() => undefined);
    },

    setStatusFilter(status) {
      set({ statusFilter: status });
    },

    setIssuesOpen(open) {
      set({ issuesOpen: open });
    },

    dismissBanner(id) {
      set({ dismissedBanners: new Set([...get().dismissedBanners, id]) });
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

    setPaletteOpen(open) {
      set({ paletteOpen: open });
    },

    setShortcutsOpen(open) {
      set({ shortcutsOpen: open });
    },

    setAboutOpen(open) {
      set({ aboutOpen: open });
    },

    setGuideStep(step) {
      set({ guideStep: step });
      if (step === null && !get().settings.guideSeen) updateSettings({ guideSeen: true });
    },

    toggleTheme() {
      // System → the opposite of what the system shows now; then Light ⇄ Dark.
      const { theme } = get();
      const dark =
        theme === "dark" ||
        (theme === "system" &&
          typeof window !== "undefined" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches);
      get().setTheme(dark ? "light" : "dark");
    },
  };
});

let viewTimer: ReturnType<typeof setTimeout> | undefined;

/** The current view of the open repository, as saved per repository. */
function currentView(s: AppState): ViewState {
  const view: ViewState = {
    // In the Changes lens, the repository's own expansion (not the diff's).
    expandedIds: [...(s.base?.expandedIds ?? s.expandedIds)].sort(),
    collapsedIds: [...s.collapsedIds].sort(),
    activeTab: s.activeTab,
    ...(s.docPath ? { docPath: s.docPath } : {}),
    docScroll: s.docScroll,
    lens: s.lens,
    explorerWidth: s.settings.explorerWidth,
    inspectorWidth: s.settings.inspectorWidth,
  };
  if (s.selectedId !== null) view.selectedId = s.selectedId;
  if (s.viewport) view.viewport = s.viewport;
  if (s.diff && s.diff.status !== "error") {
    view.diffFrom = s.diff.from;
    view.diffTo = s.diff.to;
  }
  return view;
}

useAppStore.subscribe((s, prev) => {
  if (s.phase !== "ready" || !s.bundle || s.bundle !== prev.bundle) return;
  const changed =
    s.activeTab !== prev.activeTab ||
    s.docPath !== prev.docPath ||
    s.docScroll !== prev.docScroll ||
    s.expandedIds !== prev.expandedIds ||
    s.collapsedIds !== prev.collapsedIds ||
    s.selectedId !== prev.selectedId ||
    s.lens !== prev.lens ||
    s.viewport !== prev.viewport ||
    s.diff?.from !== prev.diff?.from ||
    s.diff?.to !== prev.diff?.to ||
    s.settings.explorerWidth !== prev.settings.explorerWidth ||
    s.settings.inspectorWidth !== prev.settings.inspectorWidth;
  if (!changed) return;
  clearTimeout(viewTimer);
  const root = s.bundle.root;
  viewTimer = setTimeout(() => {
    const now = useAppStore.getState();
    if (now.bundle?.root !== root) return;
    void getApi().then((api) => api.setViewState(root, currentView(now)).catch(() => undefined));
  }, VIEW_SAVE_MS);
});

// Flush the last reading position and tab alongside camera state when the window closes.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    if (viewTimer === undefined) return;
    clearTimeout(viewTimer);
    viewTimer = undefined;
    const state = useAppStore.getState();
    if (state.phase === "ready" && state.bundle) {
      const root = state.bundle.root;
      const view = currentView(state);
      void getApi().then((api) => api.setViewState(root, view).catch(() => undefined));
    }
  });
}

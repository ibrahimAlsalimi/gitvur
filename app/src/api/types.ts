import type {
  AssetData,
  DocContent,
  DocEntry,
  AppError,
  CommitInfo,
  DiffBundle,
  ErrorCode,
  RecentRepo,
  RepoBundle,
  Settings,
  SourceSlice,
  Trace,
  ViewState,
} from "../generated/contract";

/** Everything the UI asks of the backend. Implemented by Tauri, or by the browser mock. */
export interface Api {
  listDocs(path: string): Promise<DocEntry[]>;
  readDoc(path: string, docPath: string): Promise<DocContent>;
  readDocAsset(path: string, docPath: string, href: string): Promise<AssetData>;
  openExternal(url: string): Promise<void>;
  /** Shows a folder picker; `null` if cancelled. */
  pickFolder(): Promise<string | null>;
  openRepository(path: string): Promise<RepoBundle>;
  indexRepository(path: string): Promise<RepoBundle>;
  validateRepository(path: string): Promise<RepoBundle>;
  readSource(
    path: string,
    file: string,
    start: number,
    end: number,
    context: number,
  ): Promise<SourceSlice>;
  /**
   * Asks where to save an exported diagram (`data` is base64) and writes it there; never
   * inside the repository at `repo`. Resolves false when the user cancels.
   */
  saveExport(repo: string, name: string, kind: "png" | "svg", data: string): Promise<boolean>;
  /** The deterministic call tree of an entry point or node; an unknown ID sets `error`. */
  getTrace(path: string, start: string, depth: number, maxNodes: number): Promise<Trace>;
  recentRepositories(): Promise<RecentRepo[]>;
  getSettings(): Promise<Settings>;
  setSettings(settings: Settings): Promise<void>;
  /** Up to `limit` commits reachable from HEAD, newest first. */
  listCommits(path: string, limit?: number): Promise<CommitInfo[]>;
  /** Structural diff of two revisions (`worktree` = the files on disk), with both structures. */
  diffRevisions(path: string, from: string, to: string): Promise<DiffBundle>;
  /** Source of `file` at revision `rev` (a full SHA, or `worktree`). */
  readRevisionSource(
    path: string,
    rev: string,
    file: string,
    start: number,
    end: number,
    context: number,
  ): Promise<SourceSlice>;
  /** Removes a repository from the recent list (it moved or was deleted). */
  forgetRecent(path: string): Promise<void>;
  /** The saved view of the repository at canonical `root` (app data folder, never the repo). */
  getViewState(root: string): Promise<ViewState | null>;
  setViewState(root: string, state: ViewState): Promise<void>;
  clearViewState(root: string): Promise<void>;
  /** Sets the window title. */
  setTitle(title: string): Promise<void>;
  /** A repository to open at startup (mock mode's `?fixture=`); `null` in the real app. */
  initialPath(): string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  explorerWidth: 280,
  inspectorWidth: 380,
  inspectorCollapsed: false,
  theme: "system",
  guideSeen: false,
};

const CODES: readonly ErrorCode[] = [
  "not-a-directory",
  "no-gitvur",
  "schema-invalid",
  "path-escape",
  "io",
  "index-failed",
];

/** Normalises anything a command rejects with into an `AppError`. */
export function toAppError(err: unknown): AppError {
  if (typeof err === "object" && err !== null && "code" in err && "message" in err) {
    const { code, message, detail } = err as { code: unknown; message: unknown; detail?: unknown };
    if (CODES.includes(code as ErrorCode) && typeof message === "string") {
      const out: AppError = { code: code as ErrorCode, message };
      if (typeof detail === "string") out.detail = detail;
      return out;
    }
  }
  return { code: "io", message: "Something went wrong", detail: String(err) };
}

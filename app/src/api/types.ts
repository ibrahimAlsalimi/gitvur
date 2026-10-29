import type {
  AppError,
  ErrorCode,
  RecentRepo,
  RepoBundle,
  Settings,
  SourceSlice,
} from "../generated/contract";

/** Everything the UI asks of the backend. Implemented by Tauri, or by the browser mock. */
export interface Api {
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
  recentRepositories(): Promise<RecentRepo[]>;
  getSettings(): Promise<Settings>;
  setSettings(settings: Settings): Promise<void>;
  /** A repository to open at startup (mock mode's `?fixture=`); `null` in the real app. */
  initialPath(): string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  explorerWidth: 280,
  inspectorWidth: 380,
  inspectorCollapsed: false,
  theme: "system",
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

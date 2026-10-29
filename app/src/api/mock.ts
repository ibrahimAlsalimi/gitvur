/**
 * Browser mock of the backend (`pnpm dev:mock`). Serves the fixtures' committed `.gitvur/`
 * files and sources, bundled at build time. URL parameters:
 *
 * - `?fixture=py-small|ts-small` opens that fixture at startup (default: none).
 * - `?state=no-gitvur|schema-invalid|structure-only|indexing` simulates the matching
 *   backend behaviour, for screenshots of each state.
 */
import type {
  AppError,
  Annotations,
  Manifest,
  RepoBundle,
  Report,
  Settings,
  SourceSlice,
  Structure,
} from "../generated/contract";
import { type Api, DEFAULT_SETTINGS } from "./types";

const gitvurFiles = import.meta.glob<unknown>("../../../fixtures/*/.gitvur/*.json", {
  eager: true,
  import: "default",
});
const sources = import.meta.glob<string>("../../../fixtures/*/**/*.{py,ts}", {
  eager: true,
  query: "?raw",
  import: "default",
});

const PREFIX = "../../../fixtures/";
const SETTINGS_KEY = "gitvur.mock.settings";
const params = new URLSearchParams(window.location.search);
const state = params.get("state");

function fixtureOf(path: string): string {
  return path.replace(/^mock:\/\//, "");
}

function file(fixture: string, name: string): unknown {
  return gitvurFiles[`${PREFIX}${fixture}/.gitvur/${name}`];
}

function fail(code: AppError["code"], message: string, detail?: string): Promise<never> {
  const error: AppError = { code, message };
  if (detail !== undefined) error.detail = detail;
  // Tauri rejects with the serialised AppError object, not an Error; the mock matches it.
  // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
  return Promise.reject(error);
}

function bundle(path: string): Promise<RepoBundle> {
  const fixture = fixtureOf(path);
  const manifest = file(fixture, "manifest.json") as Manifest | undefined;
  const structure = file(fixture, "structure.json") as Structure | undefined;
  if (state === "no-gitvur" || !manifest || !structure) {
    return fail("no-gitvur", "This repository hasn't been indexed yet");
  }
  if (state === "schema-invalid") {
    return fail(
      "schema-invalid",
      ".gitvur/structure.json doesn't match the expected format",
      "unknown field `nodez`, expected one of `nodes`, `edges`, `unresolvedCalls` at line 2 column 9",
    );
  }
  const structureOnly = state === "structure-only";
  const result: RepoBundle = {
    root: `/mock/fixtures/${fixture}`,
    manifest,
    structure,
    annotations: structureOnly
      ? null
      : ((file(fixture, "annotations.json") as Annotations | undefined) ?? null),
    report: structureOnly ? null : ((file(fixture, "report.json") as Report | undefined) ?? null),
    warnings: structureOnly
      ? [
          {
            code: "annotations-missing",
            message: "No descriptions yet: .gitvur/annotations.json is missing",
          },
          { code: "report-missing", message: "Not validated yet: .gitvur/report.json is missing" },
        ]
      : [],
  };
  return Promise.resolve(result);
}

const never = () => new Promise<never>(() => undefined);

export const mockApi: Api = {
  pickFolder: () => Promise.resolve(`mock://${params.get("fixture") ?? "py-small"}`),
  openRepository: bundle,
  indexRepository: (path) => (state === "indexing" ? never() : bundle(path)),
  validateRepository: bundle,
  readSource(path, relpath, start, end, context): Promise<SourceSlice> {
    const text = sources[`${PREFIX}${fixtureOf(path)}/${relpath}`];
    if (text === undefined) return fail("io", `cannot open \`${relpath}\``);
    const all = text.replace(/\n$/, "").split("\n");
    const first = Math.min(Math.max(1, start - context), all.length);
    const last = Math.min(all.length, end + context, first + 1999);
    return Promise.resolve({
      file: relpath,
      startLine: first,
      lines: all.slice(first - 1, last),
      language: relpath.endsWith(".py")
        ? "python"
        : relpath.endsWith(".ts")
          ? "typescript"
          : "text",
    });
  },
  recentRepositories: () =>
    Promise.resolve([
      { path: "mock://py-small", name: "py-small", openedAt: 0 },
      { path: "mock://ts-small", name: "ts-small", openedAt: 0 },
    ]),
  getSettings() {
    try {
      const saved = window.localStorage.getItem(SETTINGS_KEY);
      return Promise.resolve(
        saved
          ? { ...DEFAULT_SETTINGS, ...(JSON.parse(saved) as Partial<Settings>) }
          : DEFAULT_SETTINGS,
      );
    } catch {
      return Promise.resolve(DEFAULT_SETTINGS);
    }
  },
  setSettings(settings) {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Storage unavailable (private mode): settings just aren't remembered.
    }
    return Promise.resolve();
  },
  initialPath() {
    const fixture = params.get("fixture");
    return fixture ? `mock://${fixture}` : null;
  },
};

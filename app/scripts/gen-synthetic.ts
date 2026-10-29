/**
 * Writes a synthetic RepoBundle for performance work: `.synthetic/bundle.json`, loaded in
 * mock mode with `?fixture=synthetic`. Deterministic (seeded PRNG).
 *
 *   pnpm gen:synthetic [--modules 20] [--files 400] [--functions 5000] [--quiet]
 *
 * One file, `pkg00/big.py`, always has exactly 40 children (for the "expand one file
 * with 40 children" budget).
 */
import { mkdirSync, writeFileSync } from "node:fs";

interface Args {
  modules: number;
  files: number;
  functions: number;
  quiet: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { modules: 20, files: 400, functions: 5000, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === "--quiet") args.quiet = true;
    else if (key === "--modules" || key === "--files" || key === "--functions") {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 1) throw new Error(`${key} needs a positive integer`);
      args[key.slice(2) as "modules" | "files" | "functions"] = value;
    } else throw new Error(`unknown argument ${String(key)}`);
  }
  if (args.files < args.modules) throw new Error("--files must be ≥ --modules");
  if (args.functions < 40 + (args.files - 1))
    throw new Error("--functions too small for one function per file");
  return args;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const args = parseArgs(process.argv.slice(2));
const rand = mulberry32(20261030);
const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)] as T;
let hashCounter = 0;
const hash = () => `sha256:${(++hashCounter).toString(16).padStart(64, "0")}`;
const pad = (n: number) => String(n).padStart(2, "0");

type Node = {
  id: string;
  type: string;
  name: string;
  parentId?: string;
  source?: { file: string; startLine: number; endLine: number };
  contentHash?: string;
};
type Edge = {
  from: string;
  to: string;
  type: string;
  provenance: string;
  evidence: { file: string; line: number };
};

const nodes: Node[] = [{ id: "project:root", type: "project", name: "synthetic" }];
const edges: Edge[] = [];
const modules: { id: string; name: string; description: string; files: string[] }[] = [];
const descriptions: { id: string; text: string; basedOnHash: string }[] = [];
const filesByModule: string[][] = [];
const functionsByFile = new Map<string, string[]>();

// Files per module: an even split with some jitter, every module at least one file.
const counts = Array.from({ length: args.modules }, () => 1);
for (let left = args.files - args.modules; left > 0; left--) {
  const i = Math.floor(rand() * args.modules);
  counts[i] = (counts[i] ?? 1) + 1;
}

// Functions per file: the big file gets 40, the rest share the remainder.
const fileCount = args.files;
const fnPerFile = Array.from({ length: fileCount }, () => 1);
fnPerFile[0] = 40;
for (let left = args.functions - 40 - (fileCount - 1); left > 0; left--) {
  const i = 1 + Math.floor(rand() * (fileCount - 1));
  fnPerFile[i] = (fnPerFile[i] ?? 1) + 1;
}

const WORDS = [
  "store",
  "cache",
  "router",
  "parser",
  "client",
  "session",
  "queue",
  "report",
  "index",
  "auth",
  "billing",
  "search",
  "export",
  "schema",
  "worker",
  "events",
];
let fileIndex = 0;
for (let m = 0; m < args.modules; m++) {
  const moduleId = `module:m${pad(m)}`;
  const files: string[] = [];
  for (let f = 0; f < (counts[m] ?? 1); f++, fileIndex++) {
    const path = fileIndex === 0 ? "pkg00/big.py" : `pkg${pad(m)}/${pick(WORDS)}_${String(f)}.py`;
    const fileId = `file:${path}`;
    files.push(fileId);
    const total = fnPerFile[fileIndex] ?? 1;
    const lines = 20 + total * 9;
    nodes.push({
      id: fileId,
      type: "file",
      name: path.split("/").pop() as string,
      parentId: "project:root",
      source: { file: path, startLine: 1, endLine: lines },
      contentHash: hash(),
    });
    const fns: string[] = [];
    let line = 3;
    // The big file and every other file without a class keep all functions top-level.
    const withClass = fileIndex !== 0 && total >= 4 && rand() < 0.5;
    let classId: string | undefined;
    let methods = 0;
    if (withClass) {
      methods = Math.floor(total / 2);
      classId = `class:${path}:Service`;
      nodes.push({
        id: classId,
        type: "class",
        name: "Service",
        parentId: fileId,
        source: { file: path, startLine: line, endLine: line + methods * 9 },
        contentHash: hash(),
      });
      line += 1;
    }
    for (let k = 0; k < total; k++) {
      const parent = classId !== undefined && k < methods ? classId : fileId;
      const inClass = parent !== fileId;
      const name = inClass ? `method_${String(k)}` : `fn_${String(k)}`;
      const id = inClass ? `function:${path}:Service.${name}` : `function:${path}:${name}`;
      nodes.push({
        id,
        type: "function",
        name,
        parentId: parent,
        source: { file: path, startLine: line, endLine: line + 7 },
        contentHash: hash(),
      });
      fns.push(id);
      line += 9;
    }
    functionsByFile.set(fileId, fns);
  }
  filesByModule.push(files);
  modules.push({
    id: moduleId,
    name: `${pick(WORDS)[0]?.toUpperCase() ?? "M"}${pick(WORDS).slice(1)} ${pad(m)}`,
    description: `Synthetic module ${pad(m)} with ${String(files.length)} files.`,
    files,
  });
}

// Imports mostly point "down" (to later modules), with a few cycles; some calls follow.
for (let m = 0; m < args.modules; m++) {
  for (const fileId of filesByModule[m] ?? []) {
    const n = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const target =
        rand() < 0.9
          ? m + 1 + Math.floor(rand() * Math.max(1, Math.min(4, args.modules - m - 1)))
          : Math.floor(rand() * args.modules);
      const targets = filesByModule[Math.min(target, args.modules - 1)] ?? [];
      const to = pick(targets);
      if (to === fileId) continue;
      const path = fileId.slice(5);
      edges.push({
        from: fileId,
        to,
        type: "imports",
        provenance: "syntactic",
        evidence: { file: path, line: 1 + i },
      });
      const caller = pick(functionsByFile.get(fileId) ?? []);
      const callee = pick(functionsByFile.get(to) ?? []);
      if (caller && callee && rand() < 0.6)
        edges.push({
          from: caller,
          to: callee,
          type: "calls",
          provenance: "syntactic",
          evidence: { file: path, line: 10 + i },
        });
    }
  }
}

// Descriptions: ~60% documented, ~10% stale, the rest undocumented.
for (const node of nodes) {
  if (node.type === "project" || !node.contentHash) continue;
  const r = rand();
  if (r < 0.6)
    descriptions.push({
      id: node.id,
      text: `Describes ${node.name}.`,
      basedOnHash: node.contentHash,
    });
  else if (r < 0.7)
    descriptions.push({
      id: node.id,
      text: `Out of date description of ${node.name}.`,
      basedOnHash: hash(),
    });
}

nodes.sort((a, b) => (a.id < b.id ? -1 : 1));
const bundle = {
  root: "/synthetic",
  manifest: {
    schemaVersion: "0.2",
    projectName: "synthetic",
    commitSha: "uncommitted",
    generatedAt: "2026-10-30T00:00:00Z",
    extractor: { name: "gitvur-index", version: "0.2.0" },
    languages: ["python"],
  },
  structure: { nodes, edges, unresolvedCalls: [] },
  annotations: { modules, descriptions, edges: [] },
  report: null,
  warnings: [],
};
mkdirSync(new URL("../.synthetic/", import.meta.url), { recursive: true });
writeFileSync(new URL("../.synthetic/bundle.json", import.meta.url), JSON.stringify(bundle));
const fnTotal = nodes.filter((n) => n.type === "function").length;
if (!args.quiet) {
  console.log(
    `synthetic: ${String(args.modules)} modules, ${String(args.files)} files, ${String(fnTotal)} functions, ${String(nodes.filter((n) => n.type === "class").length)} classes, ${String(edges.length)} edges → .synthetic/bundle.json`,
  );
}

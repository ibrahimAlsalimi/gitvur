/**
 * User-facing wording, in one place so it can be reviewed together.
 *
 * Tone: plain, specific, no exclamation marks, no blame ("couldn't read", never "you
 * did …"). Short control labels (Fit, Index, Validate) stay next to their controls.
 */
import type { ErrorCode } from "./generated/contract";

const plural = (n: number, one: string, many = `${one}s`) => `${String(n)} ${n === 1 ? one : many}`;

export const copy = {
  docs: {
    empty: "No Markdown files in this repository.",
    truncated: "This document is larger than 2 MB; showing the beginning.",
    missing: "This document no longer exists.",
    failed: "Couldn't read this document.",
    listFailed: "Couldn't list the repository's documents.",
    assetBlocked: "Image outside the repository was not loaded.",
    remoteBlocked: "Remote images are blocked.",
    loadRemote: "Load remote images",
    diagramFailed: "Diagram couldn't be rendered",
    externalPrompt: "Open in your browser?",
    externalFailed: "Couldn't open this link.",
    unsupported: "Link not supported",
    indexing: "Indexing docs…",
    loading: "Loading document…",
    refresh: "Refresh list",
    mentioned: "Mentioned in docs",
    outline: "On this page",
    map: "Show Map tab",
    tab: "Show Docs tab",
    indexFailed: "Some documents couldn't be indexed.",
    indexLimit: "Searching the first 500 documents.",
  },
  app: {
    title: (project?: string) => (project ? `Gitvur — ${project}` : "Gitvur"),
  },

  states: {
    empty: {
      title: "Open a repository to map it",
      text: "Gitvur shows a repository as a map of modules, files, classes and functions. It never changes your code.",
      action: "Open repository",
      recent: "Recent",
    },
    busy: {
      opening: "Opening…",
      indexing: "Indexing…",
      validating: "Validating…",
      lastIndex: (files: number) => `${plural(files, "file")} in the last index.`,
      noCount: "This can take a few seconds on a large repository.",
    },
    noFiles: {
      title: "No Python or TypeScript files found.",
      text: "Gitvur maps .py and .ts files. Folders such as node_modules, build and .venv are skipped.",
      action: "Open another repository",
    },
    noDescriptions: {
      title: "Structure loaded — no descriptions yet",
      text: "A documenting agent adds modules and descriptions.",
      action: "Show how to document",
    },
    lostRemoved: "It was removed from your recent repositories.",
    details: "Details",
  },

  /** One human message per backend error code; `detail` goes behind "Details". */
  errors: {
    "not-a-directory": {
      title: "Couldn't find this folder",
      text: "It may have been moved, renamed or deleted.",
      action: "Open another repository",
    },
    "no-gitvur": {
      title: "This repository hasn't been indexed yet",
      text: "Indexing reads the code and writes its structure to a .gitvur folder. Nothing is executed.",
      action: "Index now",
    },
    "schema-invalid": {
      title: ".gitvur/ files don't match the expected format",
      text: "They may come from another version of Gitvur. Re-indexing rewrites the structure; descriptions are kept.",
      action: "Re-index",
    },
    "path-escape": {
      title: "A .gitvur file points outside the repository",
      text: "Gitvur only reads files inside the repository folder, so it stopped here.",
      action: "Re-index",
    },
    io: {
      title: "Couldn't read this folder",
      text: "Some files couldn't be read. They may be locked, or permissions may not allow it.",
      action: "Try again",
    },
    "index-failed": {
      title: "Indexing didn't finish",
      text: "Part of the repository couldn't be read. The details below say where.",
      action: "Try again",
    },
  } satisfies Record<ErrorCode, { title: string; text: string; action: string }>,

  banners: {
    reportMissing: "Not validated yet.",
    structureOutOfDate: "The code changed since this map was generated.",
    reportStale: "Validation results are older than the map.",
    large: (nodes: number) =>
      `This repository has ${nodes.toLocaleString("en")} elements. The Changes lens or a single module keeps the map quick.`,
    largeAction: "Show changes",
    dismiss: (text: string) => `Dismiss: ${text}`,
  },

  trust: {
    documented: "Description matches the current code.",
    staleSelf:
      "This code changed after the description was written. Treat the description as possibly outdated.",
    staleChild: "Something inside this element changed; its own code did not.",
    undocumented: "No description yet.",
    hint: "Run the documentation agent to add one.",
    possiblyOutdated: "possibly outdated",
  },

  search: {
    placeholder: "Search names, paths and descriptions — type > for commands",
    label: "Search",
    noMatches: (q: string) => `No matches for “${q}”.`,
    noMatchesHint: "Descriptions are searched too; try a word from what the code does.",
    noCommands: (q: string) => `No command matches “${q}”.`,
    hint: "Enter to open · Ctrl+Enter to select without moving · Esc to close",
    groups: {
      module: "Modules",
      file: "Files",
      class: "Classes",
      function: "Functions",
      command: "Commands",
    },
  },

  commands: {
    open: "Open repository",
    index: "Index",
    validate: "Validate",
    lensStructure: "Lens: Structure",
    lensDocumentation: "Lens: Documentation",
    lensChanges: "Lens: Changes",
    expandAll: "Expand all",
    collapseAll: "Collapse all",
    toggleTheme: "Toggle theme",
    showIssues: "Show issues",
    shortcuts: "Keyboard shortcuts",
    resetView: "Reset view",
    showGuide: "Show guide",
    about: "About Gitvur",
  },

  guide: [
    {
      target: "explorer",
      title: "Explorer",
      text: "Every module, file, class and function in the repository.",
    },
    {
      target: "canvas",
      title: "Map",
      text: "Click anything to see what it does and what it connects to.",
    },
    {
      target: "lens",
      title: "Lens",
      text: "Switch lens to see documentation coverage or what changed.",
    },
  ],
  guideNav: {
    next: "Next",
    done: "Done",
    skip: "Skip guide",
    step: (n: number, of: number) => `${String(n)} of ${String(of)}`,
  },

  about: {
    title: "About Gitvur",
    text: "A local, read-only map of a repository: structure extracted deterministically, meaning written by an AI agent, everything validated.",
    version: "Version",
    commit: "Build",
    source: "Source",
    license: "License",
    copyLink: "Copy link",
    copied: "Copied",
  },

  issues: {
    empty: "No validation issues.",
    notValidated: "Not validated yet.",
  },

  changes: {
    loading: "Comparing revisions…",
    none: "No structural changes between these revisions.",
    failed: "Couldn't compare these revisions.",
    noCommits: "This repository has no commits to compare.",
  },
} as const;

/** The keyboard map, listed exactly as the shortcuts sheet shows it. */
export const SHORTCUTS: readonly { keys: string; action: string }[] = [
  { keys: "Ctrl/Cmd+1 / 2", action: "Map / Docs tab" },
  { keys: "Ctrl/Cmd+K", action: "Search / palette" },
  { keys: "Ctrl/Cmd+O", action: "Open repository" },
  { keys: "Arrow keys on canvas", action: "Move focus: ↑ parent, ↓ first child, ← → siblings" },
  { keys: "Enter", action: "Expand / collapse focused file or class" },
  { keys: "Space", action: "Select focused node" },
  { keys: "Esc", action: "Clear selection, close palette or drawer" },
  { keys: "F · 0 · + −", action: "Fit view · reset zoom · zoom" },
  { keys: "1 2 3", action: "Structure / Documentation / Changes lens" },
  { keys: "Alt+← / →", action: "Selection history" },
  { keys: "N / Shift+N", action: "Next / previous change (Changes lens)" },
  { keys: "?", action: "Keyboard shortcuts sheet" },
];

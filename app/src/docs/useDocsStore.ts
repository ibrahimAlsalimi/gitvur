import { create } from "zustand";
import { useEffect, useState } from "react";
import { getApi } from "../api";
import type { DocEntry } from "../generated/contract";
import { buildModel } from "../model/buildModel";
import { useAppStore } from "../store/useAppStore";
import type { DocsIndex } from "./indexDocs";

interface DocsState {
  entries: DocEntry[];
  index: DocsIndex;
  loading: boolean;
  indexing: boolean;
  error: boolean;
  indexError: boolean;
  filter: string;
  refreshSeq: number;
  setFilter: (filter: string) => void;
  refresh: () => void;
}
export const useDocsStore = create<DocsState>()((set) => ({
  entries: [],
  index: { docs: [], mentions: {} },
  loading: false,
  indexing: false,
  error: false,
  indexError: false,
  filter: "",
  refreshSeq: 0,
  setFilter: (filter) => {
    set({ filter });
  },
  refresh: () => {
    set((s) => ({ refreshSeq: s.refreshSeq + 1 }));
  },
}));

/** Index in small batches: at most four bounded documents cross the worker boundary at once. */
export function DocsController() {
  const bundle = useAppStore((s) => s.bundle);
  const refreshSeq = useDocsStore((s) => s.refreshSeq);
  useEffect(() => {
    useDocsStore.setState({
      entries: [],
      index: { docs: [], mentions: {} },
      loading: !!bundle,
      indexing: false,
      error: false,
      indexError: false,
      filter: "",
    });
    if (!bundle) return;
    const abort = new AbortController();
    const cancelled = () => abort.signal.aborted;
    const worker = new Worker(new URL("./index.worker.ts", import.meta.url), { type: "module" });
    const nodes = [...buildModel(bundle).nodes.values()];
    let rejectJob: ((err: Error) => void) | undefined;
    const run = (docs: { path: string; title: string; text: string }[]) =>
      new Promise<DocsIndex>((resolve, reject) => {
        rejectJob = reject;
        worker.onmessage = (event: MessageEvent<DocsIndex>) => {
          resolve(event.data);
        };
        worker.onerror = () => {
          reject(new Error("Docs worker failed"));
        };
        worker.postMessage({ docs, nodes });
      });
    void (async () => {
      const api = await getApi();
      const entries = await api.listDocs(bundle.root);
      if (cancelled()) return;
      useDocsStore.setState({ entries, loading: false, indexing: true });
      const result: DocsIndex = { docs: [], mentions: {} };
      for (let offset = 0; offset < Math.min(entries.length, 500); offset += 4) {
        if (cancelled()) return;
        const batch = await Promise.all(
          entries.slice(offset, Math.min(offset + 4, 500)).map(async (entry) => {
            try {
              const content = await api.readDoc(bundle.root, entry.path);
              return { ...entry, text: content.text };
            } catch {
              if (!cancelled()) useDocsStore.setState({ indexError: true });
              return null;
            }
          }),
        );
        if (cancelled()) return;
        const indexed = await run(batch.filter((d) => d !== null));
        result.docs.push(...indexed.docs);
        for (const [id, mentions] of Object.entries(indexed.mentions))
          (result.mentions[id] ??= []).push(...mentions);
        if (!cancelled())
          useDocsStore.setState({
            index: { docs: [...result.docs], mentions: { ...result.mentions } },
          });
      }
      if (!cancelled()) useDocsStore.setState({ indexing: false });
    })().catch(() => {
      if (!cancelled())
        useDocsStore.setState((s) => ({
          loading: false,
          indexing: false,
          error: s.entries.length === 0,
          indexError: s.entries.length > 0,
        }));
    });
    return () => {
      abort.abort();
      rejectJob?.(new Error("Cancelled"));
      worker.terminate();
    };
  }, [bundle, refreshSeq]);
  return null;
}

/** Theme changes include the system setting; Mermaid rerenders when either changes. */
export function useDarkTheme() {
  const theme = useAppStore((s) => s.theme);
  const [systemDark, setSystemDark] = useState(
    () =>
      typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const change = () => {
      setSystemDark(media.matches);
    };
    media.addEventListener("change", change);
    return () => {
      media.removeEventListener("change", change);
    };
  }, []);
  return theme === "dark" || (theme === "system" && systemDark);
}

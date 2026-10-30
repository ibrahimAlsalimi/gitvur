import { useEffect } from "react";

import { useAppStore } from "../store/useAppStore";
import { typingIn } from "./typing";

const LENS_KEYS = { "1": "structure", "2": "coverage", "3": "changes" } as const;

/**
 * App-wide shortcuts: Ctrl/Cmd+K palette, Ctrl/Cmd+O open, 1 2 3 lens, ? shortcuts,
 * Esc closes the drawer (then clears the selection). Map keys live in MapCanvas; history,
 * issues and change stepping have their own hooks.
 */
export function useGlobalKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const store = useAppStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && !e.shiftKey && !e.altKey && (key === "1" || key === "2") && store.bundle) {
        e.preventDefault();
        store.setActiveTab(key === "1" ? "map" : "docs");
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && key === "k") {
        e.preventDefault();
        store.setPaletteOpen(!store.paletteOpen);
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && key === "o") {
        e.preventDefault();
        void store.chooseAndOpen();
        return;
      }
      if (mod || e.altKey || typingIn(e.target)) return;
      if (e.key === "?") {
        e.preventDefault();
        store.setShortcutsOpen(true);
      } else if (e.key in LENS_KEYS && store.model && store.activeTab === "map") {
        e.preventDefault();
        store.setLens(LENS_KEYS[e.key as keyof typeof LENS_KEYS]);
      } else if (e.key === "Escape") {
        if (store.guideStep !== null) store.setGuideStep(null);
        else if (store.issuesOpen) store.setIssuesOpen(false);
        else store.select(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);
}

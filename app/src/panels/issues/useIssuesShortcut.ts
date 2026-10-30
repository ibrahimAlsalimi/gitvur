import { useEffect } from "react";

import { useAppStore } from "../../store/useAppStore";

/** Ctrl+Shift+M toggles the issues panel. */
export function useIssuesShortcut() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey || e.key.toLowerCase() !== "m") return;
      e.preventDefault();
      const store = useAppStore.getState();
      if (store.model) store.setIssuesOpen(!store.issuesOpen);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);
}

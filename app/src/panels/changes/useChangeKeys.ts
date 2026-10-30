import { useEffect } from "react";

import { useAppStore } from "../../store/useAppStore";

/** N / Shift+N step to the next / previous change in the Changes lens. */
export function useChangeKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useAppStore.getState().activeTab !== "map") return;
      if (e.key.toLowerCase() !== "n" || e.ctrlKey || e.altKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const store = useAppStore.getState();
      if (store.lens !== "changes") return;
      e.preventDefault();
      store.stepChange(e.shiftKey ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);
}

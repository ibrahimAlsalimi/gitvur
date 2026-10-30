import { useEffect } from "react";

import { useAppStore } from "../store/useAppStore";

/** Alt+← / Alt+→ move through the selection history (outside text fields). */
export function useHistoryKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [role='separator']")) return;
      e.preventDefault();
      const store = useAppStore.getState();
      if (e.key === "ArrowLeft") store.back();
      else store.forward();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);
}

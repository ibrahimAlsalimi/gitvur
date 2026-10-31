import { useAppStore } from "../store/useAppStore";
const TABS = [
  { id: "map", label: "Map" },
  { id: "docs", label: "Docs" },
  { id: "flows", label: "Flows" },
] as const;
export function TabBar() {
  const active = useAppStore((s) => s.activeTab);
  const enabled = useAppStore((s) => s.bundle !== null);
  return (
    <div className="gv-tabs" role="tablist" aria-label="Repository views">
      {TABS.map((tab, index) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`tab-${tab.id}`}
          aria-controls={`panel-${tab.id}`}
          aria-selected={active === tab.id}
          tabIndex={active === tab.id ? 0 : -1}
          disabled={!enabled}
          onClick={() => {
            useAppStore.getState().setActiveTab(tab.id);
          }}
          onKeyDown={(e) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
            e.preventDefault();
            const next =
              e.key === "Home"
                ? TABS[0]
                : e.key === "End"
                  ? TABS[TABS.length - 1]
                  : TABS[(index + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
            if (next) {
              useAppStore.getState().setActiveTab(next.id);
              document.getElementById(`tab-${next.id}`)?.focus();
            }
          }}
          title={`${tab.label} (Ctrl/Cmd+${String(index + 1)})`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

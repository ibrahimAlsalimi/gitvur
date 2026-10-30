import { type CSSProperties, useEffect } from "react";

import { Canvas } from "./components/Canvas";
import { Explorer } from "./components/Explorer";
import { HelpDialog } from "./components/HelpDialog";
import { ResizeHandle } from "./components/ResizeHandle";
import { StatusBar } from "./components/StatusBar";
import { TopBar } from "./components/TopBar";
import { Inspector, InspectorRail } from "./inspector/Inspector";
import { useHistoryKeys } from "./inspector/useHistoryKeys";
import { ChangesPanel } from "./panels/changes/ChangesPanel";
import { useChangeKeys } from "./panels/changes/useChangeKeys";
import { IssuesPanel } from "./panels/issues/IssuesPanel";
import { useIssuesShortcut } from "./panels/issues/useIssuesShortcut";
import { Banners } from "./topbar/Banners";
import { PANE_LIMITS, useAppStore } from "./store/useAppStore";

/** The application frame: top bar, explorer | canvas | inspector, status bar. */
export function App() {
  const settings = useAppStore((s) => s.settings);
  const issuesOpen = useAppStore((s) => s.issuesOpen);
  const lens = useAppStore((s) => s.lens);
  const theme = useAppStore((s) => s.theme);

  useEffect(() => {
    void useAppStore.getState().init();
  }, []);
  useHistoryKeys();
  useIssuesShortcut();
  useChangeKeys();

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);

  const { setPane } = useAppStore.getState();
  const collapsed = settings.inspectorCollapsed;
  return (
    <div className="frame">
      <TopBar />
      <Banners />
      <div
        className="panes"
        data-inspector={collapsed ? "collapsed" : "open"}
        style={
          {
            "--explorer-width": `${String(settings.explorerWidth)}px`,
            "--inspector-width": `${String(settings.inspectorWidth)}px`,
          } as CSSProperties
        }
      >
        {lens === "changes" ? (
          <nav className="pane" aria-label="Changes">
            <div className="pane-header">Changes</div>
            <div className="pane-body">
              <ChangesPanel />
            </div>
          </nav>
        ) : (
          <nav className="pane" aria-label="Explorer">
            <div className="pane-header">Explorer</div>
            <div className="pane-body">
              <Explorer />
            </div>
          </nav>
        )}
        <ResizeHandle
          label="Resize explorer"
          value={settings.explorerWidth}
          min={PANE_LIMITS.explorer.min}
          max={PANE_LIMITS.explorer.max}
          direction={1}
          onChange={(w) => {
            setPane("explorer", w);
          }}
        />
        <Canvas />
        {collapsed ? (
          <InspectorRail />
        ) : (
          <>
            <ResizeHandle
              label="Resize inspector"
              value={settings.inspectorWidth}
              min={PANE_LIMITS.inspector.min}
              max={PANE_LIMITS.inspector.max}
              direction={-1}
              onChange={(w) => {
                setPane("inspector", w);
              }}
            />
            <Inspector />
          </>
        )}
      </div>
      <div className="drawer">{issuesOpen && <IssuesPanel />}</div>
      <StatusBar />
      <HelpDialog />
    </div>
  );
}

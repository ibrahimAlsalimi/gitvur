import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import type { Theme } from "../generated/contract";
import { useAppStore } from "../store/useAppStore";
import { copy } from "../copy";
import { RevisionPicker } from "../topbar/RevisionPicker";
import { TrustSummary } from "../topbar/TrustSummary";
import { LogoMark, MoreIcon } from "./Icons";

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "Match system" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function TopBar() {
  const phase = useAppStore((s) => s.phase);
  const path = useAppStore((s) => s.path);
  const bundle = useAppStore((s) => s.bundle);
  const lens = useAppStore((s) => s.lens);
  const busy = phase === "opening" || phase === "indexing" || phase === "validating";
  const canIndex = path !== null && !busy;
  const canValidate = bundle !== null && !busy;

  return (
    <header className="topbar">
      <div className="logo">
        <LogoMark className="logo-mark" />
        <span>Gitvur</span>
      </div>
      {bundle && (
        <>
          <span className="topbar-divider" aria-hidden="true" />
          <span className="project-name" title={bundle.root}>
            {bundle.manifest.projectName}
          </span>
          <span className="chip" title="Commit the structure was extracted from">
            <span className="visually-hidden">Commit </span>
            {bundle.manifest.commitSha}
          </span>
          <span className="topbar-divider" aria-hidden="true" />
          {lens === "changes" ? <RevisionPicker /> : <TrustSummary />}
        </>
      )}
      <span className="topbar-spacer" />
      <div className="topbar-actions">
        <button
          type="button"
          className="button"
          disabled={!canIndex}
          onClick={() => void useAppStore.getState().index()}
          title="Re-extract the structure into .gitvur/"
        >
          Index
        </button>
        <button
          type="button"
          className="button"
          disabled={!canValidate}
          onClick={() => void useAppStore.getState().validate()}
          title="Check annotations and write .gitvur/report.json"
        >
          Validate
        </button>
        <MoreMenu />
      </div>
    </header>
  );
}

function MoreMenu() {
  const [open, setOpen] = useState(false);
  const theme = useAppStore((s) => s.theme);
  const hasRepo = useAppStore((s) => s.bundle !== null);
  const anchor = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    anchor.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"], [role="menuitemradio"]')
      ?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!anchor.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const choose = (action: () => void) => {
    close();
    action();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
  };

  return (
    <div className="menu-anchor" ref={anchor}>
      <button
        ref={button}
        type="button"
        className="button button-icon button-ghost"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
        }}
      >
        <MoreIcon />
      </button>
      {open && (
        <ul className="menu" role="menu" aria-label="More actions" onKeyDown={onKeyDown}>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                choose(() => void useAppStore.getState().chooseAndOpen());
              }}
            >
              Open repository…
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                choose(() => {
                  useAppStore.getState().setHelpOpen(true);
                });
              }}
            >
              How to document a repository
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                choose(() => {
                  useAppStore.getState().setPaletteOpen(true);
                });
              }}
            >
              Search…<kbd className="menu-kbd">Ctrl+K</kbd>
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              disabled={!hasRepo}
              onClick={() => {
                choose(() => void useAppStore.getState().resetView());
              }}
            >
              {copy.commands.resetView}
            </button>
          </li>
          <li role="separator" className="menu-separator" />
          <li role="none">
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                choose(() => {
                  useAppStore.getState().setShortcutsOpen(true);
                });
              }}
            >
              {copy.commands.shortcuts}
              <kbd className="menu-kbd">?</kbd>
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                choose(() => {
                  useAppStore.getState().setGuideStep(0);
                });
              }}
            >
              {copy.commands.showGuide}
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                choose(() => {
                  useAppStore.getState().setAboutOpen(true);
                });
              }}
            >
              {copy.commands.about}
            </button>
          </li>
          <li role="separator" className="menu-separator" />
          <li role="none" className="menu-label">
            Theme
          </li>
          {THEMES.map((t) => (
            <li role="none" key={t.value}>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={theme === t.value}
                className="menu-item"
                onClick={() => {
                  choose(() => {
                    useAppStore.getState().setTheme(t.value);
                  });
                }}
              >
                {t.label}
                {theme === t.value && <span aria-hidden="true">✓</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

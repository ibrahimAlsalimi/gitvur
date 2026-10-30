import { type CSSProperties, useEffect, useState } from "react";

import { copy } from "../copy";
import { useAppStore } from "../store/useAppStore";

const TARGETS = {
  explorer: '[aria-label="Explorer"], [aria-label="Changes"].pane',
  canvas: "main.canvas",
  lens: ".gv-tool-select, .canvas",
} as const;

/** Where to put the card: inside a large target (the map), beside a small one; on screen. */
function place(target: string): CSSProperties {
  const el = document.querySelector(target);
  const r = el?.getBoundingClientRect();
  const width = 300;
  if (!r) return { top: 96, left: 96, width };
  const inside = r.width > 2 * width;
  const left = inside ? r.left + 24 : r.right + 12;
  const top = inside ? r.top + 72 : r.top + 24;
  return {
    top: Math.min(window.innerHeight - 200, Math.max(56, top)),
    left: Math.min(window.innerWidth - width - 16, Math.max(16, left)),
    width,
  };
}

/**
 * First-run coach marks: three cards pointing at the explorer, the map and the lens
 * switch. Non-modal (the app stays usable), dismissible at every step, no animation.
 */
export function Guide() {
  const step = useAppStore((s) => s.guideStep);
  const current = step === null ? undefined : copy.guide[step];
  // Re-render on resize so the card follows its target.
  const [, setSize] = useState(0);
  useEffect(() => {
    if (!current) return;
    const onResize = () => {
      setSize(window.innerWidth * 10_000 + window.innerHeight);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [current]);

  if (step === null || !current) return null;
  const last = step === copy.guide.length - 1;
  const { setGuideStep } = useAppStore.getState();
  return (
    <section
      className="guide"
      style={place(TARGETS[current.target])}
      role="dialog"
      aria-modal="false"
      aria-labelledby="guide-title"
    >
      <div className="guide-step">{copy.guideNav.step(step + 1, copy.guide.length)}</div>
      <h2 className="guide-title" id="guide-title">
        {current.title}
      </h2>
      <p className="guide-text">{current.text}</p>
      <div className="guide-actions">
        <button
          type="button"
          className="gv-link"
          onClick={() => {
            setGuideStep(null);
          }}
        >
          {copy.guideNav.skip}
        </button>
        <button
          type="button"
          className="button button-primary"
          onClick={() => {
            setGuideStep(last ? null : step + 1);
          }}
        >
          {last ? copy.guideNav.done : copy.guideNav.next}
        </button>
      </div>
    </section>
  );
}

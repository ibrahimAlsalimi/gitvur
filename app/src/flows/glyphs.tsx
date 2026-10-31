/** Entry point kind glyphs. Inline SVG, `currentColor`, decorative (the name carries meaning). */
import type { EntryKind } from "../generated/contract";

const svg = { "aria-hidden": true, focusable: false, viewBox: "0 0 16 16" } as const;
const line = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

type GlyphShape =
  "terminal" | "globe" | "play" | "clock" | "lightning" | "package" | "flask" | "dot";

const KIND_SHAPE: Record<EntryKind, GlyphShape> = {
  "console-script": "terminal",
  "cli-command": "terminal",
  "package-bin": "terminal",
  "http-route": "globe",
  "main-guard": "play",
  "package-main": "play",
  "top-level-call": "play",
  job: "clock",
  "event-handler": "lightning",
  "npm-script": "package",
  test: "flask",
  other: "dot",
};

function Shape({ shape }: { shape: GlyphShape }) {
  switch (shape) {
    case "terminal":
      return (
        <>
          <rect x="1.5" y="2.5" width="13" height="11" rx="2" {...line} />
          <path d="M4.5 6.5l2 1.75-2 1.75M8.5 10.5h3" {...line} />
        </>
      );
    case "globe":
      return (
        <>
          <circle cx="8" cy="8" r="6.25" {...line} />
          <path d="M1.75 8h12.5M8 1.75c2 2 2 10.5 0 12.5M8 1.75c-2 2-2 10.5 0 12.5" {...line} />
        </>
      );
    case "play":
      return (
        <>
          <circle cx="8" cy="8" r="6.25" {...line} />
          <path d="M6.5 5.25v5.5L11 8z" fill="currentColor" />
        </>
      );
    case "clock":
      return (
        <>
          <circle cx="8" cy="8" r="6.25" {...line} />
          <path d="M8 4.5V8l2.5 1.5" {...line} />
        </>
      );
    case "lightning":
      return <path d="M9 1.5L3.5 9H8l-1 5.5L12.5 7H8z" fill="currentColor" />;
    case "package":
      return (
        <>
          <path d="M8 1.75l5.75 3v6.5L8 14.25l-5.75-3v-6.5z" {...line} />
          <path d="M2.25 4.75L8 7.75l5.75-3M8 7.75v6.5" {...line} />
        </>
      );
    case "flask":
      return (
        <>
          <path
            d="M6 1.75h4M6.5 1.75v4.5L2.75 13a1 1 0 00.9 1.25h8.7a1 1 0 00.9-1.25L9.5 6.25v-4.5"
            {...line}
          />
          <path d="M4.5 10h7" {...line} />
        </>
      );
    case "dot":
      return <circle cx="8" cy="8" r="3" fill="currentColor" />;
  }
}

export function EntryGlyph({ kind, className = "" }: { kind: EntryKind; className?: string }) {
  return (
    <svg {...svg} className={`gv-glyph gv-entry-glyph ${className}`.trim()}>
      <Shape shape={KIND_SHAPE[kind]} />
    </svg>
  );
}

/** The status mark next to a flow name: none for current. */
export function FlowStatusMark({ status }: { status: "current" | "stale" | "broken" }) {
  if (status === "current") return null;
  if (status === "stale") {
    return (
      <svg {...svg} className="gv-glyph gv-flow-status gv-flow-status-stale">
        <circle cx="8" cy="8" r="4" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg {...svg} className="gv-glyph gv-flow-status gv-flow-status-broken">
      <path d="M8 1.75l6.5 12H1.5z" fill="currentColor" />
      <path
        d="M8 6v3.5M8 11.25v.25"
        stroke="var(--gv-bg-surface)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

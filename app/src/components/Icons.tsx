/** Small inline icons. They inherit `currentColor` and are hidden from assistive tech. */

interface IconProps {
  className?: string;
}

const base = {
  "aria-hidden": true,
  focusable: false,
  fill: "none",
  stroke: "currentColor",
} as const;

export function LogoMark({ className }: IconProps) {
  return (
    <svg {...base} className={className} viewBox="0 0 20 20" strokeWidth={1.8}>
      <circle cx="10" cy="4" r="2.2" />
      <circle cx="4.5" cy="15.5" r="2.2" />
      <circle cx="15.5" cy="15.5" r="2.2" />
      <path d="M9 6 5.5 13.5M11 6l3.5 7.5" strokeLinecap="round" />
    </svg>
  );
}

export function ChevronRight({ className }: IconProps) {
  return (
    <svg {...base} className={className} viewBox="0 0 16 16" strokeWidth={1.6}>
      <path d="m6 4 4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function FolderIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} viewBox="0 0 40 40" strokeWidth={2}>
      <path
        d="M5 11a3 3 0 0 1 3-3h8l4 4h12a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3Z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AlertIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} viewBox="0 0 40 40" strokeWidth={2}>
      <path d="M20 6 36 33H4Z" strokeLinejoin="round" />
      <path d="M20 16v8M20 28.5v.5" strokeLinecap="round" />
    </svg>
  );
}

export function DocIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} viewBox="0 0 40 40" strokeWidth={2}>
      <path
        d="M11 5h13l7 7v21a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"
        strokeLinejoin="round"
      />
      <path d="M24 5v7h7M14 20h12M14 26h9" strokeLinecap="round" />
    </svg>
  );
}

export function MoreIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} viewBox="0 0 16 16" fill="currentColor" stroke="none">
      <circle cx="3.5" cy="8" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="12.5" cy="8" r="1.3" />
    </svg>
  );
}

export function PanelIcon({ className, side }: IconProps & { side: "open" | "close" }) {
  return (
    <svg {...base} className={className} viewBox="0 0 16 16" strokeWidth={1.4}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
      <path d="M10.5 2.5v11" />
      <path
        d={side === "close" ? "m5 6 2 2-2 2" : "m7 6-2 2 2 2"}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

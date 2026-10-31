/** Inline SVG glyphs for the map. They inherit `currentColor` and are decorative. */

const svg = { "aria-hidden": true, focusable: false } as const;

/** Language mark for a file card: a rounded square with the language's short name. */
export function LanguageGlyph({ language }: { language: "c" | "go" | "py" | "ts" | "file" }) {
  return (
    <svg {...svg} className="gv-glyph gv-glyph-language" viewBox="0 0 20 20">
      <rect
        x="1"
        y="1"
        width="18"
        height="18"
        rx="4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <text
        x="10"
        y="13.5"
        textAnchor="middle"
        fontSize="8"
        fontWeight="600"
        fill="currentColor"
        fontFamily="var(--gv-font-code)"
      >
        {language === "file" ? "··" : language}
      </text>
    </svg>
  );
}

/** Class: a filled square with `C`. */
export function ClassGlyph() {
  return (
    <svg {...svg} className="gv-glyph gv-glyph-class" viewBox="0 0 16 16">
      <rect x="1" y="1" width="14" height="14" rx="3" fill="currentColor" />
      <text
        x="8"
        y="11.5"
        textAnchor="middle"
        fontSize="9.5"
        fontWeight="700"
        fill="var(--gv-bg-surface-raised)"
        fontFamily="var(--gv-font-ui)"
      >
        C
      </text>
    </svg>
  );
}

/** Function: `ƒ` in a circle; filled for functions, outline only for methods. */
export function FunctionGlyph({ method }: { method: boolean }) {
  return (
    <svg {...svg} className="gv-glyph gv-glyph-function" viewBox="0 0 16 16">
      <circle
        cx="8"
        cy="8"
        r="6.75"
        fill={method ? "none" : "currentColor"}
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <text
        x="8"
        y="11.4"
        textAnchor="middle"
        fontSize="9.5"
        fontStyle="italic"
        fontWeight="600"
        fill={method ? "currentColor" : "var(--gv-bg-surface-raised)"}
        fontFamily="var(--gv-font-ui)"
      >
        ƒ
      </text>
    </svg>
  );
}

export function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg {...svg} className="gv-glyph gv-chevron" data-expanded={expanded} viewBox="0 0 16 16">
      <path
        d="m6 4 4 4-4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

import { ClassGlyph, FunctionGlyph, LanguageGlyph } from "../canvas/glyphs";
import { isMethod } from "../inspector/relations";
import type { Model, ModelNode } from "../model/buildModel";

const svg = { "aria-hidden": true, focusable: false } as const;

function ModuleGlyph() {
  return (
    <svg {...svg} className="gv-glyph" viewBox="0 0 16 16">
      <rect
        x="1.75"
        y="1.75"
        width="12.5"
        height="12.5"
        rx="2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M1.75 5.5h12.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** The kind's glyph, coloured by kind; shared by the inspector and the palette. */
export function KindGlyph({ model, node }: { model: Model; node: ModelNode }) {
  const glyph =
    node.kind === "class" ? (
      <ClassGlyph />
    ) : node.kind === "function" ? (
      <FunctionGlyph method={isMethod(model, node)} />
    ) : node.kind === "file" ? (
      <LanguageGlyph
        language={node.id.endsWith(".py") ? "py" : node.id.endsWith(".ts") ? "ts" : "file"}
      />
    ) : (
      <ModuleGlyph />
    );
  return (
    <span className="gv-insp-glyph" data-kind={node.kind}>
      {glyph}
    </span>
  );
}

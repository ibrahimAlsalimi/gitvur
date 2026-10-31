/** Captures the Flows canvas (header, diagram, legend) as PNG or SVG, at 2× scale. */
import { toPng, toSvg } from "html-to-image";

/** Base64 payload of a data URL, whether it is base64- or percent-encoded (UTF-8 safe). */
export function dataUrlToBase64(url: string): string {
  const comma = url.indexOf(",");
  if (comma < 0) return "";
  const meta = url.slice(0, comma);
  const body = url.slice(comma + 1);
  if (meta.endsWith(";base64")) return body;
  const bytes = new TextEncoder().encode(decodeURIComponent(body));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * html-to-image copies computed styles onto HTML elements but clones SVG subtrees as they
 * are, so class-based strokes, fills, markers and the HTML inside `foreignObject` would be
 * lost. This writes each SVG descendant's computed style inline; the returned function
 * restores the original `style` attributes.
 */
export function inlineSvgStyles(root: HTMLElement): () => void {
  const saved: [Element, string | null][] = [];
  for (const svg of root.querySelectorAll("svg")) {
    for (const el of [svg, ...svg.querySelectorAll("*")]) {
      const cs = getComputedStyle(el);
      let text = "";
      for (const property of cs) text += `${property}:${cs.getPropertyValue(property)};`;
      saved.push([el, el.getAttribute("style")]);
      el.setAttribute("style", text);
    }
  }
  return () => {
    for (const [el, style] of saved) {
      if (style === null) el.removeAttribute("style");
      else el.setAttribute("style", style);
    }
  };
}

/**
 * Renders `element` in the current theme. Elements marked `data-export="skip"` (toolbars,
 * the playback rail) are left out.
 */
export async function captureDiagram(element: HTMLElement, kind: "png" | "svg"): Promise<string> {
  const background = getComputedStyle(element).getPropertyValue("--gv-bg-canvas").trim();
  const options = {
    pixelRatio: 2,
    ...(background ? { backgroundColor: background } : {}),
    filter: (node: Node) => !(node instanceof HTMLElement && node.dataset.export === "skip"),
  };
  const restore = inlineSvgStyles(element);
  try {
    const url = kind === "png" ? await toPng(element, options) : await toSvg(element, options);
    return dataUrlToBase64(url);
  } finally {
    restore();
  }
}

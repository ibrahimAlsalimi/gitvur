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
  const url = kind === "png" ? await toPng(element, options) : await toSvg(element, options);
  return dataUrlToBase64(url);
}

import { describe, expect, it } from "vitest";

import { dataUrlToBase64 } from "./exportImage";

describe("dataUrlToBase64", () => {
  it("passes base64 payloads through and encodes percent-encoded UTF-8 text", () => {
    expect(dataUrlToBase64("data:image/png;base64,iVBORw0K")).toBe("iVBORw0K");
    const svg = "<svg><text>⚡ saved · é</text></svg>";
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(dataUrlToBase64(url)), (c) => c.charCodeAt(0)),
    );
    expect(decoded).toBe(svg);
    expect(dataUrlToBase64("garbage")).toBe("");
  });
});

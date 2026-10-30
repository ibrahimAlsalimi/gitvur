import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "./App";

describe("App", () => {
  it("renders the frame with the empty state", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain("Open a repository to map it");
    expect(html).toContain('aria-label="Explorer"');
    expect(html).toContain('aria-label="Resize explorer"');
  });
});

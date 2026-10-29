import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "./App";

describe("App", () => {
  it("renders an empty main element", () => {
    expect(renderToStaticMarkup(<App />)).toBe('<main class="app"></main>');
  });
});

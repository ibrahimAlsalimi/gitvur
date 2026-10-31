import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";

async function open(
  page: import("@playwright/test").Page,
  state = "architecture",
  fixture = "py-flows",
) {
  await page.goto(`/?fixture=${fixture}&state=${state}`);
  await expect(page.getByRole("tab", { name: "Diagram", exact: true })).toBeEnabled();
  await page.keyboard.press("Control+4");
  await expect(page.getByRole("group", { name: "Diagram view" })).toBeVisible();
}

test("missing architecture has an honest empty state and explicit raw structure", async ({
  page,
}) => {
  await open(page, "structure-only");
  await expect(page.getByRole("button", { name: "Architecture", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByText("Architecture has not been generated yet", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".gv-architecture-card")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy Mermaid" })).toBeDisabled();
  await page.getByRole("button", { name: "Explore raw structure" }).click();
  await expect(page.locator(".gv-architecture-card")).toHaveCount(4);
  await expect(page.locator(".gv-architecture-eyebrow")).toContainText("Structure-derived");
  await page.locator(".gv-architecture-card").filter({ hasText: "flowapp/service" }).click();
  const inspector = page.getByRole("region", { name: "Architecture context" });
  await expect(inspector).toContainText("flowapp/service/orders.py");
  await page.getByRole("searchbox", { name: "Filter components" }).fill("missing-component");
  await expect(page.locator(".gv-architecture-empty")).toContainText("No matching components");
  await page.getByRole("searchbox", { name: "Filter components" }).fill("");
  await page.locator(".gv-architecture-card").filter({ hasText: "flowapp/service" }).click();
  await inspector.getByRole("button", { name: /orders.py · Map/ }).click();
  await expect(page.getByRole("tab", { name: "Map", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("architecture map is authored, explains interactions and exports without raw dependencies", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);
  await expect(page.locator(".gv-architecture-eyebrow")).toContainText("Architecture map");
  await expect(page.locator(".gv-architecture-card")).toHaveCount(5);
  await expect(page.locator(".gv-architecture-card[data-kind=directory]")).toHaveCount(0);
  await expect(
    page.locator(".gv-architecture-edge-label").filter({ hasText: /^Imports/ }),
  ).toHaveCount(0);
  await expect(
    page.locator(".gv-architecture-edge-label").filter({ hasText: "unresolved" }),
  ).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: `e2e/__screenshots__/${test.info().project.name}/diagram-architecture-map.png`,
  });
  await page.locator(".gv-architecture-card").filter({ hasText: "Order service" }).click();
  const inspector = page.getByRole("region", { name: "Architecture context" });
  await expect(inspector).toContainText("Coordinates order normalization");
  await expect(inspector).toContainText("Related flows");
  await inspector.locator("summary").first().click();
  await expect(page.locator("#panel-diagram .gv-code-line").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: `e2e/__screenshots__/${test.info().project.name}/diagram-architecture-inspector.png`,
  });
  await page.getByRole("button", { name: "Copy Mermaid", exact: true }).click();
  const mermaid = await page.evaluate(() => navigator.clipboard.readText());
  expect(mermaid).toContain("flowchart LR");
  expect(mermaid).toContain("Submits orders");
  expect(mermaid).toContain("unresolved");
  expect(mermaid).toContain("Coordinates order normalization");
  expect(mermaid).not.toContain("arch:dir:");
  for (const kind of ["SVG", "PNG"]) {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: `Export ${kind}`, exact: true }).click();
    const file = await download;
    const path = await file.path();
    expect(path).not.toBeNull();
    const bytes = await readFile(path);
    if (kind === "PNG") expect(bytes.subarray(1, 4).toString()).toBe("PNG");
    else {
      expect(bytes.toString()).toContain("<svg");
      expect(bytes.toString()).toContain("Order service");
    }
  }
  const relationship = page.getByRole("group", {
    name: "Relationship: Invokes saved-item callback",
    exact: true,
  });
  await relationship.focus();
  await relationship.press("Enter");
  await expect(inspector).toContainText("Order service → Saved-item callback");
  await expect(inspector).toContainText("unresolved interaction");
  const axe = await new AxeBuilder({ page }).include("#panel-diagram").analyze();
  expect(axe.violations).toEqual([]);
  await page.getByRole("button", { name: "Raw structure", exact: true }).click();
  await expect(page.locator(".gv-architecture-eyebrow")).toContainText("Structure-derived");
});

test("stale maps disclose review and invalid artifacts do not silently fall back", async ({
  page,
}) => {
  await open(page, "architecture-stale");
  await expect(page.locator(".gv-architecture-card")).toHaveCount(5);
  await expect(
    page.locator(".gv-architecture-card").filter({ hasText: "Order service" }),
  ).toContainText("Needs review");
  await expect(
    page.locator(".gv-architecture-findings").filter({ hasText: "Architecture needs review" }),
  ).toContainText("Architecture needs review");
  await open(page, "architecture-invalid");
  await expect(page.getByRole("heading", { name: "Architecture needs repair" })).toBeVisible();
  await expect(page.locator(".gv-architecture-card")).toHaveCount(0);
  await page.getByRole("button", { name: "Raw structure", exact: true }).click();
  await expect(page.locator(".gv-architecture-card")).toHaveCount(4);
});

test("subsystems are visible containers and remain grouped in Mermaid", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page, "architecture-nested");
  await expect(page.locator(".gv-architecture-card")).toHaveCount(5);
  await expect(page.locator(".gv-architecture-group")).toHaveCount(1);
  await expect(
    page.locator(".gv-architecture-card").filter({ hasText: "Order service" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Copy Mermaid", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("subgraph");
  await page.screenshot({
    path: `e2e/__screenshots__/${test.info().project.name}/diagram-subsystem.png`,
  });
});

test("documented Go fixture opens a concise system map", async ({ page }) => {
  await open(page, "documented", "go-small");
  await expect(page.locator(".gv-architecture-card")).toHaveCount(3);
  await expect(page.locator(".gv-architecture-header")).toContainText("no-op store");
  await expect(page.locator(".gv-architecture-card[data-kind=directory]")).toHaveCount(0);
  await page.screenshot({
    path: `e2e/__screenshots__/${test.info().project.name}/diagram-go-small.png`,
  });
});

test("legacy authored components remain readable without invented directory nodes", async ({
  page,
}) => {
  await open(page, "architecture-legacy");
  await expect(page.locator(".gv-architecture-eyebrow")).toContainText("Legacy architecture");
  await expect(page.locator(".gv-architecture-card")).toHaveCount(2);
  await expect(page.locator(".gv-architecture-card[data-kind=directory]")).toHaveCount(0);
});

test("an authored empty map preserves its explanation without fabricating components", async ({
  page,
}) => {
  await open(page, "architecture-empty");
  await expect(page.locator(".gv-architecture-header")).toContainText(
    "No meaningful source-backed architecture components were identified.",
  );
  await expect(page.locator(".gv-architecture-card")).toHaveCount(0);
  await expect(
    page.getByText("No architecture components were documented for this repository.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Architecture has not been generated yet" }),
  ).toHaveCount(0);
});

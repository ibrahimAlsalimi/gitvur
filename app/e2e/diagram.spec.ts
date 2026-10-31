import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";

async function open(page: import("@playwright/test").Page, state = "structure-only") {
  await page.goto(`/?fixture=py-flows&state=${state}`);
  await expect(page.getByRole("tab", { name: "Diagram", exact: true })).toBeEnabled();
  await page.keyboard.press("Control+4");
  await expect(page.locator(".gv-architecture-card").first()).toBeVisible();
}

test("structural diagram selection, filtering, navigation and themes", async ({ page }) => {
  await open(page);
  await expect(page.locator(".gv-architecture-eyebrow")).toContainText("Structure-derived");
  await expect(page.locator(".gv-architecture-card")).toHaveCount(4);
  await page.locator(".gv-architecture-card").filter({ hasText: "flowapp/service" }).click();
  const inspector = page.getByRole("region", { name: "Architecture context" });
  await expect(inspector).toContainText("flowapp/service/orders.py");
  await page.getByRole("searchbox", { name: "Filter components" }).fill("missing-component");
  await expect(page.locator(".gv-architecture-empty")).toContainText("No matching components");
  await page.getByRole("searchbox", { name: "Filter components" }).fill("");
  await expect(page.locator(".gv-architecture-card")).toHaveCount(4);
  await page.locator(".gv-architecture-card").filter({ hasText: "flowapp/service" }).click();
  await inspector.getByRole("button", { name: /orders.py · Map/ }).click();
  await expect(page.getByRole("tab", { name: "Map", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Control+4");
  await expect(page.locator(".gv-architecture-card")).toHaveCount(4);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: `e2e/__screenshots__/${test.info().project.name}/diagram-structure.png`,
  });
  const axe = await new AxeBuilder({ page }).include("#panel-diagram").analyze();
  expect(axe.violations).toEqual([]);
});

test("AI enrichment, evidence, stale fallback and exports", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page, "architecture");
  await expect(page.locator(".gv-architecture-eyebrow")).toContainText("AI-enriched");
  await page.locator(".gv-architecture-card").filter({ hasText: "Order service" }).click();
  await expect(page.getByRole("region", { name: "Architecture context" })).toContainText(
    "Validates orders",
  );
  await page
    .getByRole("region", { name: "Architecture context" })
    .locator("summary")
    .first()
    .click();
  await expect(page.locator("#panel-diagram .gv-code-line").first()).toBeVisible();
  await page.screenshot({
    path: `e2e/__screenshots__/${test.info().project.name}/diagram-enriched.png`,
  });
  await page.getByRole("button", { name: "Copy Mermaid", exact: true }).click();
  const mermaid = await page.evaluate(() => navigator.clipboard.readText());
  expect(mermaid).toContain("flowchart LR");
  expect(mermaid).toContain("Submits orders");
  for (const kind of ["SVG", "PNG"]) {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: `Export ${kind}`, exact: true }).click();
    const file = await download;
    const path = await file.path();
    expect(path).not.toBeNull();
    const bytes = await readFile(path);
    if (kind === "PNG") expect(bytes.subarray(1, 4).toString()).toBe("PNG");
    else expect(bytes.toString()).toContain("<svg");
  }
  await page.getByRole("checkbox", { name: "Structure only" }).check();
  await expect(page.locator(".gv-architecture-eyebrow")).toContainText("Structure-derived");
  await open(page, "architecture-stale");
  await expect(
    page.locator(".gv-architecture-card").filter({ hasText: "Order service" }),
  ).toHaveCount(0);
});

test("nested components disclose progressively and export Mermaid groups", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page, "architecture-nested");
  await expect(
    page.locator(".gv-architecture-card").filter({ hasText: "Order service" }),
  ).toHaveCount(0);
  await page.locator(".gv-architecture-card").filter({ hasText: "Entry points" }).click();
  await page.getByRole("button", { name: "Explore components", exact: true }).click();
  await expect(page.locator(".gv-architecture-card")).toHaveCount(1);
  await expect(page.locator(".gv-architecture-card")).toContainText("Order service");
  await page.getByRole("button", { name: "Up one level" }).click();
  await expect(
    page.locator(".gv-architecture-card").filter({ hasText: "Entry points" }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Copy Mermaid", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("subgraph");
});

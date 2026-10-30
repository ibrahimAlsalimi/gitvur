import { type Page, expect, test } from "@playwright/test";

/* Phase 08: relationships on the canvas, the inspector, evidence and navigation. */

async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({
    path: `e2e/__screenshots__/${test.info().project.name}/${name}.png`,
    animations: "disabled",
  });
}

async function openMap(page: Page, query: string) {
  await page.goto(`/?${query}`);
  await page.locator(".react-flow__node-module").first().waitFor();
  await page.waitForFunction(() => (window.__gitvurPerf?.().layouts ?? 0) > 0);
  await page.waitForTimeout(300);
}

async function afterLayout(page: Page, action: () => Promise<void>) {
  const before = (await page.evaluate(() => window.__gitvurPerf?.().layouts)) ?? 0;
  await action();
  await page.waitForFunction((n) => (window.__gitvurPerf?.().layouts ?? 0) > n, before);
  await page.waitForTimeout(250);
}

async function focus(page: Page, ids: string[], z?: number) {
  await page.evaluate(([i, z2]) => window.__gitvurMap?.focusNodes(i, z2), [ids, z] as const);
  await page.waitForTimeout(150);
}

const path = (file: string) => (file === "app.py" ? file : `shop/${file}`);

/** Expands `file` on the map and clicks the row named `name`. */
async function selectRow(page: Page, file: string, name: string) {
  await afterLayout(page, () =>
    page.getByRole("button", { name: `Expand ${file}`, exact: true }).click(),
  );
  // Rows render only at full detail.
  await focus(page, [`file:${path(file)}`], 1);
  await page
    .locator(".react-flow__node-row")
    .filter({ has: page.locator(".gv-row-name", { hasText: new RegExp(`^${name}$`) }) })
    .click();
}

const inspector = (page: Page) => page.getByRole("complementary", { name: "Inspector" });
const section = (page: Page, name: string) =>
  inspector(page).getByRole("region", { name, exact: true });

test.describe("inspector screenshots", () => {
  test("1 & 2 · function with 1-hop and 2-hop edges", async ({ page }) => {
    await openMap(page, "fixture=py-small");
    await afterLayout(page, () =>
      page.getByRole("button", { name: "Expand orders.py", exact: true }).click(),
    );
    await selectRow(page, "app.py", "main");
    await focus(page, ["module:entry-point", "module:catalogue", "module:orders"]);
    await expect(page.locator(".react-flow__edge .gv-edge")).not.toHaveCount(0);
    await expect(page.locator(".react-flow__node.gv-dimmed").first()).toBeAttached();
    await expect(inspector(page).getByRole("heading", { name: "main" })).toBeVisible();
    await expect(section(page, "Calls")).toContainText("OrderService");
    await expect(section(page, "Source")).toContainText("def main");
    await shot(page, "insp-01-one-hop");

    const oneHop = await page.locator(".react-flow__edge .gv-edge").count();
    await page.getByRole("button", { name: "2-hop" }).click();
    // Second-hop lines here join rows inside orders.py, so stay at full detail.
    await focus(page, ["file:app.py", "file:shop/orders.py"], 0.9);
    await expect(page.locator(".react-flow__edge .gv-edge[data-hop='2']").first()).toBeAttached();
    expect(await page.locator(".react-flow__edge .gv-edge").count()).toBeGreaterThan(oneHop);
    await shot(page, "insp-02-two-hop");
  });

  test("3 · edges aggregated onto a collapsed file", async ({ page }) => {
    await openMap(page, "fixture=py-small");
    await selectRow(page, "orders.py", "receipt");
    await focus(page, ["module:orders", "module:support"]);
    await expect(page.locator(".gv-count", { hasText: "2 calls" })).toBeVisible();
    await page.locator(".gv-count", { hasText: "2 calls" }).hover();
    await expect(page.locator(".gv-count-pairs").first()).toContainText("slugify");
    await shot(page, "insp-03-aggregated");
  });

  test("4 · AI edge in evidence mode", async ({ page }) => {
    await openMap(page, "fixture=py-small");
    await selectRow(page, "app.py", "main");
    await focus(page, ["module:entry-point", "module:orders"]);
    await section(page, "Calls")
      .getByRole("button", { name: "Show evidence at app.py:13" })
      .click();
    await expect(inspector(page)).toContainText("Evidence for: main → place (calls, AI)");
    await expect(inspector(page)).toContainText("service is the OrderService");
    await expect(inspector(page).locator(".gv-code-line[data-highlight='true']")).toContainText(
      "service.place",
    );
    await shot(page, "insp-04-ai-evidence");
    await inspector(page).getByRole("button", { name: "← Back" }).click();
    await expect(section(page, "Source")).toBeVisible();
  });

  test("5 · ambiguous candidates expanded", async ({ page }) => {
    await openMap(page, "fixture=py-small");
    await selectRow(page, "orders.py", "remember");
    await focus(page, ["module:storage"], 1);
    await afterLayout(page, () =>
      page.getByRole("button", { name: "Expand store.py", exact: true }).click(),
    );
    await afterLayout(page, () =>
      page.getByRole("button", { name: "Expand cache.py", exact: true }).click(),
    );
    const toggle = inspector(page).getByRole("button", { name: /Possible targets for save/ });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".react-flow__edge .gv-edge[data-prov='candidate']")).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".react-flow__edge .gv-edge[data-prov='candidate']")).toHaveCount(2);
    await toggle.scrollIntoViewIfNeeded();
    await focus(page, ["module:orders", "module:storage"]);
    await shot(page, "insp-05-ambiguous");
  });

  test("6 · missing source", async ({ page }) => {
    await openMap(page, "fixture=py-small&missing=shop/utils.py");
    await selectRow(page, "utils.py", "format_price");
    const warning = inspector(page).getByRole("alert");
    await expect(warning).toContainText(
      "Source not found at shop/utils.py:6–11 — the repository may have changed since it was indexed.",
    );
    await expect(warning.getByRole("button", { name: "Re-index" })).toBeVisible();
    await focus(page, ["module:support"], 1);
    await shot(page, "insp-06-missing-source");
  });
});

test.describe("inspector behaviour", () => {
  test("module and file variants; empty description", async ({ page }) => {
    await page.goto("/?fixture=py-small");
    await page.getByRole("treeitem", { name: /^Storage/ }).click();
    await expect(section(page, "Files")).toContainText("cache.py");
    await expect(section(page, "Contents")).toContainText("% documented");
    await expect(section(page, "Source")).toHaveCount(0);

    await section(page, "Files")
      .getByRole("button", { name: /store\.py/ })
      .click();
    await expect(page.getByRole("treeitem", { name: /store\.py/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(section(page, "Outline")).toContainText("encode");
    await expect(section(page, "Imported by")).toContainText("orders.py");

    await page.goto("/?fixture=py-small&state=structure-only");
    await page.getByRole("treeitem", { name: /^app\.py/ }).click();
    await expect(inspector(page)).toContainText("No description yet");
    await expect(inspector(page)).toContainText("Run the documentation agent to add one.");
  });

  test("relationship links, breadcrumb and history keep everything in sync", async ({ page }) => {
    await openMap(page, "fixture=py-small");
    await selectRow(page, "app.py", "main");
    await section(page, "Calls")
      .getByRole("button", { name: /^OrderService/ })
      .click();
    await expect(inspector(page).getByRole("heading", { name: "OrderService" })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: /^OrderService/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator(".gv-row[data-selected='true']")).toContainText("OrderService");

    await inspector(page)
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("button", { name: "orders.py" })
      .click();
    await expect(inspector(page).getByRole("heading", { name: "orders.py" })).toBeVisible();

    await page.keyboard.press("Alt+ArrowLeft");
    await expect(inspector(page).getByRole("heading", { name: "OrderService" })).toBeVisible();
    await inspector(page).getByRole("button", { name: "Back (Alt+←)" }).click();
    await expect(inspector(page).getByRole("heading", { name: "main" })).toBeVisible();
    await expect(inspector(page).getByRole("button", { name: "Back (Alt+←)" })).toBeDisabled();
    await page.keyboard.press("Alt+ArrowRight");
    await expect(inspector(page).getByRole("heading", { name: "OrderService" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(inspector(page)).toContainText("Select an element");
    await expect(page.locator(".react-flow__node.gv-dimmed")).toHaveCount(0);
  });
});

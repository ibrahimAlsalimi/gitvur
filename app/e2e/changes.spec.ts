import { type Page, expect, test } from "@playwright/test";

/* Phase 10: the Changes lens, built from mockDiff.json (a real Git scenario). */

async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({
    path: `e2e/__screenshots__/${test.info().project.name}/${name}.png`,
    animations: "disabled",
  });
}

async function layouts(page: Page) {
  return (await page.evaluate(() => window.__gitvurPerf?.().layouts)) ?? 0;
}

async function focus(page: Page, ids: string[], z?: number) {
  await page.evaluate(([i, z2]) => window.__gitvurMap?.focusNodes(i, z2), [ids, z] as const);
  await page.waitForTimeout(200);
}

/** Opens py-small and switches to the Changes lens, waiting for the union layout. */
async function openChanges(page: Page) {
  await page.goto("/?fixture=py-small");
  await page.locator(".react-flow__node-module").first().waitFor();
  await page.waitForFunction(() => (window.__gitvurPerf?.().layouts ?? 0) > 0);
  const before = await layouts(page);
  await page.getByRole("combobox", { name: "Lens" }).selectOption("changes");
  await expect(page.getByLabel("Change summary")).toBeVisible();
  await page.waitForFunction((n) => (window.__gitvurPerf?.().layouts ?? 0) > n, before);
  await page.waitForTimeout(300);
}

const panel = (page: Page) => page.getByRole("navigation", { name: "Changes" });
const inspector = (page: Page) => page.getByRole("complementary", { name: "Inspector" });
const row = (page: Page, name: string) =>
  panel(page)
    .locator(".changes-row")
    .filter({ has: page.locator(".changes-row-name", { hasText: new RegExp(`^${name}$`) }) });

test.describe("changes screenshots", () => {
  test("1 · Changes lens default view", async ({ page }) => {
    await openChanges(page);
    await expect(page.getByLabel("Change summary")).toContainText("+2 added");
    await expect(page.getByLabel("Change summary")).toContainText("~2 modified");
    await expect(page.getByLabel("Change summary")).toContainText("−1 removed");
    await expect(page.getByLabel("Change summary")).toContainText("→2 moved");
    await expect(page.getByRole("group", { name: "Revisions to compare" })).toBeVisible();
    // Module chips count changes without opening the module.
    await expect(
      page.locator(".react-flow__node-module", { hasText: "Support" }).locator(".gv-chip-change"),
    ).toHaveText("+1 −1 →2");
    await expect(page.locator(".gv-module[data-change='unchanged']").first()).toBeAttached();
    await focus(page, ["module:support", "module:orders"], 0.85);
    await shot(page, "changes-01-default");
  });

  test("2 & 3 · modified function: inline and side-by-side source diff", async ({ page }) => {
    await openChanges(page);
    await row(page, "receipt").click();
    const changes = inspector(page).getByRole("region", { name: "Changes", exact: true });
    await expect(changes).toContainText("Modified");
    const diff = changes.getByRole("region", { name: "Source diff" });
    await expect(diff.locator("[data-kind='add']").first()).toContainText("shop.utils.slugify");
    await expect(diff.locator("[data-kind='del']").first()).toContainText("item.name.lower()");
    // The new call to slugify is drawn as an added edge.
    await expect(
      page.locator(".react-flow__edge .gv-edge[data-change='added']").first(),
    ).toBeAttached();
    await focus(page, ["module:orders", "module:support"], 0.85);
    await shot(page, "changes-02-inline-diff");

    await changes.getByRole("button", { name: "Side by side" }).click();
    await expect(changes.locator(".gv-diff-split")).toBeVisible();
    await shot(page, "changes-03-side-by-side");
  });

  test("4 · removed ghost next to added nodes in the same file", async ({ page }) => {
    await openChanges(page);
    await row(page, "cents").click();
    await expect(
      inspector(page).getByRole("region", { name: "Changes", exact: true }),
    ).toContainText("Removed in");
    await expect(inspector(page).locator(".gv-code-text").first()).toBeVisible();
    await expect(inspector(page)).toContainText("return int(round(value * 100))");
    await page.keyboard.press("Escape");
    await focus(page, ["file:shop/utils.py"], 1.1);
    const ghost = page.locator(".gv-row[data-change='removed']");
    await expect(ghost).toContainText("cents");
    await expect(
      page.locator(".gv-row[data-change='added']", { hasText: "slugify" }),
    ).toBeVisible();
    await expect(page.locator(".gv-row[data-change='moved']").first()).toBeVisible();
    await shot(page, "changes-04-removed-and-added");
  });

  test("5 · Changes panel with stepping", async ({ page }) => {
    await openChanges(page);
    await page.keyboard.press("n");
    await expect(row(page, "label")).toHaveAttribute("aria-current", "true");
    await page.keyboard.press("n");
    await page.keyboard.press("n");
    await expect(row(page, "receipt")).toHaveAttribute("aria-current", "true");
    await expect(inspector(page).getByRole("heading", { name: "receipt" })).toBeVisible();
    await page.keyboard.press("Shift+N");
    await expect(row(page, "describe")).toHaveAttribute("aria-current", "true");
    await page.keyboard.press("n");
    await page.keyboard.press("n");
    await page.waitForTimeout(250);
    await shot(page, "changes-05-stepping");
    // Wraps around at both ends.
    for (let i = 0; i < 4; i += 1) await page.keyboard.press("n");
    await expect(row(page, "label")).toHaveAttribute("aria-current", "true");
    await page.keyboard.press("Shift+N");
    await expect(row(page, "slugify")).toHaveAttribute("aria-current", "true");
  });
});

test.describe("changes behaviour", () => {
  test("moved elements show both locations; leaving the lens restores the map", async ({
    page,
  }) => {
    await openChanges(page);
    await row(page, "format_price").click();
    const changes = inspector(page).getByRole("region", { name: "Changes", exact: true });
    await expect(changes).toContainText("Moved");
    await expect(changes).toContainText("shop/models.py:");
    await expect(changes).toContainText("shop/utils.py:6–11");

    await page.getByRole("combobox", { name: "Lens" }).selectOption("structure");
    await expect(page.getByRole("navigation", { name: "Explorer" })).toBeVisible();
    await expect(page.locator(".gv-chip-change")).toHaveCount(0);
    await expect(page.getByRole("treeitem", { name: /^format_price/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("treeitem", { name: /^cents/ })).toHaveCount(0);
  });
});

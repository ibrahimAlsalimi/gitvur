import { type Page, expect, test } from "@playwright/test";

/* Phase 09: status marks, Documentation lens, inspector trust, issues panel, banners. */

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

const expand = (page: Page, file: string) =>
  afterLayout(page, () =>
    page.getByRole("button", { name: `Expand ${file}`, exact: true }).click(),
  );

const inspector = (page: Page) => page.getByRole("complementary", { name: "Inspector" });
const treeitem = (page: Page, name: RegExp) => page.getByRole("treeitem", { name });

/** Selects an element through the explorer (which reveals and expands its ancestors). */
async function selectInTree(page: Page, path: RegExp[]) {
  for (const [i, name] of path.entries()) {
    const item = treeitem(page, name).first();
    if (i < path.length - 1) {
      if ((await item.getAttribute("aria-expanded")) === "false") {
        await item.locator(".tree-twisty").click();
      }
    } else {
      await item.click();
    }
  }
}

test.describe("trust screenshots", () => {
  test("1 · Structure lens with stale marks", async ({ page }) => {
    await openMap(page, "fixture=py-small&state=trust");
    await expand(page, "orders.py");
    await expand(page, "utils.py");
    await focus(page, ["module:orders", "module:support", "module:storage"], 0.9);
    await expect(page.locator(".gv-status-slot[data-mark='self']").first()).toBeAttached();
    await expect(page.locator(".gv-status-slot[data-mark='child']").first()).toBeAttached();
    await expect(page.locator(".gv-status-slot[data-mark='error']").first()).toBeAttached();
    await expect(page.locator(".gv-chip-error").first()).toBeVisible();
    await expect(page.locator(".gv-summary")).toHaveCount(0);
    await shot(page, "trust-01-structure-marks");
  });

  test("2 · Documentation lens with summary card; filtering the explorer", async ({ page }) => {
    await openMap(page, "fixture=py-small&state=trust");
    await expand(page, "utils.py");
    await expand(page, "models.py");
    await page.getByRole("combobox", { name: "Lens" }).selectOption("coverage");
    const card = page.getByRole("region", { name: "Documentation summary" });
    await expect(card).toContainText("29 documented");
    await expect(card).toContainText("5 stale");
    await expect(card).toContainText("5 undocumented");
    await expect(card).toContainText("7 errors");
    await focus(page, ["module:support", "module:catalogue"], 0.85);
    await expect(page.locator(".gv-module-pct").first()).toBeVisible();
    await shot(page, "trust-02-documentation-lens");

    await card.getByRole("button", { name: /Show 5 undocumented/ }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Showing 5 undocumented" }),
    ).toBeVisible();
    await expect(page.getByRole("treeitem")).toHaveCount(13);
    await expect(treeitem(page, /^label/)).toBeVisible();
    await page.getByRole("button", { name: "Show all" }).click();
    await expect(treeitem(page, /^label/)).toHaveCount(0);

    // The lens is remembered for this repository.
    await page.reload();
    await page.locator(".react-flow__node-module").first().waitFor();
    await expect(page.getByRole("combobox", { name: "Lens" })).toHaveValue("coverage");
  });

  test("3 · inspector in each status case", async ({ page }) => {
    await page.goto("/?fixture=py-small&state=trust");
    const cases = [
      {
        name: "documented",
        path: [/^Orders/, /^orders\.py/, /^OrderService/, /^place/],
        text: "Description matches the current code.",
      },
      {
        name: "stale-self",
        path: [/^Orders/, /^orders\.py/, /^OrderService/, /^receipt/],
        text: "This code changed after the description was written. Treat the description as possibly outdated.",
      },
      {
        name: "stale-child",
        path: [/^Orders/, /^orders\.py/, /^OrderService/],
        text: "Something inside this element changed; its own code did not.",
      },
      {
        name: "undocumented",
        path: [/^Catalogue/, /^models\.py/, /^Toy/, /^label/],
        text: "No description yet.",
      },
    ];
    for (const c of cases) {
      await selectInTree(page, c.path);
      await expect(inspector(page).locator(".gv-insp-trust")).toHaveText(c.text);
      await shot(page, `trust-03-inspector-${c.name}`);
    }
    // Stale descriptions stay visible, labelled; undocumented has no provenance line.
    await selectInTree(page, [/^Orders/, /^orders\.py/, /^OrderService/, /^receipt/]);
    await expect(inspector(page).locator(".gv-insp-outdated")).toHaveText("possibly outdated");
    await expect(inspector(page)).toContainText("Builds a receipt line");
    await expect(inspector(page)).toContainText("AI-written · based on version");
    // Issues for the element, with code and message.
    await selectInTree(page, [/^Orders/, /^orders\.py/, /^OrderService/, /^remember/]);
    const issues = inspector(page).getByRole("region", { name: "Validation issues" });
    await expect(issues).toContainText("ai-edge-evidence-out-of-range");
    await expect(issues).toContainText("ai-edge-evidence-mismatch");
    // AI edges show their note and a link to the evidence.
    await expect(inspector(page)).toContainText("backend is self.cache when the price is under 10");
    await inspector(page)
      .getByRole("button", { name: "Evidence at shop/orders.py:21" })
      .first()
      .click();
    await expect(inspector(page)).toContainText("Evidence for: remember → save");
  });

  test("4 · issues panel", async ({ page }) => {
    await openMap(page, "fixture=py-small&state=trust");
    const panel = page.getByRole("region", { name: "Issues panel" });
    await expect(panel).toHaveCount(0);
    await page.keyboard.press("Control+Shift+M");
    await expect(panel).toBeVisible();
    const headers = panel.locator(".issues-group-header");
    await expect(headers).toHaveCount(12);
    await expect(headers.first()).toContainText("ai-edge-bad-provenance");
    await expect(headers.nth(7)).toContainText("ai-edge-duplicates-static");
    await shot(page, "trust-04-issues-panel");

    await headers.first().click();
    await expect(headers.first()).toHaveAttribute("aria-expanded", "false");
    await headers.first().click();
    await panel.getByRole("button", { name: /provenance `syntactic`/ }).click();
    await expect(inspector(page).getByRole("heading", { name: "create" })).toBeVisible();
    await expect(treeitem(page, /^create/)).toHaveAttribute("aria-selected", "true");

    await page.getByRole("button", { name: "Close issues panel" }).click();
    await expect(panel).toHaveCount(0);
    await page
      .getByRole("button", { name: /7 errors/ })
      .last()
      .click();
    await expect(panel).toBeVisible();
  });

  test("4b · issues panel empty state", async ({ page }) => {
    await openMap(page, "fixture=py-small");
    await page.keyboard.press("Control+Shift+M");
    await expect(page.getByRole("region", { name: "Issues panel" })).toContainText(
      "No validation issues.",
    );
  });

  test("5 · banners", async ({ page }) => {
    const banner = (text: string) => page.getByRole("status").filter({ hasText: text });

    await openMap(page, "fixture=py-small&state=structure-only");
    await expect(banner("Not validated yet.")).toBeVisible();
    await expect(
      banner("Not validated yet.").getByRole("button", { name: "Validate", exact: true }),
    ).toBeVisible();
    await shot(page, "trust-05a-banner-not-validated");

    await openMap(page, "fixture=py-small&state=trust");
    const outOfDate = banner("The code changed since this map was generated.");
    await expect(outOfDate.getByRole("button", { name: "Re-index" })).toBeVisible();
    await shot(page, "trust-05b-banner-structure-out-of-date");
    await outOfDate.getByRole("button", { name: /^Dismiss/ }).click();
    await expect(outOfDate).toHaveCount(0);

    await openMap(page, "fixture=py-small&state=report-stale");
    await expect(banner("Validation results are older than the map.")).toBeVisible();
    await shot(page, "trust-05c-banner-report-stale");

    await openMap(page, "fixture=py-small");
    await expect(page.locator(".banner")).toHaveCount(0);
    await expect(page.getByLabel("Documentation status")).toHaveText(
      /39 documented\s*0 stale\s*0 undocumented/,
    );
  });
});

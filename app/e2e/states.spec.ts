import { type Page, expect, test } from "@playwright/test";

/** Saves `e2e/__screenshots__/<project>/<name>.png` once fonts are loaded. */
async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: `e2e/__screenshots__/${test.info().project.name}/${name}.png`,
    animations: "disabled",
  });
}

test.describe("states", () => {
  test("no repository open", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Open a repository to map it" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open repository" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Index" })).toBeDisabled();
    await shot(page, "01-no-repository");
  });

  test("folder has no .gitvur", async ({ page }) => {
    await page.goto("/?fixture=py-small&state=no-gitvur");
    await expect(
      page.getByRole("heading", { name: "This repository hasn't been indexed yet" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Index now" })).toBeVisible();
    await shot(page, "02-no-gitvur");
  });

  test("structure only, no annotations", async ({ page }) => {
    await page.goto("/?fixture=py-small&state=structure-only");
    await expect(
      page.getByRole("heading", { name: "Structure loaded — no descriptions yet" }),
    ).toBeVisible();
    await expect(page.getByRole("treeitem", { name: /Unassigned files/ })).toBeVisible();
    await expect(page.getByText("0% documented")).toBeVisible();
    await shot(page, "03-structure-only");
    await page.getByRole("button", { name: "Show how to document" }).click();
    await expect(page.getByRole("dialog", { name: "How to document a repository" })).toBeVisible();
    // codeDOC.md is rendered, not shown as raw Markdown.
    await expect(page.getByRole("heading", { name: "1. Role and boundaries" })).toBeVisible();
    await expect(page.getByText("## 1. Role and boundaries")).toHaveCount(0);
    await shot(page, "03b-how-to-document");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("schema invalid", async ({ page }) => {
    await page.goto("/?fixture=py-small&state=schema-invalid");
    await expect(
      page.getByRole("heading", { name: ".gitvur/ files don't match the expected format" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Re-index" })).toBeVisible();
    await shot(page, "04-schema-invalid");
  });

  test("indexing", async ({ page }) => {
    await page.goto("/?fixture=py-small&state=indexing");
    await expect(page.getByRole("treeitem", { name: /Catalogue/ })).toBeVisible();
    await page.getByRole("button", { name: "Index", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Indexing…" })).toBeVisible();
    await expect(page.getByText("7 files in the last index.")).toBeVisible();
    await shot(page, "05-indexing");
  });
});

test.describe("loaded repository", () => {
  test("py-small: explorer tree, counts, selection", async ({ page }) => {
    await page.goto("/?fixture=py-small");
    const tree = page.getByRole("tree", { name: "Repository explorer" });
    await expect(tree.getByRole("treeitem")).toHaveCount(12);
    await expect(page.getByText("py-small", { exact: true })).toBeVisible();
    await expect(page.locator(".topbar .chip")).toContainText(/[0-9a-f]{7}|uncommitted/);
    for (const text of ["7 files", "40 nodes", "21 edges", "100% documented"]) {
      await expect(page.locator(".statusbar")).toContainText(text);
    }
    await tree.getByRole("treeitem", { name: /orders\.py/ }).click();
    await expect(page.getByRole("complementary", { name: "Inspector" })).toContainText(
      "Order handling: places orders",
    );
    await shot(page, "06-py-small-loaded");
  });

  test("ts-small loads", async ({ page }) => {
    await page.goto("/?fixture=ts-small");
    await expect(page.getByRole("treeitem", { name: /Authentication/ })).toBeVisible();
    await expect(page.locator(".statusbar")).toContainText("9 files");
    await shot(page, "07-ts-small-loaded");
  });

  test("tree keyboard navigation", async ({ page }) => {
    await page.goto("/?fixture=py-small");
    const first = page.getByRole("treeitem").first();
    await first.focus();
    await expect(first).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(first).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("ArrowRight");
    await expect(first).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("treeitem", { name: /models\.py/ })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("treeitem", { name: /^Book/ })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("treeitem", { name: /^Book/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.keyboard.press("End");
    await expect(page.getByRole("treeitem").last()).toBeFocused();
  });

  test("panes resize with the keyboard and collapse", async ({ page }) => {
    await page.goto("/?fixture=py-small");
    const handle = page.getByRole("separator", { name: "Resize explorer" });
    await expect(handle).toHaveAttribute("aria-valuenow", "280");
    await handle.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(handle).toHaveAttribute("aria-valuenow", "312");
    const box = await page.getByRole("navigation", { name: "Explorer" }).boundingBox();
    expect(Math.round(box?.width ?? 0)).toBe(312);
    await page.getByRole("button", { name: "Collapse inspector" }).click();
    await expect(page.getByRole("complementary", { name: "Inspector" })).toBeHidden();
    await page.reload();
    await expect(page.getByRole("separator", { name: "Resize explorer" })).toHaveAttribute(
      "aria-valuenow",
      "312",
    );
    await page.getByRole("button", { name: "Expand inspector" }).click();
    await expect(page.getByRole("complementary", { name: "Inspector" })).toBeVisible();
  });
});

test.describe("layout", () => {
  test("narrow tiled window keeps every pane on screen", async ({ page }) => {
    await page.setViewportSize({ width: 926, height: 476 });
    await page.goto("/?fixture=py-small");
    await expect(page.getByRole("treeitem").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Collapse inspector" })).toBeInViewport();
    const box = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      inspector:
        document.querySelector('[aria-label="Inspector"]')?.getBoundingClientRect().right ?? 0,
    }));
    expect(box.overflow).toBe(0);
    expect(box.inspector).toBeLessThanOrEqual(926);
    await shot(page, "09-narrow-926x476");
  });

  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 2560, height: 1440 },
  ]) {
    test(`no horizontal scroll at ${viewport.width}×${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/?fixture=py-small");
      await expect(page.getByRole("treeitem").first()).toBeVisible();
      const overflow = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        canvas: document.querySelector(".canvas")?.getBoundingClientRect().width ?? 0,
        frame: document.querySelector(".frame")?.getBoundingClientRect().right ?? 0,
      }));
      expect(overflow.page).toBe(0);
      expect(overflow.canvas).toBeGreaterThanOrEqual(320);
      expect(overflow.frame).toBeLessThanOrEqual(viewport.width);
      await shot(page, `08-layout-${viewport.width}x${viewport.height}`);
    });
  }
});

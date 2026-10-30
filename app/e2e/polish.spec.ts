import { SHORTCUTS } from "../src/copy";
import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";

/* Phase 11: palette, keyboard map, persistence, states, first-run guide, accessibility. */

async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({
    path: `e2e/__screenshots__/${test.info().project.name}/${name}.png`,
    animations: "disabled",
  });
}

async function openMap(page: Page, query = "fixture=py-small") {
  await page.goto(`/?${query}`);
  await page.locator(".react-flow__node-module").first().waitFor();
  await page.waitForFunction(() => (window.__gitvurPerf?.().layouts ?? 0) > 0);
  await page.waitForTimeout(300);
}

const inspector = (page: Page) => page.getByRole("complementary", { name: "Inspector" });
const palette = (page: Page) => page.getByRole("dialog", { name: "Search" });
const focusedId = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.id ?? null);

test.describe("palette", () => {
  test("search, highlight, Enter and Ctrl+Enter; commands; empty results", async ({ page }) => {
    await openMap(page);
    await page.keyboard.press("Control+k");
    await expect(palette(page)).toBeVisible();
    await page.keyboard.type("fmtpr");
    await expect(palette(page).getByRole("option").first()).toContainText("format_price");
    await expect(palette(page).locator("mark").first()).toBeVisible();
    await shot(page, "polish-01-palette");
    await page.keyboard.press("Enter");
    await expect(palette(page)).toBeHidden();
    await expect(inspector(page).getByRole("heading", { name: "format_price" })).toBeVisible();

    // Description text is searched too.
    await page.keyboard.press("Control+k");
    await page.keyboard.type("receipt line");
    const receipt = palette(page)
      .getByRole("option")
      .filter({ has: page.locator(".palette-name", { hasText: /^receipt$/ }) });
    await expect(receipt).toBeVisible();
    await receipt.hover(); // makes it the active option
    await expect(receipt).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Control+Enter");
    await expect(inspector(page).getByRole("heading", { name: "receipt" })).toBeVisible();

    await page.keyboard.press("Control+k");
    await page.keyboard.type("qqqzzz");
    await expect(palette(page)).toContainText("No matches for “qqqzzz”.");
    await page.keyboard.press("Escape");
    await expect(palette(page)).toBeHidden();

    await page.keyboard.press("Control+k");
    await palette(page).getByRole("combobox").fill(">lens documentation");
    await expect(palette(page).getByRole("option").first()).toHaveText("Lens: Documentation");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("combobox", { name: "Lens" })).toHaveValue("coverage");
  });
});

test.describe("keyboard", () => {
  test("canvas arrows, Enter, Space, Esc, lens keys, zoom keys and the sheet", async ({ page }) => {
    await openMap(page);
    await page.locator(".react-flow__node[data-id='module:orders']").focus();
    await page.keyboard.press("ArrowDown");
    expect(await focusedId(page)).toBe("file:shop/orders.py");
    await page.keyboard.press("ArrowUp");
    expect(await focusedId(page)).toBe("module:orders");
    await page.keyboard.press("ArrowRight");
    expect(await focusedId(page)).toBe("module:storage");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter"); // expand the focused file
    await expect(page.getByRole("treeitem", { name: /^orders\.py/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await page.keyboard.press(" ");
    await expect(inspector(page).getByRole("heading", { name: "orders.py" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(inspector(page)).toContainText("Select an element");

    // Enter on a class folds its rows on the map.
    await page.evaluate(() => window.__gitvurMap?.focusNodes(["file:shop/orders.py"], 1));
    await page.waitForTimeout(300);
    const rows = page.locator(".react-flow__node-row");
    const before = await rows.count();
    await page.locator(".react-flow__node[data-id='class:shop/orders.py:OrderService']").focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => rows.count()).toBeLessThan(before);

    await page.locator("body").click({ position: { x: 5, y: 300 } });
    await page.keyboard.press("2");
    await expect(page.getByRole("combobox", { name: "Lens" })).toHaveValue("coverage");
    await page.keyboard.press("1");
    await expect(page.getByRole("combobox", { name: "Lens" })).toHaveValue("structure");
    await page.keyboard.press("0");
    await expect.poll(() => page.evaluate(() => window.__gitvurMap?.getZoom())).toBeCloseTo(1, 1);
    await page.keyboard.press("-");
    await expect
      .poll(() => page.evaluate(() => window.__gitvurMap?.getZoom() ?? 1))
      .toBeLessThan(0.99);

    await page.keyboard.press("?");
    const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("row")).toHaveCount(SHORTCUTS.length + 1); // header plus the current shortcut map
    await shot(page, "polish-02-shortcuts");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  });
});

test.describe("persistence", () => {
  test("restores expansion, selection, lens and camera; Reset view clears them", async ({
    page,
  }) => {
    await openMap(page);
    await page.getByRole("button", { name: "Expand utils.py", exact: true }).click();
    await page.getByRole("treeitem", { name: /^cache\.py/ }).click();
    await page.getByRole("combobox", { name: "Lens" }).selectOption("coverage");
    await page.evaluate(() => window.__gitvurMap?.setViewport({ x: 40, y: 20, zoom: 0.7 }));
    await page.waitForTimeout(700); // debounced save

    await page.reload();
    await page.locator(".react-flow__node-module").first().waitFor();
    await expect(page.getByRole("combobox", { name: "Lens" })).toHaveValue("coverage");
    await expect(page.getByRole("treeitem", { name: /^cache\.py/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("treeitem", { name: /^utils\.py/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect
      .poll(() => page.evaluate(() => window.__gitvurMap?.getZoom() ?? 0))
      .toBeCloseTo(0.7, 2);

    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Reset view" }).click();
    await expect(page.getByRole("combobox", { name: "Lens" })).toHaveValue("structure");
    await expect(inspector(page)).toContainText("Select an element");
    await page.waitForTimeout(700);
    await page.reload();
    await page.locator(".react-flow__node-module").first().waitFor();
    await expect(page.getByRole("combobox", { name: "Lens" })).toHaveValue("structure");
    await expect(page.getByRole("treeitem", { name: /^utils\.py/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});

test.describe("states", () => {
  test("errors map to a human message with details; lost folder", async ({ page }) => {
    await page.goto("/?fixture=py-small&state=lost");
    await expect(page.getByRole("heading", { name: "Couldn't find this folder" })).toBeVisible();
    await expect(page.getByText("It may have been moved, renamed or deleted.")).toBeVisible();
    await page.getByText("Details").click();
    await expect(page.getByText("No such file or directory")).toBeVisible();
    await shot(page, "polish-03-error-details");
  });

  test("the window title follows the project", async ({ page }) => {
    await openMap(page);
    await expect(page).toHaveTitle("Gitvur — py-small");
  });
});

test.describe("first-run guide", () => {
  test("three steps, non-blocking, dismissible, remembered", async ({ page }) => {
    await page.goto("/?fixture=py-small&firstrun=1");
    const guide = page.getByRole("dialog", { name: "Explorer" });
    await expect(guide).toContainText("Every module, file, class and function in the repository.");
    // The app stays usable while the guide shows.
    await page.getByRole("treeitem", { name: /^app\.py/ }).click();
    await expect(inspector(page).getByRole("heading", { name: "app.py" })).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("dialog", { name: "Map" })).toContainText(
      "Click anything to see what it does and what it connects to.",
    );
    await shot(page, "polish-04-guide-step-2");
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("dialog", { name: "Lens" })).toContainText(
      "Switch lens to see documentation coverage or what changed.",
    );
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.locator(".guide")).toHaveCount(0);
    await page.reload();
    await page.locator(".react-flow__node-module").first().waitFor();
    await expect(page.locator(".guide")).toHaveCount(0);
  });
});

/** Visible controls under 24×24 px, outside the map (whose content scales with zoom). */
async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const selector =
      "button, select, input, a[href], [role='button'], [role='option'], [role='treeitem'], [role='separator'][tabindex], [tabindex='0']";
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      if (
        el.closest(".react-flow__viewport, .react-flow__edgelabel-renderer, [inert]") ||
        getComputedStyle(el).visibility === "hidden"
      )
        continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // A separator's pointer area is its ::after (see app.css).
      const extra = el.classList.contains("resize-handle") ? 20 : 0;
      if (r.width + extra < 24 || r.height < 24)
        out.push(`${el.tagName.toLowerCase()}.${el.className.split(" ")[0] ?? ""}`);
    }
    return [...new Set(out)].sort();
  });
}

test.describe("hit targets", () => {
  test("every control outside the map is at least 24×24 px", async ({ page }) => {
    await openMap(page, "fixture=py-small&state=trust");
    await page.getByRole("treeitem", { name: /^orders\.py/ }).click();
    await page.keyboard.press("Control+Shift+M");
    expect(await smallTargets(page)).toEqual([]);
    await page.getByRole("combobox", { name: "Lens" }).selectOption("coverage");
    expect(await smallTargets(page)).toEqual([]);
    await page.getByRole("combobox", { name: "Lens" }).selectOption("changes");
    await page.getByLabel("Change summary").waitFor();
    await page.locator(".changes-row").nth(2).click();
    expect(await smallTargets(page)).toEqual([]);
  });
});

test.describe("accessibility", () => {
  const views: [string, string, ((page: Page) => Promise<void>)?][] = [
    ["no repository", "/"],
    ["map", "/?fixture=py-small"],
    [
      "inspector with selection",
      "/?fixture=py-small",
      async (page) => {
        await page.getByRole("treeitem", { name: /^orders\.py/ }).click();
      },
    ],
    [
      "trust and issues",
      "/?fixture=py-small&state=trust",
      async (page) => {
        await page.keyboard.press("Control+Shift+M");
      },
    ],
    [
      "documentation lens",
      "/?fixture=py-small&state=trust",
      async (page) => {
        await page.getByRole("combobox", { name: "Lens" }).selectOption("coverage");
      },
    ],
    [
      "changes lens",
      "/?fixture=py-small",
      async (page) => {
        await page.getByRole("combobox", { name: "Lens" }).selectOption("changes");
        await page.getByLabel("Change summary").waitFor();
      },
    ],
    [
      "palette",
      "/?fixture=py-small",
      async (page) => {
        await page.keyboard.press("Control+k");
        await page.keyboard.type("save");
      },
    ],
  ];
  for (const [name, url, setup] of views) {
    test(`no serious or critical violations: ${name}`, async ({ page }) => {
      await page.goto(url);
      await page.waitForTimeout(600);
      if (setup) await setup(page);
      await page.waitForTimeout(300);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const bad = results.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map(
          (v) =>
            `${v.id}: ${v.nodes
              .map((n) => n.target.join(" "))
              .slice(0, 3)
              .join(" | ")}`,
        );
      expect(bad).toEqual([]);
    });
  }
});

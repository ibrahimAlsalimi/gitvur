import { type Page, expect, test } from "@playwright/test";

/*
 * Phase 07 map tests. React Flow renders only nodes inside the viewport
 * (`onlyRenderVisibleElements`), so DOM counts are taken after bringing the nodes into view.
 */

async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250); // let expand/collapse transitions settle
  await page.screenshot({
    path: `e2e/__screenshots__/${test.info().project.name}/${name}.png`,
    animations: "disabled",
  });
}

async function openMap(page: Page, fixture: string) {
  await page.goto(`/?fixture=${fixture}`);
  await page.locator(".react-flow__node-module").first().waitFor();
  await page.waitForFunction(() => (window.__gitvurPerf?.().layouts ?? 0) > 0);
  await page.waitForTimeout(300);
}

/** Waits for the next layout to be applied after an action. */
async function afterLayout(page: Page, action: () => Promise<void>) {
  const before = (await page.evaluate(() => window.__gitvurPerf?.().layouts)) ?? 0;
  await action();
  await page.waitForFunction((n) => (window.__gitvurPerf?.().layouts ?? 0) > n, before);
  await page.waitForTimeout(250);
}

const zoom = (page: Page) => page.evaluate(() => window.__gitvurMap?.getZoom() ?? 0);

async function focus(page: Page, ids: string[], z?: number) {
  await page.evaluate(([i, z2]) => window.__gitvurMap?.focusNodes(i, z2), [ids, z] as const);
  await page.waitForTimeout(100);
}

const moduleNamed = (page: Page, name: string) =>
  page
    .locator(".react-flow__node-module")
    .filter({ has: page.locator(".gv-module-name", { hasText: new RegExp(`^${name}$`) }) });

const expandButton = (page: Page, file: string) =>
  page.getByRole("button", { name: `Expand ${file}`, exact: true });

test.describe("map", () => {
  test("1 · py-small default view", async ({ page }) => {
    await openMap(page, "py-small");
    await expect(page.locator(".react-flow__node-module")).toHaveCount(5);
    await expect(page.locator(".react-flow__node-file")).toHaveCount(7);
    await expect(page.locator(".react-flow__node-row")).toHaveCount(0);
    await expect(page.locator(".gv-project-name")).toHaveText("py-small");
    await shot(page, "map-01-py-small");
    // Greyscale: kinds must still be told apart by shape alone.
    await afterLayout(page, () => expandButton(page, "store.py").click());
    await focus(page, ["module:storage", "module:support"], 1);
    await page.addStyleTag({ content: "html { filter: grayscale(1) }" });
    await shot(page, "map-01g-py-small-greyscale");
  });

  test("2 · py-small with two files expanded", async ({ page }) => {
    await openMap(page, "py-small");
    await afterLayout(page, () => expandButton(page, "store.py").click());
    await afterLayout(page, () => expandButton(page, "models.py").click());
    await focus(page, ["module:storage", "module:catalogue"], 1);
    await expect(page.getByRole("treeitem", { name: /models\.py/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(await page.locator(".gv-row").count()).toBeGreaterThanOrEqual(4);
    await expect(
      page
        .locator(".gv-row-name", { hasText: "Store.save.encode" })
        .or(page.locator(".gv-row-name", { hasText: /^encode$/ })),
    ).toBeVisible();
    await shot(page, "map-02-py-small-expanded");
  });

  test("3 · ts-small default view", async ({ page }) => {
    await openMap(page, "ts-small");
    await expect(page.locator(".react-flow__node-module")).toHaveCount(4);
    await shot(page, "map-03-ts-small");
  });

  test("4 · synthetic at fit (low LOD)", async ({ page }) => {
    await openMap(page, "synthetic");
    await page.getByRole("button", { name: "Fit" }).click();
    await page.waitForTimeout(400);
    expect(await zoom(page)).toBeLessThan(0.35);
    expect(await page.locator(".react-flow__node-module").count()).toBeGreaterThan(3);
    await expect(page.locator(".gv-file-tile").first()).toBeVisible();
    await expect(page.locator(".gv-file-name")).toHaveCount(0);
    await shot(page, "map-04-synthetic-fit");
  });

  test("5 · synthetic zoomed to 0.6 on one module (mid LOD)", async ({ page }) => {
    await openMap(page, "synthetic");
    await focus(page, ["module:m03"], 0.6);
    expect(await zoom(page)).toBeCloseTo(0.6, 2);
    await expect(page.locator(".gv-file-name").first()).toBeVisible();
    await expect(page.locator(".gv-file-dir")).toHaveCount(0);
    await shot(page, "map-05-synthetic-mid-lod");
  });

  test("6 · hover and selected states", async ({ page }) => {
    await openMap(page, "py-small");
    await afterLayout(page, () => expandButton(page, "store.py").click());
    await focus(page, ["module:storage"], 1.2);
    await page
      .locator(".react-flow__node-row")
      .filter({ has: page.locator(".gv-row-name", { hasText: /^save$/ }) })
      .click();
    await expect(page.locator(".gv-row[data-selected='true']")).toHaveCount(1);
    await expect(page.getByRole("complementary", { name: "Inspector" })).toContainText(
      "Appends an item",
    );
    await page.locator(".react-flow__node-file", { hasText: "cache.py" }).hover();
    await shot(page, "map-06-hover-selected");
    await page
      .locator(".react-flow__node-file", { hasText: "cache.py" })
      .click({ position: { x: 40, y: 20 } });
    await expect(page.locator(".gv-file[data-selected='true']")).toHaveCount(1);
    await expect(page.getByRole("treeitem", { name: /cache\.py/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

test.describe("map behaviour", () => {
  test("level of detail follows zoom", async ({ page }) => {
    await openMap(page, "py-small");
    await afterLayout(page, () => expandButton(page, "store.py").click());
    await focus(page, ["module:storage"], 1);
    await expect(page.locator(".gv-row")).toHaveCount(4);
    await expect(page.locator(".gv-file-dir").first()).toBeVisible();
    await focus(page, ["module:storage"], 0.6);
    await expect(page.locator(".gv-row")).toHaveCount(0);
    await expect(page.locator(".gv-file-stub")).toHaveText("4 items");
    await focus(page, ["module:storage"], 0.3);
    await expect(page.locator(".gv-file-name")).toHaveCount(0);
    await expect(page.locator(".gv-module[data-lod='0']").first()).toBeVisible();
  });

  test("toolbar: expand all, collapse all; Enter on a focused file", async ({ page }) => {
    await openMap(page, "py-small");
    await afterLayout(page, () => page.getByRole("button", { name: "Expand all" }).click());
    await expect(page.getByRole("treeitem", { name: /models\.py/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(page.getByRole("treeitem", { name: /store\.py/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await afterLayout(page, () => page.getByRole("button", { name: "Collapse all" }).click());
    await expect(page.getByRole("treeitem", { name: /models\.py/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await page.locator(".react-flow__node-file", { hasText: "utils.py" }).focus();
    await afterLayout(page, () => page.keyboard.press("Enter"));
    await expect(page.getByRole("treeitem", { name: /utils\.py/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  test("shift+click a module header toggles all its files", async ({ page }) => {
    await openMap(page, "py-small");
    await afterLayout(page, () =>
      moduleNamed(page, "Storage")
        .locator(".gv-module-header")
        .click({ modifiers: ["Shift"] }),
    );
    await expect(page.getByRole("treeitem", { name: /cache\.py/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(page.getByRole("treeitem", { name: /store\.py/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  test("reduced motion: no node transitions", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await openMap(page, "py-small");
    const duration = await page
      .locator(".react-flow__node-file")
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(duration.split(",").every((d) => d.trim() === "0s")).toBe(true);
    await context.close();
  });
});

test.describe("performance (synthetic, 5,000 functions)", () => {
  test("budgets", async ({ page }) => {
    // Budgets are only meaningful without other tests competing for the CPU: run them alone
    // with `pnpm e2e:perf` (one worker, light project).
    test.skip(process.env.GITVUR_PERF !== "1", "run with pnpm e2e:perf");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    await openMap(page, "synthetic");
    const first = await page.evaluate(() => window.__gitvurPerf?.());

    // Expand the file with 40 children: time from the click to new positions applied.
    await focus(page, ["file:pkg00/big.py"], 1);
    await afterLayout(page, () => expandButton(page, "big.py").click());
    const expand = await page.evaluate(() => window.__gitvurPerf?.());
    await focus(page, ["file:pkg00/big.py"], 1);
    await expect(page.locator(".gv-row").first()).toBeVisible();

    // Pan and zoom continuously for 2 s, counting frames.
    await focus(page, ["module:m00"], 0.25);
    const fps = await page.evaluate(async () => {
      const map = window.__gitvurMap;
      if (!map) return 0;
      let frames = 0;
      const start = performance.now();
      await new Promise<void>((resolve) => {
        const step = (now: number) => {
          frames += 1;
          const t = (now - start) / 2000;
          void map.setViewport({
            x: -400 * Math.sin(t * Math.PI * 2),
            y: -200 * t,
            zoom: 0.25 + 0.6 * t,
          });
          if (t < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      });
      return (frames * 1000) / (performance.now() - start);
    });
    const { metrics } = await cdp.send("Performance.getMetrics");
    const heap = metrics.find((m) => m.name === "JSHeapUsedSize")?.value ?? 0;
    const result = {
      firstLayoutMs: first?.firstLayoutMs ?? null,
      expandLayoutMs: expand?.lastLayoutMs ?? null,
      expandSettleMs: expand?.lastSettleMs ?? null,
      panZoomFps: Math.round(fps),
      jsHeapMB: Math.round(heap / 1024 / 1024),
    };
    console.log(`PERF ${JSON.stringify(result)}`);
    expect(result.firstLayoutMs ?? Infinity).toBeLessThan(400);
    expect(result.expandSettleMs ?? Infinity).toBeLessThan(50);
    expect(result.jsHeapMB).toBeLessThan(400);
  });
});

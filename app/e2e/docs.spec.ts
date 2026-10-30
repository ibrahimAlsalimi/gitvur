import { type Page, expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function openDocs(page: Page, extra = "") {
  await page.goto(`/?fixture=py-small${extra}`);
  await page.getByRole("tab", { name: "Docs", exact: true }).click();
  await expect(page.locator(".gv-doc-prose h1")).toBeVisible();
}
async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: `e2e/__screenshots__/${test.info().project.name}/docs-${name}.png`,
    animations: "disabled",
  });
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
]) {
  test(`reader visual review ${String(viewport.width)}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openDocs(page);
    await expect(page.getByRole("button", { name: "Load remote images" })).toBeVisible();
    await shot(page, `01-readme-${String(viewport.width)}`);
    const mention = page.locator(".gv-doc-mention").filter({ hasText: "OrderService.receipt" });
    await mention.hover();
    await expect(
      page.getByRole("tooltip").filter({ hasText: "ƒ OrderService.receipt" }),
    ).toBeVisible();
    await shot(page, `03-mention-${String(viewport.width)}`);
    await page.locator(".gv-doc-link").filter({ hasText: "Gitvur on GitHub" }).click();
    await expect(page.getByRole("dialog", { name: "Open in your browser?" })).toBeVisible();
    await shot(page, `04-external-${String(viewport.width)}`);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.locator(".gv-doc-reader-scroll").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(page.locator(".gv-doc-image-placeholder")).toBeVisible();
    await shot(page, `05-remote-${String(viewport.width)}`);
    await page.getByRole("button", { name: /Shop architecture.*docs\/architecture.md/ }).click();
    await expect(page.locator(".gv-doc-diagram")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".gv-doc-table")).toBeVisible();
    await shot(page, `02-architecture-${String(viewport.width)}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const results = await new AxeBuilder({ page })
      .include("#panel-docs")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      results.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? "")),
    ).toEqual([]);
    await page.locator(".gv-doc-link").filter({ hasText: "Read the implementation" }).click();
    await expect(page.getByRole("tab", { name: "Map", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // Select the file for the backlink section, then return to the exact first mention.
    await page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("button", { name: "orders.py" })
      .click();
    const back = page.getByRole("region", { name: "Mentioned in docs" });
    await expect(back).toBeVisible();
    await shot(page, `06-backlinks-${String(viewport.width)}`);
    await back.getByRole("button").filter({ hasText: "Shop architecture" }).click();
    await expect(page.locator(".gv-doc-prose h1")).toHaveText(/Shop architecture/);
  });
}

test("tabs preserve map, shortcuts, reader scroll and saved view", async ({ page }) => {
  await page.goto("/?fixture=py-small");
  await expect(page.locator(".react-flow")).toBeVisible();
  await expect(page.locator(".react-flow__viewport")).not.toHaveAttribute(
    "style",
    "transform: translate(0px, 0px) scale(1);",
  );
  const before = await page.locator(".react-flow__viewport").getAttribute("style");
  await page.keyboard.press("Control+2");
  await expect(page.getByRole("tab", { name: "Docs", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("button", { name: /Shop architecture.*docs\/architecture.md/ }).click();
  await expect(page.locator(".gv-doc-prose h1")).toHaveText(/Shop architecture/);
  await page.locator(".gv-doc-reader-scroll").evaluate((el) => {
    el.scrollTop = 150;
  });
  await page.keyboard.press("Control+1");
  expect(await page.locator(".react-flow__viewport").getAttribute("style")).toBe(before);
  await page.getByRole("tab", { name: "Map", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Docs", exact: true })).toBeFocused();
  await expect
    .poll(() => page.locator(".gv-doc-reader-scroll").evaluate((el) => el.scrollTop))
    .toBeGreaterThan(100);
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("gitvur.mock.view:/mock/fixtures/py-small")),
    )
    .toContain('"activeTab":"docs"');
  await expect
    .poll(async () => {
      const saved = await page.evaluate(() =>
        localStorage.getItem("gitvur.mock.view:/mock/fixtures/py-small"),
      );
      return saved ? ((JSON.parse(saved) as { docScroll?: number }).docScroll ?? 0) : 0;
    })
    .toBeGreaterThan(100);
  await page.reload();
  await expect(page.getByRole("tab", { name: "Docs", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".gv-doc-prose h1")).toHaveText(/Shop architecture/);
  await expect
    .poll(() => page.locator(".gv-doc-reader-scroll").evaluate((el) => el.scrollTop))
    .toBeGreaterThan(100);
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox").fill("Responsibilities");
  await expect(page.getByRole("group", { name: "Docs", exact: true })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("#user-content-responsibilities")).toBeInViewport();
});

test("untrusted Markdown cannot execute, navigate, or fetch remote resources", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (req) => {
    if (/tracker\.invalid|example\.com/.test(req.url())) requests.push(req.url());
  });
  const dialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await openDocs(page, "&docs=unsafe");
  await page.getByRole("button", { name: /Untrusted document.*unsafe.md/ }).click();
  await expect(page.locator(".gv-doc-prose h1")).toHaveText(/Untrusted document/);
  await expect(
    page.locator(".gv-doc-prose script, .gv-doc-prose iframe, .gv-doc-prose [onerror]"),
  ).toHaveCount(0);
  await expect(page.locator(".gv-doc-prose a[href], .gv-doc-prose img[src^='http']")).toHaveCount(
    0,
  );
  await page.locator(".gv-doc-prose").getByText("Unsafe script", { exact: true }).click();
  await expect(
    page.locator(".gv-doc-image-placeholder").filter({ hasText: "Image outside" }),
  ).toHaveCount(2);
  await expect(
    page.locator(".gv-doc-note").filter({ hasText: "Diagram couldn't be rendered" }),
  ).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => Object.hasOwn(window, "__docsPwned"))).toBe(false);
  expect(dialogs).toEqual([]);
  expect(requests).toEqual([]);
  expect(page.url()).toContain("fixture=py-small");
});

test("external confirmation, remote image opt-in and missing documents", async ({ page }) => {
  const requested: string[] = [];
  await page.route("https://example.com/**", (route) => {
    requested.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "image/png", body: "" });
  });
  await openDocs(page);
  await page.locator(".gv-doc-link").filter({ hasText: "Gitvur on GitHub" }).click();
  expect(await page.locator("html").getAttribute("data-opened-external")).toBeNull();
  await page.getByRole("button", { name: "Open in browser", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-opened-external",
    "https://github.com/ibrahimAlsalimi/gitvur",
  );
  expect(requested).toEqual([]);
  await page.getByRole("button", { name: "Load remote images" }).click();
  await expect.poll(() => requested.length).toBe(1);
  await page.getByRole("button", { name: /Shop architecture.*docs\/architecture.md/ }).click();
  await page.getByRole("button", { name: /Shop example.*README.md/ }).click();
  await expect(page.getByRole("button", { name: "Load remote images" })).toBeVisible();
  await page.goto("/?fixture=py-small&docMissing=README.md");
  await page.getByRole("tab", { name: "Docs", exact: true }).click();
  await expect(page.getByText("This document no longer exists.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh list", exact: true }).last(),
  ).toBeVisible();
});

import { type Page, expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function openFlows(page: Page, fixture: string, extra = "") {
  await page.goto(`/?fixture=${fixture}${extra}`);
  await expect(page.getByRole("tab", { name: "Map", exact: true })).toBeEnabled();
  await page.keyboard.press("Control+3");
  await expect(page.locator("#panel-flows")).toBeVisible();
}

async function pickFlow(page: Page, name: string) {
  await page.locator(".gv-flow-item").filter({ hasText: name }).click();
  await expect(page.locator(".gv-flow-title")).toHaveText(name);
  await expect(page.locator(".gv-flow-canvas .react-flow__node-step").first()).toBeVisible();
}

async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: `e2e/__screenshots__/${test.info().project.name}/flows-${name}.png`,
    animations: "disabled",
  });
}

const steps = (page: Page) => page.locator(".gv-flow-canvas .gv-step");

test("plays every py-flows and ts-flows flow to the end", async ({ page }) => {
  for (const fixture of ["py-flows", "ts-flows"]) {
    await openFlows(page, fixture);
    const names = await page.locator(".gv-flow-item-name").allTextContents();
    expect(names.length).toBe(3);
    for (const name of names) {
      await pickFlow(page, name);
      // J through, taking the first option at every branch, until Next is disabled.
      for (let i = 0; i < 40; i++) {
        const choice = page.locator(".gv-branch-choice button").first();
        if (await choice.isVisible()) await choice.click();
        else if (await page.getByRole("button", { name: "Next step (J)" }).isDisabled()) break;
        else await page.keyboard.press("j");
      }
      await expect(page.getByRole("button", { name: "Next step (J)" })).toBeDisabled();
      await expect(page.locator('.gv-rail-dot[data-state="future"]')).toHaveCount(0);
    }
  }
});

test("a branch pauses playback and the chosen path is followed", async ({ page }) => {
  await openFlows(page, "py-flows");
  await pickFlow(page, "Backends self-check");
  await page.keyboard.press("j"); // 1
  await page.keyboard.press("j"); // 2: the unconditional call
  await page.keyboard.press("j"); // back at 1: only the branch is left
  const choice = page.getByRole("group", { name: "Choose a path" });
  await expect(choice).toBeVisible();
  await expect(steps(page).filter({ hasText: "Loads the backends module" })).toHaveAttribute(
    "data-state",
    "active",
  );
  await shot(page, "03-branch");
  await choice.getByRole("button", { name: "when run as a script" }).click();
  await expect(steps(page).filter({ hasText: "Saves the sample item" })).toHaveAttribute(
    "data-state",
    "active",
  );
  // "otherwise" declines: the branch target is dimmed.
  await page.keyboard.press("Home");
  for (let i = 0; i < 3; i++) await page.keyboard.press("j");
  await choice.getByRole("button", { name: "otherwise" }).click();
  await expect(steps(page).filter({ hasText: "Saves the sample item" })).toHaveAttribute(
    "data-state",
    "dimmed",
  );
});

test("mid-playback the inspector shows the step and its call site", async ({ page }) => {
  await openFlows(page, "py-flows");
  await pickFlow(page, "CLI places an order");
  await expect(page.locator(".gv-lane-header")).toHaveCount(4);
  await shot(page, "01-rest");
  for (let i = 0; i < 4; i++) await page.keyboard.press("j");
  const context = page.getByRole("region", { name: "Step context" });
  await expect(context).toContainText("Trims the item text");
  await expect(context).toContainText("Called from step 3 · validate line 5");
  await expect(context.locator('.gv-code-line[data-highlight="true"]').first()).toContainText(
    "normalize(item)",
  );
  await expect(page.locator("#panel-flows .inspector-title")).toHaveText("normalize");
  await expect(steps(page).nth(0)).toHaveAttribute("data-state", "visited");
  await expect(steps(page).nth(5)).toHaveAttribute("data-state", "upcoming");
  await page.waitForTimeout(700); // let the travelling dash finish for the screenshot
  await shot(page, "02-playback");
  await page.keyboard.press("k");
  await expect(context).toContainText("Validates the order item");
});

test("an AI event and a stale step are marked; broken flows explain why", async ({ page }) => {
  await openFlows(page, "py-flows", "&state=flow-stale");
  await pickFlow(page, "CLI places an order");
  await expect(page.locator(".gv-flow-banner")).toHaveText(
    "Some steps changed since this flow was written: steps 2.",
  );
  await expect(steps(page).nth(1).locator(".gv-step-stale")).toBeVisible();
  await expect(page.locator(".gv-flow-chip").filter({ hasText: "⚡ saved" })).toBeVisible();
  await shot(page, "04-stale-event");
  await openFlows(page, "py-flows", "&state=flow-broken");
  await pickFlow(page, "HTTP order request");
  await expect(page.getByRole("alert")).toContainText(
    "This flow refers to code that no longer exists.",
  );
  await expect(page.getByRole("alert")).toContainText("flow-dangling-step");
  await expect(steps(page).nth(2)).toContainText("Element no longer exists");
});

test("trace mode: cycles, ambiguous calls, expansion and copy as text", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openFlows(page, "ts-flows");
  await pickFlow(page, "Countdown recursion");
  await page.keyboard.press("t");
  await expect(page.locator(".gv-flow-badge")).toHaveText("Derived from code · no AI");
  await expect(page.locator(".gv-trace-stub[data-kind='cycle']")).toHaveText(
    "⟲ recursion back to countdown",
  );
  await page.keyboard.press("t");
  await expect(page.locator(".gv-flow-badge")).toHaveText("AI-curated · validated");

  await openFlows(page, "py-flows");
  await page.locator(".gv-flow-entry").filter({ hasText: "flowapp/backends.py" }).click();
  await page.keyboard.press("t");
  const ambiguous = page.locator(".gv-trace-ambiguous");
  await expect(ambiguous).toHaveText(/\? save · 2 possible targets/);
  await ambiguous.click();
  await expect(page.locator(".gv-trace-card[data-kind='candidate']")).toHaveCount(2);
  await shot(page, "05-trace-ambiguous");

  // Expanding below the initial depth.
  await page.locator(".gv-flow-entry").filter({ hasText: "flow-shop" }).click();
  await page.keyboard.press("t");
  await expect(page.locator(".gv-trace-card")).toHaveCount(3);
  await page.getByRole("button", { name: "Show 1 more calls" }).click();
  await expect(page.locator(".gv-trace-card")).toHaveCount(4);
  await page.getByRole("button", { name: "Copy trace as text" }).click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text.split("\n")[0]).toBe("entry:console-script:flow-shop");
  expect(text).toContain("function:flowapp/storage/driver.py:commit [trace:6]");
});

test("pin to map, flows through here, and trace from here", async ({ page }) => {
  await openFlows(page, "py-flows");
  await pickFlow(page, "CLI places an order");
  await page.getByRole("button", { name: "Pin to map" }).click();
  await expect(page.getByRole("tab", { name: "Map", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const chip = page.locator(".gv-pin-chip");
  await expect(chip).toContainText("Flow: CLI places an order · 1/7");
  await expect(page.locator(".gv-pin-badge").first()).toBeVisible();
  await expect(page.locator(".gv-map[data-pinned]")).toBeVisible();
  await chip.getByRole("button", { name: "Next step" }).click();
  await expect(chip).toContainText("2/7");
  await page.waitForTimeout(500);
  await shot(page, "06-pinned");
  await chip.getByRole("button", { name: "Remove flow from map" }).click();
  await expect(chip).toHaveCount(0);

  // The inspector lists flows through the selected element; a click opens that step.
  await page.keyboard.press("Control+3");
  await steps(page).filter({ hasText: "Coordinates the order" }).click();
  const through = page.getByRole("region", { name: "Flows through here" });
  await expect(through.getByRole("listitem")).toHaveCount(2);
  await through.getByRole("button", { name: "HTTP order request" }).click();
  await expect(page.locator(".gv-flow-title")).toHaveText("HTTP order request");
  await expect(steps(page).nth(1)).toHaveAttribute("data-state", "active");
  await page
    .locator("#panel-flows .gv-insp-meta")
    .getByRole("button", { name: "Trace from here" })
    .click();
  await expect(page.locator(".gv-flow-title")).toHaveText("submit");
  await expect(page.locator(".gv-flow-badge")).toHaveText("Derived from code · no AI");
});

test("export: Mermaid to the clipboard and a PNG through the save path", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openFlows(page, "py-flows");
  await pickFlow(page, "HTTP order request");
  await page.getByRole("button", { name: /Export/ }).click();
  await page.getByRole("menuitem", { name: "Copy as Mermaid" }).click();
  const mermaid = await page.evaluate(() => navigator.clipboard.readText());
  expect(mermaid).toContain("flowchart TD");
  expect(mermaid).toContain('n2 -.->|"⚡ saved"| n4');
  await page.getByRole("button", { name: /Export/ }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export PNG" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("flow-http-order-request.png");
  await file.saveAs(`e2e/__screenshots__/${test.info().project.name}/flows-07-export.png`);
});

test("states, keyboard, list view and accessibility", async ({ page }) => {
  // The frozen py-small bundle predates entry points.
  await openFlows(page, "py-small");
  await expect(page.locator(".gv-flow-empty")).toContainText(
    "No entry points were found in this repository.",
  );
  await page.getByRole("button", { name: "Trace from a function" }).click();
  await expect(page.getByRole("tab", { name: "Map", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await openFlows(page, "ts-flows");
  await page.locator(".gv-flow-entry").filter({ hasText: "flow-shop:main" }).click();
  await expect(page.locator(".gv-flow-banner")).toHaveText(
    "This entry point points outside the indexed code (dist/index.js).",
  );

  await page.locator(".gv-flow-item").filter({ hasText: "HTTP order request" }).click();
  const first = page.locator('.gv-flow-canvas .react-flow__node[aria-label^="Step 1 of 4"]');
  await expect(first).toHaveAttribute(
    "aria-label",
    "Step 1 of 4: Receives the order request, handle, in module Entry points",
  );
  await first.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".react-flow__node:focus")).toHaveAttribute(
    "aria-label",
    /^Step 2 of 4/,
  );
  await page.getByRole("button", { name: "List view" }).click();
  const list = page.getByRole("list", { name: "HTTP order request, as a list" });
  await expect(list.locator(":scope > li")).toHaveCount(4);
  await expect(list).toContainText("on event “saved”, runs step 4 (AI)");
  await shot(page, "08-list");
  const results = await new AxeBuilder({ page }).include("#panel-flows").analyze();
  const serious = results.violations.filter((v) =>
    ["serious", "critical"].includes(v.impact ?? ""),
  );
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);
  await page.getByRole("button", { name: "Diagram" }).click();
  const axeDiagram = await new AxeBuilder({ page }).include("#panel-flows").analyze();
  expect(
    axeDiagram.violations
      .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
      .map((v) => v.id),
  ).toEqual([]);
});

test("inspector resizes in Flows and keeps its width across tabs and reloads", async ({ page }) => {
  await openFlows(page, "py-flows");
  const flows = page.locator("#panel-flows");
  const inspector = flows.getByRole("complementary", { name: "Inspector" });
  const handle = flows.getByRole("separator", { name: "Resize inspector" });
  await handle.focus();
  await handle.press("Home");
  await expect(handle).toHaveAttribute("aria-valuenow", "280");
  const divider = await handle.boundingBox();
  if (!divider) throw new Error("Inspector resize divider is missing");
  await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2);
  await page.mouse.down();
  await page.mouse.move(divider.x + divider.width / 2 - 80, divider.y + divider.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(handle).toHaveAttribute("aria-valuenow", "360");
  await expect.poll(async () => Math.round((await inspector.boundingBox())?.width ?? 0)).toBe(360);

  await page.getByRole("tab", { name: "Map", exact: true }).click();
  const map = page.locator("#panel-map");
  await expect
    .poll(async () =>
      Math.round(
        (await map.getByRole("complementary", { name: "Inspector" }).boundingBox())?.width ?? 0,
      ),
    )
    .toBe(360);
  const mapHandle = map.getByRole("separator", { name: "Resize inspector" });
  await mapHandle.focus();
  await mapHandle.press("ArrowRight");
  await page.getByRole("tab", { name: "Flows", exact: true }).click();
  await expect(handle).toHaveAttribute("aria-valuenow", "344");
  await expect.poll(async () => Math.round((await inspector.boundingBox())?.width ?? 0)).toBe(344);
  await inspector.getByRole("button", { name: "Collapse inspector" }).click();
  await expect(handle).toHaveCount(0);
  await flows.getByRole("button", { name: "Expand inspector" }).click();
  await expect(handle).toHaveAttribute("aria-valuenow", "344");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const saved = localStorage.getItem("gitvur.mock.settings");
        return saved ? (JSON.parse(saved) as { inspectorWidth: number }).inspectorWidth : null;
      }),
    )
    .toBe(344);
  await page.reload();
  await page.getByRole("tab", { name: "Flows", exact: true }).click();
  await expect(handle).toHaveAttribute("aria-valuenow", "344");
  await expect.poll(async () => Math.round((await inspector.boundingBox())?.width ?? 0)).toBe(344);
  await steps(page).first().click();
  await expect(page.locator("#panel-flows .gv-code-line").first()).toBeVisible();
  await shot(page, "09-inspector-resized");
});

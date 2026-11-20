import { expect as baseExpect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Guided /demo against the local dev server (LOCAL_DEV store). Runs the real demo stages on the
 * live demo unit demo-pu-012 inside the isolated E2E store only, then resets it.
 * POLLTRACE_DEMO_ADMIN_PASSCODE is set to "e2e-demo-admin" in playwright.config.ts for local runs.
 */
const expect = baseExpect.configure({ timeout: 30_000 });
const PASS = process.env.POLLTRACE_E2E_DEMO_PASSCODE ?? "e2e-demo-admin";
const SHOTS = process.env.POLLTRACE_SHOTS_DIR;

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const original = page.viewportSize();
  for (const size of [
    { width: 360, height: 740 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1280, height: 900 },
  ]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(SHOTS, `${name}-${size.width}.png`), fullPage: true });
  }
  if (original) await page.setViewportSize(original);
}

const STEPS = [
  { button: "Run: two witnesses submit" },
  { button: "Run: a copy is sent" },
  { button: "Run: reviewer decides" },
  { button: "Run: reference added and checked" },
];

async function reset(page: Page) {
  await page.getByRole("button", { name: "Reset demo scenario" }).click();
  await expect(page.getByText(/removes only the records created by the synthetic demo actors/)).toBeVisible();
  await page.getByRole("button", { name: "Reset now" }).click();
  await expect(page.getByText(/Demo scenario reset/)).toBeVisible();
}

test("guided demo: wrong passcode, reset, four stages → +60, reset", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/");
  await page.getByRole("link", { name: "Guided demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Guided demo" })).toBeVisible();
  await expect(page.getByText("All data on this page is synthetic.")).toBeVisible();
  await expect(page.getByText("Demo mode is not set up on this server.")).toHaveCount(0);

  // Wrong passcode: visible error, nothing runs.
  await page.getByLabel("Demo passcode").fill("not-the-passcode");
  await page.getByRole("button", { name: "Reset demo scenario" }).click();
  await page.getByRole("button", { name: "Reset now" }).click();
  await expect(page.getByText("That passcode is not right. Nothing was run.").first()).toBeVisible();
  await page.getByRole("button", { name: "Keep everything" }).click();

  await page.getByLabel("Demo passcode").fill(PASS);
  await reset(page);
  await expect(page.getByText("0 of 4 demo-actor steps done.")).toBeVisible();
  // Later steps are blocked, with the reason visible.
  await expect(page.getByRole("button", { name: STEPS[1].button })).toBeDisabled();
  await expect(page.getByText(/Run step 4 first/)).toBeVisible();
  await shot(page, "demo-start");

  for (const s of STEPS) {
    await page.getByRole("button", { name: s.button }).click();
    await expect(page.getByRole("button", { name: s.button })).toHaveCount(0); // replaced by its result
  }
  await expect(page.getByText("4 of 4 demo-actor steps done.")).toBeVisible();
  await expect(page.getByText("Differs from reference").first()).toBeVisible();
  await shot(page, "demo-done");

  // The real public comparison shows the +60.
  await page.getByRole("link", { name: /Open the comparison for DEMO\.00\.00\.012/ }).click();
  await page.waitForURL(/\/units\/demo-pu-012$/);
  const rowB = page.getByRole("row", { name: /Party B/ });
  await expect(rowB).toContainText("+60");
  await expect(rowB).toContainText("Reference is 60 higher");
  await expect(page.getByRole("heading", { name: "Why no allegation is made" })).toBeVisible();

  // Reset: back to the unit's state without demo rows (empty store → no evidence).
  await page.goto("/demo");
  await reset(page);
  await expect(page.getByText("0 of 4 demo-actor steps done.")).toBeVisible();
  await expect(page.getByText(/Comparison status for DEMO\.00\.00\.012 is now: No evidence yet/)).toBeVisible();
});

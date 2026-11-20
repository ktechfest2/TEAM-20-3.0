import { expect as baseExpect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Minimal labelling: one quiet footer line on every page; a neutral "Sample" tag only next to
 * sample (fictional, code 99-…) unit names; "2023 historical" next to real units; no DEMO tags.
 * Set POLLTRACE_SHOTS_DIR to save 390px screenshots of the key pages.
 */
const expect = baseExpect.configure({ timeout: 20_000 });
const SHOTS = process.env.POLLTRACE_SHOTS_DIR;
const FOOTER = /Sample units \(code 99-…\) and their figures are fictional\. 2023 records are historical data/;

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOTS, `${name}-390.png`), fullPage: true });
}

test("footer line everywhere; Sample and 2023 historical tags only next to unit names", async ({ page }) => {
  for (const [url, name] of [
    ["/", "home"],
    ["/capture", "capture"],
    ["/units", "units"],
    ["/units/demo-pu-012", "unit-sample"],
    ["/units/ng23-37-01-01-001", "unit-historical"],
    ["/demo", "demo"],
  ] as const) {
    await page.goto(url);
    await expect(page.getByText(FOOTER)).toBeVisible();
    await expect(page.locator(".demo-tag")).toHaveCount(0);
    await expect(page.getByText(/DEMO DATA|Test build ·/)).toHaveCount(0);
    if (url === "/capture") {
      await page.getByLabel("Search by polling unit code or name").fill("99-04-07-012");
      await expect(page.getByRole("radio", { name: /99-04-07-012.*Sample/ })).toBeVisible();
    }
    if (url === "/units") {
      await page.getByLabel("Search by polling unit code or name").fill("99-04-07-012");
      await expect(page.getByRole("link", { name: /99-04-07-012.*Sample/ })).toBeVisible();
    }
    if (url === "/units/demo-pu-012") {
      await expect(page.getByRole("heading", { level: 1, name: "99-04-07-012" })).toBeVisible();
      await expect(page.locator("main").getByText("Sample unit, fictional")).toBeVisible();
    }
    if (url === "/units/ng23-37-01-01-001") {
      await expect(page.getByRole("heading", { level: 1, name: "37-01-01-001" })).toBeVisible();
      await expect(page.locator("main").getByText("Sample unit, fictional")).toHaveCount(0);
    }
    if (url === "/demo") {
      await expect(page.getByText("This guided demo uses sample units and sample accounts.")).toBeVisible();
    }
    await shot(page, name);
  }
});

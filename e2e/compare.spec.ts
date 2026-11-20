import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

/**
 * Comparison slice, all synthetic demo data, on polling unit demo-pu-101 (kept apart from the
 * live demo unit demo-pu-012 and the backend smoke unit demo-pu-102):
 * two contributors each send a DIFFERENT photo and confirm 145/210/42 → reviewer A accepts both as
 * independent → reviewer B adds a SYNTHETIC_DEMO reference 145/270/42 and cannot check its own
 * source → reviewer A confirms the source → the public page shows DIFFERS FROM REFERENCE, +60.
 * The shared Supabase keeps earlier runs' data: assertions are about the state after these steps
 * (earlier accepted photos for this unit also confirm 145/210/42; only the latest reference counts).
 * Set POLLTRACE_SHOTS_DIR to save 360px and 1280px screenshots.
 */

const UNIT = { id: "demo-pu-101", code: "99-04-08-101", search: "99-04-08-101" };
const SHOTS = process.env.POLLTRACE_SHOTS_DIR;
const MOBILE = { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true };

async function shot(page: Page, name: string, widths: number[] = [360, 1280]) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const original = page.viewportSize();
  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(SHOTS, `${name}-${width}.png`), fullPage: true });
  }
  if (original) await page.setViewportSize(original);
}

/** A small, valid PNG with random pixels: distinct bytes (and SHA-256) on every call. */
function distinctPng(): string {
  const width = 64;
  const height = 48;
  const chunk = (type: string, data: Buffer) => {
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) rows.push(Buffer.concat([Buffer.from([0]), randomBytes(width * 3)]));
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "polltrace-cmp-")), "synthetic-sheet.png");
  writeFileSync(file, png);
  return file;
}

/** One contributor (own browser context): capture → upload → DEMO figures → confirm 145/210/42. */
async function contributorSubmits(browser: Browser): Promise<{ ctx: BrowserContext; evidenceId: string }> {
  const ctx = await browser.newContext(MOBILE);
  const page = await ctx.newPage();
  await page.goto("/capture");
  await page.getByLabel("Search by polling unit code or name").fill(UNIT.search);
  await page.getByRole("radio", { name: new RegExp(UNIT.code.replace(/\./g, "\\.")) }).check();
  await page.getByRole("button", { name: "Yes, this is the polling unit" }).click();
  await page.locator('input[type="file"]:not([capture])').setInputFiles(distinctPng());
  await expect(page.getByRole("heading", { name: "Check your photo" })).toBeVisible();
  await page.getByRole("radio", { name: "A voter or witness at this polling unit" }).check();
  await page.getByRole("button", { name: "Save this photo" }).click();
  const received = page.getByRole("heading", { name: "Received by server" });
  const uploadNow = page.getByRole("button", { name: "Upload now" });
  await expect(received.or(uploadNow).first()).toBeVisible({ timeout: 30_000 });
  if (await uploadNow.isVisible()) await uploadNow.click();
  await expect(received).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "View ProofTrail" }).click();
  await page.waitForURL(/\/evidence\/[0-9a-f-]{36}$/);
  const evidenceId = page.url().split("/evidence/")[1];

  await page.getByRole("link", { name: "Read the figures" }).click({ timeout: 20_000 });
  await page.getByRole("radio", { name: /Load sample figures/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Type the figures" })).toBeVisible({ timeout: 20_000 });
  for (const [label, value] of [
    ["Party A", "145"],
    ["Party B", "210"],
    ["Party C", "42"],
  ]) {
    await expect(page.getByLabel(label, { exact: true })).toHaveValue(value); // demo fixture values
  }
  await page.getByRole("button", { name: "Check before confirming" }).click();
  await page.getByRole("button", { name: "Confirm figures" }).click();
  await expect(page.getByText(/Figures confirmed and saved as version/)).toBeVisible({ timeout: 20_000 });
  return { ctx, evidenceId };
}

async function signInReviewer(browser: Browser, who: "A" | "B"): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("/reviewer");
  await page.getByRole("radio", { name: new RegExp(`Reviewer ${who}`) }).check();
  // Production deployments require the demo passcode; local dev does not show the field.
  const passcode = page.getByLabel("Reviewer passcode");
  if (await passcode.isVisible()) {
    const value = process.env.POLLTRACE_E2E_REVIEWER_PASSCODE;
    if (!value) throw new Error("Set POLLTRACE_E2E_REVIEWER_PASSCODE to run this test against a deployment.");
    await passcode.fill(value);
  }
  await page.getByRole("button", { name: "Sign in as reviewer" }).click();
  await page.waitForURL(/\/review$/);
  return { ctx, page };
}

async function acceptAsIndependent(page: Page, evidenceId: string) {
  await page.goto(`/evidence/${evidenceId}#review`);
  await expect(page.getByRole("heading", { name: "Your review" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("radio", { name: /Accept: usable in comparison/ }).check();
  await page.getByRole("radio", { name: /Independent source/ }).check();
  await page
    .getByRole("textbox", { name: "Reason" })
    .fill("Synthetic demo: readable sheet, confirmed figures match; separate sender and distinct file.");
  await page.getByRole("button", { name: "Continue to confirm" }).click();
  await page.getByRole("button", { name: "Record decision" }).click();
  await expect(page.getByText(/Decision recorded at/)).toBeVisible({ timeout: 20_000 });
}

test("finder opens a unit page", async ({ page }) => {
  await page.goto("/units");
  await expect(page.getByRole("heading", { name: "Find a polling unit" })).toBeVisible();
  await page.getByLabel("Search by polling unit code or name").fill(UNIT.search);
  const link = page.getByRole("link", { name: new RegExp(UNIT.code.replace(/\./g, "\\.")) });
  await expect(link).toHaveCount(1);
  await shot(page, "units-finder");
  await link.click();
  await page.waitForURL(new RegExp(`/units/${UNIT.id}$`));
  await expect(page.getByRole("heading", { level: 1, name: UNIT.code })).toBeVisible({ timeout: 20_000 });
});

test("finder opens a real 2023 historical unit; capture cannot pick it", async ({ page }) => {
  await page.goto("/units");
  await page.getByLabel("Search by polling unit code or name").fill("37-01-01-001");
  const link = page.getByRole("link", { name: /37-01-01-001/ });
  await expect(link).toHaveCount(1);
  await expect(link).toContainText("2023 historical");
  await expect(link.locator(".demo-tag")).toHaveCount(0);
  await shot(page, "units-finder-historical", [390, 1280]);
  await link.click();
  await page.waitForURL(/\/units\/ng23-37-01-01-001$/);
  await expect(page.getByRole("heading", { level: 1, name: "37-01-01-001" })).toBeVisible({ timeout: 20_000 });
  const main = page.locator("main");
  await expect(main.getByText("2023 historical").first()).toBeVisible();
  await expect(
    main.getByText(/Nigeria 2\.0 independent crosscheck of 2023 result sheets\. Not INEC-certified\./),
  ).toBeVisible();
  // A real unit carries no "Sample" marker (the footer line explains both kinds of record).
  await expect(main.getByText("Sample unit, fictional")).toHaveCount(0);
  await expect(main.locator(".demo-tag")).toHaveCount(0);
  await shot(page, "unit-historical", [390, 1280]);

  // Capture only offers synthetic units: a historical code finds nothing to select.
  await page.goto("/capture");
  await page.getByLabel("Search by polling unit code or name").fill("37-01");
  await expect(page.getByRole("radio", { name: /37-01/ })).toHaveCount(0);
  await expect(page.getByText(/No polling unit matches/)).toBeVisible();
});

test("two independent photos + a source-checked reference → DIFFERS FROM REFERENCE, +60", async ({ browser }) => {
  test.setTimeout(420_000);

  // ---- Two contributors, two different photos, each confirms 145/210/42.
  const c1 = await contributorSubmits(browser);
  const c2 = await contributorSubmits(browser);

  // ---- Reviewer A accepts both as independent sources.
  const a = await signInReviewer(browser, "A");
  await acceptAsIndependent(a.page, c1.evidenceId);
  await acceptAsIndependent(a.page, c2.evidenceId);

  // ---- Reviewer B adds a synthetic reference 145/270/42.
  const b = await signInReviewer(browser, "B");
  await b.page.goto(`/units/${UNIT.id}/references`);
  await expect(b.page.getByRole("heading", { name: "Reference records" })).toBeVisible();
  await expect(b.page.getByRole("heading", { name: "Versions" })).toBeVisible({ timeout: 20_000 });
  const addNew = b.page.getByRole("button", { name: "Add a new version" });
  if (await addNew.isVisible()) await addNew.click();
  await expect(b.page.getByRole("radio", { name: /Sample reference/ })).toBeChecked();
  await b.page.getByLabel("Describe the source").fill("Synthetic demo reference sheet for the comparison E2E test.");
  for (const [label, value] of [
    ["Party A", "145"],
    ["Party B", "270"],
    ["Party C", "42"],
  ]) {
    await b.page.getByLabel(new RegExp(`^${label}`)).fill(value);
  }
  await b.page.getByRole("button", { name: "Continue to confirm" }).click();
  await expect(b.page.getByRole("heading", { name: "Add this reference record?" })).toBeVisible();
  const created = b.page.waitForResponse((r) => r.url().endsWith("/api/references") && r.request().method() === "POST");
  await b.page.getByRole("button", { name: "Add record" }).click();
  const refRes = await created;
  expect(refRes.status()).toBe(201);
  const ref = (await refRes.json()) as { id: string; version: number };
  await expect(b.page.getByText(new RegExp(`Reference version ${ref.version} added at`))).toBeVisible();

  // B cannot check its own record: the UI says so, and the server refuses (SELF_REVIEW).
  const bSlip = b.page.locator(`#ref-${ref.id}`);
  await expect(bSlip).toContainText("You added this record, so you cannot check its source.");
  await expect(bSlip.getByRole("button", { name: "Check this source" })).toHaveCount(0);
  await shot(b.page, "references-importer");
  const self = await b.page.request.post(`/api/references/${ref.id}/review`, {
    data: { decision: "SOURCE_CONFIRMED", reason: "self check attempt" },
  });
  expect(self.status()).toBe(403);
  expect((await self.json()).error.code).toBe("SELF_REVIEW");

  // ---- Reviewer A confirms the source.
  await a.page.goto(`/units/${UNIT.id}/references`);
  const aSlip = a.page.locator(`#ref-${ref.id}`);
  await expect(aSlip).toBeVisible({ timeout: 20_000 });
  await aSlip.getByRole("button", { name: "Check this source" }).click();
  await aSlip.getByRole("radio", { name: /Confirm the source/ }).check();
  await aSlip.getByRole("textbox", { name: "Reason" }).fill("Synthetic demo: description matches the demo reference.");
  await aSlip.getByRole("button", { name: "Continue to confirm" }).click();
  await shot(a.page, "references-check");
  await aSlip.getByRole("button", { name: "Record check" }).click();
  await expect(aSlip.getByText(/Source check recorded at/)).toBeVisible({ timeout: 20_000 });
  await expect(aSlip.getByText("Source confirmed by a second reviewer")).toBeVisible();

  // Reviewer view of the unit: ProofTrail links + reference records button.
  await a.page.goto(`/units/${UNIT.id}`);
  await expect(a.page.getByText("Differs from reference")).toBeVisible({ timeout: 20_000 });
  // Identical counted photos collapse into one line; the rows (with ProofTrail links) are behind a disclosure.
  await expect(a.page.getByText(/photos counted · all judged independent by a reviewer/)).toBeVisible();
  await a.page.getByText("Show each photo").click();
  await expect(a.page.getByRole("link", { name: /Open ProofTrail/ }).first()).toBeVisible();
  await expect(a.page.getByRole("link", { name: "Reference records for this unit" })).toBeVisible();
  await shot(a.page, "unit-reviewer");

  // ---- Public (no session): DIFFERS FROM REFERENCE, +60, no photo or identity.
  const pub = await browser.newContext(MOBILE);
  const p = await pub.newPage();
  await p.goto(`/units/${UNIT.id}`);
  await expect(p.getByRole("heading", { level: 1, name: UNIT.code })).toBeVisible();
  await expect(p.getByText("Differs from reference")).toBeVisible({ timeout: 20_000 });
  await expect(p.getByText("Difference = reference minus witness")).toBeVisible();
  const rowB = p.getByRole("row", { name: /Party B/ });
  await expect(rowB).toContainText("+60");
  await expect(rowB).toContainText("Reference is 60 higher");
  await expect(p.getByRole("heading", { name: "Why no allegation is made" })).toBeVisible();
  await expect(p.getByText("Source confirmed by a second reviewer")).toBeVisible();
  await expect(p.getByText("Sample reference (fictional)")).toBeVisible();
  // Redaction: no images, no links to originals or ProofTrails, no reviewer tools, no alias.
  await expect(p.locator("main img")).toHaveCount(0);
  await expect(p.locator('a[href*="/api/evidence"], a[href^="/evidence/"]')).toHaveCount(0);
  await expect(p.getByRole("link", { name: "Reference records for this unit" })).toHaveCount(0);
  await expect(p.getByText(/Synthetic Demo Reviewer|Reviewer [AB]\b|Anonymous contributor/)).toHaveCount(0);
  await shot(p, "unit-discrepancy-public");

  // ---- An empty unit renders NO_EVIDENCE (only shot if one exists without data).
  if (SHOTS) {
    for (const id of ["demo-pu-007", "demo-pu-002", "demo-pu-001"]) {
      const r = await p.request.get(`/api/units/${id}/verification?electionId=demo-election`);
      if (r.ok() && (await r.json()).status === "NO_EVIDENCE") {
        await p.goto(`/units/${id}`);
        await expect(p.getByText("No evidence yet")).toBeVisible({ timeout: 20_000 });
        await shot(p, "unit-no-evidence");
        break;
      }
    }
  }

  for (const ctx of [c1.ctx, c2.ctx, a.ctx, b.ctx, pub]) await ctx.close();
});

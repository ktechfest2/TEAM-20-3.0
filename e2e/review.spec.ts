import { expect as baseExpect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Figures + review slice, all synthetic demo data:
 * capture → upload → ProofTrail → DEMO_FIXTURE figures → human correction → confirm →
 * (new browser) demo reviewer A → queue → accept with reason → decision on the ProofTrail.
 * Set POLLTRACE_SHOTS_DIR to also save screenshots (figures steps at 360/390/768/1280 + 360x400).
 */

// Dev server compiles each route on first visit; with parallel workers that can exceed 5s.
const expect = baseExpect.configure({ timeout: 20_000 });

const PHOTO = path.join(__dirname, "synthetic-result-sheet.png");
const SHOTS = process.env.POLLTRACE_SHOTS_DIR;

const SIZES = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 900 },
];

/** Full-page shot at each width plus a viewport-only shot at 360x740 (shows sticky elements in place). */
async function shot(page: Page, name: string, sizes = [SIZES[0], SIZES[3]]) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const original = page.viewportSize();
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SHOTS, `${name}-${size.width}x${size.height}.png`), fullPage: true });
  }
  if (original) await page.setViewportSize(original);
}

/**
 * Keyboard-open simulation (visible area ~360x400): with Party C focused, the photo panel and the
 * focused field must both be in view. Asserted always; screenshots only with POLLTRACE_SHOTS_DIR.
 */
async function assertPhotoAndFieldVisible(page: Page, label: string, file?: string) {
  const original = page.viewportSize();
  await page.setViewportSize({ width: 360, height: 400 });
  const field = page.getByLabel(label, { exact: true });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await field.focus();
  await page.waitForTimeout(200);
  const photo = page.getByRole("region", { name: /Original photo for/ });
  await expect(photo).toBeInViewport({ ratio: 0.9 });
  await expect(field).toBeInViewport({ ratio: 1 });
  const [p, f] = await Promise.all([photo.boundingBox(), field.boundingBox()]);
  expect(p && f && f.y >= p.y + p.height).toBeTruthy(); // field is below the photo, not under it
  if (SHOTS && file) await page.screenshot({ path: path.join(SHOTS, file) });
  if (original) await page.setViewportSize(original);
}

async function captureAndUpload(page: Page): Promise<string> {
  await page.goto("/capture");
  await page.getByLabel("Search by polling unit code or name").fill("99-05-02-201");
  await page.getByRole("radio", { name: /99-05-02-201/ }).check();
  await page.getByRole("button", { name: "Yes, this is the polling unit" }).click();
  await page.locator('input[type="file"]:not([capture])').setInputFiles(PHOTO);
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
  return page.url().split("/evidence/")[1];
}

test("figures are confirmed by the sender, then a demo reviewer records a decision", async ({ page, browser }) => {
  test.setTimeout(180_000);

  // ---- Contributor: capture and upload.
  const id = await captureAndUpload(page);
  await expect(page.getByRole("heading", { level: 1, name: /Result photo for 99-05-02-201/ })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/Sample units \(code 99-…\) and their figures are fictional/)).toBeVisible();
  await expect(page.getByText("Source integrity confirmed")).toBeVisible();
  await expect(page.getByText("No figures yet.")).toBeVisible();
  // The owner never sees review controls.
  await expect(page.getByRole("heading", { name: "Your review" })).toHaveCount(0);
  await shot(page, "evidence-owner-new");

  // ---- Figures: choose DEMO_FIXTURE.
  await page.getByRole("link", { name: "Read the figures" }).click();
  await expect(page.getByRole("heading", { name: "Enter the figures" })).toBeVisible();
  // Either AI reading is offered (server has a vision provider configured) or the page says it is not.
  await expect(
    page
      .getByText("Automatic reading is not available in this version.")
      .or(page.getByRole("radio", { name: /Read the figures with AI/ })),
  ).toBeVisible();
  await shot(page, "figures-mode", SIZES);
  if (SHOTS) {
    await page.setViewportSize(SIZES[0]);
    await page.screenshot({ path: path.join(SHOTS, "figures-mode-360x740-viewport.png") });
  }
  await page.getByRole("radio", { name: /Load sample figures/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Type the figures" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Check each number against the photo before you confirm.")).toBeVisible();
  const partyB = page.getByLabel("Party B", { exact: true });
  const demoValue = await partyB.inputValue();
  expect(demoValue).toMatch(/^\d+$/);
  const corrected = String(Number(demoValue) + 5);
  await partyB.fill(corrected);

  // Typing survives a refresh (local draft).
  await page.reload();
  await expect(page.getByLabel("Party B", { exact: true })).toHaveValue(corrected, { timeout: 20_000 });
  await shot(page, "figures-enter", SIZES);
  await assertPhotoAndFieldVisible(page, "Party C", "figures-enter-360x400-partyC-focused.png");
  if (SHOTS) {
    // Sticky check at a normal phone height: scrolled down to the totals, photo still on top.
    await page.setViewportSize(SIZES[0]);
    await page.getByLabel("Total valid votes", { exact: true }).focus();
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SHOTS, "figures-enter-360x740-scrolled.png") });
  }

  await page.getByRole("button", { name: "Check before confirming" }).click();
  await expect(page.getByRole("heading", { name: "Check before you confirm" })).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(`Party B.*${corrected}`) })).toBeVisible();
  await shot(page, "figures-check", SIZES);
  if (SHOTS) {
    await page.setViewportSize(SIZES[0]);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(SHOTS, "figures-check-360x740-viewport.png") });
  }
  await page.getByRole("button", { name: "Confirm figures" }).click();

  // ---- Back on the ProofTrail: a new human-confirmed version, earlier one kept.
  await page.waitForURL(new RegExp(`/evidence/${id}\\?confirmed=2`));
  await expect(page.getByText(/Figures confirmed and saved as version/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Confirmed by sender").first()).toBeVisible();
  await expect(page.locator("#v1")).toBeVisible();
  await expect(page.locator("#v2")).toContainText("Changed from version 1");
  await expect(page.locator("#v2")).toContainText(`Party B: was ${demoValue}`);
  await expect(page.getByText("Waiting for review").first()).toBeVisible();
  await shot(page, "evidence-owner-confirmed");

  // ---- Contributor cannot review: queue page shows no data; API refuses.
  await page.goto("/review");
  await expect(page.getByRole("heading", { name: "This page is for reviewers" })).toBeVisible();
  const asContributor = await page.request.post(`/api/evidence/${id}/review`, {
    data: { decision: "ACCEPTED", independenceStatus: "UNVERIFIED", reason: "self review attempt" },
  });
  expect(asContributor.status()).toBe(403);

  // ---- Reviewer, in a separate browser context (fresh cookies and IndexedDB).
  const reviewerCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const rp = await reviewerCtx.newPage();
  await rp.goto("/reviewer");
  await expect(rp.getByRole("heading", { name: "Reviewer sign-in" })).toBeVisible({ timeout: 20_000 });
  await expect(rp.getByText("Sample reviewer accounts for this test build.")).toBeVisible();
  await shot(rp, "reviewer-signin");
  await rp.getByRole("radio", { name: /Reviewer A/ }).check();
  // Production deployments require the demo passcode; local dev does not show the field.
  const passcode = rp.getByLabel("Reviewer passcode");
  if (await passcode.isVisible()) {
    const value = process.env.POLLTRACE_E2E_REVIEWER_PASSCODE;
    if (!value) throw new Error("Set POLLTRACE_E2E_REVIEWER_PASSCODE to run this test against a deployment.");
    await passcode.fill(value);
  }
  await rp.getByRole("button", { name: "Sign in as reviewer" }).click();

  await rp.waitForURL(/\/review$/);
  await expect(rp.getByText("Signed in as Reviewer A", { exact: true })).toBeVisible();
  await expect(rp.getByRole("link", { name: /^Review/ })).toBeVisible();
  await expect(rp.getByRole("link", { name: "Capture" })).toHaveCount(0);
  const open = rp.locator(`a[href="/evidence/${id}#review"]`).filter({ visible: true });
  await expect(open).toBeVisible({ timeout: 20_000 });
  await shot(rp, "review-queue");
  await open.click();

  await expect(rp.getByRole("heading", { name: "Your review" })).toBeVisible({ timeout: 20_000 });
  await expect(rp.getByRole("radio", { name: /Accept: usable in comparison/ })).toBeEnabled();
  await expect(rp.getByRole("radio", { name: /Not assessed/ })).toBeChecked();
  await shot(rp, "evidence-reviewer");

  // The reason is required.
  await rp.getByRole("radio", { name: /Accept: usable in comparison/ }).check();
  await rp.getByRole("button", { name: "Continue to confirm" }).click();
  await expect(rp.getByText("Write a short reason. A few words are enough.").first()).toBeVisible();

  await rp.getByRole("textbox", { name: "Reason" }).fill("Sheet readable; confirmed figures match the photo. Synthetic demo review.");
  await rp.getByRole("button", { name: "Continue to confirm" }).click();
  await expect(rp.getByRole("heading", { name: "Record this decision?" })).toBeVisible();
  await shot(rp, "evidence-reviewer-confirm");
  await rp.getByRole("button", { name: "Record decision" }).click();

  await expect(rp.getByText(/Decision recorded at/)).toBeVisible({ timeout: 20_000 });
  const decisions = rp.getByRole("region", { name: "Review decisions" }).or(rp.locator("section", { has: rp.getByRole("heading", { name: "Review decisions" }) }));
  await expect(decisions.first()).toContainText("Accepted");
  await expect(decisions.first()).toContainText("Independence: Not assessed");
  await expect(rp.getByText("Accepted by reviewer")).toBeVisible();
  await expect(rp.getByText(/Review\.\s*A reviewer accepted this evidence/)).toBeVisible();
  await shot(rp, "evidence-reviewer-recorded");

  // ---- The owner sees the decision too.
  await page.goto(`/evidence/${id}`);
  await expect(page.getByText("Accepted by reviewer")).toBeVisible({ timeout: 20_000 });

  // ---- Reviewer cannot upload from this device (server refuses REVIEWER_SESSION).
  const init = await rp.request.post("/api/evidence/uploads", {
    data: {
      electionId: "demo-election",
      pollingUnitId: "demo-pu-201",
      clientSubmissionId: crypto.randomUUID(),
      originalSha256: "0".repeat(64),
      sizeBytes: 10,
      mime: "image/png",
    },
  });
  expect(init.status()).toBe(403);
  expect((await init.json()).error.code).toBe("REVIEWER_SESSION");

  await reviewerCtx.close();
});

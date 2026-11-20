import { expect as baseExpect, test, type Browser, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * LIVE AI end-to-end (real model, real server). Skipped unless POLLTRACE_E2E_LIVE_AI=1, because it
 * needs a configured vision provider key on the server and sends the synthetic sample sheet to an
 * outside AI service. Uses the reserved test unit demo-pu-201, never the live demo unit.
 * The sample sheet public/demo/synthetic-result-sheet.jpg is synthetic and reads 145 / 210 / 42.
 */

const expect = baseExpect.configure({ timeout: 30_000 });
// Synthetic sheet printed for the reserved test unit DEMO.01.02.201 (reads 145 / 210 / 42), so the
// polling-unit code on the sheet matches the chosen unit and review is not (rightly) blocked.
const SHEET = path.join(__dirname, "synthetic-sheet-201.jpg");
const SHEET_SHA256 = createHash("sha256").update(readFileSync(SHEET)).digest("hex");

test.skip(process.env.POLLTRACE_E2E_LIVE_AI !== "1", "set POLLTRACE_E2E_LIVE_AI=1 (server needs a vision provider key)");

async function signInReviewer(browser: Browser, who: "A" | "B"): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("/reviewer");
  await page.getByRole("radio", { name: new RegExp(`Synthetic Demo Reviewer ${who}`) }).check();
  const passcode = page.getByLabel("Demo passcode");
  if (await passcode.isVisible()) {
    const value = process.env.POLLTRACE_E2E_REVIEWER_PASSCODE;
    if (!value) throw new Error("Set POLLTRACE_E2E_REVIEWER_PASSCODE to run this test against a deployment.");
    await passcode.fill(value);
  }
  await page.getByRole("button", { name: "Sign in as demo reviewer" }).click();
  await page.waitForURL(/\/review$/);
  return page;
}

test("live AI: suggestions → person changes one value and ticks uncertain ones → confirm → reviewer accepts", async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);

  // Capture + upload the synthetic sample sheet on the reserved test unit.
  await page.goto("/capture");
  await page.getByLabel("Search by polling unit code or name").fill("201");
  await page.getByRole("radio", { name: /DEMO\.01\.02\.201/ }).check();
  await page.getByRole("button", { name: "Yes, this is the polling unit" }).click();
  await page.locator('input[type="file"]:not([capture])').setInputFiles(SHEET);
  await expect(page.getByRole("heading", { name: "Check your photo" })).toBeVisible();
  await page.getByRole("radio", { name: "A voter or witness at this polling unit" }).check();
  await page.getByRole("button", { name: "Save this photo" }).click();
  const received = page.getByRole("heading", { name: "Received by server" });
  const uploadNow = page.getByRole("button", { name: "Upload now" });
  await expect(received.or(uploadNow).first()).toBeVisible();
  if (await uploadNow.isVisible()) await uploadNow.click();
  await expect(received).toBeVisible();
  await page.getByRole("link", { name: "View ProofTrail" }).click();
  await page.waitForURL(/\/evidence\/[0-9a-f-]{36}$/);
  const evidenceId = page.url().split("/evidence/")[1];

  // Read with AI and wait (up to 90 s) for the suggestions.
  await page.getByRole("link", { name: "Read the figures" }).click();
  await page.getByRole("radio", { name: /Read the figures with AI/ }).check();
  await page.getByRole("button", { name: "Read with AI" }).click();
  await expect(page.getByText("AI suggestions — check every number.")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/Read by .+ at .+ · took \d+ s/)).toBeVisible();

  // Change one value (Party C → its AI value + 1, so the confirmed figure differs from the suggestion).
  const partyC = page.locator("#f-PARTY_C");
  const suggested = Number((await partyC.inputValue()) || "42");
  await partyC.fill(String(suggested + 1));
  await expect(page.getByText(new RegExp(`Changed by you \\(AI suggested`))).toBeVisible();

  // Tick every remaining uncertain value; resolve anything the AI could not read.
  for (const box of await page.getByRole("checkbox", { name: "I checked this on the photo" }).all()) await box.check();
  for (const key of ["PARTY_A", "PARTY_B", "accreditedVoters", "rejectedVotes", "validVotes"]) {
    const input = page.locator(`#f-${key}`);
    if ((await input.isEnabled()) && (await input.inputValue()) === "") {
      await input.locator("xpath=..").getByRole("checkbox", { name: "I can’t read this" }).check();
    }
  }

  await page.getByRole("button", { name: "Check before confirming" }).click();
  await expect(page.getByRole("heading", { name: "Check before you confirm" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm figures" }).click();
  await page.waitForURL(new RegExp(`/evidence/${evidenceId}\\?confirmed=`));

  // Reviewer A accepts.
  const rp = await signInReviewer(browser, "A");
  await rp.goto(`/evidence/${evidenceId}#review`);
  await rp.getByRole("radio", { name: /Accept: usable in comparison/ }).check();
  await rp.getByRole("textbox", { name: "Reason" }).fill("Live AI E2E: confirmed figures match the synthetic sheet.");
  await rp.getByRole("button", { name: "Continue to confirm" }).click();
  await rp.getByRole("button", { name: "Record decision" }).click();
  await expect(rp.getByText(/Decision recorded at/)).toBeVisible();

  // Evidence page: confirmed figures, AI version with provenance, diff naming the AI value.
  await page.goto(`/evidence/${evidenceId}`);
  await expect(page.getByText("Accepted by reviewer")).toBeVisible();
  await expect(page.getByText(/Based on an AI suggestion \(version 1\)/)).toBeVisible();
  await expect(page.locator("#v1")).toContainText("AI model");
  await expect(page.locator("#v1")).toContainText(/Read by .+ \(.+\) at/);
  await expect(page.locator("#v2")).toContainText("Changed from version 1 (AI suggestion)");
  await expect(page.locator("#v2")).toContainText(`Party C: AI suggested`);

  // The stored original is byte-for-byte the uploaded file: AI reading used a separate copy.
  const storedSha = await page.evaluate(async (id) => {
    const res = await fetch(`/api/evidence/${id}/original`, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`original fetch ${res.status}`);
    const digest = await crypto.subtle.digest("SHA-256", await res.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  }, evidenceId);
  expect(storedSha).toBe(SHEET_SHA256);
  console.log(`[ai-live] evidence ${evidenceId}: stored original sha256 matches uploaded file`);
});

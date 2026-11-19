import { expect, test } from "@playwright/test";
import path from "node:path";

const PHOTO = path.join(__dirname, "synthetic-result-sheet.png");

test("capture → local receipt survives refresh → uploads exactly once", async ({ page }) => {
  const evidencePosts: number[] = [];
  page.on("response", (r) => {
    if (r.url().endsWith("/api/evidence") && r.request().method() === "POST") evidencePosts.push(r.status());
  });

  // Step 1: choose and explicitly confirm the polling unit.
  await page.goto("/capture");
  await expect(page.getByRole("note", { name: "Demo data notice" })).toBeVisible();
  await page.getByLabel("Search by polling unit code or name").fill("012");
  await page.getByRole("radio", { name: /DEMO\.00\.00\.012/ }).check();
  await page.getByRole("button", { name: "Yes, this is the polling unit" }).click();

  // Step 2: pick the original photo (gallery path; camera needs a device).
  await expect(page.getByRole("heading", { name: "Photograph the result sheet" })).toBeVisible();
  await page.locator('input[type="file"]:not([capture])').setInputFiles(PHOTO);
  await expect(page.getByRole("heading", { name: "Check your photo" })).toBeVisible();

  // Role is required: saving without it shows an inline prompt, nothing is stored.
  await page.getByRole("button", { name: "Save this photo" }).click();
  await expect(page.getByText("Choose one to save the photo.")).toBeVisible();
  await page.getByRole("radio", { name: "A voter or witness at this polling unit" }).check();

  // Server unreachable: the capture must still be saved locally.
  await page.route("**/api/evidence**", (route) => route.abort("internetdisconnected"));
  await page.getByRole("button", { name: "Save this photo" }).click();

  await expect(page.getByRole("heading", { name: "Saved on this device" })).toBeVisible();
  await expect(page.getByText("Not yet received by server.")).toBeVisible();
  const fingerprint = await page.locator("dd .font-mono.text-lg").first().innerText();
  const receiptUrl = page.url();
  expect(receiptUrl).toContain("step=receipt");

  // Refresh: receipt and fingerprint survive (IndexedDB), still not received.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Saved on this device" })).toBeVisible();
  await expect(page.locator("dd .font-mono.text-lg").first()).toHaveText(fingerprint);
  await expect(page.getByText("Source integrity confirmed.")).toHaveCount(0);

  // Queue shows it as saved locally, never as received.
  await page.goto("/submissions");
  await expect(page.getByRole("heading", { name: /Saved on this device \(1\)/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Received by server/ })).toHaveCount(0);

  // Server reachable again: re-opening the app retries automatically with the same
  // clientSubmissionId; the server re-hashes and acknowledges.
  await page.unroute("**/api/evidence**");
  await page.goto(receiptUrl);
  await expect(page.getByRole("heading", { name: "Received by server" })).toBeVisible();
  await expect(page.getByText("Source integrity confirmed.")).toBeVisible();

  // Exactly one accepted upload; re-opening does not upload again.
  await page.goto("/submissions");
  await expect(page.getByRole("heading", { name: /Received by server \(1\)/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: /Received by server \(1\)/ })).toBeVisible();
  expect(evidencePosts.filter((s) => s === 200 || s === 201)).toHaveLength(1);
});

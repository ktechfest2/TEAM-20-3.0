import { expect, test, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const PHOTO = path.join(__dirname, "synthetic-result-sheet.png");

/** Valid PNG of random (incompressible) pixels, so file size ≈ width*height*3 bytes. */
function noisePng(width: number, height: number): string {
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
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) rows.push(Buffer.concat([Buffer.from([0]), randomBytes(width * 3)]));
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows), { level: 0 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "polltrace-e2e-")), "synthetic-large-sheet.png");
  writeFileSync(file, png);
  return file;
}

/** Records responses of the 3-step upload so tests can assert "exactly once". */
function trackUploads(page: Page) {
  const seen = { init: [] as number[], put: [] as Array<{ status: number; host: string }>, finalize: [] as number[] };
  page.on("response", (r) => {
    const url = new URL(r.url());
    const method = r.request().method();
    if (method === "POST" && url.pathname === "/api/evidence/uploads") seen.init.push(r.status());
    if (method === "POST" && url.pathname === "/api/evidence/uploads/finalize") seen.finalize.push(r.status());
    if (method === "PUT") seen.put.push({ status: r.status(), host: url.host });
  });
  return seen;
}

async function captureUpToSave(page: Page, photo: string) {
  await page.goto("/capture");
  await page.getByLabel("Search by polling unit code or name").fill("012");
  await page.getByRole("radio", { name: /DEMO\.00\.00\.012/ }).check();
  await page.getByRole("button", { name: "Yes, this is the polling unit" }).click();
  await page.locator('input[type="file"]:not([capture])').setInputFiles(photo);
  await expect(page.getByRole("heading", { name: "Check your photo" })).toBeVisible();
  await page.getByRole("radio", { name: "An accredited observer or party agent" }).check();
}

test("capture → local receipt survives refresh → uploads exactly once", async ({ page }) => {
  const uploads = trackUploads(page);

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
  // Three round trips to remote storage (plus first-hit route compile in dev): allow time.
  await expect(page.getByRole("heading", { name: "Received by server" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Source integrity confirmed.")).toBeVisible();

  // Exactly one accepted upload; re-opening does not upload again.
  await page.goto("/submissions");
  await expect(page.getByRole("heading", { name: /Received by server \(1\)/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: /Received by server \(1\)/ })).toBeVisible();
  expect(uploads.finalize.filter((s) => s === 201)).toHaveLength(1);
  expect(uploads.put.filter((p) => p.status >= 200 && p.status < 300)).toHaveLength(1);
});

// Network-bound (12 MB up, plus finalize's server-side download/re-upload, which in local dev
// also crosses this machine's uplink). Opt-in: POLLTRACE_E2E_LARGE=1 npx playwright test
test("a ~12 MB original goes straight to storage and is re-hashed by the server", async ({ page }) => {
  test.skip(process.env.POLLTRACE_E2E_LARGE !== "1", "set POLLTRACE_E2E_LARGE=1 to run the large-upload test");
  test.setTimeout(330_000);
  const big = noisePng(2000, 2000); // ≈12 MB, above the serverless request-body limit
  const uploads = trackUploads(page);
  await captureUpToSave(page, big);
  await page.getByRole("button", { name: "Save this photo" }).click();
  await expect(page.getByRole("heading", { name: "Saved on this device" })).toBeVisible();
  await page.getByRole("button", { name: "Upload now" }).click();
  await expect(page.getByRole("heading", { name: "Received by server" })).toBeVisible({ timeout: 300_000 });
  await expect(page.getByText("Source integrity confirmed.")).toBeVisible();
  await expect(page.getByText("Accredited observer or party agent")).toBeVisible();
  expect(uploads.finalize).toEqual([201]);
  expect(uploads.put).toHaveLength(1);
  expect(uploads.put[0].status).toBeLessThan(300);
  console.log(`large upload PUT host: ${uploads.put[0].host}`);
});

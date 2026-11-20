import { expect as baseExpect, test, type Page, type Route } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * UI-STATE COVERAGE ONLY — NOT PROOF OF LIVE AI.
 * Every /trace, /extract, /confirm and /original response below is MOCKED in the browser with
 * Playwright route handlers, so these tests show how the figures flow and the evidence page render
 * each AI state (mode, extracting, ready for review, failures, confirmed). No AI model is called.
 * The real end-to-end AI test is e2e/ai-live.spec.ts (skipped unless POLLTRACE_E2E_LIVE_AI=1).
 */

const expect = baseExpect.configure({ timeout: 20_000 });
const SHOTS = process.env.POLLTRACE_SHOTS_DIR;
const ID = "aaaaaaaa-0000-4000-8000-00000000a1a1";
const SHA = "ab".repeat(32);
const SHEET = readFileSync(path.join(__dirname, "..", "public", "demo", "synthetic-result-sheet.jpg"));
const T0 = "2026-11-20T09:00:00.000Z";
const T1 = "2026-11-20T09:01:00.000Z";
const T2 = "2026-11-20T09:05:00.000Z";

const AI_REVISION = {
  id: "rev-ai-1",
  revisionNumber: 1,
  origin: "REAL_VISION",
  extractionMode: "REAL_VISION",
  formType: "EC8A",
  pollingUnitCodeOnSheet: "DEMO.01.02.210",
  entries: [
    { partyCode: "PARTY_A", votes: 145, needsReview: false },
    { partyCode: "PARTY_B", votes: 201, needsReview: true },
    { partyCode: "PARTY_C", votes: 42, needsReview: false },
  ],
  accreditedVoters: 410,
  rejectedVotes: 3,
  validVotes: null,
  warnings: ["The total valid votes box was hard to read."],
  uncertainFields: ["PARTY_A", "PARTY_B", "validVotes"],
  provenance: { provider: "anthropic", model: "mock-vision-model", extractedAt: T1, durationMs: 18_400 },
  humanConfirmed: false,
  basedOnRevision: null,
  note: null,
  createdAt: T1,
  createdByViewer: false,
};

const HUMAN_REVISION = {
  ...AI_REVISION,
  id: "rev-human-2",
  revisionNumber: 2,
  origin: "HUMAN_CORRECTION",
  extractionMode: null,
  pollingUnitCodeOnSheet: "DEMO.01.02.210",
  entries: [
    { partyCode: "PARTY_A", votes: 145, needsReview: false },
    { partyCode: "PARTY_B", votes: 210, needsReview: false },
    { partyCode: "PARTY_C", votes: 42, needsReview: false },
  ],
  validVotes: 397,
  warnings: [],
  uncertainFields: [],
  provenance: null,
  humanConfirmed: true,
  basedOnRevision: 1,
  createdAt: T2,
  createdByViewer: true,
};

function trace(revisions: unknown[], status = "RECEIVED") {
  const timeline: unknown[] = [
    { type: "CAPTURE_CLAIMED", at: "2026-11-20T08:59:00.000Z", summary: "Phone clock says the photo was saved.", ref: null, claimOnly: true },
    { type: "RECEIVED", at: T0, summary: "Server received the file and recomputed its fingerprint; it matched.", ref: null, claimOnly: false },
  ];
  if (revisions.length >= 1)
    timeline.push({ type: "EXTRACTION", at: T1, summary: "An AI model suggested figures — not checked yet.", ref: "1", claimOnly: false });
  if (revisions.length >= 2)
    timeline.push({
      type: "HUMAN_CONFIRMATION",
      at: T2,
      summary: "A person checked the figures against the photo and confirmed them.",
      ref: "2",
      claimOnly: false,
    });
  return {
    evidence: {
      id: ID,
      electionId: "demo-election",
      pollingUnitId: "demo-pu-201",
      pollingUnitCode: "DEMO.01.02.201",
      pollingUnitName: "Synthetic Civic Centre",
      sourceType: "WITNESS_PHOTO",
      status,
      sha256: SHA,
      mime: "image/jpeg",
      sizeBytes: SHEET.byteLength,
      capturedAtClaimed: "2026-11-20T08:59:00.000Z",
      receivedAt: T0,
      synthetic: true,
      storageMode: "LOCAL_DEV",
    },
    integrity: { serverHashMatchedClient: true, exactDuplicateCount: 0 },
    revisions,
    reviews: [],
    timeline,
    viewer: "OWNER",
    permissions: {
      canExtract: true,
      canConfirm: true,
      canReview: false,
      reviewBlockedReason: "Only reviewers can record a decision.",
      availableExtractionModes: ["REAL_VISION", "MANUAL", "DEMO_FIXTURE"],
    },
    originalUrl: `/api/evidence/${ID}/original`,
  };
}

type Mock = {
  revisions: unknown[];
  status: string;
  extract: (route: Route, mode: string) => Promise<void>;
  extractCalls: string[];
};

async function mockApi(page: Page, extract: Mock["extract"]): Promise<Mock> {
  const m: Mock = { revisions: [], status: "RECEIVED", extract, extractCalls: [] };
  await page.route(`**/api/evidence/${ID}/trace`, (r) => r.fulfill({ json: trace(m.revisions, m.status) }));
  await page.route(`**/api/evidence/${ID}/original**`, (r) =>
    r.fulfill({ body: SHEET, headers: { "content-type": "image/jpeg" } }),
  );
  await page.route(`**/api/evidence/${ID}/extract`, async (r) => {
    const mode = (r.request().postDataJSON() as { mode: string }).mode;
    m.extractCalls.push(mode);
    await m.extract(r, mode);
  });
  await page.route(`**/api/evidence/${ID}/confirm`, async (r) => {
    m.revisions = [AI_REVISION, HUMAN_REVISION];
    m.status = "PENDING_REVIEW";
    await r.fulfill({ status: 201, json: HUMAN_REVISION });
  });
  return m;
}

const extractOk = (m: { revisions: unknown[] }, delayMs = 0) => async (route: Route) => {
  if (delayMs) await new Promise((res) => setTimeout(res, delayMs));
  m.revisions = [AI_REVISION];
  await route
    .fulfill({
      status: 201,
      json: {
        revision: AI_REVISION,
        modeUsed: "REAL_VISION",
        availableModes: ["REAL_VISION", "MANUAL", "DEMO_FIXTURE"],
        notice: "AI suggestions: check every number against the photo.",
      },
    })
    .catch(() => undefined); // request may have been aborted by "Stop and type myself"
};

const SIZES = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 900 },
];

async function shot(page: Page, name: string, fullPage = true) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const original = page.viewportSize();
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SHOTS, `${name}-${size.width}.png`), fullPage });
  }
  if (original) await page.setViewportSize(original);
}

/** The photo panel stays visible with zoom controls at 360x400 (keyboard-open size). */
async function photoVisibleAt360x400(page: Page) {
  const original = page.viewportSize();
  await page.setViewportSize({ width: 360, height: 400 });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  await expect(page.getByRole("region", { name: /Original photo for/ })).toBeInViewport({ ratio: 0.8 });
  await expect(page.getByRole("button", { name: "Zoom in" })).toBeInViewport();
  if (original) await page.setViewportSize(original);
}

const BANNED = /verified|accurate|AI-verified|smart|trusted|confidence|magic|instantly/i;

async function noBannedWords(page: Page) {
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(BANNED);
  expect(text.replace(/zoom \d+%/gi, "")).not.toMatch(/\d+\s?%/);
}

test.describe("AI reading UI states (mocked API, not live AI)", () => {
  test("mode → extracting → ready for review → tick gate → check → confirmed evidence page", async ({ page }) => {
    test.setTimeout(180_000);
    const m = await mockApi(page, async (route) => extractOk(m, 3_500)(route));
    await page.goto(`/evidence/${ID}/figures`);

    // NOT_STARTED
    await expect(page.getByRole("heading", { name: "Enter the figures" })).toBeVisible();
    await expect(page.getByText("It can make mistakes.", { exact: false })).toBeVisible();
    await expect(page.getByText("Your photo is sent to an outside AI service to be read.")).toBeVisible();
    for (const name of [/Read the figures with AI/, /Type the figures yourself/, /Load demo figures/])
      await expect(page.getByRole("radio", { name })).not.toBeChecked();
    await noBannedWords(page);
    await shot(page, "ai-1-mode");
    await photoVisibleAt360x400(page);

    // EXTRACTING: one request even on a double click; honest counter; no percentage.
    await page.getByRole("radio", { name: /Read the figures with AI/ }).check();
    await page.getByRole("button", { name: "Read with AI" }).dblclick();
    await expect(page.getByText("Reading the figures…")).toBeVisible();
    await expect(page.getByText(/Waiting \d+ s/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop and type myself" })).toBeVisible();
    await expect(page.getByRole("progressbar")).toHaveCount(0);
    await noBannedWords(page);
    await shot(page, "ai-2-extracting");

    // READY_FOR_REVIEW
    await expect(page.getByText("AI suggestions — check every number.")).toBeVisible();
    expect(m.extractCalls).toEqual(["REAL_VISION"]);
    await expect(page.getByText(/Read by mock-vision-model at/)).toBeVisible();
    await expect(page.getByText(/numbers the AI was not sure about are marked below/)).toBeVisible();
    await expect(page.getByText("The AI was not sure about this number. Look closely at the photo.")).toHaveCount(2);
    await expect(page.getByText("The AI could not read this.", { exact: false })).toBeVisible();
    await expect(page.getByText(/The unit is not changed\./)).toBeVisible();
    await expect(page.getByText("Noted when the AI read the photo:")).toBeVisible();
    await noBannedWords(page);
    await shot(page, "ai-3-ready");
    await photoVisibleAt360x400(page);

    // Gate: uncertain values with no tick block "Check before confirming".
    await page.getByRole("button", { name: "Check before confirming" }).click();
    await expect(page.getByText("Check Party A against the photo, then tick “I checked this on the photo”.")).toBeVisible();
    await expect(page.getByText("Check Party B against the photo", { exact: false })).toBeVisible();
    await shot(page, "ai-4-gate");

    // Resolve: tick Party A, edit Party B (edit clears the need to tick), type the unread total.
    const rowA = page.locator("#f-PARTY_A").locator("xpath=..");
    await rowA.getByRole("checkbox", { name: "I checked this on the photo" }).check();
    await page.locator("#f-PARTY_B").fill("210");
    await expect(page.getByText("Changed by you (AI suggested 201)")).toBeVisible();
    await page.locator("#f-validVotes").fill("397");

    // Reload keeps typing, AI flags and ticks.
    await page.reload();
    await expect(page.locator("#f-PARTY_B")).toHaveValue("210");
    await expect(page.getByText("Changed by you (AI suggested 201)")).toBeVisible();
    await expect(rowA.getByRole("checkbox", { name: "I checked this on the photo" })).toBeChecked();

    await page.getByRole("button", { name: "Check before confirming" }).click();
    await expect(page.getByRole("heading", { name: "Check before you confirm" })).toBeVisible();
    await expect(page.getByText("AI suggestions you keep become your confirmed figures.")).toBeVisible();
    await expect(page.getByRole("row", { name: /Party A.*kept after checking/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /Party B.*Changed by you/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /Total valid votes.*Typed by you/ })).toBeVisible();
    await noBannedWords(page);
    await shot(page, "ai-5-check");

    await page.getByRole("button", { name: "Confirm figures" }).click();

    // HUMAN_CONFIRMED on the evidence page.
    await page.waitForURL(new RegExp(`/evidence/${ID}\\?confirmed=2`));
    await expect(page.getByText(/Based on an AI suggestion \(version 1\)\. 2 of 6 numbers changed by the person\./)).toBeVisible();
    await expect(page.getByText("Changed from version 1 (AI suggestion)")).toBeVisible();
    await expect(page.locator("#v2")).toContainText("Party B: AI suggested");
    await expect(page.locator("#v2")).toContainText("Kept as suggested: Party A, Party C");
    await expect(page.locator("#v1")).toContainText("AI model");
    await expect(page.locator("#v1")).toContainText("Read by mock-vision-model (anthropic)");
    await expect(page.locator("#v1")).toContainText("The AI was not sure about: Party A, Party B, Total valid votes.");
    await expect(page.getByText("AI suggestion. An AI model suggested figures — not checked yet.")).toBeVisible();
    await noBannedWords(page);
    await shot(page, "ai-6-evidence-confirmed");
  });

  test("reviewer: Accept is blocked when the sheet shows a different polling-unit code", async ({ page }) => {
    const m = await mockApi(page, (route) => route.abort());
    m.revisions = [AI_REVISION, HUMAN_REVISION];
    m.status = "PENDING_REVIEW";
    await page.route(`**/api/evidence/${ID}/trace`, (r) => {
      const t = trace(m.revisions, m.status);
      return r.fulfill({
        json: {
          ...t,
          viewer: "REVIEWER",
          permissions: { ...t.permissions, canConfirm: false, canExtract: false, canReview: true, reviewBlockedReason: null },
        },
      });
    });
    await page.goto(`/evidence/${ID}#review`);
    await expect(page.getByText(/The sheet shows a different polling-unit code \(DEMO\.01\.02\.210\)/)).toBeVisible();
    await expect(page.getByRole("radio", { name: /Accept: usable in comparison/ })).toBeDisabled();
    await expect(
      page.getByText("Not available: the sheet shows polling unit DEMO.01.02.210, not DEMO.01.02.201."),
    ).toBeVisible();
    await shot(page, "ai-9-reviewer-pu-mismatch");
  });

  test("stop waiting and type myself", async ({ page }) => {
    const m = await mockApi(page, async (route, mode) => {
      if (mode === "REAL_VISION") return extractOk(m, 60_000)(route); // never answers in time
      m.revisions = [{ ...AI_REVISION, id: "rev-manual-1", origin: "MANUAL", extractionMode: "MANUAL", provenance: null, uncertainFields: [], entries: AI_REVISION.entries.map((e) => ({ ...e, votes: null, needsReview: true })), accreditedVoters: null, rejectedVotes: null, validVotes: null, warnings: [], pollingUnitCodeOnSheet: null }];
      await route.fulfill({
        status: 201,
        json: { revision: m.revisions[0], modeUsed: "MANUAL", availableModes: ["REAL_VISION", "MANUAL"], notice: "Type each number as you read it on the photo." },
      });
    });
    await page.goto(`/evidence/${ID}/figures`);
    await page.getByRole("radio", { name: /Read the figures with AI/ }).check();
    await page.getByRole("button", { name: "Read with AI" }).click();
    await page.getByRole("button", { name: "Stop and type myself" }).click();
    await expect(page.getByRole("heading", { name: "Type the figures" })).toBeVisible();
    await expect(page.getByText("Stopped waiting. If the AI finishes later", { exact: false })).toBeVisible();
    expect(m.extractCalls).toEqual(["REAL_VISION", "MANUAL"]);
  });

  const FAILURES: Array<{ status: number; code: string; copy: string; retry: string | null }> = [
    { status: 504, code: "EXTRACTION_TIMEOUT", copy: "The AI took too long to answer.", retry: "Try again" },
    { status: 502, code: "EXTRACTION_REJECTED", copy: "The AI’s answer could not be used.", retry: "Try again" },
    { status: 409, code: "EXTRACTION_IN_PROGRESS", copy: "The AI is already reading this photo.", retry: "Check again" },
    { status: 429, code: "EXTRACTION_LIMIT_REACHED", copy: "The AI has already read this photo the most times allowed.", retry: null },
    { status: 429, code: "RATE_LIMITED", copy: "Too many requests right now.", retry: "Try again" },
    { status: 422, code: "MODE_UNAVAILABLE", copy: "AI reading is not available right now.", retry: null },
  ];

  for (const f of FAILURES) {
    test(`failure ${f.status} ${f.code} shows its copy and "Type the figures myself"`, async ({ page }) => {
      await mockApi(page, (route) =>
        route.fulfill({ status: f.status, json: { error: { code: f.code, message: "mocked" } } }),
      );
      await page.goto(`/evidence/${ID}/figures`);
      await page.getByRole("radio", { name: /Read the figures with AI/ }).check();
      await page.getByRole("button", { name: "Read with AI" }).click();
      const panel = page.getByRole("alert").filter({ hasText: f.copy });
      await expect(panel).toBeVisible();
      await expect(panel).toContainText("Nothing was saved.");
      await expect(panel.getByRole("button", { name: "Type the figures myself" })).toBeVisible();
      if (f.retry) await expect(panel.getByRole("button", { name: f.retry })).toBeVisible();
      if (f.code === "EXTRACTION_LIMIT_REACHED")
        await expect(page.getByRole("radio", { name: /Read the figures with AI/ })).toHaveCount(0);
      await noBannedWords(page);
      if (f.code === "EXTRACTION_TIMEOUT") await shot(page, "ai-7-failed-timeout");
    });
  }

  test("network failure and unsupported document", async ({ page }) => {
    let mode: "network" | "unsupported" = "network";
    await mockApi(page, (route) =>
      mode === "network"
        ? route.abort("internetdisconnected")
        : route.fulfill({ status: 422, json: { error: { code: "EXTRACTION_UNSUPPORTED_DOCUMENT", message: "mocked" } } }),
    );
    await page.goto(`/evidence/${ID}/figures`);
    await page.getByRole("radio", { name: /Read the figures with AI/ }).check();
    await page.getByRole("button", { name: "Read with AI" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Could not reach the server." })).toContainText("Nothing was saved.");

    mode = "unsupported";
    await page.getByRole("button", { name: "Try again" }).click();
    const panel = page.getByRole("alert").filter({ hasText: "The AI could not find result figures in this photo." });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("button", { name: "Type the figures myself" })).toBeVisible();
    await expect(panel.getByRole("link", { name: "Retake the photo" })).toHaveAttribute("href", "/capture");
    await noBannedWords(page);
    await shot(page, "ai-8-needs-manual-entry");
  });
});

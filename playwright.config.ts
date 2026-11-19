import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";

const PORT = 3100;
// Isolated LOCAL_DEV evidence store for E2E runs.
const dataDir = path.join(os.tmpdir(), `polltrace-e2e-${process.pid}`);

// Optional: run the suite against a deployed site instead of a local dev server,
// e.g. POLLTRACE_E2E_BASE_URL=https://polltrace.vercel.app POLLTRACE_E2E_REVIEWER_PASSCODE=… npx playwright test
const remote = process.env.POLLTRACE_E2E_BASE_URL;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: remote ?? `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "mobile-360", use: { ...devices["Pixel 5"], viewport: { width: 360, height: 740 } } },
  ],
  webServer: remote
    ? undefined
    : {
        command: `npx next dev --port ${PORT}`,
        url: `http://localhost:${PORT}/capture`,
        reuseExistingServer: false,
        timeout: 120_000,
        env: { POLLTRACE_LOCAL_DATA_DIR: dataDir, POLLTRACE_DEMO_REVIEWERS: "1" },
      },
});

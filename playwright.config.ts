import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";

const PORT = 3100;
// Isolated LOCAL_DEV evidence store for E2E runs.
const dataDir = path.join(os.tmpdir(), `polltrace-e2e-${process.pid}`);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "mobile-360", use: { ...devices["Pixel 5"], viewport: { width: 360, height: 740 } } },
  ],
  webServer: {
    command: `npx next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/capture`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { POLLTRACE_LOCAL_DATA_DIR: dataDir },
  },
});

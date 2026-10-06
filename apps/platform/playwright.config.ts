import { defineConfig, devices } from "@playwright/test";
import { resolveApiOrigin } from "./e2e/api-origin";

// One source of truth for the API origin, shared with `e2e/global-setup.ts`.
// Hardcoding it here is what desynced the webServer probe from the stack the
// dev command actually started.
const apiOrigin = resolveApiOrigin();

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  testIgnore: ["**/*real-llm*.e2e.ts", "**/anvia-v1-migration.e2e.ts"],
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: "line",
  use: {
    baseURL: "http://localhost:3000",
    storageState: "./e2e/.auth/user.json",
    trace: "on-first-retry",
  },
  webServer: {
    // A Node script instead of an inline shell line: the old command used
    // `VAR=value cmd &` syntax, which cmd.exe cannot parse, so on Windows the
    // stack never started.
    command: "node e2e/start-dev-stack.ts",
    url: `${apiOrigin}/api/auth/get-session`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

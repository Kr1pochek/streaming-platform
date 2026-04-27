import process from "node:process";
import { defineConfig } from "@playwright/test";

const apiPort = Number(process.env.API_PORT ?? 4000);
const clientPort = Number(process.env.PLAYWRIGHT_CLIENT_PORT ?? 4173);
const clientBaseUrl = `http://127.0.0.1:${clientPort}`;
const browserChannel = String(process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? "msedge").trim() || "msedge";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  timeout: 45_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [
    ["list"],
    ["html", { open: "never" }],
  ],
  use: {
    baseURL: clientBaseUrl,
    browserName: "chromium",
    channel: browserChannel,
    headless: true,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
  },
  webServer: [
    {
      command: "npm run start:app",
      url: `http://127.0.0.1:${apiPort}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${clientPort} --strictPort`,
      url: clientBaseUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});

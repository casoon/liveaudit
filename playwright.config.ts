/**
 * Browser-Regressionstests für den Inspector-Layer.
 *
 * jsdom trägt den Layer nicht: Geometrie, `pointer-events`, `elementFromPoint()`
 * und Fokusverhalten bildet es nicht ab. Die Zusicherungen aus
 * `docs/project-state.md` waren deshalb bis hierher von Hand über
 * `examples/inspector.html` gemessen — eine Schaltfläche, die jemand drücken
 * muss, ist keine Regressionsprüfung.
 *
 * Playwright, weil derselbe Satz Fälle in Chromium, Firefox und WebKit laufen
 * soll; `pnpm test:browser` fährt Chromium. Die anderen beiden sind eingerichtet
 * und brauchen nur ihre Binärdatei:
 *
 *   pnpm exec playwright install firefox
 *   pnpm exec playwright test --project=firefox
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  // Derselbe Server wie für die Beispiele. `dist/inspector.js` lädt sein WASM
  // über eine echte Herkunft; über `file://` scheitert das.
  webServer: {
    command: "node scripts/serve.js",
    url: "http://localhost:4173/",
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
  },
});

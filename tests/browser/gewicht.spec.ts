/**
 * Seitengewicht in der Seitenleiste — gegen eine Seite mit je einer Datei pro
 * Kategorie. LiveAudits eigenes Bundle und WASM-Modul zählen nicht mit.
 */

import { expect, test } from "@playwright/test";
import { HOST, oeffne, zeige } from "./helpers";

test("die Seitenleiste zählt die Dateien der Seite nach Kategorie, ohne LiveAudit selbst", async ({
  page,
}) => {
  await oeffne(page, "/tests/browser/fixtures/gewicht.html");
  await page.waitForLoadState("load");
  await zeige(page);

  const abschnitt = page.locator(`${HOST} details.weight`);
  await expect(abschnitt).toHaveCount(1);
  await abschnitt.locator("summary").click();

  const zeile = (typ: string) => abschnitt.locator("tbody tr", { hasText: typ });
  await expect(zeile("CSS").locator("td").nth(1)).toHaveText("1");
  await expect(zeile("Images").locator("td").nth(1)).toHaveText("1");
  // Nur gewicht.js — inspector.js und das WASM-Modul sind herausgerechnet.
  await expect(zeile("JavaScript / WASM").locator("td").nth(1)).toHaveText("1");
  await expect(zeile("HTML").locator("td").nth(2)).toHaveText(/^\d[\d.,]* (B|KB)$/);
  await expect(abschnitt).toContainText("LiveAudit's own files are not counted.");

  // Chromium misst LCP; der Wert steht als Zeit da, nicht als „not measured".
  const lcp = abschnitt
    .locator("dt", { hasText: "Largest contentful paint" })
    .locator("xpath=following-sibling::dd[1]");
  await expect(lcp).toContainText("ms");
});

test("der aufgeklappte Abschnitt bleibt offen, wenn die Leiste neu zeichnet", async ({ page }) => {
  await oeffne(page, "/tests/browser/fixtures/gewicht.html");
  await zeige(page);
  await page.locator(`${HOST} details.weight summary`).click();
  // Ein Filterwechsel zeichnet die Leiste neu.
  await page.locator(`${HOST} #liveaudit-filter-review`).uncheck();
  await expect(page.locator(`${HOST} details.weight`)).toHaveAttribute("open", "");
});

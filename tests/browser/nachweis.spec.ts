/**
 * Ein Scan ohne Befund muss nach einem Scan aussehen.
 *
 * Vier Nullen und eine leere Liste sind von einem Werkzeug, das gar nicht
 * lief, nicht zu unterscheiden — aufgefallen auf einer Seite, die LiveAudit
 * über einen Schalter einbindet. Die Seitenleiste nennt deshalb Knotenzahl,
 * gelaufene Regeln und den Zeitpunkt des Scans.
 */

import { expect, test } from "@playwright/test";
import { HOST, oeffne, zeige } from "./helpers";

test("ohne Urteil nennt die Seitenleiste, was gescannt wurde", async ({ page }) => {
  await oeffne(page, "/tests/browser/fixtures/sauber.html");
  await zeige(page);

  const nachweis = page.locator(`${HOST} .evidence`);
  await expect(nachweis).toContainText(/\d+ nodes scanned/);
  await expect(nachweis).toContainText(/\d+ rules ran/);
  await expect(nachweis).toContainText(/last scan \d{2}:\d{2}:\d{2}/);
  // Kein Urteil, aber die Checkliste: Was keine Maschine entscheiden kann,
  // steht auch auf einer einwandfreien Seite als UNTESTED (liveaudit#7).
  await expect(page.locator(`${HOST} .summary .o-fail .count`)).toHaveText("0");
  await expect(page.locator(`${HOST} .summary .o-review .count`)).toHaveText("0");
  await expect(page.locator(`${HOST} .summary .o-untested .count`)).not.toHaveText("0");
});

test("mit Befunden, aber alle ausgefiltert, bleibt es beim Filterhinweis", async ({ page }) => {
  await oeffne(page, "/examples/inspector.html");
  await zeige(page);

  for (const outcome of ["fail", "review", "untested"]) {
    await page.locator(`${HOST} #liveaudit-filter-${outcome}`).uncheck();
  }
  await expect(page.locator(`${HOST} .panel-body .note`).first()).toHaveText(
    "No finding in the selected states.",
  );
});

/**
 * „Nicht gelaufen ist nicht bestanden" — sichtbar in der Seitenleiste.
 *
 * Die Gruppe „Regeln ohne Lauf" galt als ungetestet, weil sie leer blieb:
 * `packages/core` bedient `Semantics`, also liefen alle Regeln. Seit
 * `a11y-rules` 0.7.0 gibt es Tier 3, und ohne den Kontrastdurchgang melden die
 * beiden Kontrastregeln `capability_missing`. Die Gruppe ist damit der
 * Normalfall, nicht die Ausnahme — und genau das ist der fachliche Kern
 * gegenüber Werkzeugen, die Schweigen wie ein Bestehen aussehen lassen.
 */

import { expect, test } from "@playwright/test";
import { HOST, oeffne } from "./helpers";

const GRUPPE = `${HOST} section[aria-labelledby="liveaudit-group-notrun"]`;

test.beforeEach(async ({ page }) => {
  await oeffne(page, "/examples/inspector.html");
});

test("ohne Darstellungsdurchgang nennt die Seitenleiste die Tier-3-Regeln", async ({ page }) => {
  await page.evaluate(async () => {
    await window.LiveAudit.show();
  });

  // Kontrast, die Heuristiken über Layout und Geometrie (liveaudit#6), die
  // Messspalten und die Regeln über Stylesheets.
  await expect(page.locator(`${GRUPPE} h3`)).toHaveText(/^Rules that did not run \(\d+\)$/);
  const eintraege = await page.locator(`${GRUPPE} li`).allInnerTexts();
  expect(eintraege.join(" ")).toContain("contrast/text-insufficient");
  expect(eintraege.join(" ")).toContain("contrast/text-undetermined");
  expect(eintraege.join(" ")).toContain("targets/size");
  // Der Grund steht dabei, nicht nur die Kennung.
  expect(eintraege.join(" ")).toContain("capability missing");
});

test("mit Kontrastdurchgang bleibt die Gruppe für das, was der Host nicht misst", async ({
  page,
}) => {
  await page.evaluate(async () => {
    await window.LiveAudit.show(undefined, { rendering: true });
  });

  // Die Gruppe verschwindet nicht: Fokus-Sichtbarkeit (ohne Fokusdurchgang),
  // Textabstand und die Regeln über Stylesheets liefert der Host nicht. Was
  // er misst, steht nicht mehr darin.
  const eintraege = (await page.locator(`${GRUPPE} li`).allInnerTexts()).join(" ");
  expect(eintraege).toContain("focus/indicator-missing");
  expect(eintraege).toContain("text-spacing/clipped");
  expect(eintraege).not.toContain("contrast/text-insufficient");
  expect(eintraege).not.toContain("targets/size");
  expect(eintraege).not.toContain("frames/cross-origin");
});

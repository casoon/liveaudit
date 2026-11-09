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

  // Kontrast, die Heuristiken über Layout und Geometrie (liveaudit#6) und die
  // Regeln, die Sonden oder Stylesheets brauchen (liveaudit#8).
  await expect(page.locator(`${GRUPPE} h3`)).toHaveText("Rules that did not run (27)");
  const eintraege = await page.locator(`${GRUPPE} li`).allInnerTexts();
  expect(eintraege.join(" ")).toContain("contrast/text-insufficient");
  expect(eintraege.join(" ")).toContain("contrast/text-undetermined");
  expect(eintraege.join(" ")).toContain("targets/size");
  // Der Grund steht dabei, nicht nur die Kennung.
  expect(eintraege.join(" ")).toContain("capability missing");
});

test("mit Darstellungsdurchgang bleiben die Regeln ohne Sonde in der Gruppe", async ({ page }) => {
  await page.evaluate(async () => {
    await window.LiveAudit.show(undefined, { rendering: true });
  });

  // Der Durchgang bedient Kontrast und Geometrie. Was bleibt, hat der Host
  // (noch) keine Sonde: die fünf Stylesheet-Regeln und vier Regeln aus
  // a11y-rules 0.28 mit eigenen Sonden. Sie bleiben sichtbar, nicht still.
  await expect(page.locator(`${GRUPPE} h3`)).toHaveText("Rules that did not run (9)");
  const eintraege = (await page.locator(`${GRUPPE} li`).allInnerTexts()).join(" ");
  expect(eintraege).not.toContain("contrast/");
  expect(eintraege).toContain("text-spacing/clipped");
  expect(eintraege).toContain("focus/obscured-enhanced");
  expect(eintraege).toContain("orientation/root-rotated");
  expect(eintraege).toContain("frames/cross-origin");
});

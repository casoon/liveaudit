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

test("ohne Kontrastdurchgang nennt die Seitenleiste die beiden Regeln", async ({ page }) => {
  await page.evaluate(async () => {
    await window.LiveAudit.show();
  });

  await expect(page.locator(`${GRUPPE} h3`)).toHaveText("Rules that did not run (2)");
  const eintraege = await page.locator(`${GRUPPE} li`).allInnerTexts();
  expect(eintraege.join(" ")).toContain("contrast/text-insufficient");
  expect(eintraege.join(" ")).toContain("contrast/text-undetermined");
  // Der Grund steht dabei, nicht nur die Kennung.
  expect(eintraege.join(" ")).toContain("capability missing");
});

test("mit Kontrastdurchgang verschwindet die Gruppe", async ({ page }) => {
  await page.evaluate(async () => {
    await window.LiveAudit.show(undefined, { rendering: true });
  });

  await expect(page.locator(GRUPPE)).toHaveCount(0);
});

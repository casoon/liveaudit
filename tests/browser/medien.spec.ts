/**
 * Die Wiedergabe-Messung selbststartender Medien (`media/audio-autoplay-measured`,
 * WCAG 1.4.2) an einer echten Seite.
 *
 * Chromium startet die Testtöne ohne Nutzergeste
 * (`--autoplay-policy=no-user-gesture-required` in `playwright.config.ts`).
 */

import { expect, type Page, test } from "@playwright/test";
import { oeffne } from "./helpers";

const FIXTURE = "/tests/browser/fixtures/media.html";
const REGEL = "media/audio-autoplay-measured";

async function scanne(page: Page, probes: "media"[]) {
  return page.evaluate(
    async ({ probes, regel }) => {
      const ergebnis = await window.LiveAudit.scan(document.documentElement, {
        rendering: true,
        probes,
      });
      const dok = ergebnis.documents[0];
      const nach: Record<string, string[]> = {};
      for (const befund of dok?.report.findings ?? []) {
        const el = dok?.idToElement.get(Number(befund.location?.node));
        const id = el?.id || el?.localName || "?";
        nach[id] ??= [];
        nach[id].push(`${befund.rule_id}:${befund.outcome}`);
      }
      const lauf = dok?.report.rule_runs.find((l) => l.rule_id === regel);
      return {
        nach,
        notRun: lauf?.not_run,
        spalte: dok?.probes?.columns.media,
        skipped: dok?.probes?.skipped,
        html: document.documentElement.outerHTML,
        paused: [...document.querySelectorAll("audio")].map((a) => [a.id, a.paused, a.muted]),
      };
    },
    { probes, regel: REGEL },
  );
}

test.beforeEach(async ({ page }) => {
  await oeffne(page, FIXTURE);
  await page.waitForFunction(() => "LiveAudit" in window);
});

test("ohne Anforderung bleibt die Regel nicht gelaufen", async ({ page }) => {
  const e = await scanne(page, []);
  expect(e.notRun).toBe("capability_missing");
  expect(e.spalte).toBeUndefined();
});

test("hörbarer Ton ohne Bedienung ergibt einen Befund, die anderen Fälle nicht", async ({
  page,
}) => {
  const e = await scanne(page, ["media"]);
  expect(e.notRun).toBeUndefined();
  expect(e.spalte).toBe(5);
  expect(e.skipped).toEqual([]);

  expect(e.nach.laut?.some((x) => x.startsWith(`${REGEL}:`))).toBe(true);
  for (const id of ["bedienbar", "stumm", "kurz"]) {
    expect(e.nach[id] ?? [], id).not.toContain(`${REGEL}:fail`);
    expect(
      (e.nach[id] ?? []).filter((x) => x.startsWith(`${REGEL}:`)),
      id,
    ).toEqual([]);
  }
  // Eine Tonspur ohne Pegel ist nicht als hörbar belegt: kein harter Befund.
  expect(e.nach.still ?? []).not.toContain(`${REGEL}:fail`);
});

test("die Messung verändert die Seite nicht und lässt die Medien laufen", async ({ page }) => {
  await page.waitForFunction(() => !(document.getElementById("laut") as HTMLAudioElement).paused);
  const vorher = await page.evaluate(() => document.documentElement.outerHTML);
  const e = await scanne(page, ["media"]);
  expect(e.html).toBe(vorher);
  // Nichts wurde angehalten oder stummgeschaltet.
  const laut = e.paused.find(([id]) => id === "laut");
  expect(laut).toEqual(["laut", false, false]);
});

test("ohne selbststartende Medien läuft die Regel ohne Befund", async ({ page }) => {
  await page.evaluate(() => {
    for (const a of document.querySelectorAll("audio")) a.remove();
  });
  const e = await scanne(page, ["media"]);
  expect(e.notRun).toBeUndefined();
  expect(e.spalte).toBe(0);
  expect(
    Object.values(e.nach)
      .flat()
      .filter((x) => x.startsWith(`${REGEL}:`)),
  ).toEqual([]);
});

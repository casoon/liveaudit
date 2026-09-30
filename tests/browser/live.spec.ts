/**
 * Live-Modus: Der Layer läuft mit, ohne dass jemand einen Scan anstößt.
 *
 * Geprüft wird an einer Seite, die sich aus eigenem Antrieb ändert — Element
 * dazu, Element weg, Attribut geändert. Entscheidend ist dabei nicht nur, dass
 * ein neuer Befund erscheint, sondern dass der Neuscan eines Teilbaums die
 * Befunde daneben **und** die dokumentweiten Aussagen stehen lässt.
 */

import { expect, type Page, test } from "@playwright/test";
import { HOST, oeffne } from "./helpers";

/** Die Regel-Kennungen aller Marker im Layer, so wie sie gerade stehen. */
async function markerRegeln(page: Page): Promise<string[]> {
  return page
    .locator(`${HOST} .marker`)
    .evaluateAll((knoten) =>
      knoten.map((k) => k.getAttribute("aria-label")?.split(", ").pop() ?? ""),
    );
}

test.describe("über die Schnittstelle", () => {
  test.beforeEach(async ({ page }) => {
    await oeffne(page, "/tests/browser/fixtures/live.html");
    // Kurze Ruhezeit: Der Test soll auf den Modus warten, nicht auf die Vorgabe.
    await page.evaluate(async () => {
      await window.LiveAudit.watch(undefined, { debounceMs: 50 });
    });
  });

  test("ein neues Element bringt seinen Befund von selbst in den Layer", async ({ page }) => {
    await expect(page.locator(`${HOST} .marker[aria-label*="images/alt-missing"]`)).toHaveCount(0);

    await page.evaluate(() => globalThis.fuegeBefundEin());

    await expect(page.locator(`${HOST} .marker[aria-label*="images/alt-missing"]`)).toHaveCount(1);
  });

  test("ein entferntes Element nimmt seinen Befund mit", async ({ page }) => {
    await page.evaluate(() => globalThis.fuegeBefundEin());
    await expect(page.locator(`${HOST} .marker[aria-label*="images/alt-missing"]`)).toHaveCount(1);

    await page.evaluate(() => globalThis.entferneBefund());

    await expect(page.locator(`${HOST} .marker[aria-label*="images/alt-missing"]`)).toHaveCount(0);
  });

  test("ein behobener Befund verschwindet", async ({ page }) => {
    await page.evaluate(() => globalThis.fuegeBefundEin());
    await expect(page.locator(`${HOST} .marker[aria-label*="images/alt-missing"]`)).toHaveCount(1);

    await page.evaluate(() => globalThis.behebeBefund());

    await expect(page.locator(`${HOST} .marker[aria-label*="images/alt-missing"]`)).toHaveCount(0);
  });

  test("der Neuscan eines Teilbaums lässt die Befunde daneben stehen", async ({ page }) => {
    const vorher = await markerRegeln(page);
    expect(vorher.some((regel) => regel.includes("buttons/name-missing"))).toBe(true);

    await page.evaluate(() => globalThis.fuegeBefundEin());
    await expect(page.locator(`${HOST} .marker[aria-label*="images/alt-missing"]`)).toHaveCount(1);

    const nachher = await markerRegeln(page);
    // Genau einer mehr, und der Befund im unberührten Teilbaum lebt noch.
    expect(nachher).toHaveLength(vorher.length + 1);
    expect(nachher.filter((r) => r.includes("buttons/name-missing"))).toHaveLength(1);
  });

  test("eine Seite, die nie zur Ruhe kommt, hungert den Modus nicht aus", async ({ page }) => {
    // Alle 20 ms eine Mutation, die Ruhezeit von 50 ms verstreicht nie.
    await page.evaluate(() => globalThis.starteCountdown());
    await page.evaluate(() => globalThis.fuegeBefundEin());

    // Spätestens nach der Höchstwartezeit (Vorgabe 1 s) steht der Befund da.
    await expect(page.locator(`${HOST} .marker[aria-label*="images/alt-missing"]`)).toHaveCount(1, {
      timeout: 2500,
    });
  });

  test("unwatch() beendet das Mitlaufen", async ({ page }) => {
    await page.evaluate(() => window.LiveAudit.unwatch());

    await page.evaluate(() => globalThis.fuegeBefundEin());
    await page.waitForTimeout(400);

    await expect(page.locator(`${HOST} .marker[aria-label*="images/alt-missing"]`)).toHaveCount(0);
  });
});

test.describe("Zustände ohne Mutation", () => {
  test.beforeEach(async ({ page }) => {
    await oeffne(page, "/tests/browser/fixtures/live.html");
  });

  test("ein change-Ereignis löst im Live-Modus einen Neuscan aus", async ({ page }) => {
    await page.evaluate(async () => {
      await window.LiveAudit.watch(undefined, { debounceMs: 50, rendering: true });
    });
    const kontrast = page.locator(`${HOST} .marker[aria-label*="contrast/text-insufficient"]`);
    await expect(kontrast).toHaveCount(0);

    // Nur CSS schaltet um — kein Attribut, kein Knoten ändert sich.
    await page.locator("#schalter").check();

    await expect(kontrast).toHaveCount(1);
  });

  test("rescan() erfasst, was der Modus nicht sieht", async ({ page }) => {
    await page.evaluate(async () => {
      await window.LiveAudit.show(undefined, { rendering: true });
    });
    const kontrast = page.locator(`${HOST} .marker[aria-label*="contrast/text-insufficient"]`);
    await page.locator("#schalter").check();
    await page.waitForTimeout(300);
    await expect(kontrast).toHaveCount(0);

    await page.evaluate(() => window.LiveAudit.rescan());

    await expect(kontrast).toHaveCount(1);
  });
});

test.describe("über die Seitenleiste", () => {
  test.beforeEach(async ({ page }) => {
    await oeffne(page, "/tests/browser/fixtures/live.html");
    await page.evaluate(async () => {
      await window.LiveAudit.show();
    });
  });

  test("das Kontrollkästchen schaltet den Live-Modus ein und wieder aus", async ({ page }) => {
    const schalter = page.locator(`${HOST} #liveaudit-live`);
    await expect(schalter).not.toBeChecked();

    await page.evaluate(() => globalThis.fuegeBefundEin());
    await page.waitForTimeout(400);
    // Ohne Live-Modus bleibt der Layer stehen, wo er war.
    await expect(page.locator(`${HOST} .marker[aria-label*="images/alt-missing"]`)).toHaveCount(0);

    await schalter.check();
    await expect(page.locator(`${HOST} .marker[aria-label*="images/alt-missing"]`)).toHaveCount(1);
    await expect(page.locator(`${HOST} #liveaudit-live`)).toBeChecked();

    await page.locator(`${HOST} #liveaudit-live`).uncheck();
    await page.evaluate(() => globalThis.entferneBefund());
    await page.waitForTimeout(400);
    // Ausgeschaltet: Der Befund steht noch da, obwohl das Element weg ist.
    await expect(page.locator(`${HOST} .marker[aria-label*="images/alt-missing"]`)).toHaveCount(1);
  });
});

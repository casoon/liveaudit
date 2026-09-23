/**
 * Die Zusicherungen aus `docs/project-state.md`: Der Layer legt sich über die
 * Seite, ohne sie anzufassen — und hinterlässt nichts, wenn er geht.
 *
 * Gemessen wird an `examples/inspector.html`, weil dort die Fehler stehen, an
 * denen die Zusicherungen etwas bedeuten: Ein Layer über einer befundfreien
 * Seite zeigt nichts an und verdeckt nichts.
 */

import { expect, type Page, test } from "@playwright/test";
import { fokusImLayer, HOST, oeffne, verbirg, zeige } from "./helpers";

/** Alles, woran sich eine Veränderung der Seite zeigen würde. */
async function zustand(page: Page) {
  return page.evaluate(() => ({
    bodyAttribute: [...document.body.attributes].map((a) => `${a.name}=${a.value}`).join("|"),
    bodyKinder: document.body.childElementCount,
    scrollHoehe: document.documentElement.scrollHeight,
    bodyScrollHoehe: document.body.scrollHeight,
    rechtecke: [...document.querySelectorAll("#probe *")].map((el) => {
      const r = el.getBoundingClientRect();
      return `${r.x},${r.y},${r.width},${r.height}`;
    }),
    markup: document.getElementById("probe")?.outerHTML ?? "",
  }));
}

test.beforeEach(async ({ page }) => {
  await oeffne(page, "/examples/inspector.html");
});

test("show() legt genau einen Host als letztes Kind von <body> an", async ({ page }) => {
  await zeige(page);

  const befund = await page.evaluate((host) => {
    const hosts = document.querySelectorAll(host);
    const erster = hosts[0];
    const stil = erster === undefined ? null : getComputedStyle(erster);
    return {
      anzahl: hosts.length,
      letztesKind: document.body.lastElementChild?.localName ?? null,
      position: stil?.position ?? null,
      pointerEvents: stil?.pointerEvents ?? null,
      offenerShadowRoot: erster instanceof HTMLElement && erster.shadowRoot !== null,
    };
  }, HOST);

  expect(befund).toEqual({
    anzahl: 1,
    letztesKind: HOST,
    position: "fixed",
    pointerEvents: "none",
    offenerShadowRoot: true,
  });
});

test("ein zweiter show()-Aufruf ersetzt den Layer, statt einen zweiten anzulegen", async ({
  page,
}) => {
  await zeige(page);
  await zeige(page);
  await expect(page.locator(HOST)).toHaveCount(1);
});

test("der geprüfte Teilbaum bleibt unverändert", async ({ page }) => {
  const vorher = await zustand(page);
  await zeige(page);
  const nachher = await zustand(page);

  expect(nachher.markup).toBe(vorher.markup);
  expect(nachher.bodyAttribute).toBe(vorher.bodyAttribute);
  expect(nachher.scrollHoehe).toBe(vorher.scrollHoehe);
  expect(nachher.bodyScrollHoehe).toBe(vorher.bodyScrollHoehe);
  expect(nachher.rechtecke).toEqual(vorher.rechtecke);
  // Der Host ist ein zusätzliches Kind von <body> — die eine erlaubte Änderung,
  // und sie betrifft den geprüften Teilbaum nicht.
  expect(nachher.bodyKinder - vorher.bodyKinder).toBe(1);
});

test("hide() lässt nichts im Dokument zurück", async ({ page }) => {
  await zeige(page);
  await expect(page.locator(HOST)).toHaveCount(1);

  await verbirg(page);

  await expect(page.locator(HOST)).toHaveCount(0);
  expect(await page.evaluate(() => window.LiveAudit.isVisible())).toBe(false);
});

test("ein Klick neben dem Layer erreicht die Seite", async ({ page }) => {
  await zeige(page);

  // Ein echter Klick, nicht elementFromPoint: Erst der Klick beweist, dass
  // `pointer-events: none` am Host bis zur Seite durchreicht.
  await page.click("#klickziel");

  await expect(page.locator("#klicks")).toHaveText("1");
});

test("der Fokus kehrt nach hide() dorthin zurück, wo er war", async ({ page }) => {
  await page.locator("#zeigen").focus();
  await zeige(page);

  await page.locator(`${HOST} .toggle`).focus();
  expect(await fokusImLayer(page)).toContain("toggle");

  await verbirg(page);

  // Ohne die Übergabe fiele der Fokus auf <body> — genau der Verlust, den der
  // Layer an anderen meldet.
  expect(await page.evaluate(() => document.activeElement?.id ?? null)).toBe("zeigen");
});

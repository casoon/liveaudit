/**
 * Positionierung über Dokumentgrenzen hinweg: Same-Origin-Rahmen, offener
 * Shadow Root, Scrollen, Fenstergröße.
 *
 * Ein Element in einem Rahmen liefert sein Rechteck relativ zum Viewport
 * *seines* Dokuments; der Layer hängt im Hauptdokument. Dass die Umrechnung
 * stimmt — samt Rahmenbreite über `clientLeft`/`clientTop` —, ist in jsdom nicht
 * zu prüfen, weil es dort keine Geometrie gibt.
 */

import { expect, test } from "@playwright/test";
import { kasten, MARKER_VERSATZ, marker, naechsterRahmen, oeffne, zeige } from "./helpers";

/** Subpixel unterscheiden sich zwischen Browsern; ein Marker daneben nicht. */
function nahe(gemessen: number, erwartet: number): void {
  expect(Math.abs(gemessen - erwartet)).toBeLessThan(1.5);
}

test.beforeEach(async ({ page }) => {
  await oeffne(page, "/tests/browser/fixtures/geometrie.html");
  await zeige(page);
});

test("ein Befund im Same-Origin-Rahmen bekommt seinen Marker an dessen Stelle", async ({
  page,
}) => {
  const erwartet = await page.evaluate(() => {
    const rahmen = document.getElementById("rahmen");
    if (!(rahmen instanceof HTMLIFrameElement)) throw new Error("Kein Rahmen");
    const aussen = rahmen.getBoundingClientRect();
    const bild = rahmen.contentDocument?.querySelector("img");
    if (bild === null || bild === undefined) throw new Error("Kein Bild im Rahmen");
    const innen = bild.getBoundingClientRect();
    return {
      x: aussen.left + rahmen.clientLeft + innen.left,
      y: aussen.top + rahmen.clientTop + innen.top,
    };
  });

  const box = await kasten(marker(page, "images/alt-missing"));
  nahe(box.x, erwartet.x - MARKER_VERSATZ);
  nahe(box.y, erwartet.y - MARKER_VERSATZ);
});

test("ein Befund im offenen Shadow Root bekommt seinen Marker an dessen Stelle", async ({
  page,
}) => {
  const erwartet = await page.evaluate(() => {
    const knopf = document.getElementById("wirt")?.shadowRoot?.querySelector("button");
    if (knopf === null || knopf === undefined) throw new Error("Kein Knopf im Shadow Root");
    const r = knopf.getBoundingClientRect();
    return { x: r.left, y: r.top };
  });

  const box = await kasten(marker(page, "buttons/name-missing"));
  nahe(box.x, erwartet.x - MARKER_VERSATZ);
  nahe(box.y, erwartet.y - MARKER_VERSATZ);
});

test("beim Scrollen wandern die Marker mit", async ({ page }) => {
  const vorher = await kasten(marker(page, "buttons/name-missing"));

  await page.evaluate(() => window.scrollBy(0, 200));
  await naechsterRahmen(page);

  const nachher = await kasten(marker(page, "buttons/name-missing"));
  nahe(nachher.y, vorher.y - 200);
  nahe(nachher.x, vorher.x);
});

test("nach einer Fenstergrößenänderung sitzen die Marker neu", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await naechsterRahmen(page);

  const erwartet = await page.evaluate(() => {
    const knopf = document.getElementById("wirt")?.shadowRoot?.querySelector("button");
    if (knopf === null || knopf === undefined) throw new Error("Kein Knopf im Shadow Root");
    const r = knopf.getBoundingClientRect();
    return { x: r.left, y: r.top };
  });

  const box = await kasten(marker(page, "buttons/name-missing"));
  nahe(box.x, erwartet.x - MARKER_VERSATZ);
  nahe(box.y, erwartet.y - MARKER_VERSATZ);
});

/**
 * Marker, Popover, Seitenleiste und Ziehgriff — mit Maus und mit Tastatur.
 *
 * Ein Prüfwerkzeug für Barrierefreiheit, das sich nur mit der Maus bedienen
 * lässt, wäre sein eigener Befund. Deshalb steht hier jeder Weg zweimal.
 */

import { expect, test } from "@playwright/test";
import { fokusImLayer, HOST, oeffne, zeige } from "./helpers";

test.beforeEach(async ({ page }) => {
  await oeffne(page, "/examples/inspector.html");
  await zeige(page);
});

test("ein Klick auf einen Marker öffnet sein Popover", async ({ page }) => {
  const marker = page.locator(`${HOST} .marker`).first();
  await expect(marker).toHaveAttribute("aria-expanded", "false");

  await marker.click();

  await expect(page.locator(`${HOST} .popover`)).toBeVisible();
  await expect(marker).toHaveAttribute("aria-expanded", "true");
});

test("Escape schließt das Popover und gibt den Fokus an den Marker zurück", async ({ page }) => {
  await page.locator(`${HOST} .marker`).first().click();
  await expect(page.locator(`${HOST} .popover`)).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(page.locator(`${HOST} .popover`)).toBeHidden();
  expect(await fokusImLayer(page)).toContain("marker");
});

test("ein Marker lässt sich mit der Tastatur öffnen", async ({ page }) => {
  const marker = page.locator(`${HOST} .marker`).first();
  await marker.focus();
  await page.keyboard.press("Enter");

  await expect(page.locator(`${HOST} .popover`)).toBeVisible();
  await expect(marker).toHaveAttribute("aria-expanded", "true");
});

test("die Seitenleiste lässt sich schließen und wieder öffnen", async ({ page }) => {
  const leiste = page.locator(`${HOST} .panel`);
  const schalter = page.locator(`${HOST} .toggle`);
  await expect(leiste).toBeVisible();

  await schalter.click();
  await expect(leiste).toBeHidden();
  await expect(schalter).toHaveAttribute("aria-expanded", "false");

  await schalter.click();
  await expect(leiste).toBeVisible();
  await expect(schalter).toHaveAttribute("aria-expanded", "true");
});

test("die Seitenleiste dockt an eine andere Kante", async ({ page }) => {
  await page.locator(`${HOST} .dock-btn[aria-label="Links andocken"]`).click();

  await expect(page.locator(`${HOST} .root`)).toHaveAttribute("data-dock", "left");
});

test("der Ziehgriff reagiert auf die Pfeiltasten", async ({ page }) => {
  const griff = page.locator(`${HOST} .grip`);
  await expect(griff).toHaveAttribute("role", "separator");
  const vorher = Number(await griff.getAttribute("aria-valuenow"));

  await griff.focus();
  // Rechts angedockt: nach innen ziehen heißt nach links, und das macht größer.
  await page.keyboard.press("ArrowLeft");
  expect(Number(await griff.getAttribute("aria-valuenow"))).toBe(vorher + 16);

  await page.keyboard.press("Shift+ArrowLeft");
  expect(Number(await griff.getAttribute("aria-valuenow"))).toBe(vorher + 16 + 64);

  await page.keyboard.press("ArrowRight");
  expect(Number(await griff.getAttribute("aria-valuenow"))).toBe(vorher + 64);
});

test("der Ziehgriff lässt sich ziehen", async ({ page }) => {
  const griff = page.locator(`${HOST} .grip`);
  const vorher = Number(await griff.getAttribute("aria-valuenow"));
  const box = await griff.boundingBox();
  if (box === null) throw new Error("Der Ziehgriff hat keinen Kasten");

  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 60, y, { steps: 8 });
  await page.mouse.up();

  const nachher = Number(await griff.getAttribute("aria-valuenow"));
  expect(nachher).toBeGreaterThan(vorher + 40);
});

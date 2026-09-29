/**
 * Der Layer unter strenger CSP: `style-src 'self'` ohne `'unsafe-inline'`.
 *
 * Ein `<style>`-Element im Shadow Root bräuchte dort einen Hash, der sich mit
 * jeder Version ändert. Der Layer übernimmt sein Stylesheet deshalb über
 * `adoptedStyleSheets` — dieser Test hält fest, dass das greift und keine
 * CSP-Verletzung auslöst.
 */

import { expect, test } from "@playwright/test";
import { HOST, oeffne, zeige } from "./helpers";

test("unter style-src 'self' ist der Layer gestylt, ohne CSP-Verletzung", async ({ page }) => {
  const verletzungen: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy/i.test(m.text()))
      verletzungen.push(m.text());
  });

  await oeffne(page, "/tests/browser/fixtures/csp-strikt.html");
  await page.waitForFunction(() => "LiveAudit" in window);
  await zeige(page);

  // Werte, die nur aus dem Stylesheet kommen können: Ohne es wäre ein
  // `<aside>` statisch positioniert und durchsichtig.
  const panel = page.locator(`${HOST} .panel`);
  await expect(panel).toHaveCSS("position", "absolute");
  await expect(panel).toHaveCSS("background-color", "rgb(24, 24, 27)");
  expect(verletzungen).toEqual([]);
});

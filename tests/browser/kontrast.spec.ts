/**
 * Kontrast an Shadow-Grenzen.
 *
 * Die Hintergrundsuche in `packages/browser/src/rendering.ts` steigt über die
 * Vorfahren auf. An einer Shadow-Grenze endet `parentElement` — und am Slot
 * zeigt es in den Licht-DOM, während gezeichnet wird, wo der Slot steht. Beides
 * ist nur im echten Browser zu belegen: jsdom rechnet keine Stile aus.
 *
 * Der gefährliche Fehler ist nicht der falsche Befund, sondern das falsche
 * Schweigen: Wer Weiß annimmt, wo dunkel gezeichnet wird, meldet nichts.
 */

import { expect, type Page, test } from "@playwright/test";
import { oeffne } from "./helpers";

/**
 * `id` oder Klasse des Elements → `Regel:Outcome`, für alle Kontrastbefunde.
 *
 * Fehlt eine Kennung im Ergebnis, ist die Regel dort nicht angeschlagen — bei
 * Kontrast heißt das bestanden, denn `PASS` erzeugt keinen Befund.
 */
async function kontrastBefunde(page: Page): Promise<Record<string, string>> {
  return page.evaluate(async () => {
    const ergebnis = await window.LiveAudit.scan(document.documentElement, { rendering: true });
    const nach: Record<string, string> = {};
    for (const dokument of ergebnis.documents) {
      for (const befund of dokument.report.findings) {
        if (!befund.rule_id.startsWith("contrast/")) continue;
        const element = dokument.idToElement.get(Number(befund.location?.node));
        const klasse = typeof element?.className === "string" ? element.className : "";
        const schluessel = element?.id !== undefined && element.id !== "" ? element.id : klasse;
        nach[schluessel === "" ? "ohne-kennung" : schluessel] =
          `${befund.rule_id}:${befund.outcome}`;
      }
    }
    return nach;
  });
}

test.describe("an Shadow-Grenzen", () => {
  test.beforeEach(async ({ page }) => {
    await oeffne(page, "/tests/browser/fixtures/kontrast-shadow.html");
  });

  test("dunkler Text im Shadow Root über dunklem Host fällt auf", async ({ page }) => {
    const befunde = await kontrastBefunde(page);
    // Rund 1,3:1. Wer beim Shadow Root stehen bleibt und Weiß annimmt, rechnet
    // 14:1 und schweigt — ein PASS, auf das sich jemand verlässt.
    expect(befunde["dunkel-auf-dunkel"]).toBe("contrast/text-insufficient:fail");
  });

  test("heller Text im Shadow Root über dunklem Host besteht", async ({ page }) => {
    const befunde = await kontrastBefunde(page);
    // Rund 16:1. Gegen geratenes Weiß gerechnet wären es 1,06:1 — ein Befund,
    // der die Seite zu Unrecht anklagt.
    expect(befunde["hell-auf-dunkel"]).toBeUndefined();
  });

  test("geslotteter Text wird gegen die Fläche geprüft, auf der er steht", async ({ page }) => {
    const befunde = await kontrastBefunde(page);
    // Gezeichnet wird er im Shadow Tree auf #111827, nicht im Licht-DOM auf Weiß.
    expect(befunde.geslottet).toBe("contrast/text-insufficient:fail");
  });
});

/**
 * Der Aufstieg über den flachen Baum darf im Licht-DOM nichts verändern —
 * dieselben fünf bekannten Fälle, die `examples/contrast.html` von Hand zeigt.
 */
test("die bekannten Fälle im Licht-DOM bleiben, wie sie waren", async ({ page }) => {
  await oeffne(page, "/examples/contrast.html");
  const befunde = await kontrastBefunde(page);

  expect(befunde["zu-schwach"]).toBe("contrast/text-insufficient:fail");
  expect(befunde["knapp-genug"]).toBeUndefined();
  expect(befunde["gross-und-grau"]).toBeUndefined();
  expect(befunde["auf-bild"]).toBe("contrast/text-undetermined:untested");
  // `display: none` wird gar nicht erst geprüft.
  expect(befunde.versteckt).toBeUndefined();
});

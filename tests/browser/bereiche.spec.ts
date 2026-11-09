/**
 * Baumbereiche an echtem Shadow DOM (liveaudit#10).
 *
 * Der Collector nimmt offene Shadow Roots als flachen Baum in eine Arena. IDs
 * gehören dagegen zu dem Baum, in dem sie stehen: Dieselbe ID in zwei Bäumen ist
 * kein Duplikat, und ein Verweis trifft nur Ziele im eigenen Baum. Der flache
 * Baum bleibt für den Kontrast (`assignedSlot`) maßgeblich -- das prüft
 * `kontrast.spec.ts`.
 */

import { expect, test } from "@playwright/test";
import { oeffne } from "./helpers";

test.beforeEach(async ({ page }) => {
  await oeffne(page, "/tests/browser/fixtures/bereiche.html");
  await page.waitForFunction(() => "LiveAudit" in window);
});

test("dieselbe ID in Dokument und Shadow Root ist kein Duplikat, ein fremder Verweis läuft ins Leere", async ({
  page,
}) => {
  const ergebnis = await page.evaluate(async () => {
    const e = await window.LiveAudit.scan();
    const dok = e.documents[0];
    return {
      knoten: dok?.report.findings
        .filter((b) => b.rule_id === "ids/duplicate" || b.rule_id === "aria/reference-missing")
        .map((b) => ({
          regel: b.rule_id,
          id: dok.idToElement.get(Number(b.location?.node))?.id,
        })),
    };
  });

  // Nichts gemeldet für "hinweis" (zweimal vorhanden, je im eigenen Baum, auch
  // vom zugewiesenen Licht-Kind aus) und für "innen".
  expect(ergebnis.knoten?.filter((k) => k.regel === "ids/duplicate")).toEqual([]);
  // Gemeldet: nur der Verweis aus dem Dokument auf eine ID, die nur im Shadow Root liegt.
  expect(ergebnis.knoten?.filter((k) => k.regel === "aria/reference-missing")).toEqual([
    { regel: "aria/reference-missing", id: "fremd" },
  ]);
});

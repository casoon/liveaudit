/**
 * Die heuristischen Regeln (liveaudit#6) an echtem Layout: Was der Collector
 * aus berechneten Stilen, Animationen und Geometrie erhebt, kommt bei den
 * Regeln an — und nur in jsdom ist davon nichts zu sehen.
 */

import { expect, type Page, test } from "@playwright/test";
import { oeffne } from "./helpers";

/** `id` des Elements → Regelkennungen, für alle Befunde. */
async function befunde(page: Page, focus: boolean): Promise<Record<string, string[]>> {
  return page.evaluate(async (focus) => {
    const ergebnis = await window.LiveAudit.scan(document.documentElement, {
      rendering: true,
      focus,
    });
    const nach: Record<string, string[]> = {};
    for (const dokument of ergebnis.documents) {
      for (const befund of dokument.report.findings) {
        const element = dokument.idToElement.get(Number(befund.location?.node));
        const id = element?.id || element?.localName || "?";
        nach[id] ??= [];
        nach[id].push(`${befund.rule_id}:${befund.outcome}`);
      }
    }
    return nach;
  }, focus);
}

test.beforeEach(async ({ page }) => {
  await oeffne(page, "/tests/browser/fixtures/heuristik.html");
});

test("jede Heuristik trifft ihren Fall, als REVIEW", async ({ page }) => {
  const b = await befunde(page, false);
  expect(b.umgekehrt).toContain("order/visual-mismatch:review");
  expect(b.endlos).toContain("motion/infinite-animation:review");
  expect(b.breit).toContain("reflow/min-width:review");
  expect(b.suchen).toContain("keyboard/pointer-only:review");
  expect(b.verdeckt).toContain("focus/obscured:review");
  // Die Leiste reicht 60 px tief, scroll-padding-top ist 0.
  expect(b.leiste).toContain("focus/obscured:review");
});

test("eine Leiste mit ausreichendem scroll-padding bleibt ruhig", async ({ page }) => {
  await page.addStyleTag({ content: "html { scroll-padding-top: 64px; }" });
  const b = await befunde(page, false);
  expect(b.leiste ?? []).not.toContain("focus/obscured:review");
});

test("was richtig gebaut ist, bleibt ruhig", async ({ page }) => {
  const b = await befunde(page, false);
  expect(b["mit-fokus"] ?? []).toEqual([]);
  // Die Links in der Leiste liegen auf ihr, nicht unter ihr.
  expect(b.a ?? []).not.toContain("focus/obscured:review");
});

test("ohne Fokus-Durchgang steht die Fokus-Sichtbarkeit als nicht gelaufen im Bericht", async ({
  page,
}) => {
  // `focus/indicator-unmeasured` gibt es seit a11y-rules 0.27 nicht mehr: Ein
  // Host ohne Fokus-Messung bekommt `focus/indicator-missing` mit
  // `NotRun::CapabilityMissing` in `rule_runs` -- kein Befund, kein Bestehen.
  const b = await befunde(page, false);
  expect(Object.values(b).flat()).not.toContain("focus/indicator-unmeasured:untested");
  expect(b["ohne-fokus"] ?? []).not.toContain("focus/indicator-missing:review");

  const lauf = await page.evaluate(async () => {
    const ergebnis = await window.LiveAudit.scan(document.documentElement, { rendering: true });
    return ergebnis.documents[0]?.report.rule_runs.find(
      (r) => r.rule_id === "focus/indicator-missing",
    );
  });
  expect(lauf?.not_run).toBe("capability_missing");
});

test("der Fokus-Durchgang misst, dass die Leiste das Element beim Fokussieren überdeckt", async ({
  page,
}) => {
  const b = await befunde(page, true);
  expect(b.verdeckt).toContain("focus/obscured-enhanced:review");
  expect(b.a ?? []).not.toContain("focus/obscured-enhanced:review");
});

test("der Fokus-Durchgang liefert die Abdeckungsmessung", async ({ page }) => {
  const lauf = await page.evaluate(async () => {
    const ergebnis = await window.LiveAudit.scan(document.documentElement, {
      rendering: true,
      focus: true,
    });
    const runs = ergebnis.documents[0]?.report.rule_runs ?? [];
    return {
      indicator: runs.find((r) => r.rule_id === "focus/indicator-missing")?.not_run,
      enhanced: runs.find((r) => r.rule_id === "focus/obscured-enhanced")?.not_run,
      frames: runs.find((r) => r.rule_id === "frames/cross-origin")?.not_run,
      root: runs.find((r) => r.rule_id === "orientation/root-rotated")?.not_run,
    };
  });
  expect(lauf).toEqual({
    indicator: undefined,
    enhanced: undefined,
    frames: undefined,
    root: undefined,
  });
});

test("der Fokus-Durchgang findet den fehlenden Rahmen und stellt den Fokus zurück", async ({
  page,
}) => {
  await page.locator("#mit-fokus").focus();
  const b = await befunde(page, true);
  expect(b["ohne-fokus"]).toContain("focus/indicator-missing:review");
  expect(b["rahmen-null"]).toContain("focus/indicator-missing:review");
  expect(b["mit-fokus"] ?? []).toEqual([]);
  expect(b.html ?? []).not.toContain("focus/indicator-unmeasured:untested");
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("mit-fokus");
});

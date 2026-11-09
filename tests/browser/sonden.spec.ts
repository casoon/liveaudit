/**
 * Die Messungen für die seitenabhängigen Regeln (liveaudit#16) an einer echten
 * Seite.
 *
 * jsdom kennt weder `elementsFromPoint` noch konstruierbare Stylesheets noch
 * `DataTransfer`; ob die Spalten gefüllt ankommen, zeigt nur ein Browser. Je
 * Messung gilt: Die Spalte ist nicht leer, die Regel trifft ihren Fall, und
 * die Seite steht danach wieder, wie sie war.
 */

import { expect, type Page, test } from "@playwright/test";
import { oeffne } from "./helpers";

const FIXTURE = "/tests/browser/fixtures/probes.html";
const ALLE = ["paste", "focus", "spacing"] as const;

/** Die Seite weit unten, damit `scrollIntoView` das Element oben unter die Leiste bringt. */
async function scrolleNachUnten(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 800));
}

/** Befunde als `id → ["regel:ergebnis"]`, Elemente über ihre `id`. */
async function scanne(page: Page, probes: readonly string[]) {
  return page.evaluate(async (probes) => {
    const ergebnis = await window.LiveAudit.scan(document.documentElement, {
      rendering: true,
      probes: probes as ("paste" | "focus" | "spacing")[],
    });
    const nach: Record<string, string[]> = {};
    const dok = ergebnis.documents[0];
    for (const befund of dok?.report.findings ?? []) {
      const element = dok?.idToElement.get(Number(befund.location?.node));
      const id = element?.id || element?.localName || "?";
      nach[id] ??= [];
      nach[id].push(`${befund.rule_id}:${befund.outcome}`);
    }
    const laeufe: Record<string, string | undefined> = {};
    for (const lauf of dok?.report.rule_runs ?? []) laeufe[lauf.rule_id] = lauf.not_run;
    return { nach, laeufe, probes: dok?.probes };
  }, probes);
}

test.beforeEach(async ({ page }) => {
  await oeffne(page, FIXTURE);
  await page.waitForFunction(() => "LiveAudit" in window);
});

test("ohne Anforderung bleiben die berührenden Regeln nicht gelaufen, die lesenden laufen", async ({
  page,
}) => {
  const { laeufe, probes, nach } = await scanne(page, []);

  // Berührend: nicht angefordert, also nicht gemessen und nicht bestanden.
  for (const regel of ["auth/paste-blocked", "focus/obscured-enhanced", "text-spacing/clipped"]) {
    expect(laeufe[regel], regel).toBe("capability_missing");
  }
  expect(probes?.columns.paste).toBeUndefined();
  expect(probes?.columns.focus).toBeUndefined();
  expect(probes?.columns.spacing).toBeUndefined();

  // Lesend: laufen mit dem Darstellungsdurchgang.
  expect(laeufe["frames/cross-origin"]).toBeUndefined();
  expect(laeufe["orientation/root-rotated"]).toBeUndefined();
  expect(probes?.columns.frames).toBe(2);
  expect(probes?.columns.transforms).toBe(2);
  expect(nach.fremd).toContain("frames/cross-origin:untested");
  expect(nach.lesbar ?? []).not.toContain("frames/cross-origin:untested");
});

test("jede Messung füllt ihre Spalte und trifft ihren Fall", async ({ page }) => {
  await scrolleNachUnten(page);
  const { nach, laeufe, probes } = await scanne(page, ALLE);

  // Die Spalte ist da und nicht leer -- sonst hätte die Regel nichts gesehen.
  expect(probes?.columns.paste).toBe(4);
  expect(probes?.columns.focus ?? 0).toBeGreaterThan(0);
  expect(probes?.columns.spacing ?? 0).toBeGreaterThan(0);
  expect(probes?.focusScroll).toContain("nearest");
  expect(probes?.skipped).toEqual([]);
  for (const regel of ["auth/paste-blocked", "focus/obscured-enhanced", "text-spacing/clipped"]) {
    expect(laeufe[regel], regel).toBeUndefined();
  }

  // auth/paste-blocked: nur das Feld, dessen Handler abbricht und nichts einfügt.
  expect(nach.gesperrt).toContain("auth/paste-blocked:fail");
  expect(nach.frei ?? []).not.toContain("auth/paste-blocked:fail");
  expect(nach.selbst ?? []).not.toContain("auth/paste-blocked:fail");
  expect(nach.dialog).toContain("auth/paste-blocked:fail");

  // focus/obscured: das Element liegt nach dem Scrollen unter der Leiste.
  expect(nach.oben).toContain("focus/obscured:review");
  expect(nach.oben).toContain("focus/obscured-enhanced:review");
  // Ein Bedienelement mitten im sichtbaren Bereich bleibt ruhig.
  expect(nach.unten ?? []).not.toContain("focus/obscured:review");
  expect(nach.unten ?? []).not.toContain("focus/obscured-enhanced:review");

  // text-spacing/clipped: nur, was durch den Textabstand neu abschneidet.
  expect(nach.eng).toContain("text-spacing/clipped:review");
  expect(nach.vorher ?? []).not.toContain("text-spacing/clipped:review");
  expect(nach["abstand-frei"] ?? []).not.toContain("text-spacing/clipped:review");
});

test("die Fokus-Messung hält Blocker und Abdeckung als Beleg fest", async ({ page }) => {
  await scrolleNachUnten(page);
  const evidenz = await page.evaluate(async () => {
    const e = await window.LiveAudit.scan(document.documentElement, {
      rendering: true,
      probes: ["focus"],
    });
    const dok = e.documents[0];
    const befund = dok?.report.findings.find(
      (b) =>
        b.rule_id === "focus/obscured" &&
        dok.idToElement.get(Number(b.location?.node))?.id === "oben",
    ) as { evidence?: { field: string; value: string }[] } | undefined;
    return Object.fromEntries((befund?.evidence ?? []).map((x) => [x.field, x.value]));
  });
  expect(Number(evidenz.focus_points)).toBeGreaterThan(0);
  expect(evidenz.focus_covered).toBe(evidenz.focus_points);
  // Der Blocker ist ein Arena-Index, nicht -1: die Leiste liegt im Scan.
  expect(evidenz.focus_blocker).toBeDefined();
});

test("nach dem Scan steht die Seite wie vorher", async ({ page }) => {
  const dialoge: string[] = [];
  page.on("dialog", async (d) => {
    dialoge.push(d.type());
    await d.dismiss();
  });
  await page.locator("#frei").focus();
  await page.locator("#frei").fill("mein-passwort");
  await scrolleNachUnten(page);

  const zustand = () =>
    page.evaluate(() => ({
      html: document.documentElement.outerHTML,
      fokus: document.activeElement?.id,
      scrollY: window.scrollY,
      scrollX: window.scrollX,
      werte: [...document.querySelectorAll("input")].map((i) => [i.id, i.value]),
      auswahl: [
        (document.getElementById("frei") as HTMLInputElement).selectionStart,
        (document.getElementById("frei") as HTMLInputElement).selectionEnd,
      ],
      blaetter: document.adoptedStyleSheets.length,
      stile: [...document.querySelectorAll("[style]")].map((e) => e.getAttribute("style")),
    }));

  const vorher = await zustand();
  await scanne(page, ALLE);
  const nachher = await zustand();

  expect(nachher).toEqual(vorher);
  expect(vorher.fokus).toBe("frei");
  expect(vorher.scrollY).toBe(800);
  // Die Dialoge des Handlers erreichen den Nutzer nicht.
  expect(dialoge).toEqual([]);
});

test("die Messungen lösen keine Mutation und keine Übergänge aus", async ({ page }) => {
  const meldungen = await page.evaluate(async () => {
    const eintraege: string[] = [];
    const beobachter = new MutationObserver((rs) => {
      for (const r of rs) eintraege.push(`${r.type}:${r.attributeName ?? ""}`);
    });
    beobachter.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    let uebergaenge = 0;
    document.addEventListener("transitionrun", () => uebergaenge++, true);
    document.addEventListener("transitionstart", () => uebergaenge++, true);

    // #abstand-frei bekommt ein `transition: all`, das ohne Gegenmaßnahme beim
    // Überschreiben und beim Zurücknehmen einen Übergang starten würde.
    const el = document.getElementById("abstand-frei") as HTMLElement;
    el.setAttribute("data-t", "");
    document.head.insertAdjacentHTML(
      "beforeend",
      "<style>#eng, #abstand-frei { transition: all 0.5s; }</style>",
    );
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    beobachter.takeRecords();
    eintraege.length = 0;

    await window.LiveAudit.scan(document.documentElement, {
      rendering: true,
      probes: ["paste", "focus", "spacing"],
    });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    beobachter.takeRecords().forEach((r) => {
      eintraege.push(`${r.type}:${r.attributeName ?? ""}`);
    });
    return { eintraege, uebergaenge };
  });
  expect(meldungen.eintraege).toEqual([]);
  expect(meldungen.uebergaenge).toBe(0);
});

test("die Textabstand-Messung greift auch unter strenger CSP (style-src 'self')", async ({
  page,
}) => {
  const verletzungen: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy/i.test(m.text())) {
      verletzungen.push(m.text());
    }
  });
  await oeffne(page, "/tests/browser/fixtures/probes-csp.html");
  await page.waitForFunction(() => "LiveAudit" in window);

  const { nach, probes } = await scanne(page, ["spacing"]);
  expect(probes?.columns.spacing ?? 0).toBeGreaterThan(0);
  expect(nach.eng).toContain("text-spacing/clipped:review");
  expect(verletzungen).toEqual([]);
});

test("eine gedrehte Wurzel meldet orientation/root-rotated", async ({ page }) => {
  await oeffne(page, "/tests/browser/fixtures/probes-gedreht.html");
  await page.waitForFunction(() => "LiveAudit" in window);

  const { nach, probes } = await scanne(page, []);
  expect(probes?.columns.transforms).toBeGreaterThan(0);
  expect(nach.html).toContain("orientation/root-rotated:fail");
});

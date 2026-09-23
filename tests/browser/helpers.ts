/**
 * Gemeinsames für die Browser-Regressionstests des Inspector-Layers.
 */

import type { Locator, Page } from "@playwright/test";

/** Der Tagname des einen Hosts; der Layer hängt vollständig in dessen Shadow Root. */
export const HOST = "liveaudit-inspector";

/** Der Marker sitzt auf der oberen linken Ecke seines Elements: MARKER_SIZE / 2. */
export const MARKER_VERSATZ = 12;

/** Nur so viel vom Ergebnis, wie die Tests lesen. */
export interface Befund {
  rule_id: string;
  outcome: string;
  location?: { node?: number };
}

export interface ScanErgebnis {
  documents: { report: { findings: Befund[] }; idToElement: Map<number, Element> }[];
}

/** Nur das, was die Tests von der öffentlichen Schnittstelle brauchen. */
interface LiveAuditApi {
  scan(root?: Element, options?: { rendering?: boolean }): Promise<ScanErgebnis>;
  show(root?: Element, options?: { rendering?: boolean }): Promise<unknown>;
  watch(root?: Element, options?: { rendering?: boolean; debounceMs?: number }): Promise<unknown>;
  unwatch(): void;
  hide(): void;
  isVisible(): boolean;
}

declare global {
  interface Window {
    LiveAudit: LiveAuditApi;
  }
  /** Was die Live-Fixture zum Auslösen echter Mutationen bereitstellt. */
  var fuegeBefundEin: () => void;
  var entferneBefund: () => void;
  var behebeBefund: () => void;
}

/**
 * Öffnet eine Seite unter `baseURL`.
 *
 * Der Cross-Origin-Rahmen in `examples/inspector.html` wird abgewiesen: Er ist
 * dort, um einen UNTESTED-Bereich zu erzeugen, und dafür genügt ein Rahmen, in
 * den niemand hineinsehen kann. Die Tests bleiben damit ohne Netz.
 */
export async function oeffne(page: Page, pfad: string): Promise<void> {
  await page.route("https://example.com/**", (route) => route.abort());
  await page.goto(pfad);
}

/** `show()` liefert das Scan-Ergebnis; das ist nichts, was über die Grenze passt. */
export async function zeige(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await window.LiveAudit.show();
  });
}

export async function verbirg(page: Page): Promise<void> {
  await page.evaluate(() => window.LiveAudit.hide());
}

/**
 * Wartet zwei Bildwechsel ab.
 *
 * Der Layer legt seine Neupositionierung in ein `requestAnimationFrame`, damit
 * Scrollen und Größenänderung nicht je Ereignis rechnen — direkt nach dem
 * Ereignis stehen die Marker deshalb noch alt.
 */
export async function naechsterRahmen(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((fertig) => {
        requestAnimationFrame(() => requestAnimationFrame(() => fertig()));
      }),
  );
}

/** Der Marker zu einer Regel-Kennung — die Beschriftung des Markers trägt sie. */
export function marker(page: Page, regel: string): Locator {
  return page.locator(`${HOST} .marker[aria-label*="${regel}"]`);
}

/** Der Kasten eines Elements, oder ein Fehler mit Namen statt eines `null`. */
export async function kasten(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("Element hat keinen Kasten — nicht dargestellt?");
  return box;
}

/**
 * Wo im Shadow Root der Fokus steht.
 *
 * Von außen zeigt `document.activeElement` nur den Host; welches Bedienelement
 * darin den Fokus hat, steht im `activeElement` des Shadow Roots.
 */
export async function fokusImLayer(page: Page): Promise<string | null> {
  return page.evaluate((host) => {
    const element = document.querySelector(host)?.shadowRoot?.activeElement ?? null;
    return element === null ? null : element.className;
  }, HOST);
}

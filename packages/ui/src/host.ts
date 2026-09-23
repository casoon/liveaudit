/**
 * Der Host des Inspector-Layers und die Geometrie darum herum.
 *
 * Genau **ein** Host `<liveaudit-inspector>`, letztes Kind von `<body>`, mit
 * eigenem Shadow Root. Nicht einer je Befund, nicht mehrere nebeneinander.
 * Der Collector schließt genau diesen Tagnamen vom Scan aus — der Inspector
 * prüft sich nicht selbst (siehe `docs/decisions.md`, „Der eigene Host bleibt
 * aus dem Scan").
 *
 * Der Host ist `position: fixed` und `pointer-events: none`. Beides zusammen
 * ist die Zusicherung aus dem Bauplan: Er verändert weder Layout noch
 * Scrollhöhe der Seite und fängt keine Klicks ab, die der Seite gelten. Nur
 * Marker, Popover und Panel setzen `pointer-events: auto`.
 */

import { HOST_TAG_NAME } from "@liveaudit/browser/collect";
import type { DocumentScan, ScanResult } from "@liveaudit/browser/scan";

/**
 * Die Eigenschaften, die der Host führen muss, damit die Zusicherung hält.
 *
 * Sie stehen inline und mit `!important` am Element, nicht als `:host`-Regel im
 * Shadow Root: Eine Seitenregel auf den Tagnamen schlägt `:host` in der
 * Spezifität, eine Inline-Deklaration mit `!important` nicht.
 */
const HOST_STYLE: ReadonlyArray<readonly [string, string]> = [
  ["position", "fixed"],
  ["inset", "0"],
  ["display", "block"],
  ["margin", "0"],
  ["padding", "0"],
  ["border", "0"],
  ["pointer-events", "none"],
  ["z-index", "2147483647"],
  ["color-scheme", "dark"],
];

/**
 * Sorgt für genau einen Host als letztes Kind von `<body>` und gibt dessen
 * Shadow Root zurück.
 *
 * Ein Host aus einem früheren Lauf wird wiederverwendet, überzählige werden
 * entfernt. Der Shadow Root ist `open`, damit der Layer selbst prüfbar bleibt —
 * der Selbsttest scannt ihn.
 */
export function ensureHost(): { host: HTMLElement; shadow: ShadowRoot } {
  const existing = document.getElementsByTagName(HOST_TAG_NAME);
  for (let i = existing.length - 1; i >= 1; i--) existing[i]?.remove();

  const host = (existing[0] as HTMLElement | undefined) ?? document.createElement(HOST_TAG_NAME);
  for (const [property, value] of HOST_STYLE) {
    host.style.setProperty(property, value, "important");
  }

  if (host.parentNode !== document.body || host.nextSibling !== null) {
    document.body.appendChild(host);
  }

  const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  return { host, shadow };
}

/** Entfernt den Host wieder. Danach ist von LiveAudit nichts mehr im Dokument. */
export function removeHost(): void {
  const existing = document.getElementsByTagName(HOST_TAG_NAME);
  for (let i = existing.length - 1; i >= 0; i--) existing[i]?.remove();
}

/**
 * Das oberste Element an einem Punkt — **ohne** den eigenen Host.
 *
 * `elementFromPoint()` träfe den Layer statt des Zielelements. Statt den Host
 * kurz auszublenden (das flackert und erzwingt zwei Layouts) filtert diese
 * Fassung ihn aus `elementsFromPoint()` heraus. Der Effekt ist derselbe, die
 * Messung bleibt in einem Frame.
 */
export function topElementAt(doc: Document, x: number, y: number): Element | null {
  const stack = doc.elementsFromPoint(x, y);
  for (const element of stack) {
    if (element.localName === HOST_TAG_NAME) continue;
    return element;
  }
  return null;
}

/** Wo ein Element im Viewport des **Hauptdokuments** liegt. */
export interface Placement {
  rect: DOMRect;
  /** Das Dokument, in dem das Element hängt — für Messungen an diesem Punkt. */
  ownerDocument: Document;
  /** Der Versatz des umgebenden Frames, bereits in `rect` eingerechnet. */
  frameOffsetX: number;
  frameOffsetY: number;
}

/**
 * Rechnet die Bounding-Box eines Elements in Viewport-Koordinaten des
 * Hauptdokuments um.
 *
 * Ein Element in einem Same-Origin-Frame liefert `getBoundingClientRect()`
 * relativ zum Viewport **seines** Frames. Der Layer hängt aber im
 * Hauptdokument, also kommt der Versatz jedes umgebenden `<iframe>` dazu —
 * inklusive dessen Rahmenbreite über `clientLeft`/`clientTop`.
 *
 * Gelesen wird ausschließlich: `getBoundingClientRect()` verändert nichts am
 * geprüften Teilbaum.
 */
export function placementOf(
  result: ScanResult,
  scanned: DocumentScan,
  element: Element,
): Placement | null {
  const rect = element.getBoundingClientRect();
  let offsetX = 0;
  let offsetY = 0;

  let current: DocumentScan | undefined = scanned;
  while (current !== undefined && current.parent !== null) {
    const outer: DocumentScan | undefined = result.documents[current.parent.document];
    if (outer === undefined) return null;
    const frame = outer.idToElement.get(current.parent.node);
    if (frame === undefined) return null;
    const frameRect = frame.getBoundingClientRect();
    offsetX += frameRect.left + frame.clientLeft;
    offsetY += frameRect.top + frame.clientTop;
    current = outer;
  }

  return {
    rect: new DOMRect(rect.left + offsetX, rect.top + offsetY, rect.width, rect.height),
    ownerDocument: element.ownerDocument,
    frameOffsetX: offsetX,
    frameOffsetY: offsetY,
  };
}

/** Die Fenster aller gescannten Dokumente — für Scroll-Listener in Frames. */
export function windowsOf(result: ScanResult): Window[] {
  const windows: Window[] = [];
  for (const scanned of result.documents) {
    const view = scanned.idToElement.get(0)?.ownerDocument.defaultView;
    if (view !== null && view !== undefined && !windows.includes(view)) windows.push(view);
  }
  if (!windows.includes(window)) windows.unshift(window);
  return windows;
}

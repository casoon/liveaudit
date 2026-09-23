/**
 * Tier 3: berechnete Stile, gesammelt in einem eigenen Durchgang.
 *
 * Warum nicht im Collector: `getComputedStyle()` kostet ein Vielfaches der
 * Strukturerfassung und wird nicht für jeden Scan gebraucht. Gemessen am
 * 20.09.2026 (`examples/tier3.html`, in `docs/project-state.md` festgehalten)
 * kostet Tier 3 das 1,9- bis 4,6-fache des Collectors.
 *
 * Zwei Befunde aus derselben Messung bestimmen den Aufbau hier:
 *
 * 1. **`getComputedStyle()` kostet pro Aufruf, nicht pro Layout.** Der warme
 *    Wert ist so hoch wie der kalte. Der Hebel ist die Zahl der Aufrufe.
 * 2. **Der effektive Hintergrund ist der größte Einzelposten**, weil die
 *    Traversierung über dieselben Vorfahren immer wieder läuft — 934 ms gegen
 *    111 ms bei `tc39-ecma262`. Die Merkliste unten ist deshalb keine
 *    Optimierung für später, sondern Bedingung.
 */

import { flatParent } from "./collect.ts";

/** Ein Farbwert, gepackt als `0xRRGGBBAA`. */
export type PackedColor = number;

/**
 * Was an einer Stelle steht, an der der Host nichts bestimmen konnte.
 *
 * `a11y-rules` verlangt genau das: Kann der Host eine Farbe nicht auflösen,
 * liefert er nichts, und die Regel meldet `UNTESTED`. Eine Prüfung gegen
 * geratenes Weiß erzeugte ein `PASS`, auf das sich jemand verlässt.
 */
export const UNBESTIMMT: PackedColor = 0;

/** Bit 0: `display: none`. Bit 1: `visibility: hidden`. Bit 2: Stil erfasst. */
export const FLAG_DISPLAY_NONE = 1;
export const FLAG_VISIBILITY_HIDDEN = 2;
export const FLAG_ERFASST = 4;

/** Die Tier-3-Spalten, parallel zu den Arena-Indizes. */
export interface RenderingColumns {
  color: Uint32Array;
  background: Uint32Array;
  fontSizePx: Float32Array;
  fontWeight: Uint16Array;
  flags: Uint8Array;
}

/**
 * Zerlegt einen `rgb()`- oder `rgba()`-Wert.
 *
 * `getComputedStyle` liefert in allen aktuellen Engines diese beiden Formen;
 * moderne Farbräume (`color(display-p3 …)`, `oklch()`) erscheinen dort nur,
 * wenn sie nicht in sRGB darstellbar sind. Die werden bewusst nicht geraten —
 * sie ergeben `UNBESTIMMT`.
 */
export function parseColor(wert: string): PackedColor {
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.%]+))?\s*\)$/.exec(
    wert.trim(),
  );
  if (m === null) return UNBESTIMMT;

  const kanal = (s: string) => Math.max(0, Math.min(255, Math.round(Number(s))));
  const r = kanal(m[1] as string);
  const g = kanal(m[2] as string);
  const b = kanal(m[3] as string);

  const roh = m[4];
  let a = 255;
  if (roh !== undefined) {
    const zahl = roh.endsWith("%") ? Number(roh.slice(0, -1)) / 100 : Number(roh);
    a = Math.max(0, Math.min(255, Math.round(zahl * 255)));
  }

  // Vollständig durchsichtig ist keine Farbe, sondern die Abwesenheit einer.
  if (a === 0) return UNBESTIMMT;
  // 0 ist als Sentinel vergeben; reines Schwarz mit Alpha 0 kann nicht
  // vorkommen, weil Alpha 0 oben abgefangen ist.
  return (((r << 24) | (g << 16) | (b << 8) | a) >>> 0) as PackedColor;
}

/** Ob dieser Hintergrundwert deckend genug ist, um die Suche zu beenden. */
function istDeckend(gepackt: PackedColor): boolean {
  return gepackt !== UNBESTIMMT && (gepackt & 0xff) === 0xff;
}

/**
 * Ob der Hintergrund dieses Elements aus etwas besteht, das sich nicht auf eine
 * Farbe reduzieren lässt — Bild, Verlauf, Blend-Modus.
 */
function hatUnbestimmbarenHintergrund(stil: CSSStyleDeclaration): boolean {
  const bild = stil.backgroundImage;
  if (bild !== "" && bild !== "none") return true;
  const blend = stil.backgroundBlendMode;
  return blend !== "" && blend !== "normal";
}

/**
 * Die effektive Hintergrundfarbe, über die Vorfahren aufgelöst.
 *
 * `memo` hält jeden Zwischenstand, damit jedes Element höchstens einen
 * `getComputedStyle`-Aufruf kostet — siehe Modulkopf.
 */
function effektiverHintergrund(
  el: Element,
  win: Window,
  memo: Map<Element, PackedColor>,
): PackedColor {
  const kette: Element[] = [];
  let cur: Element | null = el;
  let ergebnis: PackedColor | null = null;

  while (cur !== null) {
    const bekannt = memo.get(cur);
    if (bekannt !== undefined) {
      ergebnis = bekannt;
      break;
    }
    const stil = win.getComputedStyle(cur);
    if (hatUnbestimmbarenHintergrund(stil)) {
      ergebnis = UNBESTIMMT;
      break;
    }
    const eigen = parseColor(stil.backgroundColor);
    if (istDeckend(eigen)) {
      ergebnis = eigen;
      break;
    }
    // Teildurchsichtige Hintergründe über einem Vorfahren zu verrechnen wäre
    // möglich, aber der Fehler bei Schichtung ist schwer zu begrenzen. Ehrlich
    // ist hier UNBESTIMMT — die Regel meldet dann UNTESTED.
    if (eigen !== UNBESTIMMT) {
      ergebnis = UNBESTIMMT;
      break;
    }
    kette.push(cur);
    cur = flatParent(cur);
  }

  // Oben angekommen ohne Treffer: Das Dokument selbst ist der Hintergrund.
  // Der Browser stellt es weiß dar, wenn nichts anderes gesetzt ist — das ist
  // keine Annahme, sondern die Vorgabe des Initial Containing Block.
  if (ergebnis === null) ergebnis = parseColor("rgb(255, 255, 255)");

  for (const k of kette) memo.set(k, ergebnis);
  if (cur !== null) memo.set(cur, ergebnis);
  return ergebnis;
}

/**
 * Sammelt die Tier-3-Spalten für eine bereits aufgebaute Arena.
 *
 * `idToElement` stammt aus dem Collector. Knoten ohne Element — Textknoten —
 * bleiben auf `0` und tragen kein `FLAG_ERFASST`.
 */
export function collectRendering(
  idToElement: Map<number, Element>,
  nodes: number,
  win: Window,
): RenderingColumns {
  const color = new Uint32Array(nodes);
  const background = new Uint32Array(nodes);
  const fontSizePx = new Float32Array(nodes);
  const fontWeight = new Uint16Array(nodes);
  const flags = new Uint8Array(nodes);

  const memo = new Map<Element, PackedColor>();

  for (const [id, el] of idToElement) {
    if (id >= nodes) continue;
    const stil = win.getComputedStyle(el);

    let f = FLAG_ERFASST;
    if (stil.display === "none") f |= FLAG_DISPLAY_NONE;
    if (stil.visibility === "hidden" || stil.visibility === "collapse") {
      f |= FLAG_VISIBILITY_HIDDEN;
    }
    flags[id] = f;

    // Unsichtbares kostet keinen Hintergrund-Aufstieg — das ist der billigste
    // Weg, die Zahl der Aufrufe zu senken, auf die es laut Messung ankommt.
    if ((f & (FLAG_DISPLAY_NONE | FLAG_VISIBILITY_HIDDEN)) !== 0) continue;

    color[id] = parseColor(stil.color);
    fontSizePx[id] = Number.parseFloat(stil.fontSize) || 0;
    fontWeight[id] = Number.parseInt(stil.fontWeight, 10) || 0;
    background[id] = effektiverHintergrund(el, win, memo);
  }

  return { color, background, fontSizePx, fontWeight, flags };
}

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

/** Bits der Layout-Spalte, passend zu `LAYOUT_*` in `@casoon/a11y-wasm`. */
const LAYOUT_ERFASST = 1;
const LAYOUT_UMGEKEHRT = 2;
const LAYOUT_ZEIGER = 4;
const LAYOUT_ENDLOS = 8;
const LAYOUT_VERDECKT = 16;
const LAYOUT_FOKUS_GEMESSEN = 32;
const LAYOUT_FOKUS_SICHTBAR = 64;
const LAYOUT_VERSTECKT_FOKUS = 128;

/** Die Tier-3-Spalten, parallel zu den Arena-Indizes. */
export interface RenderingColumns {
  color: Uint32Array;
  background: Uint32Array;
  fontSizePx: Float32Array;
  fontWeight: Uint16Array;
  flags: Uint8Array;
  /** Layout für die heuristischen Regeln, Bits `LAYOUT_*`. */
  layoutFlags: Uint8Array;
  order: Int32Array;
  minWidthPx: Float32Array;
  /** Vier Werte je Knoten (x, y, Breite, Höhe); Breite `NaN` = nicht erhoben. */
  bounds: Float32Array;
}

/**
 * Ob die Tabtaste dieses Element erreicht — dieselbe Abgrenzung wie
 * `per_tab_erreichbar` in `a11y-rules`. Nur an solchen Elementen wird
 * Geometrie erhoben: `getBoundingClientRect()` je Knoten kostet so viel wie
 * der ganze Collector.
 */
function perTabErreichbar(el: Element): boolean {
  const tabindex = el.getAttribute("tabindex");
  if (tabindex !== null && tabindex.trim() !== "" && !Number.isNaN(Number(tabindex))) {
    return Number(tabindex) >= 0;
  }
  if (el.hasAttribute("disabled")) return false;
  switch (el.localName) {
    case "a":
    case "area":
      return el.hasAttribute("href");
    case "input":
      return el.getAttribute("type")?.trim().toLowerCase() !== "hidden";
    case "button":
    case "select":
    case "textarea":
    case "summary":
    case "iframe":
      return true;
    default:
      return false;
  }
}

/** Elemente, auf denen gerade eine Animation ohne Ende läuft. */
function endloseAnimationen(doc: Document): Set<Element> {
  const treffer = new Set<Element>();
  if (typeof doc.getAnimations !== "function") return treffer;
  for (const animation of doc.getAnimations()) {
    if (animation.playState !== "running") continue;
    const effekt = animation.effect as KeyframeEffect | null;
    const ziel = effekt?.target ?? null;
    if (ziel !== null && effekt?.getComputedTiming().iterations === Number.POSITIVE_INFINITY) {
      treffer.add(ziel);
    }
  }
  return treffer;
}

/**
 * Ob die Mitte von `el` im sichtbaren Bereich liegt und dort ein fremdes,
 * fixiertes oder klebendes Element getroffen wird. Der Inspector-Layer ist
 * `pointer-events: none` und wird dabei nicht getroffen.
 */
function istVerdeckt(el: Element, r: DOMRect, win: Window): boolean {
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  if (x < 0 || y < 0 || x >= win.innerWidth || y >= win.innerHeight) return false;
  const wurzel = el.getRootNode() as Document | ShadowRoot;
  const getroffen = wurzel.elementFromPoint(x, y);
  if (getroffen === null || getroffen === el || el.contains(getroffen) || getroffen.contains(el)) {
    return false;
  }
  for (let cur: Element | null = getroffen; cur !== null; cur = flatParent(cur)) {
    if (cur.contains(el)) return false;
    const position = win.getComputedStyle(cur).position;
    if (position === "fixed" || position === "sticky") return true;
  }
  return false;
}

/**
 * Was `farbleser` für einen vollständig durchsichtigen Wert liefert. Keine
 * gepackte Farbe ist negativ, der Wert landet nie in einer Spalte.
 */
const DURCHSICHTIG = -1;

/**
 * Zerlegt einen `rgb()`- oder `rgba()`-Wert in Kanäle `0…255`, oder `null`.
 *
 * Das ist nur der schnelle Weg: Chrome liefert berechnete Farben im Farbraum,
 * in dem sie geschrieben wurden — `oklch()`, `lab()`, `color(…)`. Die rechnet
 * `farbleser` über eine Leinwand nach sRGB um.
 */
function zerlege(wert: string): [number, number, number, number] | null {
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.%]+))?\s*\)$/.exec(
    wert.trim(),
  );
  if (m === null) return null;

  const kanal = (s: string) => Math.max(0, Math.min(255, Math.round(Number(s))));
  const roh = m[4];
  let a = 255;
  if (roh !== undefined) {
    const zahl = roh.endsWith("%") ? Number(roh.slice(0, -1)) / 100 : Number(roh);
    a = Math.max(0, Math.min(255, Math.round(zahl * 255)));
  }
  return [kanal(m[1] as string), kanal(m[2] as string), kanal(m[3] as string), a];
}

/** Ein `rgb()`/`rgba()`-Wert gepackt; durchsichtig oder anderes ist `UNBESTIMMT`. */
export function parseColor(wert: string): PackedColor {
  const k = zerlege(wert);
  // Vollständig durchsichtig ist keine Farbe, sondern die Abwesenheit einer.
  if (k === null || k[3] === 0) return UNBESTIMMT;
  return packe(k[0], k[1], k[2], k[3]);
}

/** Ob dieser Hintergrundwert deckend genug ist, um die Suche zu beenden. */
function istDeckend(gepackt: PackedColor): boolean {
  return gepackt !== UNBESTIMMT && (gepackt & 0xff) === 0xff;
}

function packe(r: number, g: number, b: number, a: number): PackedColor {
  // 0 ist als Sentinel vergeben; Alpha 0 kommt hier nie an.
  return (((r << 24) | (g << 16) | (b << 8) | a) >>> 0) as PackedColor;
}

/**
 * Liest berechnete Farbwerte in jedem Farbraum, den der Browser kennt.
 *
 * Was nicht `rgb()` ist, malt er auf eine 1×1-Leinwand und liest das Pixel in
 * sRGB zurück — der Browser rechnet um, nicht wir. Die Leinwand ist ein
 * `OffscreenCanvas` und hängt nirgends im Dokument. Je Wert wird einmal
 * gemalt: Eine Seite hat wenige verschiedene Farben, aber viele Elemente.
 *
 * Ohne Leinwand bleibt ein solcher Wert `UNBESTIMMT` — nie geraten.
 */
function farbleser(): (wert: string) => PackedColor | typeof DURCHSICHTIG {
  const gelesen = new Map<string, PackedColor | typeof DURCHSICHTIG>();
  let ctx: OffscreenCanvasRenderingContext2D | null | undefined;

  const male = (wert: string): PackedColor | typeof DURCHSICHTIG => {
    if (ctx === undefined) {
      ctx =
        typeof OffscreenCanvas === "function"
          ? new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true })
          : null;
    }
    if (ctx === null) return UNBESTIMMT;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = wert;
    ctx.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 0] = ctx.getImageData(0, 0, 1, 1).data;
    return a === 0 ? DURCHSICHTIG : packe(r, g, b, a);
  };

  return (wert) => {
    const bekannt = gelesen.get(wert);
    if (bekannt !== undefined) return bekannt;
    let ergebnis: PackedColor | typeof DURCHSICHTIG;
    const k = zerlege(wert);
    if (k !== null) ergebnis = k[3] === 0 ? DURCHSICHTIG : packe(k[0], k[1], k[2], k[3]);
    else if (wert === "" || wert === "transparent") ergebnis = DURCHSICHTIG;
    else ergebnis = male(wert);
    gelesen.set(wert, ergebnis);
    return ergebnis;
  };
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
  lies: (wert: string) => PackedColor | typeof DURCHSICHTIG,
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
    const eigen = lies(stil.backgroundColor);
    // Nicht lesbar ist nicht durchsichtig: Wer hier weiter aufsteigt, landet
    // beim Weiß des Dokuments und prüft gegen eine Fläche, die nicht da ist.
    if (eigen === UNBESTIMMT) {
      ergebnis = UNBESTIMMT;
      break;
    }
    if (eigen !== DURCHSICHTIG && istDeckend(eigen)) {
      ergebnis = eigen;
      break;
    }
    // Teildurchsichtige Hintergründe über einem Vorfahren zu verrechnen wäre
    // möglich, aber der Fehler bei Schichtung ist schwer zu begrenzen. Ehrlich
    // ist hier UNBESTIMMT — die Regel meldet dann UNTESTED.
    if (eigen !== DURCHSICHTIG) {
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

/** Ein fixiertes oder klebendes Element, wie es am oberen Rand steht. */
interface Leiste {
  id: number;
  oben: number;
  unten: number;
}

/**
 * Markiert die Leisten, unter denen ein fokussiertes Element ganz
 * verschwinden kann (WCAG 2.4.11).
 *
 * Tabbt man rückwärts, richtet der Browser das Ziel oben aus — bei
 * `scroll-padding-top`. Decken fixierte und klebende Leisten, lückenlos
 * aneinander, den Streifen ab dieser Kante ab, landet ein niedriges
 * Bedienelement ganz unter ihnen. Eine klebende Leiste zählt an der Stelle, an
 * der sie klebt (`top`), nicht an der, an der sie gerade steht.
 */
function markiereLeisten(leisten: Leiste[], flags: Uint8Array, win: Window): void {
  if (leisten.length === 0) return;
  const kante =
    Number.parseFloat(win.getComputedStyle(win.document.documentElement).scrollPaddingTop) || 0;
  leisten.sort((a, b) => a.oben - b.oben);
  let bis = kante;
  const deckend: Leiste[] = [];
  for (const l of leisten) {
    if (l.unten <= kante + 1) continue;
    if (l.oben > bis + 1) break;
    deckend.push(l);
    bis = Math.max(bis, l.unten);
  }
  for (const l of deckend) flags[l.id] = (flags[l.id] ?? 0) | LAYOUT_VERSTECKT_FOKUS;
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

  const layoutFlags = new Uint8Array(nodes);
  const order = new Int32Array(nodes);
  const minWidthPx = new Float32Array(nodes);
  const bounds = new Float32Array(nodes * 4).fill(Number.NaN);

  const memo = new Map<Element, PackedColor>();
  const lies = farbleser();
  const endlos = endloseAnimationen(win.document);
  const leisten: Leiste[] = [];

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

    const vorne = lies(stil.color);
    color[id] = vorne === DURCHSICHTIG ? UNBESTIMMT : vorne;

    let l = LAYOUT_ERFASST;
    if (stil.display.endsWith("flex") && stil.flexDirection.endsWith("-reverse")) {
      l |= LAYOUT_UMGEKEHRT;
    }
    if (stil.cursor === "pointer") l |= LAYOUT_ZEIGER;
    if (endlos.has(el)) l |= LAYOUT_ENDLOS;
    order[id] = Number.parseInt(stil.order, 10) || 0;
    minWidthPx[id] = Number.parseFloat(stil.minWidth) || 0;
    if (perTabErreichbar(el)) {
      const r = el.getBoundingClientRect();
      bounds.set([r.x, r.y, r.width, r.height], id * 4);
      if (istVerdeckt(el, r, win)) l |= LAYOUT_VERDECKT;
    }
    if (stil.position === "fixed" || stil.position === "sticky") {
      const r = el.getBoundingClientRect();
      // Nur Leisten über die halbe Breite; ein fixierter Knopf in der Ecke
      // verdeckt keine Zeile.
      if (r.height > 0 && r.width >= win.innerWidth / 2) {
        const oben = stil.position === "sticky" ? Number.parseFloat(stil.top) : r.top;
        if (Number.isFinite(oben)) leisten.push({ id, oben, unten: oben + r.height });
      }
    }
    layoutFlags[id] = l;
    fontSizePx[id] = Number.parseFloat(stil.fontSize) || 0;
    fontWeight[id] = Number.parseInt(stil.fontWeight, 10) || 0;
    background[id] = effektiverHintergrund(el, win, memo, lies);
  }

  markiereLeisten(leisten, layoutFlags, win);

  return {
    color,
    background,
    fontSizePx,
    fontWeight,
    flags,
    layoutFlags,
    order,
    minWidthPx,
    bounds,
  };
}

/**
 * Was sich beim Fokussieren ändern darf, damit der Fokus als sichtbar gilt.
 * Der Rahmen (`outline`) kommt gesondert: Ein Wechsel von `none` auf `solid`
 * bei Breite 0 zeigt nichts.
 */
const FOKUS_EIGENSCHAFTEN = [
  "box-shadow",
  "border-top-color",
  "border-bottom-color",
  "border-left-color",
  "border-right-color",
  "background-color",
  "color",
  "text-decoration-line",
] as const;

function fokusStil(stil: CSSStyleDeclaration): string {
  const rahmen =
    stil.outlineStyle !== "none" && (Number.parseFloat(stil.outlineWidth) || 0) > 0
      ? `${stil.outlineStyle} ${stil.outlineWidth} ${stil.outlineColor}`
      : "none";
  return [rahmen, ...FOKUS_EIGENSCHAFTEN.map((e) => stil.getPropertyValue(e))].join("|");
}

/**
 * Misst, ob der Fokus an jedem erreichbaren Element sichtbar wird.
 *
 * **Das verändert den Zustand der Seite.** Jedes Element wird fokussiert,
 * die Seite bekommt `focus`- und `blur`-Ereignisse und kann darauf reagieren
 * — ein Menü öffnen, etwas nachladen. Deshalb nur auf ausdrücklichen Wunsch
 * (`scan(root, { rendering: true, focus: true })`), und danach steht der
 * Fokus wieder dort, wo er war. Gescrollt wird nicht (`preventScroll`).
 *
 * Fokussiert wird mit `focusVisible: true`: Ob `:focus-visible` greift,
 * hängt sonst davon ab, ob zuletzt Maus oder Tastatur benutzt wurde.
 */
export function measureFocus(
  idToElement: Map<number, Element>,
  columns: RenderingColumns,
  win: Window,
): void {
  const doc = win.document;
  const vorher = doc.activeElement;

  for (const [id, el] of idToElement) {
    if (id >= columns.layoutFlags.length) continue;
    if (((columns.flags[id] ?? 0) & (FLAG_DISPLAY_NONE | FLAG_VISIBILITY_HIDDEN)) !== 0) continue;
    if (!perTabErreichbar(el) || !("focus" in el)) continue;

    const stil = win.getComputedStyle(el);
    const ohne = fokusStil(stil);
    (el as HTMLElement).focus({ preventScroll: true, focusVisible: true } as FocusOptions);
    const aktiv = (el.getRootNode() as Document | ShadowRoot).activeElement;
    if (aktiv !== el) continue;
    const mit = fokusStil(stil);

    let l = (columns.layoutFlags[id] ?? 0) | LAYOUT_FOKUS_GEMESSEN;
    if (mit !== ohne) l |= LAYOUT_FOKUS_SICHTBAR;
    columns.layoutFlags[id] = l;
  }

  // Kein `instanceof HTMLElement`: Ein Same-Origin-Rahmen ist ein eigenes
  // Realm mit eigenen Konstruktoren.
  if (vorher !== null && vorher !== doc.body && "focus" in vorher) {
    (vorher as HTMLElement).focus({ preventScroll: true });
  } else if (doc.activeElement !== null && "blur" in doc.activeElement) {
    (doc.activeElement as HTMLElement).blur();
  }
}

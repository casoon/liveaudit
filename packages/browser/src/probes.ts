/**
 * Messungen für die seitenabhängigen Regeln von `a11y-rules` (liveaudit#16).
 *
 * Fünf Regeln brauchen etwas, das nur die laufende Seite beantworten kann:
 * ob ein Rahmen lesbar ist, ob die Wurzel gedreht ist, ob Einfügen in ein
 * Passwortfeld blockiert ist, ob ein fokussiertes Bedienelement unter einer
 * fixierten Leiste liegt, ob ein Element mit mehr Textabstand seinen Text
 * abschneidet. Jede Messung ist eine dünn besetzte Spalte (Knotenindizes plus
 * Werte); **eine fehlende Spalte heißt „nicht gemessen"** und macht die Regel
 * zu `NotRun::CapabilityMissing`, nie zu einem Bestehen.
 *
 * Zwei Messungen lesen nur (Rahmen, Drehung) und laufen mit dem
 * Darstellungsdurchgang. Drei verändern die Seite für einen Moment (Wert eines
 * Feldes, Fokus und Scrollposition, ein Stil) und laufen nur auf
 * ausdrückliche Anforderung (`probes: ["paste", "focus", "spacing"]`). Jede
 * stellt den Zustand in einem `finally` wieder her. Was sich nicht
 * zurücknehmen lässt — ein `focus`-Handler der Seite, der selbst etwas tut —,
 * steht in `docs/constraints.md`.
 */

import { type FrameRef, flatParent } from "./collect.ts";
import {
  FLAG_DISPLAY_NONE,
  FLAG_VISIBILITY_HIDDEN,
  perTabErreichbar,
  type RenderingColumns,
} from "./rendering.ts";

/** Die Messungen, die die Seite berühren und deshalb einzeln anzufordern sind. */
export type ProbeName = "paste" | "focus" | "spacing";

/** Bits der Einfüge-Spalte, passend zu `PASTE_*` in `a11y-wasm`. */
const PASTE_CANCELLED = 1;
const PASTE_INSERTED = 2;
/** Bits der Textabstands-Spalte, passend zu `SPACING_*` in `a11y-wasm`. */
const SPACING_BEFORE = 1;
const SPACING_AFTER = 2;

/** Der Probetext der Einfüge-Messung. */
const PASTE_PROBE_TEXT = "liveaudit-paste-probe";

/**
 * Deckel auf die Zahl der Elemente je Messung. Beide sind Obergrenzen für die
 * Kosten, nicht für die Richtigkeit: Was darüber liegt, bleibt ungemessen, und
 * der Bericht nennt es (`ProbeReport.skipped`).
 */
export const MAX_FOCUS_CONTROLS = 300;
export const MAX_SPACING_ELEMENTS = 5000;

/** Wie die Fokus-Messung gescrollt hat — die Regel verlangt, es festzuhalten. */
export const FOCUS_SCROLL = 'scrollIntoView({ block: "nearest", inline: "nearest" })';

export interface FramesColumn {
  nodes: Uint32Array;
  reachable: Uint8Array;
}
export interface TransformsColumn {
  nodes: Uint32Array;
  transform: string[];
  rotate: string[];
}
export interface PasteColumn {
  nodes: Uint32Array;
  flags: Uint8Array;
}
export interface FocusColumn {
  nodes: Uint32Array;
  points: Uint32Array;
  covered: Uint32Array;
  blocker: Int32Array;
}
export interface SpacingColumn {
  nodes: Uint32Array;
  flags: Uint8Array;
}

/** Die Spalten dieses Durchgangs; `null` ist „nicht gemessen". */
export interface ProbeColumns {
  frames: FramesColumn | null;
  transforms: TransformsColumn | null;
  paste: PasteColumn | null;
  focus: FocusColumn | null;
  spacing: SpacingColumn | null;
}

/** Was ein Durchgang nicht gemessen hat, obwohl er angefordert war. */
export interface ProbeSkip {
  probe: ProbeName;
  reason: "cap" | "override-failed";
  /** Bei `cap`: wie viele Elemente über dem Deckel lagen. */
  count?: number;
}

/** Was ein Dokument an Messungen geliefert hat — für Berichte und Tests. */
export interface ProbeReport {
  /** Knoten je gefüllter Spalte. Eine Spalte fehlt hier, wenn sie nicht gemessen wurde. */
  columns: Partial<Record<"frames" | "transforms" | ProbeName, number>>;
  skipped: ProbeSkip[];
  /** Wie die Fokus-Messung gescrollt hat; nur gesetzt, wenn sie lief. */
  focusScroll?: string;
}

function ascending<T extends { id: number }>(rows: T[]): T[] {
  return rows.sort((a, b) => a.id - b.id);
}

// --- frames/cross-origin --------------------------------------------------------

/** Je `<iframe>`: ob sein Dokument lesbar ist. Liest nur. */
export function probeFrames(frames: FrameRef[]): FramesColumn | null {
  if (frames.length === 0) return null;
  const rows = ascending(frames.map((f) => ({ id: f.node, reachable: f.document !== null })));
  return {
    nodes: Uint32Array.from(rows, (r) => r.id),
    reachable: Uint8Array.from(rows, (r) => (r.reachable ? 1 : 0)),
  };
}

// --- orientation/root-rotated ---------------------------------------------------

/** `transform` und `rotate` von `html` und `body`, wie der Browser sie serialisiert. Liest nur. */
export function probeTransforms(
  elementToId: WeakMap<Element, number>,
  win: Window,
): TransformsColumn | null {
  const doc = win.document;
  const rows: { id: number; transform: string; rotate: string }[] = [];
  for (const el of [doc.documentElement, doc.body]) {
    if (el === null) continue;
    const id = elementToId.get(el);
    if (id === undefined) continue;
    const stil = win.getComputedStyle(el);
    // `rotate` kennt nicht jeder Browser; eine leere Zeichenkette heißt „nicht gemessen".
    rows.push({ id, transform: stil.transform, rotate: stil.getPropertyValue("rotate") });
  }
  if (rows.length === 0) return null;
  ascending(rows);
  return {
    nodes: Uint32Array.from(rows, (r) => r.id),
    transform: rows.map((r) => r.transform),
    rotate: rows.map((r) => r.rotate),
  };
}

// --- shared helpers -------------------------------------------------------------

function sichtbarErfasst(columns: RenderingColumns, id: number): boolean {
  const f = columns.flags[id] ?? 0;
  return f !== 0 && (f & (FLAG_DISPLAY_NONE | FLAG_VISIBILITY_HIDDEN)) === 0;
}

/** Elemente in Arena-Reihenfolge — die Index-Spalten müssen aufsteigen. */
function inReihenfolge(idToElement: Map<number, Element>, nodes: number): [number, Element][] {
  return [...idToElement].filter(([id]) => id < nodes).sort((a, b) => a[0] - b[0]);
}

/** Das tiefste fokussierte Element, auch durch offene Shadow Roots hindurch. */
function tiefsterFokus(doc: Document): Element | null {
  let aktiv: Element | null = doc.activeElement;
  while (aktiv?.shadowRoot?.activeElement) aktiv = aktiv.shadowRoot.activeElement;
  return aktiv;
}

function stelleFokusWiederHer(doc: Document, vorher: Element | null): void {
  // Kein `instanceof HTMLElement`: ein Same-Origin-Rahmen ist ein eigenes Realm.
  if (vorher !== null && vorher !== doc.body && "focus" in vorher) {
    (vorher as HTMLElement).focus({ preventScroll: true });
  } else {
    const aktiv = tiefsterFokus(doc);
    if (aktiv !== null && "blur" in aktiv) (aktiv as HTMLElement).blur();
  }
}

// --- auth/paste-blocked ---------------------------------------------------------

/** Typen, in die man nichts einfügt — dieselbe Liste wie `is_paste_candidate` in `a11y-rules`. */
const KEIN_EINFUEGEFELD = new Set([
  "hidden",
  "checkbox",
  "radio",
  "file",
  "submit",
  "button",
  "reset",
  "image",
  "range",
  "color",
]);

function istEinfuegeKandidat(el: Element): boolean {
  if (el.localName !== "input" || el.hasAttribute("disabled") || el.hasAttribute("readonly")) {
    return false;
  }
  const art = (el.getAttribute("type") ?? "").trim().toLowerCase();
  if (KEIN_EINFUEGEFELD.has(art)) return false;
  const token = (wunsch: string) =>
    (el.getAttribute("autocomplete") ?? "").split(/\s+/).some((t) => t.toLowerCase() === wunsch);
  return art === "password" || token("one-time-code") || token("current-password");
}

/** Ein abbrechbares `paste` mit Probetext. Synthetisch: `isTrusted` ist falsch. */
function einfuegeEreignis(fenster: Window): Event {
  // Die Konstruktoren des Fensters, nicht die globalen: ein Rahmen ist ein eigenes Realm.
  const win = fenster as Window & typeof globalThis;
  const init = { bubbles: true, cancelable: true, composed: true };
  try {
    const daten = new win.DataTransfer();
    daten.setData("text/plain", PASTE_PROBE_TEXT);
    return new win.ClipboardEvent("paste", { ...init, clipboardData: daten });
  } catch {
    // Ohne `DataTransfer`-Konstruktor: ein einfaches Ereignis mit der Eigenschaft,
    // die Handler lesen.
    const ereignis = new win.Event("paste", init);
    Object.defineProperty(ereignis, "clipboardData", {
      value: {
        types: ["text/plain"],
        getData: (art: string) => (art === "text" || art === "text/plain" ? PASTE_PROBE_TEXT : ""),
      },
    });
    return ereignis;
  }
}

const DIALOGE = ["alert", "confirm", "prompt"] as const;

/** Setzt die drei Dialoge still, solange `lauf` läuft, und stellt sie danach wieder her. */
function ohneDialoge<T>(win: Window, lauf: () => T): T {
  const alt = DIALOGE.map((n) => [n, Object.getOwnPropertyDescriptor(win, n)] as const);
  try {
    for (const name of DIALOGE) {
      Object.defineProperty(win, name, {
        configurable: true,
        writable: true,
        value: name === "alert" ? () => undefined : name === "confirm" ? () => false : () => null,
      });
    }
    return lauf();
  } finally {
    for (const [name, beschreibung] of alt) {
      if (beschreibung === undefined) Reflect.deleteProperty(win, name);
      else Object.defineProperty(win, name, beschreibung);
    }
  }
}

/**
 * Schickt an jedes Passwort- und Codefeld ein synthetisches `paste` und hält
 * fest, ob ein Handler es abbricht und ob der Probetext danach im Feld steht.
 *
 * **Berührt die Seite:** Handler laufen, und der Wert des Feldes wird für einen
 * Moment geschrieben. Der Wert kommt zurück; `alert`, `confirm` und `prompt`
 * sind währenddessen still. Ein synthetisches Ereignis ist nicht vertrauenswürdig
 * — ein Handler, der nur auf Tastendrücke oder `isTrusted` reagiert, bleibt
 * unsichtbar.
 */
export function probePaste(
  idToElement: Map<number, Element>,
  columns: RenderingColumns,
  win: Window,
): PasteColumn | null {
  const rows: { id: number; flags: number }[] = [];
  ohneDialoge(win, () => {
    for (const [id, el] of inReihenfolge(idToElement, columns.flags.length)) {
      if (!sichtbarErfasst(columns, id) || !istEinfuegeKandidat(el)) continue;
      const feld = el as HTMLInputElement;
      const rect = feld.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      const wert = feld.value;
      let start: number | null = null;
      let ende: number | null = null;
      let richtung: "forward" | "backward" | "none" | null = null;
      try {
        ({ selectionStart: start, selectionEnd: ende, selectionDirection: richtung } = feld);
      } catch {
        // Nicht jeder Typ kennt eine Auswahl.
      }
      try {
        const abgebrochen = !feld.dispatchEvent(einfuegeEreignis(win));
        const eingefuegt = feld.value.includes(PASTE_PROBE_TEXT);
        rows.push({
          id,
          flags: (abgebrochen ? PASTE_CANCELLED : 0) | (eingefuegt ? PASTE_INSERTED : 0),
        });
      } finally {
        // Nur schreiben, wenn sich etwas geändert hat: Ein Schreiben markiert
        // das Feld als vom Nutzer berührt.
        if (feld.value !== wert) feld.value = wert;
        if (start !== null && ende !== null) {
          try {
            feld.setSelectionRange(start, ende, richtung ?? undefined);
          } catch {
            // wie oben
          }
        }
      }
    }
  });
  if (rows.length === 0) return null;
  return {
    nodes: Uint32Array.from(rows, (r) => r.id),
    flags: Uint8Array.from(rows, (r) => r.flags),
  };
}

// --- focus/obscured, focus/obscured-enhanced ------------------------------------

interface ScrollStand {
  ziel: Element | Window;
  left: number;
  top: number;
}

function merkeScroll(el: Element, win: Window): ScrollStand[] {
  const stand: ScrollStand[] = [{ ziel: win, left: win.scrollX, top: win.scrollY }];
  for (let cur = flatParent(el); cur !== null; cur = flatParent(cur)) {
    if (cur === win.document.documentElement) continue; // gehört zum Fenster
    stand.push({ ziel: cur, left: cur.scrollLeft, top: cur.scrollTop });
  }
  return stand;
}

/**
 * Scrollt ohne Animation. `scroll-behavior: smooth` der Seite würde sonst die
 * Messung vor dem Ende der Bewegung treffen und die Rücknahme nach hinten
 * schieben.
 */
function scrolleSofort(ziel: Element | Window, left: number, top: number): void {
  try {
    ziel.scrollTo({ left, top, behavior: "instant" as ScrollBehavior });
  } catch {
    ziel.scrollTo(left, top);
  }
}

function stelleScrollWiederHer(stand: ScrollStand[], win: Window): void {
  for (const s of stand) {
    const [jetztLeft, jetztTop] =
      s.ziel === win
        ? [win.scrollX, win.scrollY]
        : [(s.ziel as Element).scrollLeft, (s.ziel as Element).scrollTop];
    if (jetztLeft !== s.left || jetztTop !== s.top) scrolleSofort(s.ziel, s.left, s.top);
  }
}

const RASTER = [0, 0.5, 1] as const;

/** Punkt `anteil` im Kasten, am Rand 1 px eingerückt. */
function punkt(start: number, laenge: number, anteil: number): number {
  if (laenge <= 2 || anteil === 0.5) return start + laenge / 2;
  return anteil === 0 ? start + 1 : start + laenge - 1;
}

/**
 * Das fixierte oder klebende Element, das `treffer` darstellt — der Treffer
 * selbst oder einer seiner Vorfahren im flachen Baum. Bei einem Vorfahren des
 * Bedienelements endet die Suche: Eine Leiste, die das Element enthält, deckt
 * es nicht ab.
 */
function festerVorfahr(treffer: Element, el: Element, win: Window): Element | null {
  for (let cur: Element | null = treffer; cur !== null; cur = flatParent(cur)) {
    if (cur.contains(el)) return null;
    const position = win.getComputedStyle(cur).position;
    if (position === "fixed" || position === "sticky") return cur;
  }
  return null;
}

/**
 * Fokussiert jedes erreichbare Bedienelement, scrollt es so ins Bild, wie ein
 * Tastaturnutzer es sähe (`FOCUS_SCROLL`), tastet ein Raster von 3 × 3 Punkten
 * (1 px eingerückt, nur Punkte im Viewport) mit `elementsFromPoint` ab und
 * zählt die Punkte unter einem fremden fixierten oder klebenden Element.
 *
 * **Berührt die Seite:** Fokus und Scrollposition (auch die scrollbarer
 * Vorfahren) ändern sich je Element und kommen zurück; `focus`- und
 * `blur`-Handler der Seite laufen. Höchstens `MAX_FOCUS_CONTROLS` Elemente.
 */
export function probeFocus(
  idToElement: Map<number, Element>,
  elementToId: WeakMap<Element, number>,
  columns: RenderingColumns,
  win: Window,
): { column: FocusColumn | null; overCap: number } {
  const doc = win.document;
  const vorher = tiefsterFokus(doc);
  const rows: { id: number; points: number; covered: number; blocker: number }[] = [];
  let overCap = 0;

  try {
    for (const [id, el] of inReihenfolge(idToElement, columns.flags.length)) {
      if (!sichtbarErfasst(columns, id) || !perTabErreichbar(el) || !("focus" in el)) continue;
      if (rows.length >= MAX_FOCUS_CONTROLS) {
        overCap++;
        continue;
      }

      const stand = merkeScroll(el, win);
      try {
        (el as HTMLElement).focus({ preventScroll: true });
        if (tiefsterFokus(doc) !== el) continue;
        try {
          el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
        } catch {
          el.scrollIntoView({ block: "nearest", inline: "nearest" });
        }

        const kasten = el.getBoundingClientRect();
        const breite = doc.documentElement.clientWidth;
        const hoehe = doc.documentElement.clientHeight;
        const wurzel = el.getRootNode() as Document | ShadowRoot;
        let points = 0;
        let covered = 0;
        let blocker = -1;

        for (const fy of RASTER) {
          for (const fx of RASTER) {
            const x = punkt(kasten.left, kasten.width, fx);
            const y = punkt(kasten.top, kasten.height, fy);
            if (x < 0 || y < 0 || x >= breite || y >= hoehe) continue;
            points++;
            // Von oben nach unten bis zum Bedienelement selbst: Was davor steht,
            // wird darüber gemalt.
            for (const treffer of wurzel.elementsFromPoint(x, y)) {
              if (treffer === el || el.contains(treffer)) break;
              const fest = festerVorfahr(treffer, el, win);
              if (fest === null) continue;
              covered++;
              if (blocker === -1) blocker = elementToId.get(fest) ?? -1;
              break;
            }
          }
        }
        rows.push({ id, points, covered, blocker });
      } finally {
        stelleScrollWiederHer(stand, win);
      }
    }
  } finally {
    stelleFokusWiederHer(doc, vorher);
  }

  if (rows.length === 0) return { column: null, overCap };
  return {
    column: {
      nodes: Uint32Array.from(rows, (r) => r.id),
      points: Uint32Array.from(rows, (r) => r.points),
      covered: Uint32Array.from(rows, (r) => r.covered),
      blocker: Int32Array.from(rows, (r) => r.blocker),
    },
    overCap,
  };
}

// --- text-spacing/clipped -------------------------------------------------------

/**
 * Die Mindestwerte aus WCAG 1.4.12 als Stylesheet. Eigenschaften des Textabstands
 * erben, `!important` setzt sich gegen die Seite durch.
 *
 * `transition-duration: 0s` verhindert, dass ein `transition: all` der Seite
 * beim Überschreiben und beim Zurücknehmen einen Übergang startet — der
 * Übergang würde sonst den Messwert verfälschen und danach ein `transitionend`
 * auslösen, auf das der Live-Modus neu scannt. Laufende Übergänge bleiben
 * unberührt, anders als bei `transition: none`.
 */
const SPACING_CSS =
  "*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important;" +
  "transition-duration:0s!important;transition-delay:0s!important}" +
  "p{margin-bottom:2em!important}";
const NO_TRANSITION_CSS = "*{transition-duration:0s!important;transition-delay:0s!important}";

interface Kandidat {
  id: number;
  el: Element;
  /** Nur gesetzt, wenn ein Rand abschneiden kann. */
  achsen?: { x: boolean; y: boolean };
  vorher?: boolean;
}

function hatEigenenText(el: Element): boolean {
  for (const kind of el.childNodes) {
    if (kind.nodeType === 3 && (kind as Text).data.trim() !== "") return true;
  }
  return false;
}

/** Ob der Kasten seinen eigenen Text abschneidet (`overflow: hidden` und Überstand). */
function schneidetAb(el: Element, x: boolean, y: boolean): boolean {
  return (x && el.scrollWidth > el.clientWidth + 2) || (y && el.scrollHeight > el.clientHeight + 2);
}

/** Wendeltext und Karten, die ihre Rückseite verbergen: bis zu fünf Vorfahren. */
function verbirgRueckseite(el: Element, win: Window): boolean {
  let cur: Element | null = el;
  for (let n = 0; n <= 5 && cur !== null; n++, cur = flatParent(cur)) {
    if (win.getComputedStyle(cur).backfaceVisibility === "hidden") return true;
  }
  return false;
}

/** Ob die Überschreibung am Element angekommen ist — die Seite kann sie übertrumpfen. */
function ueberschriebenAngekommen(el: Element, win: Window): boolean {
  const stil = win.getComputedStyle(el);
  const schrift = Number.parseFloat(stil.fontSize);
  if (!(schrift > 0)) return false;
  const zeichen = Number.parseFloat(stil.letterSpacing);
  const zeile = Number.parseFloat(stil.lineHeight);
  return Math.abs(zeichen - 0.12 * schrift) < 0.05 && Math.abs(zeile - 1.5 * schrift) < 0.5;
}

/**
 * Misst je Textcontainer, ob er seinen Text abschneidet, vor und nach dem
 * Überschreiben des Textabstands (Zeilenhöhe 1,5, Absatzabstand 2, Zeichenabstand
 * 0,12, Wortabstand 0,16 der Schriftgröße).
 *
 * **Berührt die Seite für die Dauer der Messung:** ein adoptiertes Stylesheet je
 * Baum (Dokument und offene Shadow Roots). Es entsteht über das CSSOM, ist
 * damit nicht an `style-src` gebunden und verändert keinen Knoten und kein
 * Attribut — der `MutationObserver` des Live-Modus sieht nichts. Wo
 * konstruierbare Stylesheets fehlen (jsdom, ältere Browser), bleibt die Spalte
 * leer und die Regel `NotRun`.
 *
 * Ein Element kann nur abschneiden, wenn `overflow` auf einer Achse `hidden`
 * ist; nur diese werden vermessen, die übrigen stehen mit `false/false` in der
 * Spalte — sonst fehlte der Regel der Beleg, dass der Durchgang lief.
 */
export function probeSpacing(
  idToElement: Map<number, Element>,
  columns: RenderingColumns,
  win: Window,
): { column: SpacingColumn | null; overCap: number; failed: boolean } {
  const kandidaten: Kandidat[] = [];
  let overCap = 0;
  for (const [id, el] of inReihenfolge(idToElement, columns.flags.length)) {
    if (!sichtbarErfasst(columns, id) || !hatEigenenText(el)) continue;
    if (kandidaten.length >= MAX_SPACING_ELEMENTS) {
      overCap++;
      continue;
    }
    kandidaten.push({ id, el });
  }
  if (kandidaten.length === 0) return { column: null, overCap, failed: false };

  // Welche Elemente überhaupt abschneiden können, und ob sie zählen.
  const zuMessen: Kandidat[] = [];
  const ausgeschlossen = new Set<number>();
  for (const k of kandidaten) {
    const stil = win.getComputedStyle(k.el);
    const x = stil.overflowX === "hidden";
    const y = stil.overflowY === "hidden";
    if (!x && !y) continue;
    const kasten = k.el.getBoundingClientRect();
    if (kasten.width <= 2 || kasten.height <= 2 || verbirgRueckseite(k.el, win)) {
      ausgeschlossen.add(k.id);
      continue;
    }
    k.achsen = { x, y };
    k.vorher = schneidetAb(k.el, x, y);
    zuMessen.push(k);
  }

  const nachher = new Map<number, boolean>();
  if (zuMessen.length > 0) {
    if (!messeNachher(zuMessen, win, nachher)) return { column: null, overCap, failed: true };
  }

  const rows = kandidaten
    .filter((k) => !ausgeschlossen.has(k.id) && (k.achsen === undefined || nachher.has(k.id)))
    .map((k) => ({
      id: k.id,
      flags:
        (k.vorher === true ? SPACING_BEFORE : 0) | (nachher.get(k.id) === true ? SPACING_AFTER : 0),
    }));
  if (rows.length === 0) return { column: null, overCap, failed: false };
  return {
    column: {
      nodes: Uint32Array.from(rows, (r) => r.id),
      flags: Uint8Array.from(rows, (r) => r.flags),
    },
    overCap,
    failed: false,
  };
}

/**
 * Das Überschreiben: adoptieren, messen, zurücknehmen. `false`, wenn der Browser
 * keine konstruierbaren Stylesheets kennt — dann wurde nichts verändert.
 * Elemente, an denen die Überschreibung nicht ankam (die Seite hat sie mit
 * einem stärkeren `!important` übertrumpft), bleiben ohne Eintrag in `nachher`.
 */
function messeNachher(zuMessen: Kandidat[], win: Window, nachher: Map<number, boolean>): boolean {
  const Sheet = (win as Window & { CSSStyleSheet?: typeof CSSStyleSheet }).CSSStyleSheet;
  if (typeof Sheet !== "function" || !("adoptedStyleSheets" in win.document)) return false;

  const wurzeln = new Set<Document | ShadowRoot>();
  for (const k of zuMessen) wurzeln.add(k.el.getRootNode() as Document | ShadowRoot);
  // Das Dokument immer: Es bestimmt das Layout um die Shadow Roots herum.
  wurzeln.add(win.document);

  let sheet: CSSStyleSheet;
  try {
    sheet = new Sheet();
    sheet.replaceSync(SPACING_CSS);
  } catch {
    return false;
  }

  const vorher = new Map<Document | ShadowRoot, CSSStyleSheet[]>();
  try {
    for (const w of wurzeln) {
      vorher.set(w, [...w.adoptedStyleSheets]);
      w.adoptedStyleSheets = [...w.adoptedStyleSheets, sheet];
    }
    for (const k of zuMessen) {
      if (!ueberschriebenAngekommen(k.el, win)) continue;
      // biome-ignore lint/style/noNonNullAssertion: `achsen` ist für alle in `zuMessen` gesetzt.
      const { x, y } = k.achsen!;
      nachher.set(k.id, schneidetAb(k.el, x, y));
    }
  } finally {
    // Erst die Übergänge sperren, dann zurücknehmen und die Sperre in einem
    // eigenen Stilabgleich wirken lassen, ehe sie fällt.
    try {
      sheet.replaceSync(NO_TRANSITION_CSS);
      void win.document.documentElement.getBoundingClientRect();
    } finally {
      for (const [w, alt] of vorher) w.adoptedStyleSheets = alt;
    }
  }
  return true;
}

// --- Zusammenstellung -----------------------------------------------------------

/**
 * Alle Messungen eines Dokuments. Die lesenden laufen immer, die berührenden nur,
 * wenn sie in `probes` stehen.
 */
export function collectProbes(
  collected: {
    idToElement: Map<number, Element>;
    elementToId: WeakMap<Element, number>;
    frames: FrameRef[];
  },
  columns: RenderingColumns,
  win: Window,
  probes: readonly ProbeName[],
): { columns: ProbeColumns; report: ProbeReport } {
  const spalten: ProbeColumns = {
    frames: probeFrames(collected.frames),
    transforms: probeTransforms(collected.elementToId, win),
    paste: null,
    focus: null,
    spacing: null,
  };
  const skipped: ProbeSkip[] = [];
  const report: ProbeReport = { columns: {}, skipped };

  if (probes.includes("paste")) {
    spalten.paste = probePaste(collected.idToElement, columns, win);
  }
  if (probes.includes("focus")) {
    const r = probeFocus(collected.idToElement, collected.elementToId, columns, win);
    spalten.focus = r.column;
    report.focusScroll = FOCUS_SCROLL;
    if (r.overCap > 0) skipped.push({ probe: "focus", reason: "cap", count: r.overCap });
  }
  if (probes.includes("spacing")) {
    const r = probeSpacing(collected.idToElement, columns, win);
    spalten.spacing = r.column;
    if (r.overCap > 0) skipped.push({ probe: "spacing", reason: "cap", count: r.overCap });
    if (r.failed) skipped.push({ probe: "spacing", reason: "override-failed" });
  }

  for (const [name, spalte] of Object.entries(spalten) as [
    keyof ProbeColumns,
    { nodes: Uint32Array } | null,
  ][]) {
    if (spalte !== null) report.columns[name] = spalte.nodes.length;
  }
  return { columns: spalten, report };
}

/** Reicht die Spalten an das WASM-Modul weiter. */
export function applyProbes(
  arena: {
    withFrames(nodes: Uint32Array, reachable: Uint8Array): void;
    withTransforms(nodes: Uint32Array, transform: string[], rotate: string[]): void;
    withPasteProbes(nodes: Uint32Array, flags: Uint8Array): void;
    withFocusCover(
      nodes: Uint32Array,
      points: Uint32Array,
      covered: Uint32Array,
      blocker: Int32Array,
    ): void;
    withTextSpacing(nodes: Uint32Array, flags: Uint8Array): void;
  },
  c: ProbeColumns,
): void {
  if (c.frames !== null) arena.withFrames(c.frames.nodes, c.frames.reachable);
  if (c.transforms !== null) {
    arena.withTransforms(c.transforms.nodes, c.transforms.transform, c.transforms.rotate);
  }
  if (c.paste !== null) arena.withPasteProbes(c.paste.nodes, c.paste.flags);
  if (c.focus !== null) {
    arena.withFocusCover(c.focus.nodes, c.focus.points, c.focus.covered, c.focus.blocker);
  }
  if (c.spacing !== null) arena.withTextSpacing(c.spacing.nodes, c.spacing.flags);
}

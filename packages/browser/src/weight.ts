/**
 * Seitengewicht und Ladezeiten aus den Messwerten des Browsers.
 *
 * Grundlage ist die Resource Timing API: Der Browser führt über jede geladene
 * Datei Buch, und die Seite selbst darf die Liste lesen. Gezählt wird die
 * komprimierte Body-Größe (`encodedBodySize`) — sie bleibt auch bei einem
 * Treffer im Cache erhalten, während die übertragene Größe dann 0 ist.
 *
 * Drei Grenzen, die sichtbar bleiben statt als 0 in die Summe zu gehen:
 *
 * - Dateien fremder Herkunft melden ihre Größe nur, wenn deren Server es mit
 *   `Timing-Allow-Origin` erlaubt. Sonst: **unbekannt**.
 * - Gezählt ist, was bisher geladen wurde — ein Bild, das erst beim Scrollen
 *   kommt, fehlt, bis es da ist.
 * - Der Puffer des Browsers fasst standardmäßig 250 Einträge; ist er voll,
 *   ist die Liste womöglich unvollständig.
 *
 * Nicht gelaufen ist nicht bestanden, auch hier: Was ein Browser nicht misst
 * (LCP und CLS gibt es nur in Chromium), bleibt `undefined` und wird als
 * „nicht gemessen" angezeigt, nie als 0.
 */

export type WeightCategory = "html" | "css" | "js" | "images" | "fonts" | "media" | "other";

export const WEIGHT_CATEGORIES: readonly WeightCategory[] = [
  "html",
  "css",
  "js",
  "images",
  "fonts",
  "media",
  "other",
];

export interface WeightBucket {
  requests: number;
  /** Komprimierte Body-Größe in Bytes, nur über Anfragen mit bekannter Größe. */
  bytes: number;
  /** Anfragen, deren Größe der Browser nicht preisgibt. */
  unknown: number;
}

export interface PageTimings {
  /** Zeit bis zum ersten Byte der Seite, ms. */
  ttfb?: number;
  domContentLoaded?: number;
  load?: number;
  /** Largest Contentful Paint, ms — nur, wo der Browser ihn misst. */
  lcp?: number;
  /** Cumulative Layout Shift nach Sitzungsfenstern — nur, wo der Browser ihn misst. */
  cls?: number;
}

export interface PageWeight {
  buckets: Record<WeightCategory, WeightBucket>;
  /** Inline-`<style>` und Inline-`<script>` im Dokument, UTF-8-Bytes. Stecken auch im HTML. */
  inline: { css: number; js: number };
  total: WeightBucket;
  /** Anfragen an andere Herkünfte als die der Seite. */
  thirdParty: WeightBucket;
  timings: PageTimings;
  /** Der Puffer ist voll — womöglich fehlen Einträge. */
  bufferFull: boolean;
  /** Eigene Dateien von LiveAudit, nicht mitgezählt. */
  excluded: number;
}

/** Das, was aus einem Eintrag der Resource Timing API gebraucht wird. */
export interface ResourceLike {
  name: string;
  initiatorType: string;
  encodedBodySize: number;
  decodedBodySize: number;
  transferSize: number;
  /** Nur in Chromium vorhanden. */
  contentType?: string;
}

const PUFFER_VORGABE = 250;

const ENDUNGEN: [RegExp, WeightCategory][] = [
  [/\.(m?js|wasm)$/i, "js"],
  [/\.css$/i, "css"],
  [/\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/i, "images"],
  [/\.(woff2?|ttf|otf|eot)$/i, "fonts"],
  [/\.(mp4|webm|ogv|mov|mp3|ogg|oga|wav|m4a|aac|flac|vtt)$/i, "media"],
  [/\.html?$/i, "html"],
];

/** Ordnet eine Anfrage ein: erst nach Content-Type, dann Endung, dann Anlass. */
export function categorize(entry: ResourceLike): WeightCategory {
  const typ = entry.contentType?.toLowerCase() ?? "";
  if (typ !== "") {
    if (typ.includes("css")) return "css";
    if (typ.includes("javascript") || typ.includes("wasm") || typ.includes("ecmascript")) {
      return "js";
    }
    if (typ.startsWith("image/")) return "images";
    if (typ.startsWith("font/") || typ.includes("font")) return "fonts";
    if (typ.startsWith("video/") || typ.startsWith("audio/") || typ.includes("vtt")) return "media";
    if (typ.includes("html")) return "html";
  }

  let pfad = entry.name;
  try {
    pfad = new URL(entry.name).pathname;
  } catch {
    // Kein gültiger URL — die Endung am Rohwert versuchen.
  }
  for (const [muster, kategorie] of ENDUNGEN) {
    if (muster.test(pfad)) return kategorie;
  }

  switch (entry.initiatorType) {
    case "script":
      return "js";
    case "img":
    case "image":
      return "images";
    case "video":
    case "audio":
    case "track":
      return "media";
    case "iframe":
    case "frame":
      return "html";
    default:
      return "other";
  }
}

/** Ob der Browser die Größe preisgibt. Alle drei Werte 0 heißt: nicht. */
export function sizeKnown(entry: ResourceLike): boolean {
  return entry.encodedBodySize > 0 || entry.decodedBodySize > 0 || entry.transferSize > 0;
}

function leer(): WeightBucket {
  return { requests: 0, bytes: 0, unknown: 0 };
}

function zaehle(bucket: WeightBucket, entry: ResourceLike): void {
  bucket.requests += 1;
  if (sizeKnown(entry)) bucket.bytes += entry.encodedBodySize;
  else bucket.unknown += 1;
}

/**
 * Cumulative Layout Shift nach der heutigen Definition: Verschiebungen ohne
 * vorangehende Eingabe, gebündelt in Sitzungsfenster (höchstens 1 s Abstand,
 * höchstens 5 s Dauer); der Wert ist das schwerste Fenster.
 */
export function cumulativeLayoutShift(
  shifts: readonly { startTime: number; value: number; hadRecentInput: boolean }[],
): number {
  let schwerstes = 0;
  let fenster = 0;
  let fensterStart = 0;
  let letzte = Number.NEGATIVE_INFINITY;
  for (const shift of shifts) {
    if (shift.hadRecentInput) continue;
    if (shift.startTime - letzte > 1000 || shift.startTime - fensterStart > 5000) {
      fenster = 0;
      fensterStart = shift.startTime;
    }
    fenster += shift.value;
    letzte = shift.startTime;
    schwerstes = Math.max(schwerstes, fenster);
  }
  return schwerstes;
}

/**
 * Die gepufferten Einträge eines Typs, synchron. `observe` mit `buffered`
 * legt sie sofort in den Puffer des Beobachters; `takeRecords` holt sie ab.
 * `undefined`, wenn der Browser den Typ nicht kennt.
 */
function gepuffert(win: Window, typ: string): PerformanceEntry[] | undefined {
  const Beobachter = (win as unknown as { PerformanceObserver?: typeof PerformanceObserver })
    .PerformanceObserver;
  if (Beobachter?.supportedEntryTypes?.includes(typ) !== true) return undefined;
  const beobachter = new Beobachter(() => {});
  beobachter.observe({ type: typ, buffered: true });
  const eintraege = beobachter.takeRecords();
  beobachter.disconnect();
  return eintraege;
}

function zeiten(win: Window): PageTimings {
  const timings: PageTimings = {};
  const nav = win.performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;
  if (nav !== undefined) {
    if (nav.responseStart > 0) timings.ttfb = nav.responseStart - nav.startTime;
    if (nav.domContentLoadedEventEnd > 0) timings.domContentLoaded = nav.domContentLoadedEventEnd;
    if (nav.loadEventEnd > 0) timings.load = nav.loadEventEnd;
  }

  const lcp = gepuffert(win, "largest-contentful-paint");
  const letzte = lcp?.at(-1);
  if (letzte !== undefined) timings.lcp = letzte.startTime;

  const verschiebungen = gepuffert(win, "layout-shift");
  if (verschiebungen !== undefined) {
    timings.cls = cumulativeLayoutShift(
      verschiebungen as unknown as { startTime: number; value: number; hadRecentInput: boolean }[],
    );
  }
  return timings;
}

function utf8(text: string): number {
  return new TextEncoder().encode(text).length;
}

function inline(doc: Document): { css: number; js: number } {
  let css = 0;
  let js = 0;
  for (const style of doc.querySelectorAll("style")) css += utf8(style.textContent ?? "");
  for (const script of doc.querySelectorAll("script:not([src])")) {
    const typ = script.getAttribute("type") ?? "";
    // JSON-LD, Importmaps und Vorlagen sind kein ausgeführtes JavaScript.
    if (typ === "" || typ === "module" || /javascript|ecmascript/i.test(typ)) {
      js += utf8(script.textContent ?? "");
    }
  }
  return { css, js };
}

/**
 * Misst Seitengewicht und Ladezeiten des Dokuments in `win`.
 *
 * @param own URLs von LiveAudit selbst — Bundle und WASM-Modul. Sie gehören
 *   nicht zur geprüften Seite und werden nicht mitgezählt.
 */
export function measureWeight(win: Window, own: readonly string[] = []): PageWeight {
  const buckets = Object.fromEntries(WEIGHT_CATEGORIES.map((k) => [k, leer()])) as Record<
    WeightCategory,
    WeightBucket
  >;
  const total = leer();
  const thirdParty = leer();
  const eigene = new Set(own);
  let excluded = 0;

  const nav = win.performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;
  if (nav !== undefined) {
    zaehle(buckets.html, nav);
    zaehle(total, nav);
  }

  const resources = win.performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  const herkunft = win.location.origin;
  for (const entry of resources) {
    if (eigene.has(entry.name)) {
      excluded += 1;
      continue;
    }
    zaehle(buckets[categorize(entry)], entry);
    zaehle(total, entry);
    let fremd = false;
    try {
      fremd = new URL(entry.name).origin !== herkunft;
    } catch {
      fremd = false;
    }
    if (fremd) zaehle(thirdParty, entry);
  }

  return {
    buckets,
    inline: inline(win.document),
    total,
    thirdParty,
    timings: zeiten(win),
    bufferFull: resources.length >= PUFFER_VORGABE,
    excluded,
  };
}

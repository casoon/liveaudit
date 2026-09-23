/**
 * Die öffentliche Schnittstelle von LiveAudit.
 *
 * **LiveAudit prüft, es repariert nicht.** Das Werkzeug verändert den geprüften
 * Teilbaum nicht: keine `data-*`-Attribute zur Element-Identifikation, keine
 * Inline-Styles am Zielelement. Die Zuordnung läuft über
 * `WeakMap<Element, NodeId>` im Speicher.
 *
 * **Ohne Freischaltung passiert nichts.** Das Script legt dann kein globales
 * Objekt an und lädt nichts nach — freigeschaltet wird per `?liveaudit` in der
 * URL oder einem `localStorage`-Eintrag `liveaudit`. Siehe [`gate`].
 *
 * Auch freigeschaltet startet nichts von selbst: Das WASM-Modul lädt erst beim
 * ersten `init()`, der Inspector-Layer erscheint erst bei `show()`.
 */

import initCore from "@casoon/a11y-wasm";
import { type LiveHandle, type LiveOptions, watch as watchLive } from "@liveaudit/browser/live";
import { type ScanOptions, type ScanResult, scan } from "@liveaudit/browser/scan";
import {
  configureLive,
  type DockSide,
  dock as dockLayer,
  hide as hideLayer,
  isVisible as layerVisible,
  show as showLayer,
} from "@liveaudit/ui";

import { forget, isEnabled, remember } from "./gate.ts";

export type { ArenaColumns, Collected, FrameRef } from "@liveaudit/browser/collect";
export { collect, countNodes, HOST_TAG_NAME } from "@liveaudit/browser/collect";
export * from "@liveaudit/browser/report";
export type { DocumentScan, ScanOptions, ScanResult, UntestedScope } from "@liveaudit/browser/scan";
export type { DockSide } from "@liveaudit/ui";

/** Was `show()` über den Scan hinaus steuert. */
export interface ShowOptions extends ScanOptions {
  /** An welcher Kante die Seitenleiste andockt. Ohne Angabe die gemerkte. */
  dock?: DockSide;
}

/** Was `watch()` über `show()` hinaus steuert. */
export interface WatchOptions extends ShowOptions, LiveOptions {}
export { elementOf, scan } from "@liveaudit/browser/scan";
export { FLAG, forget, isEnabled, remember } from "./gate.ts";

let ready: Promise<unknown> | null = null;
let live: LiveHandle | null = null;

/**
 * Womit zuletzt gescannt wurde.
 *
 * Der Schalter in der Seitenleiste nimmt keine Argumente entgegen. Ohne dieses
 * Gedächtnis fiele beim Einschalten des Live-Modus ein ausdrücklich gewählter
 * Prüfbereich oder der Kontrastdurchgang weg — und zwar stillschweigend.
 */
let zuletzt: { root?: Element; options?: WatchOptions } = {};

/** Die Direktive, ohne die Chrome kein WebAssembly instanziiert. */
const CSP_HINWEIS =
  "LiveAudit could not instantiate the WebAssembly module. This page's Content " +
  "Security Policy does not allow WebAssembly — add `wasm-unsafe-eval` to the " +
  "`script-src` directive.";

/**
 * Erkennt, ob ein Fehlschlag von der Content Security Policy kommt.
 *
 * Browser melden das unterschiedlich: Chrome wirft einen `CompileError` oder
 * einen `EvalError`, Firefox einen `TypeError` mit einem Hinweis auf
 * `unsafe-eval`. Keiner davon sagt von sich aus „CSP".
 */
function istCspFehler(err: unknown): boolean {
  if (typeof WebAssembly !== "undefined" && err instanceof WebAssembly.CompileError) return true;
  if (err instanceof EvalError) return true;
  const text = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return /unsafe-eval|Content Security Policy|CSP/i.test(text);
}

/**
 * Lädt und initialisiert das WASM-Modul. Mehrfache Aufrufe teilen sich eine
 * Ladung.
 *
 * Scheitert die Instanziierung an einer strikten Content Security Policy, wirft
 * diese Funktion einen Fehler, der die fehlende Direktive benennt — der
 * ursprüngliche Fehler hängt als `cause` daran. Ohne diese Einordnung sieht der
 * Fehlschlag nicht nach CSP aus, und wer das Werkzeug einbindet, sucht an der
 * falschen Stelle.
 */
export function init(): Promise<unknown> {
  ready ??= initCore().catch((err: unknown) => {
    ready = null; // Ein Fehlschlag darf den nächsten Versuch nicht blockieren.
    if (istCspFehler(err)) throw new Error(CSP_HINWEIS, { cause: err });
    throw err;
  });
  return ready;
}

/** Initialisiert das Modul, falls nötig, und scannt das Dokument. */
export async function scanDocument(root?: Element, options?: ScanOptions): Promise<ScanResult> {
  await init();
  return scan(root ?? document.documentElement, options ?? {});
}

/**
 * Scannt und zeigt den Inspector-Layer.
 *
 * Der Layer hängt in genau einem Host `<liveaudit-inspector>` als letztes Kind
 * von `<body>` und ist `position: fixed` mit `pointer-events: none` — er
 * verändert damit weder Layout noch Scrollhöhe der Seite und fängt keine Klicks
 * ab, die der Seite gelten.
 */
export async function show(root?: Element, options?: ShowOptions): Promise<ScanResult> {
  zuletzt = { root, options };
  const result = await scanDocument(root, options);
  showLayer(result, options?.dock);
  return result;
}

/**
 * Die Kante wechseln, an der die Seitenleiste andockt, ohne neu zu scannen.
 *
 * Welche Kante frei ist, weiß nur der Prüfende: Eine Seite mit fixierter
 * Kopfzeile verträgt kein Andocken oben. Die Wahl wird gemerkt.
 */
export function dock(side: DockSide): void {
  dockLayer(side);
}

/**
 * Scannt, zeigt den Layer und hält ihn auf Stand, solange sich die Seite ändert.
 *
 * Beobachtet wird entprellt, und neu gescannt wird nur der geänderte Teilbaum —
 * der Collector ist der gemessene Engpass, ein Vollscan je Mutation wäre
 * spürbar. Regeln, die dem Dokument als Ganzes gelten, bleiben dabei auf dem
 * Stand des letzten vollständigen Scans; siehe `@liveaudit/browser/live`.
 */
export async function watch(root?: Element, options?: WatchOptions): Promise<ScanResult> {
  const result = await show(root, options);
  live?.stop();
  live = watchLive(
    result,
    root ?? document.documentElement,
    (aktualisiert) => showLayer(aktualisiert),
    options ?? {},
  );
  return result;
}

/** Beendet den Live-Modus. Der Layer bleibt stehen, wie er ist. */
export function unwatch(): void {
  live?.stop();
  live = null;
}

// Der Schalter in der Seitenleiste. Die Oberfläche kennt `watch()` nicht — sie
// hängt unter `browser`, nicht über diesem Paket —, deshalb wird er hier
// angemeldet.
configureLive({
  isActive: () => live !== null,
  toggle: (an) => {
    if (an) void watch(zuletzt.root, zuletzt.options);
    else unwatch();
  },
});

/** Entfernt den Inspector-Layer. Danach ist von LiveAudit nichts mehr im DOM. */
export function hide(): void {
  // Ohne den Layer gibt es nichts mehr aufzufrischen — weiterzuscannen wäre
  // Arbeit, die niemand sieht.
  unwatch();
  hideLayer();
}

/** Das globale Objekt, das `dist/inspector.js` bereitstellt. */
export interface LiveAuditApi {
  init(): Promise<unknown>;
  scan(root?: Element, options?: ScanOptions): Promise<ScanResult>;
  show(root?: Element, options?: ShowOptions): Promise<ScanResult>;
  /** Wie `show()`, hält den Layer aber auf Stand, solange sich die Seite ändert. */
  watch(root?: Element, options?: WatchOptions): Promise<ScanResult>;
  /** Beendet den Live-Modus; der Layer bleibt. */
  unwatch(): void;
  dock(side: DockSide): void;
  hide(): void;
  isVisible(): boolean;
  /** Merkt die Freischaltung für diese Herkunft vor. */
  remember(): void;
  /** Nimmt eine vorgemerkte Freischaltung zurück. */
  forget(): void;
}

const api: LiveAuditApi = {
  init,
  scan: scanDocument,
  show,
  watch,
  unwatch,
  dock,
  hide,
  isVisible: layerVisible,
  remember,
  forget,
};

declare global {
  var LiveAudit: LiveAuditApi | undefined;
}

/**
 * Schaltet LiveAudit frei, ohne das Flag zu setzen — für Tests und eigene
 * Oberflächen, die das Werkzeug programmgesteuert einsetzen.
 */
export function enable(): LiveAuditApi {
  globalThis.LiveAudit = api;
  return api;
}

// Ohne Freischaltung wird kein globales Objekt angelegt. Das Modul bleibt
// importierbar — wer es als Abhängigkeit einbindet, ruft `enable()`.
if (isEnabled()) enable();

export default api;

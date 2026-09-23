/**
 * Live-Modus: mitlaufen, ohne die Seite jedes Mal neu zu scannen.
 *
 * Der Spike hat den Collector als Engpass gemessen — 79 ms bei 31.000 Knoten,
 * rund 90 % der Gesamtzeit (`spike/ERGEBNIS.md`). Ein Vollscan je Mutation wäre
 * auf einer Seite, die sich bewegt, sofort spürbar. Beobachtet wird deshalb
 * entprellt, und neu gescannt wird **nur der geänderte Teilbaum**.
 *
 * Ein neu gescannter Teilbaum kommt als **eigener Eintrag** in `documents` —
 * genau wie ein Same-Origin-Frame, und aus demselben Grund: Ein eigener Scan
 * hat einen eigenen ID-Raum, und Indizes aus zwei Arenen lassen sich nicht
 * mischen (`docs/decisions.md`).
 *
 * **Was dabei nicht neu bewertet wird.** Regeln, die über den Geltungsbereich
 * als Ganzes sprechen — fehlende `main`-Landmark, fehlender Titel, fehlende
 * `h1` —, melden am Wurzelknoten der Arena. Auf einem Fragment sind sie nicht
 * sinnvoll zu prüfen: Ein Teilbaum ist kein Dokument, und genau daran ist der
 * Selbsttest des Layers schon aufgelaufen. Ihre Befunde aus dem letzten
 * Vollscan bleiben deshalb stehen, statt zu verschwinden oder falsch neu zu
 * entstehen. Sie sind damit so alt wie der letzte Vollscan — das ist die eine
 * Ungenauigkeit dieses Modus, und sie ist lieber alt als erfunden.
 *
 * **Was nicht beobachtet wird.** Mutationen *innerhalb* eines Same-Origin-
 * Frames. Ein `MutationObserver` im Hauptdokument sieht sie nicht, und ein
 * eigener Beobachter je Frame brächte Teilbäume hervor, die nicht im
 * Hauptdokument hängen — deren Marker müssten den Frame-Versatz mitführen.
 * Frames werden mitgescannt, sobald ein Teilbaum über ihnen sich ändert.
 */

import { flatParent, HOST_TAG_NAME } from "./collect.ts";
import type { Finding, Report, RuleRun, Summary } from "./report.ts";
import { type DocumentScan, type ScanOptions, type ScanResult, scan } from "./scan.ts";

/** Ruhezeit nach der letzten Mutation. */
const RUHE_MS = 200;

const ELEMENT_NODE = 1;

const BEOBACHTET: MutationObserverInit = {
  subtree: true,
  childList: true,
  attributes: true,
  characterData: true,
};

export interface LiveOptions extends ScanOptions {
  /** Ruhezeit nach der letzten Mutation, in Millisekunden. Vorgabe: 200. */
  debounceMs?: number;
}

export interface LiveHandle {
  /** Beendet die Beobachtung. Der zuletzt gelieferte Stand bleibt stehen. */
  stop(): void;
}

/** Ein Neuscan eines geänderten Teilbaums. */
export interface Teilbaumscan {
  wurzel: Element;
  ergebnis: ScanResult;
}

/** Ob `kandidat` im flachen Baum unter `wurzel` hängt — die Wurzel zählt mit. */
function liegtUnter(wurzel: Element, kandidat: Element): boolean {
  let cur: Element | null = kandidat;
  while (cur !== null) {
    if (cur === wurzel) return true;
    cur = flatParent(cur);
  }
  return false;
}

/**
 * Die kleinste Menge Wurzeln, die alle Ziele abdeckt.
 *
 * Das ist zugleich die Schranke für den Aufwand eines Durchgangs: Wird ein
 * ganzer Bereich ausgetauscht, bleibt eine Wurzel übrig statt hundert, und
 * verstreute Einzeländerungen scannen zusammen höchstens so viel wie das
 * Dokument.
 */
export function minimaleWurzeln(ziele: Iterable<Element>): Element[] {
  const verbunden = [...new Set(ziele)].filter((el) => el.isConnected);
  const menge = new Set(verbunden);
  const wurzeln: Element[] = [];

  for (const kandidat of verbunden) {
    let cur = flatParent(kandidat);
    let bedeckt = false;
    while (cur !== null) {
      if (menge.has(cur)) {
        bedeckt = true;
        break;
      }
      cur = flatParent(cur);
    }
    if (!bedeckt) wurzeln.push(kandidat);
  }
  return wurzeln;
}

/**
 * Ob dieser Befund dem Geltungsbereich als Ganzes gilt statt einem Element
 * darin. Er meldet dann am Wurzelknoten der Arena.
 */
function giltDemBereich(finding: Finding): boolean {
  const node = finding.location?.node;
  return node === undefined || Number(node) === 0;
}

function fasseZusammen(findings: Finding[], ruleRuns: RuleRun[]): Summary {
  const s: Summary = {
    fail: 0,
    review: 0,
    pass: 0,
    untested: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    rules_not_run: 0,
  };
  for (const f of findings) {
    s[f.outcome] += 1;
    s[f.severity] += 1;
  }
  for (const r of ruleRuns) {
    if (r.not_run !== undefined) s.rules_not_run += 1;
  }
  return s;
}

function mitFindings(report: Report, findings: Finding[]): Report {
  return { ...report, findings, summary: fasseZusammen(findings, report.rule_runs) };
}

/**
 * Fügt die Neuscans geänderter Teilbäume in das letzte Ergebnis ein.
 *
 * Ausgesondert wird alles, was im geänderten Bereich lag oder nicht mehr im
 * Dokument hängt — Befunde, ungeprüfte Bereiche und ganze Geltungsbereiche,
 * deren Wurzel mitgegangen ist. Die Indizes der überlebenden Bereiche werden
 * dabei neu vergeben, und die Verweise der Frames darauf mitgezogen.
 */
export function mergeSubtrees(vorher: ScanResult, neue: Teilbaumscan[]): ScanResult {
  const wurzeln = neue.map((n) => n.wurzel);
  const betroffen = (el: Element): boolean =>
    !el.isConnected || wurzeln.some((w) => liegtUnter(w, el));

  // 1. Welche alten Geltungsbereiche überleben? Ein Frame, dessen umgebendes
  //    Dokument weggefallen ist, fällt mit.
  const bleibt = new Set<number>();
  for (const dok of vorher.documents) {
    const wurzelElement = dok.idToElement.get(0);
    if (wurzelElement !== undefined && !betroffen(wurzelElement)) bleibt.add(dok.id);
  }
  for (let wieder = true; wieder; ) {
    wieder = false;
    for (const dok of vorher.documents) {
      if (bleibt.has(dok.id) && dok.parent !== null && !bleibt.has(dok.parent.document)) {
        bleibt.delete(dok.id);
        wieder = true;
      }
    }
  }

  // 2. Die Überlebenden aussieben und neu durchnummerieren.
  const neuerIndex = new Map<number, number>();
  const documents: DocumentScan[] = [];
  for (const dok of vorher.documents) {
    if (!bleibt.has(dok.id)) continue;
    neuerIndex.set(dok.id, documents.length);

    const findings = dok.report.findings.filter((f) => {
      if (giltDemBereich(f)) return true;
      const el = dok.idToElement.get(Number(f.location?.node));
      return el !== undefined && !betroffen(el);
    });
    const untested = dok.untested.filter((u) => {
      const el = dok.idToElement.get(u.node);
      return el !== undefined && !betroffen(el);
    });

    // Ausgesonderte Elemente aus der Zuordnung nehmen: Sonst hielte die Map
    // abgehängte Knoten fest, und der Speicher wüchse mit jeder Änderung.
    for (const [id, el] of dok.idToElement) {
      if (id !== 0 && betroffen(el)) dok.idToElement.delete(id);
    }

    documents.push({
      ...dok,
      id: documents.length,
      report: mitFindings(dok.report, findings),
      untested,
    });
  }
  for (const dok of documents) {
    if (dok.parent !== null) {
      dok.parent = {
        document: neuerIndex.get(dok.parent.document) ?? 0,
        node: dok.parent.node,
      };
    }
  }

  // 3. Die Neuscans anhängen. Ein Teilbaum ist kein Dokument: Befunde, die dem
  //    Bereich als Ganzes gelten, wären auf ihm eine Aussage über ein Fragment.
  let collectMs = 0;
  let renderingMs = 0;
  let totalMs = 0;
  for (const neuScan of neue) {
    const basis = documents.length;
    const istDokumentwurzel = neuScan.wurzel === neuScan.wurzel.ownerDocument.documentElement;
    collectMs += neuScan.ergebnis.collectMs;
    renderingMs += neuScan.ergebnis.renderingMs;
    totalMs += neuScan.ergebnis.totalMs;

    for (const dok of neuScan.ergebnis.documents) {
      const fragment = dok.id === 0 && !istDokumentwurzel;
      documents.push({
        ...dok,
        id: basis + dok.id,
        parent:
          dok.parent === null
            ? null
            : { document: basis + dok.parent.document, node: dok.parent.node },
        report: fragment
          ? mitFindings(
              dok.report,
              dok.report.findings.filter((f) => !giltDemBereich(f)),
            )
          : dok.report,
      });
    }
  }

  return { documents, collectMs, renderingMs, totalMs };
}

function istEigenerLayer(node: Node): boolean {
  return node.nodeType === ELEMENT_NODE && (node as Element).localName === HOST_TAG_NAME;
}

/**
 * Das Element, dem eine Mutation gilt — oder `null`, wenn sie den eigenen
 * Layer betrifft.
 *
 * Ohne diese Ausnahme liefe der Modus im Kreis: `show()` hängt den Host an
 * `<body>` und setzt Inline-Stile an ihm, beides sind Mutationen, und jede
 * löste den nächsten Scan aus.
 */
function zielElement(eintrag: MutationRecord): Element | null {
  const ziel = eintrag.target;
  if (istEigenerLayer(ziel)) return null;

  if (eintrag.type === "childList") {
    const knoten = [...eintrag.addedNodes, ...eintrag.removedNodes];
    if (knoten.length > 0 && knoten.every(istEigenerLayer)) return null;
  }

  if (ziel.nodeType === ELEMENT_NODE) return ziel as Element;
  return ziel.parentElement;
}

/**
 * Beobachtet `wurzel` und meldet nach jeder Ruhephase ein aktualisiertes
 * Ergebnis.
 *
 * `start` ist das Ergebnis des letzten vollständigen Scans — der Stand, in den
 * die Teilbäume eingefügt werden.
 */
export function watch(
  start: ScanResult,
  wurzel: Element,
  onUpdate: (ergebnis: ScanResult) => void,
  options: LiveOptions = {},
): LiveHandle {
  let aktuell = start;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const offen = new Set<Element>();
  const beobachteteRoots = new WeakSet<ShadowRoot>();

  const beobachter = new MutationObserver((eintraege) => {
    for (const eintrag of eintraege) {
      const ziel = zielElement(eintrag);
      if (ziel !== null) offen.add(ziel);
    }
    if (offen.size === 0) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(durchgang, options.debounceMs ?? RUHE_MS);
  });

  /** Shadow Roots sind eigene Bäume; ein Beobachter am Host sieht nicht hinein. */
  function beobachteShadowRoots(dokumente: DocumentScan[]): void {
    for (const dok of dokumente) {
      for (const el of dok.idToElement.values()) {
        const shadow = el.shadowRoot;
        if (shadow === null || beobachteteRoots.has(shadow)) continue;
        beobachteteRoots.add(shadow);
        beobachter.observe(shadow, BEOBACHTET);
      }
    }
  }

  function durchgang(): void {
    timer = undefined;
    const geaendert = minimaleWurzeln(offen);
    offen.clear();
    if (geaendert.length === 0) return;

    const neue = geaendert.map((w) => ({ wurzel: w, ergebnis: scan(w, options) }));
    aktuell = mergeSubtrees(aktuell, neue);
    // Ein Teilbaum kann neue Shadow Roots mitgebracht haben.
    beobachteShadowRoots(aktuell.documents.slice(-neue.length));
    onUpdate(aktuell);
  }

  beobachter.observe(wurzel, BEOBACHTET);
  beobachteShadowRoots(aktuell.documents);

  return {
    stop(): void {
      beobachter.disconnect();
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      offen.clear();
    },
  };
}

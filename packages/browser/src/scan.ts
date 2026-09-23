/**
 * Der Scan: Collector → Arena → Regelbestand → `Finding[]`.
 *
 * Ein `<iframe>` ist ein eigenes Dokument mit eigenem ID-Raum. Es wird deshalb
 * eigenständig gescannt und nicht in die Arena des umgebenden Dokuments
 * eingebettet — siehe `docs/decisions.md`, „Same-Origin-iframes als eigener
 * Scan". Ein nicht erreichbarer Frame erzeugt einen `UNTESTED`-Geltungsbereich,
 * kein Schweigen.
 */

import { Scan } from "@liveaudit/core";

import { collect, type FrameRef } from "./collect.ts";
import { collectRendering } from "./rendering.ts";
import type { Report } from "./report.ts";

/** Ein Bereich, über den der Scan bewusst keine Aussage trifft. */
export interface UntestedScope {
  /**
   * Cross-Origin ist der übliche Grund. Ein Same-Origin-Frame, der noch nicht
   * geladen ist, ist von außen nicht davon zu unterscheiden und landet hier
   * ebenfalls.
   */
  reason: "cross-origin-frame";
  /** Arena-Index des `<iframe>` im Dokument, das diesen Bereich meldet. */
  node: number;
  src: string | null;
}

/** Ein gescanntes Dokument: das Hauptdokument oder ein Same-Origin-Frame. */
export interface DocumentScan {
  /** `0` ist das Hauptdokument. */
  id: number;
  /** Wo dieses Dokument hängt — `null` beim Hauptdokument. */
  parent: { document: number; node: number } | null;
  nodes: number;
  report: Report;
  /** Element-Identität ohne Mutation des geprüften Teilbaums. */
  elementToId: WeakMap<Element, number>;
  idToElement: Map<number, Element>;
  untested: UntestedScope[];
}

export interface ScanResult {
  /** `documents[0]` ist das Hauptdokument. */
  documents: DocumentScan[];
  /** Millisekunden im Collector — der gemessene Engpass, siehe `spike/ERGEBNIS.md`. */
  collectMs: number;
  /** Millisekunden für den gesamten Scan, inklusive Arena-Aufbau und Regeln. */
  totalMs: number;
  /** Millisekunden im Tier-3-Durchgang. `0`, wenn er nicht lief. */
  renderingMs: number;
}

export interface ScanOptions {
  /**
   * Berechnete Stile miterheben und damit die Kontrastregeln laufen lassen.
   *
   * Kostet nach der Messung vom 20.09.2026 das 1,9- bis 4,6-fache des
   * Collectors (`examples/tier3.html`), deshalb abschaltbar und nicht Vorgabe.
   * Ohne ihn melden die Kontrastregeln `UNTESTED` — nicht `PASS`.
   */
  rendering?: boolean;
}

interface Pending {
  root: Element;
  parent: { document: number; node: number } | null;
}

/**
 * Scannt `root` und jeden erreichbaren Same-Origin-Frame darunter.
 *
 * Setzt voraus, dass das WASM-Modul initialisiert ist — siehe `init()`.
 */
export function scan(
  root: Element = document.documentElement,
  options: ScanOptions = {},
): ScanResult {
  const started = performance.now();
  let collectMs = 0;
  let renderingMs = 0;

  const documents: DocumentScan[] = [];
  const queue: Pending[] = [{ root, parent: null }];

  while (queue.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: queue.length > 0.
    const pending = queue.shift()!;
    const id = documents.length;

    const collectStarted = performance.now();
    const collected = collect(pending.root);
    collectMs += performance.now() - collectStarted;

    const c = collected.columns;
    const arena = new Scan(
      c.tag,
      c.parent,
      c.textOff,
      c.textLen,
      c.attrStart,
      c.attrName,
      c.attrValOff,
      c.attrValLen,
      c.blob,
      c.tagDict,
      c.attrDict,
    );

    let report: Report;
    try {
      if (options.rendering === true) {
        const view = pending.root.ownerDocument.defaultView;
        if (view !== null) {
          const renderingStarted = performance.now();
          const r = collectRendering(collected.idToElement, c.nodes, view);
          renderingMs += performance.now() - renderingStarted;
          arena.withRendering(r.color, r.background, r.fontSizePx, r.fontWeight, r.flags);
        }
      }
      report = arena.run() as Report;
    } finally {
      arena.free();
    }

    const untested: UntestedScope[] = [];
    for (const frame of collected.frames) {
      const frameRoot = frameRootElement(frame);
      if (frameRoot === null) {
        untested.push({ reason: "cross-origin-frame", node: frame.node, src: frame.src });
        continue;
      }
      queue.push({ root: frameRoot, parent: { document: id, node: frame.node } });
    }

    documents.push({
      id,
      parent: pending.parent,
      nodes: c.nodes,
      report,
      elementToId: collected.elementToId,
      idToElement: collected.idToElement,
      untested,
    });
  }

  return { documents, collectMs, renderingMs, totalMs: performance.now() - started };
}

function frameRootElement(frame: FrameRef): Element | null {
  return frame.document?.documentElement ?? null;
}

/** Das reale Element zu einem Finding, oder `undefined`. */
export function elementOf(scanned: DocumentScan, finding: { location?: { node?: string } }) {
  const node = finding.location?.node;
  return node === undefined ? undefined : scanned.idToElement.get(Number(node));
}

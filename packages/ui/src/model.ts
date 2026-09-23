/**
 * Das Anzeigemodell des Inspector-Layers.
 *
 * Hier wird der Bericht aus `@liveaudit/browser` in die Reihenfolge und
 * Gruppierung gebracht, die Marker und Seitenleiste brauchen — mehr nicht.
 * Insbesondere wird hier **nichts verrechnet**: `outcome` und `severity`
 * bleiben zwei getrennte Achsen, und `untested` ist eine eigene Kategorie, kein
 * weggefilterter Rest (siehe `docs/decisions.md`, „Vier Analysezustände statt
 * Score").
 *
 * Die Zuordnung Befund → Element läuft ausschließlich über `elementOf()` aus
 * `@liveaudit/browser`. Ein eigener Rückbezug wäre eine zweite Wahrheit.
 */

import type { Finding, Outcome, Severity } from "@liveaudit/browser/report";
import { type DocumentScan, elementOf, type ScanResult } from "@liveaudit/browser/scan";

/** Ein Befund mit allem, was der Layer zum Anzeigen braucht. */
export interface Item {
  /** Stabil über einen Scan hinweg — adressiert Marker und Panel-Eintrag. */
  key: string;
  /** Die Nummer auf dem Marker. Vergeben über alle Befunde, nicht je Kategorie. */
  number: number;
  finding: Finding;
  /** `0` ist das Hauptdokument. */
  documentId: number;
  scanned: DocumentScan;
  /** Das reale Element, oder `undefined`, wenn der Befund keines benennt. */
  element: Element | undefined;
  /** Das Präfix der Rule-ID, z. B. `images` aus `images/alt-missing`. */
  category: string;
}

/** Eine Regel, die gar nicht erst gelaufen ist. Auch das ist „nicht geprüft". */
export interface NotRunEntry {
  ruleId: string;
  notRun: string;
  reason: string | undefined;
}

/** Ein Bereich, über den der Scan bewusst keine Aussage trifft. */
export interface UntestedScopeEntry {
  documentId: number;
  reason: string;
  src: string | null;
}

/** Zustände, die der Layer standardmäßig zeigt. `pass` wird geführt, aber nicht angezeigt. */
export const DEFAULT_OUTCOMES: readonly Outcome[] = ["fail", "review", "untested"];

/** Anzeigereihenfolge der Zustände — von „sicher ein Problem" nach „bestanden". */
export const OUTCOME_ORDER: readonly Outcome[] = ["fail", "review", "untested", "pass"];

const OUTCOME_GLOSS: Record<Outcome, string> = {
  fail: "detected automatically",
  review: "needs a human decision",
  untested: "not decidable automatically",
  pass: "passed the automatic check",
};

const SEVERITY_LABEL: Record<Severity, string> = {
  low: "low",
  medium: "medium",
  high: "high",
  critical: "critical",
};

const CATEGORY_LABEL: Record<string, string> = {
  aria: "ARIA",
  buttons: "Buttons",
  contrast: "Contrast",
  document: "Document",
  forms: "Forms",
  headings: "Headings",
  ids: "IDs",
  images: "Images",
  keyboard: "Keyboard",
  landmarks: "Landmarks",
  links: "Links",
  lists: "Lists",
  svg: "SVG",
  tables: "Tables",
  zoom: "Zoom",
};

const NOT_RUN_LABEL: Record<string, string> = {
  capability_missing: "capability missing (tier not served)",
  disabled: "disabled",
  not_applicable: "not applicable",
  errored: "aborted with an error",
};

/** Die erklärende Beschriftung zu einem Zustand. Der Code selbst bleibt sichtbar. */
export function outcomeGloss(outcome: Outcome): string {
  return OUTCOME_GLOSS[outcome];
}

export function severityLabel(severity: Severity): string {
  return SEVERITY_LABEL[severity] ?? severity;
}

export function categoryOf(ruleId: string): string {
  const slash = ruleId.indexOf("/");
  return slash === -1 ? ruleId : ruleId.slice(0, slash);
}

export function categoryLabel(category: string): string {
  return CATEGORY_LABEL[category] ?? category;
}

export function notRunLabel(notRun: string): string {
  return NOT_RUN_LABEL[notRun] ?? notRun;
}

/** Der Arena-Index eines Befunds, oder `undefined`. */
function nodeIndex(finding: Finding): number | undefined {
  const node = finding.location?.node;
  if (node === undefined) return undefined;
  const parsed = Number(node);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Baut die Anzeigeliste über alle gescannten Dokumente.
 *
 * Sortiert wird nach Dokument und darin nach Arena-Index — das entspricht der
 * Dokumentreihenfolge, sodass die Markernummern ungefähr der Lesereihenfolge
 * folgen. Die Nummern werden **vor** jeder Filterung vergeben und bleiben
 * deshalb stabil, wenn der Benutzer Zustände ein- oder ausblendet.
 */
export function buildItems(result: ScanResult): Item[] {
  const items: Item[] = [];

  for (const scanned of result.documents) {
    for (const finding of scanned.report.findings) {
      items.push({
        key: `d${scanned.id}-n${nodeIndex(finding) ?? -1}-${finding.rule_id}-${items.length}`,
        number: 0,
        finding,
        documentId: scanned.id,
        scanned,
        element: elementOf(scanned, finding),
        category: categoryOf(finding.rule_id),
      });
    }
  }

  items.sort((a, b) => {
    if (a.documentId !== b.documentId) return a.documentId - b.documentId;
    return (
      (nodeIndex(a.finding) ?? Number.MAX_SAFE_INTEGER) -
      (nodeIndex(b.finding) ?? Number.MAX_SAFE_INTEGER)
    );
  });

  for (let i = 0; i < items.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: i < items.length.
    items[i]!.number = i + 1;
  }

  return items;
}

/** Zählt die Zustände über alle Dokumente. Vier Zahlen, kein Prozentwert. */
export function countOutcomes(items: readonly Item[]): Record<Outcome, number> {
  const counts: Record<Outcome, number> = { fail: 0, review: 0, untested: 0, pass: 0 };
  for (const item of items) counts[item.finding.outcome] += 1;
  return counts;
}

/** Gruppiert nach Kategorie, in der Reihenfolge der Markernummern. */
export function groupByCategory(items: readonly Item[]): Map<string, Item[]> {
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const group = groups.get(item.category);
    if (group === undefined) groups.set(item.category, [item]);
    else group.push(item);
  }
  return groups;
}

/** Regeln, die nicht gelaufen sind — über alle Dokumente zusammengefasst. */
export function notRunRules(result: ScanResult): NotRunEntry[] {
  const seen = new Map<string, NotRunEntry>();
  for (const scanned of result.documents) {
    for (const run of scanned.report.rule_runs) {
      if (run.not_run === undefined) continue;
      if (seen.has(run.rule_id)) continue;
      seen.set(run.rule_id, { ruleId: run.rule_id, notRun: run.not_run, reason: run.reason });
    }
  }
  return [...seen.values()].sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}

/** Nicht erreichbare Bereiche — Cross-Origin-Frames und solche, die noch laden. */
export function untestedScopes(result: ScanResult): UntestedScopeEntry[] {
  const scopes: UntestedScopeEntry[] = [];
  for (const scanned of result.documents) {
    for (const scope of scanned.untested) {
      scopes.push({ documentId: scanned.id, reason: scope.reason, src: scope.src });
    }
  }
  return scopes;
}

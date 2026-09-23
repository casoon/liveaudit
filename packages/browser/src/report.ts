/**
 * Das Berichtsmodell, wie `a11y-report` es über die WASM-Grenze liefert.
 *
 * Die Feldnamen sind die des Rust-Modells — der JSON-Vertrag ist über alle drei
 * Oberflächen derselbe und wird hier nicht umbenannt.
 */

/** Wie sicher die Aussage ist. Kein Score: `untested` ist nicht `pass`. */
export type Outcome = "fail" | "review" | "pass" | "untested";

/** Wie schwer das Problem wiegt — eine eigene Achse neben [`Outcome`]. */
export type Severity = "low" | "medium" | "high" | "critical";

export type WcagLevel = "A" | "AA" | "AAA";

/** Warum eine Regel nicht gelaufen ist. */
export type NotRun = "capability_missing" | "disabled" | "not_applicable" | "errored";

export interface Location {
  file?: string;
  url?: string;
  selector?: string;
  /** Arena-Index als Text. TypeScript löst darüber auf das reale Element auf. */
  node?: string;
  source_hint?: string;
}

export interface Evidence {
  source: string;
  field?: string;
  value?: string;
}

export interface Finding {
  rule_id: string;
  outcome: Outcome;
  severity: Severity;
  message: string;
  location?: Location;
  wcag?: string[];
  wcag_level?: WcagLevel;
  tags?: string[];
  help?: string;
  help_url?: string;
  suggestion?: string;
  suggested_code?: string;
  snippet?: string;
  evidence?: Evidence[];
}

/** Beantwortet „lief das überhaupt?", während [`Finding`] beantwortet, was
 * dabei herauskam. */
export interface RuleRun {
  rule_id: string;
  not_run?: NotRun;
  findings: number;
  reason?: string;
}

export interface Summary {
  fail: number;
  review: number;
  pass: number;
  untested: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  rules_not_run: number;
}

export interface Report {
  findings: Finding[];
  rule_runs: RuleRun[];
  summary: Summary;
}

/**
 * Die beiden gebauten Ansichten: Seitenleiste und Popover.
 *
 * Eigenes DOM, keine Framework-Laufzeit — eine solche im Bundle wäre gegen das
 * Bundle-Budget (siehe `CLAUDE.md`, Stack).
 *
 * Der Layer ist selbst ein Barrierefreiheits-Werkzeug. Deshalb gilt hier, was er
 * an anderen prüft: jede Schaltfläche trägt einen Namen, sichtbarer Text steckt
 * im zugänglichen Namen, Gruppen sind über Überschriften benannt, und die Farbe
 * eines Badges wiederholt nur, was als Text darin steht.
 */

import type { Outcome } from "@liveaudit/browser/report";
import { DOCK_SIDES, type DockSide, dockLabel } from "./dock.ts";
import {
  categoryLabel,
  type Item,
  type NotRunEntry,
  notRunLabel,
  OUTCOME_ORDER,
  outcomeGloss,
  severityLabel,
  type UntestedScopeEntry,
} from "./model.ts";

type Attrs = Record<string, string | number | boolean | undefined>;

/** Ein Element bauen. Ersetzt den Teil eines Frameworks, den der Layer braucht. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    node.setAttribute(name, value === true ? "" : String(value));
  }
  node.append(...children);
  return node;
}

/** Zustand und Schweregrad als zwei getrennte Badges. Nie eine gemeinsame Zahl. */
function badges(item: Item): HTMLElement[] {
  return [
    el("span", { class: `badge o-${item.finding.outcome}` }, [item.finding.outcome.toUpperCase()]),
    el("span", { class: "badge-sev" }, [`Severity ${severityLabel(item.finding.severity)}`]),
  ];
}

export interface PanelState {
  items: readonly Item[];
  visible: readonly Item[];
  groups: Map<string, Item[]>;
  counts: Record<Outcome, number>;
  outcomes: ReadonlySet<Outcome>;
  selected: string | null;
  notRun: readonly NotRunEntry[];
  scopes: readonly UntestedScopeEntry[];
  /** Befunde ohne Marker — Dokumentbezug oder nicht dargestelltes Element. */
  unplaced: ReadonlySet<string>;
  dock: DockSide;
  /** Der Live-Modus, sofern das Einstiegspaket ihn angemeldet hat. */
  live: { verfuegbar: boolean; aktiv: boolean };
}

export interface PanelCallbacks {
  onSelect(key: string): void;
  onToggleOutcome(outcome: Outcome, shown: boolean): void;
  onClose(): void;
  onDock(side: DockSide): void;
  onToggleLive(an: boolean): void;
}

/**
 * Der Schalter für den Live-Modus.
 *
 * Eine Kontrollkästchen-Zeile und kein stiller Automatismus: Mitzulaufen
 * kostet bei jeder Änderung einen Scan des geänderten Teilbaums, und wer prüft,
 * soll wissen, dass unter ihm etwas rechnet. Die Beschriftung sagt deshalb
 * auch, was dabei *nicht* neu bewertet wird.
 */
function liveSchalter(state: PanelState, cb: PanelCallbacks): HTMLElement {
  const box = el("input", { type: "checkbox", id: "liveaudit-live" });
  const kasten = box as HTMLInputElement;
  kasten.checked = state.live.aktiv;
  kasten.addEventListener("change", () => cb.onToggleLive(kasten.checked));

  return el("div", { class: "live" }, [
    box,
    el("label", { for: "liveaudit-live" }, ["Live mode"]),
    el("span", { class: "live-note" }, [
      state.live.aktiv
        ? "Running. Only the changed subtree is rescanned; statements about the document still come from the last full scan."
        : "Off. The layer shows the state of the last scan.",
    ]),
  ]);
}

/**
 * Baut die Seitenleiste neu.
 *
 * Die Gruppierung folgt dem Präfix der Rule-ID (`images/alt-missing` →
 * „Bilder"). Die Rule-IDs stammen aus `a11y-rules` und sind über alle drei
 * Oberflächen dieselben; hier wird nur beschriftet, nicht umbenannt.
 */
export function renderPanel(panel: HTMLElement, state: PanelState, cb: PanelCallbacks): void {
  panel.replaceChildren();

  const close = el("button", { type: "button", class: "close" }, ["Close"]);
  close.addEventListener("click", cb.onClose);

  // Die Andockwahl steht in der Kopfleiste und nicht in einem Menü: vier
  // Schaltflächen sind billiger zu bedienen als ein aufklappbares Etwas, und
  // die gewählte Kante ist ohne Öffnen ablesbar.
  const docks = el("div", { class: "docks", role: "group", "aria-label": "Dock" });
  for (const side of DOCK_SIDES) {
    const button = el(
      "button",
      {
        type: "button",
        class: "dock-btn",
        "data-side": side,
        "aria-pressed": String(side === state.dock),
      },
      [el("i", { "aria-hidden": "true" })],
    );
    button.setAttribute("aria-label", `Dock ${dockLabel(side).toLowerCase()}`);
    button.addEventListener("click", () => cb.onDock(side));
    docks.append(button);
  }

  panel.append(
    el("div", { class: "panel-head" }, [
      el("div", { class: "head" }, [
        el("h2", { class: "title", id: "liveaudit-panel-title" }, ["LiveAudit"]),
        el("div", { class: "head-actions" }, [docks, close]),
      ]),
      el("p", { class: "claim" }, [
        "Inspector layer. ",
        el("strong", {}, ["It inspects. It does not repair."]),
      ]),
      ...(state.live.verfuegbar ? [liveSchalter(state, cb)] : []),
      // Vier Zahlen nebeneinander, kein Prozentwert: UNTESTED steht
      // gleichrangig neben FAIL, nicht als Rest.
      el(
        "ul",
        { class: "summary", "aria-label": "Findings by state" },
        OUTCOME_ORDER.map((outcome) =>
          el("li", { class: `o-${outcome}` }, [
            el("span", { class: "count" }, [String(state.counts[outcome])]),
            el("span", { class: "badge" }, [outcome.toUpperCase()]),
            el("span", { class: "sr-only" }, [` — ${outcomeGloss(outcome)}`]),
          ]),
        ),
      ),
    ]),
  );

  const body = el("div", { class: "panel-body" });
  panel.append(body);

  const filters = el("fieldset", { class: "filters" }, [el("legend", {}, ["Show states"])]);
  for (const outcome of OUTCOME_ORDER) {
    const input = el("input", {
      type: "checkbox",
      id: `liveaudit-filter-${outcome}`,
      checked: state.outcomes.has(outcome),
    });
    input.addEventListener("change", () => cb.onToggleOutcome(outcome, input.checked));
    filters.append(
      el("label", { for: `liveaudit-filter-${outcome}` }, [
        input,
        `${outcome.toUpperCase()} (${state.counts[outcome]})`,
      ]),
    );
  }
  body.append(filters);

  if (state.visible.length === 0) {
    body.append(el("p", { class: "note" }, ["No finding in the selected states."]));
  }

  for (const [category, items] of state.groups) {
    const headingId = `liveaudit-group-${category}`;
    const list = el("ul", {});
    for (const item of items) {
      const entry = el(
        "button",
        {
          type: "button",
          class: `entry o-${item.finding.outcome}`,
          "data-key": item.key,
          "aria-current": item.key === state.selected ? "true" : undefined,
        },
        [
          el("span", { class: "meta" }, [
            el("span", { class: "num", "aria-hidden": "true" }, [String(item.number)]),
            el("span", { class: "sr-only" }, [`Finding ${item.number}.`]),
            ...badges(item),
            el("span", { class: "rule" }, [item.finding.rule_id]),
          ]),
          el("span", { class: "msg" }, [item.finding.message]),
        ],
      );
      if (state.unplaced.has(item.key)) {
        entry.append(
          el("span", { class: "note" }, [
            "No marker: it applies to the document, or the element is not rendered.",
          ]),
        );
      }
      entry.addEventListener("click", () => cb.onSelect(item.key));
      list.append(el("li", {}, [entry]));
    }
    body.append(
      el("section", { class: "group", "aria-labelledby": headingId }, [
        el("h3", { id: headingId }, [`${categoryLabel(category)} (${items.length})`]),
        list,
      ]),
    );
  }

  // „Nicht prüfbar" ist eine eigene sichtbare Kategorie, kein weggelassener
  // Rest — das ist der fachliche Kern gegenüber Score-Werkzeugen.
  if (state.scopes.length > 0) {
    body.append(
      el("section", { class: "group", "aria-labelledby": "liveaudit-group-scopes" }, [
        el("h3", { id: "liveaudit-group-scopes" }, [`Unreachable scopes (${state.scopes.length})`]),
        el(
          "ul",
          {},
          state.scopes.map((scope) =>
            el("li", {}, [
              el("p", { class: "note" }, [
                `${scope.reason}: ${scope.src ?? "(no src)"} — not decidable automatically.`,
              ]),
            ]),
          ),
        ),
      ]),
    );
  }

  if (state.notRun.length > 0) {
    body.append(
      el("section", { class: "group", "aria-labelledby": "liveaudit-group-notrun" }, [
        el("h3", { id: "liveaudit-group-notrun" }, [
          `Rules that did not run (${state.notRun.length})`,
        ]),
        el(
          "ul",
          {},
          state.notRun.map((run) =>
            el("li", {}, [
              el("p", { class: "note" }, [
                `${run.ruleId} — ${notRunLabel(run.notRun)}${run.reason ? `: ${run.reason}` : ""}`,
              ]),
            ]),
          ),
        ),
      ]),
    );
  }
}

/** Was eine Messung am Ankerpunkt über die Sichtbarkeit des Elements sagt. */
export type Visibility =
  | { kind: "visible" }
  | { kind: "covered"; by: string }
  | { kind: "offscreen" }
  | { kind: "not-rendered" }
  | { kind: "unknown" };

function visibilityText(visibility: Visibility): string {
  switch (visibility.kind) {
    case "visible":
      return "Visible at the anchor point.";
    case "covered":
      return `Covered at the anchor point by ${visibility.by}.`;
    case "offscreen":
      return "Outside the viewport.";
    case "not-rendered":
      return "Not rendered — it has no box in the layout.";
    default:
      return "Visibility not measured.";
  }
}

export interface PopoverCallbacks {
  onReveal(): void;
  onDetails(): void;
  onClose(): void;
}

/** Baut das Popover zu einem Marker neu. */
export function renderPopover(
  popover: HTMLElement,
  item: Item,
  visibility: Visibility,
  cb: PopoverCallbacks,
): void {
  popover.replaceChildren();

  const close = el("button", { type: "button", class: "close" }, ["Close"]);
  close.addEventListener("click", cb.onClose);

  popover.append(
    el("div", { class: "head" }, [
      el("h2", { class: "pop-title", id: "liveaudit-popover-title" }, [
        `Finding ${item.number}: ${item.finding.rule_id}`,
      ]),
      close,
    ]),
    el("p", { class: "pop-meta" }, badges(item)),
    el("p", { class: "pop-msg" }, [item.finding.message]),
  );

  const facts = el("dl", { class: "pop-dl" });
  const addFact = (term: string, value: string): void => {
    facts.append(el("dt", {}, [term]), el("dd", {}, [value]));
  };
  addFact("State", `${item.finding.outcome.toUpperCase()} — ${outcomeGloss(item.finding.outcome)}`);
  addFact("Severity", severityLabel(item.finding.severity));
  if (item.finding.wcag !== undefined && item.finding.wcag.length > 0) {
    const level =
      item.finding.wcag_level === undefined ? "" : ` (Level ${item.finding.wcag_level})`;
    addFact("WCAG", `${item.finding.wcag.join(", ")}${level}`);
  }
  if (item.documentId !== 0) addFact("Document", `Same-origin frame #${item.documentId}`);
  addFact("Position", visibilityText(visibility));
  popover.append(facts);

  if (item.finding.help !== undefined) {
    popover.append(el("p", { class: "note" }, [item.finding.help]));
  }
  if (item.finding.snippet !== undefined) {
    popover.append(el("pre", { class: "snippet" }, [item.finding.snippet]));
  }
  if (item.finding.suggestion !== undefined) {
    popover.append(el("p", { class: "note" }, [`Suggestion: ${item.finding.suggestion}`]));
  }

  const reveal = el("button", { type: "button", class: "action" }, ["Reveal element"]);
  reveal.addEventListener("click", cb.onReveal);
  const details = el("button", { type: "button", class: "action" }, ["Details in the list"]);
  details.addEventListener("click", cb.onDetails);
  popover.append(el("div", { class: "actions" }, [reveal, details]));
}

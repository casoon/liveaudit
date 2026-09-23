/**
 * Der Inspector-Layer: Befunde auf der Seite sichtbar machen, ohne den
 * geprüften Teilbaum zu verändern.
 *
 * **LiveAudit prüft, es repariert nicht.** Der Begriff ist „Inspector-Layer",
 * nicht „Overlay" — „Overlay" bleibt der Kategorie von Werkzeugen vorbehalten,
 * die eine Seite zu reparieren vorgeben (siehe `docs/decisions.md`).
 *
 * Drei Darstellungsvarianten:
 *
 * 1. **Rahmen** für Elemente, die groß genug sind, um einen zu tragen.
 * 2. **Marker plus Popover** für jeden Befund — der Marker ist zugleich das
 *    Bedienelement, auch dort, wo ein Rahmen daneben steht. Rahmen sind
 *    `pointer-events: none` und dürfen es bleiben: Ein klickbares Rechteck über
 *    einem großen Element fängt genau die Klicks ab, die der Seite gelten.
 * 3. **Seitenleiste** mit Gruppierung nach Kategorie.
 *
 * Die vierte Variante — nummerierte Marker über der Tabreihenfolge — braucht
 * Tier 4 und steht im Bauplan unter „Danach".
 *
 * Was der Layer **nicht** tut: Er schreibt weder Attribute noch Inline-Styles
 * an ein Zielelement. Jede Positionierung entsteht aus `getBoundingClientRect()`
 * im eigenen Layer. Gelesen wird der geprüfte Teilbaum, geschrieben nie.
 */

import type { Outcome } from "@liveaudit/browser/report";
import type { ScanResult } from "@liveaudit/browser/scan";
import {
  clampSize,
  type DockSide,
  type DockState,
  defaultSize,
  isVertical,
  readDock,
  writeDock,
} from "./dock.ts";
import {
  ensureHost,
  type Placement,
  placementOf,
  removeHost,
  topElementAt,
  windowsOf,
} from "./host.ts";
import {
  buildItems,
  countOutcomes,
  DEFAULT_OUTCOMES,
  groupByCategory,
  type Item,
  notRunRules,
  untestedScopes,
} from "./model.ts";
import { STYLES } from "./styles.ts";
import { el, renderPanel, renderPopover, type Visibility } from "./views.ts";

/**
 * Was das Einstiegspaket anmeldet, damit die Seitenleiste einen Schalter für
 * den Live-Modus zeigen kann.
 *
 * Der Layer scannt nicht selbst; `watch()` liegt eine Ebene darüber. Statt die
 * Abhängigkeit umzudrehen — `ui` hängt von `browser` ab, nicht umgekehrt —
 * meldet das Einstiegspaket hier an, was es kann. Ohne Anmeldung gibt es den
 * Schalter nicht.
 */
export interface LiveControl {
  isActive(): boolean;
  toggle(an: boolean): void;
}

let liveControl: LiveControl | null = null;

/** Meldet den Live-Modus an der Oberfläche an. `null` nimmt ihn zurück. */
export function configureLive(control: LiveControl | null): void {
  liveControl = control;
}

/** Ab dieser Größe bekommt ein Element zusätzlich einen Rahmen. */
const FRAME_MIN_WIDTH = 34;
const FRAME_MIN_HEIGHT = 18;

const MARKER_SIZE = 24;
const EDGE = 4;

/** Respektiert die Systemeinstellung. Der Layer prüft Barrierefreiheit — er
 * darf sie nicht selbst unterlaufen. */
function scrollBehavior(): ScrollBehavior {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

/**
 * Ob ein Element überhaupt dargestellt wird.
 *
 * Ein `display: none`-Element liefert ein Rechteck aus lauter Nullen. Ein
 * Marker dafür landete in der oberen linken Ecke und zeigte auf nichts — der
 * Befund gehört in die Seitenleiste, nicht auf die Seite.
 */
function isRendered(element: Element, rect: DOMRect): boolean {
  if (rect.width > 0 || rect.height > 0) return true;
  return element.checkVisibility?.() ?? false;
}

function describe(element: Element): string {
  const id = element.id === "" ? "" : `#${element.id}`;
  const cls = element.classList.length === 0 ? "" : `.${element.classList[0]}`;
  return `<${element.localName}${id}${cls}>`;
}

interface Anchor {
  frame: HTMLElement | null;
  marker: HTMLButtonElement;
}

class InspectorLayer {
  private host: HTMLElement | null = null;
  private root: HTMLElement | null = null;
  private layer: HTMLElement | null = null;
  private panel: HTMLElement | null = null;
  private grip: HTMLElement | null = null;
  private popover: HTMLElement | null = null;
  private toggle: HTMLButtonElement | null = null;

  private result: ScanResult | null = null;
  private items: Item[] = [];
  private outcomes = new Set<Outcome>(DEFAULT_OUTCOMES);
  private anchors = new Map<string, Anchor>();
  private selected: string | null = null;
  private openPopoverKey: string | null = null;
  private dock: DockState = readDock();

  private observedWindows: Window[] = [];
  private tick = 0;
  private returnFocus: Element | null = null;

  private readonly onViewportChange = (): void => this.schedule();

  isVisible(): boolean {
    return this.host !== null;
  }

  /** Die angedockte Kante wechseln. Wird gemerkt. */
  setDock(side: DockSide): void {
    if (this.dock.side === side) return;
    // Beim Kantenwechsel wechselt auch die Bedeutung der Größe — aus Breite
    // wird Höhe. Die alte Zahl zu behalten ergäbe eine Leiste, die fast das
    // ganze Fenster füllt oder kaum zu sehen ist.
    this.dock = { ...this.dock, side, size: defaultSize(side) };
    writeDock(this.dock);
    this.applyDock();
    this.render();
  }

  /** Setzt Kante, Größe und Offenstand ins DOM um. */
  private applyDock(): void {
    this.root?.setAttribute("data-dock", this.dock.side);
    this.panel?.style.setProperty("--dock-size", `${this.dock.size}px`);
    if (this.grip !== null) {
      this.grip.setAttribute(
        "aria-orientation",
        isVertical(this.dock.side) ? "vertical" : "horizontal",
      );
      this.grip.setAttribute("aria-valuenow", String(this.dock.size));
      this.grip.setAttribute(
        "aria-valuemax",
        String(clampSize(this.dock.side, Number.MAX_SAFE_INTEGER)),
      );
    }
  }

  private resize(size: number): void {
    this.dock = { ...this.dock, size: clampSize(this.dock.side, size) };
    writeDock(this.dock);
    this.applyDock();
    this.schedule();
  }

  /**
   * Der Ziehgriff, mit Zeiger **und** Tastatur.
   *
   * Ein Griff, der nur auf Ziehen reagiert, wäre in einem Prüfwerkzeug für
   * Barrierefreiheit ein eigener Befund — deshalb `role="separator"` mit
   * Pfeiltasten, dem ARIA-Muster für einen Fensterteiler.
   */
  private wireGrip(grip: HTMLElement): void {
    grip.addEventListener("pointerdown", (event: PointerEvent) => {
      event.preventDefault();
      grip.setPointerCapture(event.pointerId);
      const start = isVertical(this.dock.side) ? event.clientX : event.clientY;
      const startSize = this.dock.size;
      // Nach innen ziehen macht größer: rechts/unten zählt rückwärts.
      const richtung = this.dock.side === "right" || this.dock.side === "bottom" ? -1 : 1;

      const move = (e: PointerEvent): void => {
        const jetzt = isVertical(this.dock.side) ? e.clientX : e.clientY;
        this.resize(startSize + (jetzt - start) * richtung);
      };
      const up = (): void => {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", up);
        grip.removeEventListener("pointercancel", up);
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
      grip.addEventListener("pointercancel", up);
    });

    grip.addEventListener("keydown", (event: KeyboardEvent) => {
      const schritt = event.shiftKey ? 64 : 16;
      const groesser = isVertical(this.dock.side)
        ? { ArrowLeft: this.dock.side === "right", ArrowRight: this.dock.side === "left" }
        : { ArrowUp: this.dock.side === "bottom", ArrowDown: this.dock.side === "top" };
      const treffer = groesser[event.key as keyof typeof groesser];
      if (treffer === undefined) return;
      event.preventDefault();
      this.resize(this.dock.size + (treffer ? schritt : -schritt));
    });
  }

  /** Zeigt den Layer für ein Scan-Ergebnis. Ein zweiter Aufruf ersetzt es. */
  show(result: ScanResult): void {
    if (this.host === null) this.returnFocus = document.activeElement;

    const { host, shadow } = ensureHost();
    this.host = host;

    if (this.root === null || this.root.parentNode !== shadow) {
      shadow.replaceChildren();
      shadow.append(el("style", {}, [STYLES]));

      this.layer = el("div", { class: "layer" });
      this.panel = el("aside", {
        class: "panel",
        id: "liveaudit-panel",
        "aria-labelledby": "liveaudit-panel-title",
        tabindex: "-1",
      });
      // Ohne Inhalt gibt es die Überschrift noch nicht — `aria-labelledby`
      // zeigte dann ins Leere. Der eigene Scanner hat genau das gefunden
      // (`aria/reference-missing`), deshalb wird die Referenz erst beim Öffnen
      // gesetzt und beim Schließen wieder entfernt.
      this.popover = el("div", {
        class: "popover",
        id: "liveaudit-popover",
        role: "dialog",
        tabindex: "-1",
        hidden: true,
      });
      this.grip = el("div", {
        class: "grip",
        role: "separator",
        tabindex: "0",
        "aria-label": "Größe der Seitenleiste",
        "aria-valuemin": "240",
      });
      this.wireGrip(this.grip);

      this.toggle = el("button", { type: "button", class: "toggle", "aria-expanded": "true" });
      this.toggle.setAttribute("aria-controls", "liveaudit-panel");
      this.toggle.addEventListener("click", () => this.setPanelOpen(!this.dock.open, true));

      this.root = el("div", { class: "root" }, [this.layer, this.popover, this.panel, this.toggle]);
      this.root.addEventListener("keydown", (event) => this.onKeyDown(event));
      shadow.append(this.root);
    }

    // Nach einem Fensterwechsel kann die gemerkte Größe zu groß geworden sein.
    this.dock = { ...this.dock, size: clampSize(this.dock.side, this.dock.size) };
    this.applyDock();

    this.result = result;
    this.items = buildItems(result);
    this.selected = null;
    this.openPopoverKey = null;

    this.listen(result);
    this.render();
  }

  /** Entfernt den Layer wieder — danach ist von LiveAudit nichts mehr im DOM. */
  hide(): void {
    if (this.host === null) return;

    const inside = this.host.contains(document.activeElement);
    this.unlisten();
    if (this.tick !== 0) {
      cancelAnimationFrame(this.tick);
      this.tick = 0;
    }

    removeHost();
    this.host = null;
    this.root = null;
    this.layer = null;
    this.panel = null;
    this.grip = null;
    this.popover = null;
    this.toggle = null;
    this.anchors.clear();

    // Ohne das fiele der Fokus beim Schließen auf `<body>` — genau der
    // Fokusverlust, den der Layer an anderen prüft.
    if (inside) {
      const target = this.returnFocus;
      if (target instanceof HTMLElement && target.isConnected) target.focus();
    }
    this.returnFocus = null;
  }

  // --- Aufbau -------------------------------------------------------------

  private render(): void {
    const layer = this.layer;
    const panel = this.panel;
    const result = this.result;
    if (layer === null || panel === null || result === null) return;

    const visible = this.items.filter((item) => this.outcomes.has(item.finding.outcome));

    layer.replaceChildren();
    this.anchors.clear();
    const unplaced = new Set<string>();

    for (const item of visible) {
      const placement = this.placementFor(item);
      const element = item.element;
      if (
        placement === null ||
        element === undefined ||
        this.isDocumentScope(item) ||
        !isRendered(element, placement.rect)
      ) {
        unplaced.add(item.key);
        continue;
      }

      const outcome = `o-${item.finding.outcome}`;
      const rect = placement.rect;
      const frame =
        rect.width >= FRAME_MIN_WIDTH && rect.height >= FRAME_MIN_HEIGHT
          ? el("div", { class: `frame ${outcome}`, "aria-hidden": "true" })
          : null;

      const marker = el("button", {
        type: "button",
        class: `marker ${outcome}`,
        "aria-expanded": "false",
        "aria-controls": "liveaudit-popover",
        "aria-label": `Befund ${item.number}: ${item.finding.outcome.toUpperCase()}, ${item.finding.rule_id}`,
      });
      marker.textContent = String(item.number);
      marker.addEventListener("click", () => this.togglePopover(item.key));

      if (frame !== null) layer.append(frame);
      layer.append(marker);
      this.anchors.set(item.key, { frame, marker });
    }

    renderPanel(
      panel,
      {
        items: this.items,
        visible,
        groups: groupByCategory(visible),
        counts: countOutcomes(this.items),
        outcomes: this.outcomes,
        selected: this.selected,
        notRun: notRunRules(result),
        scopes: untestedScopes(result),
        unplaced,
        dock: this.dock.side,
        live: {
          verfuegbar: liveControl !== null,
          aktiv: liveControl?.isActive() ?? false,
        },
      },
      {
        onSelect: (key) => this.select(key, true),
        onToggleOutcome: (outcome, shown) => {
          if (shown) this.outcomes.add(outcome);
          else this.outcomes.delete(outcome);
          this.render();
        },
        onClose: () => this.setPanelOpen(false, true),
        onDock: (side) => this.setDock(side),
        onToggleLive: (an) => {
          liveControl?.toggle(an);
          // Ein Einschalten scannt neu und zeichnet den Layer ohnehin neu; ein
          // Ausschalten muss die Beschriftung selbst nachziehen.
          if (!an) this.render();
        },
      },
    );

    // Der Griff überlebt `replaceChildren` in `renderPanel` nicht und wird
    // deshalb danach wieder eingehängt — er ist Rahmen, nicht Inhalt.
    if (this.grip !== null) panel.append(this.grip);

    const shown = visible.length;
    if (this.toggle !== null) {
      this.toggle.textContent = `LiveAudit — ${shown} ${shown === 1 ? "Befund" : "Befunde"}`;
    }

    this.setPanelOpen(this.dock.open, false);
    this.layout();
  }

  // --- Geometrie ----------------------------------------------------------

  private placementFor(item: Item): Placement | null {
    const element = item.element;
    if (this.result === null || element === undefined || !element.isConnected) return null;
    return placementOf(this.result, item.scanned, element);
  }

  /** Ein Befund am `<html>` oder `<body>` bekommt keinen seitengroßen Rahmen. */
  private isDocumentScope(item: Item): boolean {
    const element = item.element;
    if (element === undefined) return true;
    const doc = element.ownerDocument;
    return element === doc.documentElement || element === doc.body;
  }

  private schedule(): void {
    if (this.tick !== 0) return;
    this.tick = requestAnimationFrame(() => {
      this.tick = 0;
      this.layout();
    });
  }

  /**
   * Der Streifen, in dem ein Marker stehen darf.
   *
   * Ein fokussierbares, aber von der Seitenleiste verdecktes Bedienelement wäre
   * selbst ein Befund — deshalb weichen die Marker aus, und zwar an jeder der
   * vier Kanten.
   */
  private freierBereich(): { minX: number; maxX: number; minY: number; maxY: number } {
    let minX = EDGE;
    let maxX = window.innerWidth - MARKER_SIZE - EDGE;
    let minY = EDGE;
    let maxY = window.innerHeight - MARKER_SIZE - EDGE;

    if (this.dock.open && this.panel !== null) {
      const r = this.panel.getBoundingClientRect();
      if (this.dock.side === "right") maxX = Math.min(maxX, r.left - MARKER_SIZE - EDGE);
      if (this.dock.side === "left") minX = Math.max(minX, r.right + EDGE);
      if (this.dock.side === "bottom") maxY = Math.min(maxY, r.top - MARKER_SIZE - EDGE);
      if (this.dock.side === "top") minY = Math.max(minY, r.bottom + EDGE);
    }
    // Bei sehr großer Leiste kann der Streifen zusammenfallen. Dann gilt der
    // Anfang — ein Marker am Rand ist besser als einer bei NaN.
    if (maxX < minX) maxX = minX;
    if (maxY < minY) maxY = minY;
    return { minX, maxX, minY, maxY };
  }

  private layout(): void {
    if (this.layer === null) return;
    const bereich = this.freierBereich();

    for (const item of this.items) {
      const anchor = this.anchors.get(item.key);
      if (anchor === undefined) continue;
      const placement = this.placementFor(item);
      if (placement === null) {
        anchor.marker.style.display = "none";
        if (anchor.frame !== null) anchor.frame.style.display = "none";
        continue;
      }

      const rect = placement.rect;
      anchor.marker.style.display = "";
      if (anchor.frame !== null) {
        anchor.frame.style.display = "";
        anchor.frame.style.left = `${rect.left}px`;
        anchor.frame.style.top = `${rect.top}px`;
        anchor.frame.style.width = `${rect.width}px`;
        anchor.frame.style.height = `${rect.height}px`;
      }

      // Der Marker sitzt auf der oberen linken Ecke des Elements und rutscht
      // in den freien Streifen, wenn er sonst unter der Leiste läge.
      const x = Math.max(bereich.minX, Math.min(rect.left - MARKER_SIZE / 2, bereich.maxX));
      const y = Math.max(bereich.minY, Math.min(rect.top - MARKER_SIZE / 2, bereich.maxY));
      anchor.marker.style.left = `${x}px`;
      anchor.marker.style.top = `${y}px`;
    }

    this.positionPopover();
  }

  private positionPopover(): void {
    const popover = this.popover;
    if (popover === null || this.openPopoverKey === null) return;
    const anchor = this.anchors.get(this.openPopoverKey);
    if (anchor === undefined) return;

    const marker = anchor.marker.getBoundingClientRect();
    const box = popover.getBoundingClientRect();
    const x = Math.max(EDGE, Math.min(marker.left, window.innerWidth - box.width - EDGE));
    const below = marker.bottom + 8;
    const y =
      below + box.height + EDGE <= window.innerHeight
        ? below
        : Math.max(EDGE, marker.top - box.height - 8);
    popover.style.left = `${x}px`;
    popover.style.top = `${y}px`;
  }

  /**
   * Misst am Mittelpunkt des Elements, was dort tatsächlich obenauf liegt.
   *
   * `elementsFromPoint()` statt `elementFromPoint()`, und der eigene Host wird
   * aus dem Ergebnis gefiltert — sonst misst der Layer sich selbst.
   */
  private measure(item: Item, placement: Placement | null): Visibility {
    const element = item.element;
    if (element === undefined || placement === null) return { kind: "not-rendered" };
    const rect = placement.rect;
    if (rect.width === 0 && rect.height === 0) return { kind: "not-rendered" };

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) {
      return { kind: "offscreen" };
    }

    const hit = topElementAt(
      placement.ownerDocument,
      cx - placement.frameOffsetX,
      cy - placement.frameOffsetY,
    );
    if (hit === null) return { kind: "unknown" };
    if (hit === element || element.contains(hit) || hit.contains(element)) {
      return { kind: "visible" };
    }
    return { kind: "covered", by: describe(hit) };
  }

  // --- Interaktion --------------------------------------------------------

  private setPanelOpen(open: boolean, moveFocus: boolean): void {
    if (this.dock.open !== open) {
      this.dock = { ...this.dock, open };
      writeDock(this.dock);
    }
    if (this.panel !== null) this.panel.hidden = !open;
    if (this.toggle !== null) this.toggle.setAttribute("aria-expanded", String(open));
    // Beim Schließen verschwindet der Schließen-Knopf mitsamt dem Fokus. Ohne
    // diese Übergabe landete der Fokus auf `<body>`.
    if (moveFocus && !open) this.toggle?.focus();
    if (moveFocus && open) this.panel?.focus();
  }

  private select(key: string, reveal: boolean): void {
    this.selected = key;
    for (const [other, anchor] of this.anchors) {
      const on = other === key;
      anchor.marker.dataset.selected = String(on);
      if (anchor.frame !== null) anchor.frame.dataset.selected = String(on);
    }
    if (this.panel !== null) {
      for (const entry of this.panel.querySelectorAll(".entry")) {
        if (entry instanceof HTMLElement && entry.dataset.key === key) {
          entry.setAttribute("aria-current", "true");
        } else {
          entry.removeAttribute("aria-current");
        }
      }
    }
    if (reveal) this.reveal(key);
  }

  private reveal(key: string): void {
    const item = this.items.find((candidate) => candidate.key === key);
    const element = item?.element;
    if (element === undefined) return;
    element.scrollIntoView({ behavior: scrollBehavior(), block: "center", inline: "nearest" });
    this.schedule();
  }

  private togglePopover(key: string): void {
    if (this.openPopoverKey === key) {
      this.closePopover(true);
      return;
    }
    this.openPopover(key);
  }

  private openPopover(key: string): void {
    const popover = this.popover;
    const item = this.items.find((candidate) => candidate.key === key);
    if (popover === null || item === undefined) return;

    if (this.openPopoverKey !== null) {
      this.anchors.get(this.openPopoverKey)?.marker.setAttribute("aria-expanded", "false");
    }

    renderPopover(popover, item, this.measure(item, this.placementFor(item)), {
      onReveal: () => this.reveal(key),
      onDetails: () => {
        this.select(key, false);
        this.setPanelOpen(true, true);
      },
      onClose: () => this.closePopover(true),
    });

    popover.setAttribute("aria-labelledby", "liveaudit-popover-title");
    popover.hidden = false;
    this.openPopoverKey = key;
    this.anchors.get(key)?.marker.setAttribute("aria-expanded", "true");
    this.select(key, false);
    this.positionPopover();
    popover.focus();
  }

  private closePopover(returnFocus: boolean): void {
    const key = this.openPopoverKey;
    if (this.popover === null || key === null) return;
    this.popover.hidden = true;
    this.popover.removeAttribute("aria-labelledby");
    this.popover.replaceChildren();
    this.openPopoverKey = null;
    const marker = this.anchors.get(key)?.marker;
    marker?.setAttribute("aria-expanded", "false");
    if (returnFocus) marker?.focus();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    if (this.openPopoverKey !== null) {
      event.stopPropagation();
      this.closePopover(true);
      return;
    }
    if (this.dock.open && this.panel?.contains(event.composedPath()[0] as Node) === true) {
      event.stopPropagation();
      this.setPanelOpen(false, true);
    }
  }

  // --- Listener -----------------------------------------------------------

  private listen(result: ScanResult): void {
    this.unlisten();
    this.observedWindows = windowsOf(result);
    for (const view of this.observedWindows) {
      view.addEventListener("scroll", this.onViewportChange, { capture: true, passive: true });
      view.addEventListener("resize", this.onViewportChange, { passive: true });
    }
  }

  private unlisten(): void {
    for (const view of this.observedWindows) {
      view.removeEventListener("scroll", this.onViewportChange, { capture: true });
      view.removeEventListener("resize", this.onViewportChange);
    }
    this.observedWindows = [];
  }
}

const layer = new InspectorLayer();

/**
 * Zeigt den Inspector-Layer für ein Scan-Ergebnis.
 *
 * `dock` setzt die Kante ausdrücklich und überschreibt damit die gemerkte.
 * Ohne Angabe gilt, was zuletzt gewählt wurde — bei erstem Besuch rechts.
 */
export function show(result: ScanResult, dock?: DockSide): void {
  if (dock !== undefined) layer.setDock(dock);
  layer.show(result);
}

/** Die angedockte Kante wechseln, ohne neu zu scannen. */
export function dock(side: DockSide): void {
  layer.setDock(side);
}

/** Entfernt den Inspector-Layer aus dem Dokument. */
export function hide(): void {
  layer.hide();
}

/** Ob der Layer gerade im Dokument hängt. */
export function isVisible(): boolean {
  return layer.isVisible();
}

export { HOST_TAG_NAME } from "@liveaudit/browser/collect";
export { DOCK_SIDES, type DockSide } from "./dock.ts";

/**
 * Das Stylesheet des Inspector-Layers.
 *
 * Es lebt im Shadow Root und ist damit von Seiten-CSS abgeschirmt — kein
 * WordPress-Theme, kein Bootstrap, kein `!important` aus der Seite kommt hier
 * an. Umgekehrt gilt dasselbe: Diese Regeln erreichen den geprüften Teilbaum
 * nicht.
 *
 * Zwei Dinge sind nicht Geschmackssache:
 *
 * - `pointer-events` ist im Layer `none` und wird **nur** von Marker, Popover
 *   und Panel auf `auto` gehoben. Sonst fängt der Layer Klicks ab, die der
 *   Seite gelten.
 * - Zustand und Schweregrad sind zwei Badges, nie eine Zahl. Farbe ist dabei
 *   nur Zugabe: In jedem Badge steht der Code als Text.
 */

export const STYLES = `
*, *::before, *::after { box-sizing: border-box; }

:host { all: initial; }

.root {
  position: absolute;
  inset: 0;
  pointer-events: none;
  font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #f4f4f5;
  text-align: left;
}

.root :focus-visible {
  outline: 3px solid #fde047;
  outline-offset: 2px;
}

/* --- Zustandsfarben. Der Code im Badge trägt die Aussage, nicht die Farbe. --- */
.o-fail     { --edge: #ef4444; --chip: #b91c1c; }
.o-review   { --edge: #f59e0b; --chip: #a15c07; }
.o-untested { --edge: #a78bfa; --chip: #6d28d9; }
.o-pass     { --edge: #22c55e; --chip: #15803d; }

/* --- Variante 1: Rahmen für größere Elemente --- */
.frame {
  position: absolute;
  pointer-events: none;
  border: 2px solid var(--edge);
  border-radius: 2px;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6), inset 0 0 0 1px rgba(0, 0, 0, 0.6);
}

.frame[data-selected="true"] {
  background: color-mix(in srgb, var(--edge) 14%, transparent);
}

/* --- Variante 2: Marker plus Popover für kleine Elemente --- */
.marker {
  position: absolute;
  pointer-events: auto;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 2px solid #fafafa;
  border-radius: 999px;
  background: var(--chip);
  color: #ffffff;
  font: 700 11px/1 ui-sans-serif, system-ui, sans-serif;
  cursor: pointer;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.55);
}

.marker[aria-expanded="true"],
.marker[data-selected="true"] {
  border-color: #fde047;
}

.popover {
  position: absolute;
  pointer-events: auto;
  width: min(340px, calc(100vw - 24px));
  max-height: min(60vh, 520px);
  overflow: auto;
  padding: 12px 14px 14px;
  border: 1px solid #52525b;
  border-radius: 10px;
  background: #18181b;
  box-shadow: 0 10px 34px rgba(0, 0, 0, 0.55);
}

.popover[hidden] { display: none; }

/* --- Variante 3: Seitenleiste, an jede Kante andockbar ---
 *
 * Welche Kante frei ist, weiß nur der Prüfende: Eine Seite mit fixierter
 * Kopfzeile verträgt kein Andocken oben. Die Kante steht als 'data-dock' an
 * '.root', die Größe als '--dock-size'. Beides wird gemerkt.
 */
.panel {
  position: absolute;
  display: flex;
  flex-direction: column;
  pointer-events: auto;
  background: #18181b;
  --dock-size: 380px;
}

.panel[hidden] { display: none; }

[data-dock="right"] .panel,
[data-dock="left"] .panel {
  top: 0;
  bottom: 0;
  width: min(var(--dock-size), 92vw);
}

[data-dock="top"] .panel,
[data-dock="bottom"] .panel {
  left: 0;
  right: 0;
  height: min(var(--dock-size), 85vh);
}

[data-dock="right"] .panel  { right: 0;  border-left: 1px solid #3f3f46;   box-shadow: -10px 0 30px rgba(0,0,0,.4); }
[data-dock="left"] .panel   { left: 0;   border-right: 1px solid #3f3f46;  box-shadow: 10px 0 30px rgba(0,0,0,.4); }
[data-dock="bottom"] .panel { bottom: 0; border-top: 1px solid #3f3f46;    box-shadow: 0 -10px 30px rgba(0,0,0,.4); }
[data-dock="top"] .panel    { top: 0;    border-bottom: 1px solid #3f3f46; box-shadow: 0 10px 30px rgba(0,0,0,.4); }

/* --- Der Ziehgriff an der Innenkante ---
 *
 * 'role="separator"' mit 'tabindex', nicht nur ein Mausziel: Ein Griff, der
 * ausschließlich auf Ziehen reagiert, wäre in einem Prüfwerkzeug für
 * Barrierefreiheit ein eigener Befund. Pfeiltasten verstellen ihn ebenso.
 */
.grip {
  position: absolute;
  z-index: 2;
  background: transparent;
  border: 0;
  padding: 0;
  touch-action: none;
}

.grip::after {
  content: "";
  position: absolute;
  inset: 0;
  margin: auto;
  border-radius: 999px;
  background: #52525b;
}

.grip:hover::after,
.grip:focus-visible::after { background: #a78bfa; }

[data-dock="right"] .grip, [data-dock="left"] .grip {
  top: 0; bottom: 0; width: 10px; cursor: ew-resize;
}
[data-dock="right"] .grip { left: -5px; }
[data-dock="left"] .grip { right: -5px; }
[data-dock="right"] .grip::after, [data-dock="left"] .grip::after { width: 3px; height: 42px; }

[data-dock="top"] .grip, [data-dock="bottom"] .grip {
  left: 0; right: 0; height: 10px; cursor: ns-resize;
}
[data-dock="bottom"] .grip { top: -5px; }
[data-dock="top"] .grip { bottom: -5px; }
[data-dock="top"] .grip::after, [data-dock="bottom"] .grip::after { height: 3px; width: 42px; }

/* --- Kopfleiste: bleibt stehen, während die Liste darunter läuft --- */
.panel-head {
  flex: none;
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 12px 14px 10px;
  background: linear-gradient(#18181b 70%, rgba(24, 24, 27, 0));
  border-bottom: 1px solid #27272a;
}

.panel-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 12px 14px 22px;
}

/* Quer angedockt ist die Leiste breit und flach — dann nebeneinander statt
   untereinander, sonst scrollt man durch eine Spalte im Breitformat.
   Grid, nicht column-width: CSS-Spalten fließen bei fester Höhe zur Seite
   und erzwingen waagerechtes Scrollen durch eine Befundliste. */
[data-dock="top"] .panel-body,
[data-dock="bottom"] .panel-body {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(22rem, 100%), 1fr));
  align-content: start;
  gap: 0 20px;
}

/* --- Andockwahl --- */
.docks {
  display: flex;
  gap: 4px;
}

.dock-btn {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid #3f3f46;
  border-radius: 6px;
  background: #27272a;
  color: #a1a1aa;
  cursor: pointer;
}

.dock-btn:hover { color: #e4e4e7; border-color: #52525b; }

.dock-btn[aria-pressed="true"] {
  background: #3f3f46;
  border-color: #a78bfa;
  color: #fafafa;
}

/* Ein Rechteck mit dicker Kante dort, wo angedockt würde. Kein Icon-Font,
   keine SVG-Datei — das wären Bytes für eine Linie. */
.dock-btn i {
  display: block;
  width: 15px;
  height: 13px;
  border: 1px solid currentColor;
  border-radius: 2px;
}

.dock-btn[data-side="right"] i  { border-right-width: 5px; }
.dock-btn[data-side="left"] i   { border-left-width: 5px; }
.dock-btn[data-side="top"] i    { border-top-width: 5px; }
.dock-btn[data-side="bottom"] i { border-bottom-width: 5px; }

.toggle {
  position: absolute;
  left: 16px;
  bottom: 16px;
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 6px 12px;
  border: 1px solid #52525b;
  border-radius: 999px;
  background: #18181b;
  color: #f4f4f5;
  font: 600 13px/1.2 ui-sans-serif, system-ui, sans-serif;
  cursor: pointer;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
}

/* Der Umschalter sitzt in der Ecke gegenüber der angedockten Kante — sonst
   liegt er unter der Leiste, die er öffnen soll. */
[data-dock="left"] .toggle   { left: auto; right: 16px; }
[data-dock="bottom"] .toggle { bottom: auto; top: 16px; left: auto; right: 16px; }
[data-dock="top"] .toggle    { top: auto; bottom: 16px; left: auto; right: 16px; }

/* --- Gemeinsame Bausteine --- */
.title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.live {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 4px 8px;
  margin: 10px 0 0;
}
.live label {
  font-size: 12.5px;
  font-weight: 600;
}
.live-note {
  grid-column: 2;
  color: var(--la-muted);
  font-size: 11.5px;
  line-height: 1.45;
}
.claim {
  margin: 2px 0 12px;
  color: #d4d4d8;
  font-size: 12px;
}

.claim strong { color: #fafafa; }

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.close {
  flex: none;
  min-width: 32px;
  min-height: 32px;
  padding: 4px 10px;
  border: 1px solid #52525b;
  border-radius: 6px;
  background: #27272a;
  color: #f4f4f5;
  font: 600 12px/1 ui-sans-serif, system-ui, sans-serif;
  cursor: pointer;
}

.badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--chip, #3f3f46);
  color: #ffffff;
  font: 700 10px/1.5 ui-monospace, "SF Mono", Menlo, monospace;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

.badge-sev {
  display: inline-block;
  padding: 1px 6px;
  border: 1px solid #71717a;
  border-radius: 4px;
  color: #e4e4e7;
  font: 600 10px/1.5 ui-sans-serif, system-ui, sans-serif;
  white-space: nowrap;
}

.summary {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}

.summary li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px 3px 6px;
  border: 1px solid #3f3f46;
  border-left: 3px solid var(--edge, #52525b);
  border-radius: 6px;
  background: #212124;
}

.summary .count {
  font: 700 15px/1 ui-monospace, "SF Mono", Menlo, monospace;
  font-variant-numeric: tabular-nums;
}

/* Kein eingefärbter Block, sondern nur der Code: Die Zahl davor trägt die
   Aussage, der farbige Rand ist Zugabe. */
.summary .badge {
  background: transparent;
  color: #a1a1aa;
  padding: 0;
  font-size: 9px;
}

.filters {
  margin: 0 0 14px;
  padding: 8px 10px 10px;
  border: 1px solid #3f3f46;
  border-radius: 8px;
}

.filters legend { padding: 0 4px; color: #d4d4d8; font-size: 11px; font-weight: 700; }

.filters label {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 24px;
  color: #e4e4e7;
  font-size: 12px;
}

.filters input { width: 15px; height: 15px; accent-color: #a78bfa; margin: 0; }

.group { margin: 0 0 14px; }

.group h3 {
  margin: 0 0 6px;
  padding-bottom: 4px;
  border-bottom: 1px solid #3f3f46;
  color: #fafafa;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.group ul { margin: 0; padding: 0; list-style: none; }

.entry {
  display: grid;
  gap: 4px;
  width: 100%;
  margin: 0 0 4px;
  padding: 7px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: #212124;
  color: #f4f4f5;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.entry:hover { background: #2a2a2e; }

.entry[aria-current="true"] { border-color: #fde047; background: #2f2f33; }

.entry .meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

.entry .num {
  display: inline-grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: var(--chip, #3f3f46);
  color: #ffffff;
  font: 700 10px/1 ui-monospace, Menlo, monospace;
}

.entry .rule { color: #a1a1aa; font: 500 10px/1.4 ui-monospace, Menlo, monospace; }

.entry .msg { margin: 0; color: #e4e4e7; font-size: 12px; }

.note { margin: 0; color: #a1a1aa; font-size: 11px; }

.pop-title { margin: 0 0 2px; font-size: 13px; font-weight: 700; }

.pop-rule { margin: 0 0 8px; color: #a1a1aa; font: 500 11px/1.4 ui-monospace, Menlo, monospace; }

.pop-msg { margin: 0 0 8px; font-size: 12px; color: #f4f4f5; }

.pop-meta { display: flex; gap: 6px; flex-wrap: wrap; margin: 0 0 8px; }

.pop-dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin: 0 0 10px; }

.pop-dl dt { color: #a1a1aa; font-size: 11px; }

.pop-dl dd { margin: 0; font-size: 11px; color: #e4e4e7; }

.snippet {
  margin: 0 0 10px;
  padding: 7px 8px;
  overflow: auto;
  max-height: 8rem;
  border-radius: 6px;
  background: #0b0b0d;
  color: #d4d4d8;
  font: 500 11px/1.5 ui-monospace, "SF Mono", Menlo, monospace;
  white-space: pre-wrap;
  word-break: break-word;
}

.actions { display: flex; gap: 8px; flex-wrap: wrap; }

.action {
  min-height: 32px;
  padding: 6px 12px;
  border: 1px solid #52525b;
  border-radius: 6px;
  background: #27272a;
  color: #f4f4f5;
  font: 600 12px/1.2 ui-sans-serif, system-ui, sans-serif;
  cursor: pointer;
}

.action:hover { background: #33333a; }

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

/* Der Layer ist selbst ein Barrierefreiheits-Werkzeug: Wer Bewegung abbestellt
   hat, bekommt hier keine. Das gilt auch für das Springen zum Element — siehe
   'scrollBehavior()' in index.ts. */
@media (prefers-reduced-motion: reduce) {
  .root *, .root *::before, .root *::after {
    transition: none !important;
    animation: none !important;
  }
}
`;

/**
 * Wo die Seitenleiste andockt, wie groß sie ist und ob sie offen steht.
 *
 * Der Layer liegt über fremden Seiten, und welche Kante frei ist, weiß nur der
 * Prüfende: Eine Seite mit fixierter Kopfzeile verträgt kein Andocken oben,
 * eine mit rechter Sidebar keines rechts. Deshalb vier Kanten statt einer
 * Vorgabe.
 *
 * Der Zustand liegt in `localStorage` — eine Bequemlichkeit je Betrachter, kein
 * Befund und nichts, was jemand anders lesen müsste. Jeder Zugriff ist
 * abgesichert: Im privaten Fenster und bei gesperrten Website-Daten wirft er.
 */

export type DockSide = "right" | "left" | "bottom" | "top";

export const DOCK_SIDES: readonly DockSide[] = ["left", "top", "bottom", "right"];

/** Ob diese Kante die Seitenleiste hoch statt breit macht. */
export function isVertical(side: DockSide): boolean {
  return side === "left" || side === "right";
}

export interface DockState {
  side: DockSide;
  /** Breite bei linkem/rechtem Andocken, Höhe bei oberem/unterem — in px. */
  size: number;
  open: boolean;
}

const KEY = "liveaudit:dock";

const VORGABE: Record<"vertical" | "horizontal", number> = {
  vertical: 380,
  horizontal: 320,
};

/** Unter der Untergrenze ist die Liste nicht mehr lesbar, über der Obergrenze
 *  verdeckt die Leiste die Seite, die sie zeigen soll. */
export function clampSize(side: DockSide, size: number): number {
  const platz = isVertical(side) ? window.innerWidth : window.innerHeight;
  const max = Math.max(240, Math.round(platz * 0.8));
  return Math.round(Math.max(240, Math.min(size, max)));
}

export function defaultSize(side: DockSide): number {
  return clampSize(side, VORGABE[isVertical(side) ? "vertical" : "horizontal"]);
}

function isSide(value: unknown): value is DockSide {
  return typeof value === "string" && (DOCK_SIDES as readonly string[]).includes(value);
}

/** Der gemerkte Zustand, oder die Vorgabe. Liest nie ungeprüft. */
export function readDock(): DockState {
  const fallback: DockState = { side: "right", size: defaultSize("right"), open: true };
  let roh: string | null = null;
  try {
    roh = globalThis.localStorage?.getItem(KEY) ?? null;
  } catch {
    return fallback;
  }
  if (roh === null) return fallback;

  try {
    const gelesen: unknown = JSON.parse(roh);
    if (typeof gelesen !== "object" || gelesen === null) return fallback;
    const { side, size, open } = gelesen as Partial<DockState>;
    const kante = isSide(side) ? side : fallback.side;
    return {
      side: kante,
      size:
        typeof size === "number" && Number.isFinite(size)
          ? clampSize(kante, size)
          : defaultSize(kante),
      open: typeof open === "boolean" ? open : true,
    };
  } catch {
    return fallback;
  }
}

export function writeDock(state: DockState): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(state));
  } catch {
    // Ohne Gedächtnis ist der Layer voll brauchbar — nur nicht über Seiten hinweg.
  }
}

/** Die Beschriftung der Andockschaltflächen. */
export function dockLabel(side: DockSide): string {
  return { left: "Left", top: "Top", bottom: "Bottom", right: "Right" }[side];
}

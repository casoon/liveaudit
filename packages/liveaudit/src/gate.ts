/**
 * Die Freischaltung.
 *
 * LiveAudit ist ohne ausdrückliche Freischaltung **inert**: Das Einbinden des
 * Scripts registriert nichts, lädt nichts nach und legt kein globales Objekt
 * an. Auf einer Produktionsseite beschränken sich die Kosten damit auf das
 * Herunterladen und Parsen des Bundles.
 *
 * Bewusst kein Host-Filter: Der Kern von LiveAudit ist, dort zu prüfen, wo die
 * Seite tatsächlich läuft. Eine Allowlist auf `localhost` und Staging nähme
 * genau diesen Fall weg. Siehe `docs/decisions.md`.
 */

/** Query-Parameter und `localStorage`-Schlüssel, die LiveAudit freischalten. */
export const FLAG = "liveaudit";

/**
 * Ist LiveAudit auf dieser Seite freigeschaltet?
 *
 * Wahr bei `?liveaudit` in der URL (mit oder ohne Wert, außer `0` und `false`)
 * oder bei einem `localStorage`-Eintrag `liveaudit`, der nicht `0` oder `false`
 * ist. Äußert sich die URL, gewinnt sie — auch mit `0`, womit sich eine
 * vorgemerkte Freischaltung für einen Aufruf abschalten lässt.
 *
 * Jeder Zugriff ist abgesichert: In einem Sandbox-iframe oder bei blockierten
 * Site-Daten wirft `localStorage` schon beim Lesen. Ein Prüfwerkzeug, das die
 * geprüfte Seite mit einer Ausnahme beschädigt, wäre das Gegenteil seines
 * Zwecks.
 */
export function isEnabled(): boolean {
  // Ein ausdrückliches `?liveaudit=0` gewinnt gegen einen vorgemerkten
  // Eintrag — so lässt sich die Freischaltung für einen Aufruf abschalten,
  // ohne sie zu löschen.
  const ausDerUrl = fromQuery();
  if (ausDerUrl !== undefined) return ausDerUrl;
  return fromStorage();
}

function verneint(value: string | null): boolean {
  return value === "0" || value === "false";
}

/** `undefined`, wenn die URL sich nicht äußert. */
function fromQuery(): boolean | undefined {
  try {
    const params = new URLSearchParams(globalThis.location?.search ?? "");
    if (!params.has(FLAG)) return undefined;
    return !verneint(params.get(FLAG));
  } catch {
    return undefined;
  }
}

function fromStorage(): boolean {
  try {
    const value = globalThis.localStorage?.getItem(FLAG) ?? null;
    return value !== null && !verneint(value);
  } catch {
    return false;
  }
}

/**
 * Merkt die Freischaltung für diese Herkunft vor, sodass sie auch ohne
 * Query-Parameter gilt. Wirkt ab dem nächsten Seitenaufbau.
 */
export function remember(): void {
  try {
    globalThis.localStorage?.setItem(FLAG, "1");
  } catch {
    // Ohne Speicher bleibt es beim Query-Parameter.
  }
}

/** Nimmt eine vorgemerkte Freischaltung zurück. */
export function forget(): void {
  try {
    globalThis.localStorage?.removeItem(FLAG);
  } catch {
    // Nichts zu tun.
  }
}

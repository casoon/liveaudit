/**
 * Wiedergabe-Messung selbststartender Medien (WCAG 1.4.2, `media/audio-autoplay-measured`).
 *
 * Ob ein `<audio autoplay>` oder `<video autoplay>` tatsächlich läuft, ob es
 * stumm ist, wie lang es dauert und ob es überhaupt eine hörbare Tonspur hat,
 * beantwortet nur die laufende Seite. Die Messung wartet auf Metadaten und
 * Anlaufen und ist deshalb asynchron: Sie läuft **vor** dem synchronen
 * `scan()` (siehe `scanDocument`) und liefert Messwerte je Element. Die
 * Spaltenbildung (`mediaColumn`) ordnet sie danach den Knotenindizes der Arena zu.
 *
 * **Nicht gemessen ist nicht pausiert:** Ein Element, dessen Metadaten nicht
 * rechtzeitig kamen oder das noch auf Daten zum Starten wartet, fehlt in den
 * Messwerten. Es als „pausiert" zu melden ließe die Regel fälschlich bestehen.
 *
 * **Die Messung verändert die Seite nicht:** Es wird kein Knoten, kein
 * Attribut und kein Stil angefasst, das Medium wird weder gestartet noch
 * angehalten noch umgeleitet. Die Tonspur wird über `captureStream()` und einen
 * `AudioContext` abgehört, dessen Analyser **nicht** mit dem Ausgang
 * verbunden ist; `createMediaElementSource` bliebe aus, weil es den Ton des
 * Elements umleitet.
 */

/** Ein Messwert je Element: `1` ja, `0` nein, `-1` nicht bestimmt (außer `duration`). */
export interface MediaSample {
  paused: number;
  muted: number;
  /** Sekunden; `Infinity` für einen Datenstrom, `NaN` für nicht bestimmt. */
  duration: number;
  hasAudio: number;
}

export interface MediaColumn {
  nodes: Uint32Array;
  paused: Int8Array;
  muted: Int8Array;
  duration: Float64Array;
  hasAudio: Int8Array;
}

export interface MediaTimings {
  /** Wie lange insgesamt auf Metadaten gewartet wird. */
  metadataMs: number;
  /** Wie lange ein pausiertes Element zum Anlaufen bekommt. */
  startMs: number;
  /** Wie lange höchstens eine Tonspur abgehört wird. */
  listenMs: number;
}

export const MEDIA_TIMINGS: MediaTimings = { metadataMs: 3000, startMs: 500, listenMs: 1000 };

/** Pegel, ab dem eine Tonspur als hörbar gilt (dBFS). */
export const AUDIBLE_DBFS = -60;

const HAVE_METADATA = 1;
const HAVE_FUTURE_DATA = 3;

type MediaElement = HTMLMediaElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

/**
 * Alle `<audio autoplay>` und `<video autoplay>` unter `root`, auch in offenen
 * Shadow Roots und in lesbaren Rahmen. Liest nur.
 */
export function findAutoplayMedia(root: Element): HTMLMediaElement[] {
  const found: HTMLMediaElement[] = [];
  const seen = new Set<Document | ShadowRoot | Element>();
  const walk = (start: Document | ShadowRoot | Element): void => {
    if (seen.has(start)) return;
    seen.add(start);
    for (const el of start.querySelectorAll("audio[autoplay], video[autoplay]")) {
      found.push(el as HTMLMediaElement);
    }
    for (const el of start.querySelectorAll("*")) {
      if (el.shadowRoot !== null) walk(el.shadowRoot);
      if (el.localName === "iframe") {
        let doc: Document | null = null;
        try {
          doc = (el as HTMLIFrameElement).contentDocument;
        } catch {
          // Fremde Herkunft: nicht lesbar, wie bei den übrigen Spalten.
        }
        if (doc?.documentElement) walk(doc.documentElement);
      }
    }
  };
  walk(root);
  return found;
}

/** Wartet auf eines der Ereignisse oder das Ende der Frist; `fertig` beendet vorzeitig. */
function warte(
  el: EventTarget,
  ereignisse: readonly string[],
  ms: number,
  fertig: () => boolean,
): Promise<void> {
  if (fertig() || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const ende = (): void => {
      clearTimeout(timer);
      for (const e of ereignisse) el.removeEventListener(e, pruefe);
      resolve();
    };
    const pruefe = (): void => {
      if (fertig()) ende();
    };
    const timer = setTimeout(ende, ms);
    for (const e of ereignisse) el.addEventListener(e, pruefe);
  });
}

function dbfs(spitze: number): number {
  return spitze > 0 ? 20 * Math.log10(spitze) : Number.NEGATIVE_INFINITY;
}

type Kontext = AudioContext;

function kontextFuer(win: Window, kontexte: Map<Window, Kontext | null>): Kontext | null {
  const vorhanden = kontexte.get(win);
  if (vorhanden !== undefined) return vorhanden;
  const Klasse =
    (win as Window & { AudioContext?: typeof AudioContext }).AudioContext ??
    (win as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  let kontext: Kontext | null = null;
  if (typeof Klasse === "function") {
    try {
      kontext = new Klasse();
    } catch {
      kontext = null;
    }
  }
  kontexte.set(win, kontext);
  return kontext;
}

/**
 * Hat das Medium eine Tonspur, und ist sie hörbar? `0`: keine Tonspur. `1`: Pegel
 * über `AUDIBLE_DBFS` gehört. `-1`: nicht bestimmbar — fremde Herkunft, kein
 * `captureStream`, stumm geschaltet, angehalten oder Stille im Hörfenster (eine
 * stumme Tonspur ist nicht belegt).
 */
async function messeTonspur(
  el: MediaElement,
  kontexte: Map<Window, Kontext | null>,
  listenMs: number,
): Promise<number> {
  const erfasse = el.captureStream ?? el.mozCaptureStream;
  if (typeof erfasse !== "function") return -1;
  let strom: MediaStream;
  try {
    strom = erfasse.call(el);
  } catch {
    return -1; // fremde Herkunft (CORS) oder nicht erlaubt
  }
  const spuren = strom.getAudioTracks();
  if (spuren.length === 0) return 0;
  try {
    if (el.paused || el.muted || el.volume === 0) return -1;
    const win = el.ownerDocument.defaultView;
    if (win === null) return -1;
    const kontext = kontextFuer(win, kontexte);
    if (kontext === null) return -1;
    if (kontext.state === "suspended") await kontext.resume().catch(() => undefined);
    if (kontext.state !== "running") return -1;

    const quelle = kontext.createMediaStreamSource(new win.MediaStream(spuren));
    const analyse = kontext.createAnalyser();
    analyse.fftSize = 2048;
    // Bewusst nicht mit `kontext.destination` verbunden: Es soll nichts hörbar werden.
    quelle.connect(analyse);
    const puffer = new Float32Array(analyse.fftSize);
    try {
      const ende = performance.now() + listenMs;
      while (performance.now() < ende) {
        await new Promise((r) => setTimeout(r, 50));
        analyse.getFloatTimeDomainData(puffer);
        let spitze = 0;
        for (const wert of puffer) spitze = Math.max(spitze, Math.abs(wert));
        if (dbfs(spitze) > AUDIBLE_DBFS) return 1;
        if (el.paused) return -1;
      }
      return -1;
    } finally {
      quelle.disconnect();
    }
  } finally {
    for (const spur of spuren) spur.stop();
  }
}

/**
 * Misst jedes selbststartende Medium unter `root`. Fehlende Einträge heißen
 * „nicht gemessen". Die Fristen laufen für alle Elemente gemeinsam, nicht je
 * Element: Die Wartezeit ist insgesamt auf `metadataMs + startMs + listenMs`
 * begrenzt.
 */
export async function measureMedia(
  root: Element,
  timings: MediaTimings = MEDIA_TIMINGS,
): Promise<Map<Element, MediaSample>> {
  const medien = findAutoplayMedia(root);
  const ergebnis = new Map<Element, MediaSample>();
  if (medien.length === 0) return ergebnis;

  const beginn = performance.now();
  const kontexte = new Map<Window, Kontext | null>();
  try {
    await Promise.all(
      medien.map(async (el: MediaElement) => {
        await warte(
          el,
          ["loadedmetadata", "error"],
          timings.metadataMs - (performance.now() - beginn),
          () => el.readyState >= HAVE_METADATA || el.error !== null,
        );
        if (el.readyState < HAVE_METADATA) return;

        await warte(el, ["playing", "play"], timings.startMs, () => !el.paused);
        // Noch pausiert und ohne genug Daten: Es wartet noch, es ist nicht pausiert.
        if (el.paused && el.readyState < HAVE_FUTURE_DATA) return;

        const hatTon = await messeTonspur(el, kontexte, timings.listenMs);
        ergebnis.set(el, {
          paused: el.paused ? 1 : 0,
          muted: el.muted || el.volume === 0 ? 1 : 0,
          duration: el.duration,
          hasAudio: hatTon,
        });
      }),
    );
  } finally {
    for (const kontext of kontexte.values()) void kontext?.close().catch(() => undefined);
  }
  return ergebnis;
}

/**
 * Die Messwerte als Spalte der Arena: Knotenindizes streng aufsteigend. Ein Element
 * ohne Index (nicht im geprüften Teilbaum dieses Dokuments) fällt heraus.
 */
export function mediaColumn(
  samples: ReadonlyMap<Element, MediaSample>,
  elementToId: WeakMap<Element, number>,
): MediaColumn {
  const rows: { id: number; sample: MediaSample }[] = [];
  for (const [el, sample] of samples) {
    const id = elementToId.get(el);
    if (id !== undefined) rows.push({ id, sample });
  }
  rows.sort((a, b) => a.id - b.id);
  return {
    nodes: Uint32Array.from(rows, (r) => r.id),
    paused: Int8Array.from(rows, (r) => r.sample.paused),
    muted: Int8Array.from(rows, (r) => r.sample.muted),
    duration: Float64Array.from(rows, (r) => r.sample.duration),
    hasAudio: Int8Array.from(rows, (r) => r.sample.hasAudio),
  };
}

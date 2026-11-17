import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import {
  findAutoplayMedia,
  type MediaSample,
  type MediaTimings,
  measureMedia,
  mediaColumn,
} from "../src/media.ts";
import { scan } from "../src/scan.ts";
import { initWasm, parse } from "./helpers.ts";

before(() => initWasm());

const KURZ: MediaTimings = { metadataMs: 30, startMs: 20, listenMs: 20 };
const REGEL = "media/audio-autoplay-measured";

const probe = (s: Partial<MediaSample> = {}): MediaSample => ({
  paused: 0,
  muted: 0,
  duration: 10,
  hasAudio: 1,
  ...s,
});

/** Setzt, was jsdom an einem Medienelement nicht kennt. */
function stelle(el: Element, werte: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(werte)) {
    Object.defineProperty(el, k, { configurable: true, get: () => v });
  }
}

describe("Spaltenbildung", () => {
  it("ordnet streng aufsteigend, unabhängig von der Einfügereihenfolge", () => {
    const doc = parse('<audio id="a" autoplay></audio><audio id="b" autoplay></audio>');
    const a = doc.getElementById("a") as Element;
    const b = doc.getElementById("b") as Element;
    const ids = new WeakMap<Element, number>([
      [a, 3],
      [b, 7],
    ]);
    const samples = new Map<Element, MediaSample>([
      [b, probe({ duration: 4 })],
      [a, probe({ duration: 9 })],
    ]);
    const spalte = mediaColumn(samples, ids);
    assert.deepEqual([...spalte.nodes], [3, 7]);
    assert.deepEqual([...spalte.duration], [9, 4]);
  });

  it("behält Tri-State, NaN und Infinity", () => {
    const doc = parse('<audio id="a" autoplay></audio><video id="v" autoplay></video>');
    const a = doc.getElementById("a") as Element;
    const v = doc.getElementById("v") as Element;
    const ids = new WeakMap<Element, number>([
      [a, 1],
      [v, 2],
    ]);
    const spalte = mediaColumn(
      new Map([
        [a, probe({ paused: -1, muted: 1, duration: Number.NaN, hasAudio: -1 })],
        [v, probe({ paused: 0, muted: 0, duration: Number.POSITIVE_INFINITY, hasAudio: 0 })],
      ]),
      ids,
    );
    assert.deepEqual([...spalte.paused], [-1, 0]);
    assert.deepEqual([...spalte.muted], [1, 0]);
    assert.deepEqual([...spalte.hasAudio], [-1, 0]);
    assert.ok(Number.isNaN(spalte.duration[0]));
    assert.equal(spalte.duration[1], Number.POSITIVE_INFINITY);
    assert.ok(spalte.paused instanceof Int8Array && spalte.duration instanceof Float64Array);
  });

  it("lässt Elemente ohne Index aus und kennt die leere Spalte", () => {
    const doc = parse('<audio id="a" autoplay></audio>');
    const a = doc.getElementById("a") as Element;
    assert.equal(mediaColumn(new Map([[a, probe()]]), new WeakMap()).nodes.length, 0);
    assert.equal(mediaColumn(new Map(), new WeakMap()).nodes.length, 0);
  });
});

describe("Auffinden", () => {
  it("findet nur autoplay, auch in offenen Shadow Roots", () => {
    const doc = parse(
      '<audio id="x"></audio><audio id="a" autoplay></audio><div id="h"></div><video id="v" autoplay></video>',
    );
    const host = doc.getElementById("h") as Element;
    const wurzel = host.attachShadow({ mode: "open" });
    wurzel.innerHTML = '<audio id="s" autoplay></audio>';
    const ids = findAutoplayMedia(doc.documentElement).map((e) => e.id);
    assert.deepEqual(ids.sort(), ["a", "s", "v"]);
  });
});

describe("Messung", () => {
  it("lässt ein Medium ohne Metadaten weg", async () => {
    const doc = parse('<audio id="a" autoplay></audio>');
    const a = doc.getElementById("a") as Element;
    stelle(a, { readyState: 0, paused: true });
    assert.equal((await measureMedia(doc.documentElement, KURZ)).has(a), false);
  });

  it("meldet ein Medium, das noch auf Daten wartet, nicht als pausiert", async () => {
    const doc = parse('<audio id="a" autoplay></audio>');
    const a = doc.getElementById("a") as Element;
    stelle(a, { readyState: 1, paused: true, duration: 8 });
    assert.equal((await measureMedia(doc.documentElement, KURZ)).has(a), false);
  });

  it("meldet ein wirklich pausiertes Medium (genug Daten, nicht gestartet)", async () => {
    const doc = parse('<audio id="a" autoplay></audio>');
    const a = doc.getElementById("a") as Element;
    stelle(a, { readyState: 4, paused: true, muted: false, volume: 1, duration: 8 });
    const m = (await measureMedia(doc.documentElement, KURZ)).get(a);
    assert.equal(m?.paused, 1);
    assert.equal(m?.hasAudio, -1); // kein captureStream in jsdom: nicht bestimmt
    assert.equal(m?.duration, 8);
  });

  it("hält Strom und unbekannte Dauer fest und erkennt Stummschaltung", async () => {
    const doc = parse('<video id="v" autoplay></video>');
    const v = doc.getElementById("v") as Element;
    stelle(v, {
      readyState: 4,
      paused: false,
      muted: true,
      volume: 1,
      duration: Number.POSITIVE_INFINITY,
    });
    const m = (await measureMedia(doc.documentElement, KURZ)).get(v);
    assert.equal(m?.paused, 0);
    assert.equal(m?.muted, 1);
    assert.equal(m?.duration, Number.POSITIVE_INFINITY);
  });

  it("meldet 0 ohne Tonspur und -1, wenn captureStream wirft", async () => {
    const doc = parse('<video id="a" autoplay></video><video id="b" autoplay></video>');
    const a = doc.getElementById("a") as Element;
    const b = doc.getElementById("b") as Element;
    for (const el of [a, b])
      stelle(el, { readyState: 4, paused: false, muted: false, volume: 1, duration: 9 });
    (a as unknown as { captureStream: () => unknown }).captureStream = () => ({
      getAudioTracks: () => [],
    });
    (b as unknown as { captureStream: () => unknown }).captureStream = () => {
      throw new Error("SecurityError");
    };
    const m = await measureMedia(doc.documentElement, KURZ);
    assert.equal(m.get(a)?.hasAudio, 0);
    assert.equal(m.get(b)?.hasAudio, -1);
  });

  it("ohne Medien kommt eine leere Menge zurück, ohne zu warten", async () => {
    const doc = parse("<p>nichts</p>");
    const t = performance.now();
    assert.equal((await measureMedia(doc.documentElement)).size, 0);
    assert.ok(performance.now() - t < 100);
  });
});

describe("Scan mit Messwerten", () => {
  const ruleRun = (r: { rule_runs: { rule_id: string; not_run?: string }[] }) =>
    r.rule_runs.find((x) => x.rule_id === REGEL);
  const medienBefunde = (r: { findings: { rule_id: string }[] }) =>
    r.findings.filter((f) => f.rule_id === REGEL);

  it("ohne Messwerte bleibt die Regel nicht gelaufen", () => {
    const doc = parse('<main><audio id="a" autoplay></audio></main>');
    const r = scan(doc.documentElement, { rendering: true, probes: ["media"] });
    assert.equal(ruleRun(r.documents[0]?.report as never)?.not_run, "capability_missing");
    assert.equal(r.documents[0]?.probes?.columns.media, undefined);
  });

  it("hörbar, lang, ohne Bedienung: Befund; mit controls oder muted: keiner", () => {
    const doc = parse(
      '<main><audio id="a" autoplay></audio><audio id="b" autoplay controls></audio><audio id="c" autoplay muted></audio></main>',
    );
    const media = new Map<Element, MediaSample>();
    for (const id of ["a", "b"]) media.set(doc.getElementById(id) as Element, probe());
    media.set(doc.getElementById("c") as Element, probe({ muted: 1, hasAudio: -1 }));
    const r = scan(doc.documentElement, { rendering: true, probes: ["media"], media });
    const dok = r.documents[0];
    assert.equal(dok?.probes?.columns.media, 3);
    const report = dok?.report as never as Parameters<typeof medienBefunde>[0] &
      Parameters<typeof ruleRun>[0];
    assert.equal(ruleRun(report)?.not_run, undefined);
    const befunde = medienBefunde(report) as unknown as {
      location: { node: string };
      outcome: string;
    }[];
    assert.equal(befunde.length, 1);
    const a = doc.getElementById("a") as Element;
    assert.equal(dok?.idToElement.get(Number(befunde[0]?.location.node)), a);
    assert.equal(befunde[0]?.outcome, "fail");
  });

  it("ohne selbststartende Medien läuft die Regel ohne Befund", () => {
    const doc = parse("<main><p>Text</p></main>");
    const r = scan(doc.documentElement, { rendering: true, probes: ["media"], media: new Map() });
    const report = r.documents[0]?.report as never as Parameters<typeof ruleRun>[0] &
      Parameters<typeof medienBefunde>[0];
    assert.equal(ruleRun(report)?.not_run, undefined);
    assert.equal(medienBefunde(report).length, 0);
    assert.equal(r.documents[0]?.probes?.columns.media, 0);
  });

  it("ein Medium ohne Messwert steht als ungemessen im Bericht", () => {
    const doc = parse('<main><audio id="a" autoplay></audio></main>');
    const r = scan(doc.documentElement, { rendering: true, probes: ["media"], media: new Map() });
    assert.deepEqual(r.documents[0]?.probes?.skipped, [
      { probe: "media", reason: "unmeasured", count: 1 },
    ]);
  });
});

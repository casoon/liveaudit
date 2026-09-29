import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  categorize,
  cumulativeLayoutShift,
  measureWeight,
  type ResourceLike,
  sizeKnown,
} from "../src/weight.ts";
import { parse } from "./helpers.ts";

function eintrag(name: string, rest: Partial<ResourceLike> = {}): ResourceLike {
  return {
    name,
    initiatorType: "other",
    encodedBodySize: 1000,
    decodedBodySize: 3000,
    transferSize: 1300,
    ...rest,
  };
}

describe("Einordnung einer Anfrage", () => {
  it("nimmt den Content-Type vor der Endung", () => {
    assert.equal(categorize(eintrag("https://a.test/x", { contentType: "text/css" })), "css");
    assert.equal(
      categorize(eintrag("https://a.test/bild.php", { contentType: "image/webp" })),
      "images",
    );
  });

  it("fällt auf die Endung zurück, dann auf den Anlass", () => {
    assert.equal(categorize(eintrag("https://a.test/app.mjs?v=3")), "js");
    assert.equal(categorize(eintrag("https://a.test/font.woff2")), "fonts");
    assert.equal(categorize(eintrag("https://a.test/modul.wasm")), "js");
    assert.equal(
      categorize(eintrag("https://a.test/api/daten", { initiatorType: "fetch" })),
      "other",
    );
    assert.equal(
      categorize(eintrag("https://a.test/ohne-endung", { initiatorType: "img" })),
      "images",
    );
  });

  it("wertet drei Nullen als unbekannte Größe, nicht als leere Datei", () => {
    assert.equal(
      sizeKnown(
        eintrag("https://cdn.test/x.js", {
          encodedBodySize: 0,
          decodedBodySize: 0,
          transferSize: 0,
        }),
      ),
      false,
    );
    // Aus dem Cache: nichts übertragen, die Größe ist trotzdem bekannt.
    assert.equal(sizeKnown(eintrag("https://a.test/x.js", { transferSize: 0 })), true);
  });
});

describe("Cumulative Layout Shift", () => {
  it("bündelt in Sitzungsfenster und nimmt das schwerste", () => {
    const cls = cumulativeLayoutShift([
      { startTime: 100, value: 0.05, hadRecentInput: false },
      { startTime: 600, value: 0.05, hadRecentInput: false },
      // Mehr als eine Sekunde später: neues Fenster.
      { startTime: 3000, value: 0.02, hadRecentInput: false },
    ]);
    assert.equal(cls.toFixed(3), "0.100");
  });

  it("zählt Verschiebungen nach einer Eingabe nicht mit", () => {
    assert.equal(cumulativeLayoutShift([{ startTime: 100, value: 0.3, hadRecentInput: true }]), 0);
  });
});

describe("Seitengewicht einer Seite", () => {
  /** Ein Fenster mit festen Messwerten; ohne PerformanceObserver wie in Firefox. */
  function fenster(ressourcen: ResourceLike[]): Window {
    const doc = parse(`<!doctype html><html><head>
      <style>body{color:red}</style>
      <script type="application/ld+json">{"@type":"Thing"}</script>
      <script>console.log(1)</script>
    </head><body></body></html>`);
    const nav = {
      name: "https://seite.test/",
      initiatorType: "navigation",
      encodedBodySize: 5000,
      decodedBodySize: 20000,
      transferSize: 5300,
      startTime: 0,
      responseStart: 120,
      domContentLoadedEventEnd: 400,
      loadEventEnd: 900,
    };
    return {
      document: doc,
      location: { origin: "https://seite.test" },
      performance: {
        getEntriesByType: (typ: string) =>
          typ === "navigation" ? [nav] : typ === "resource" ? ressourcen : [],
      },
    } as unknown as Window;
  }

  it("zählt nach Kategorien, weist Unbekanntes und Fremdes aus und lässt Eigenes weg", () => {
    const gewicht = measureWeight(
      fenster([
        eintrag("https://seite.test/style.css", { initiatorType: "link" }),
        eintrag("https://seite.test/bild.png", { initiatorType: "img", encodedBodySize: 4000 }),
        eintrag("https://cdn.test/lib.js", {
          initiatorType: "script",
          encodedBodySize: 0,
          decodedBodySize: 0,
          transferSize: 0,
        }),
        eintrag("https://seite.test/vendor/liveaudit/inspector.js", { initiatorType: "script" }),
      ]),
      ["https://seite.test/vendor/liveaudit/inspector.js"],
    );

    assert.equal(gewicht.buckets.html.bytes, 5000);
    assert.equal(gewicht.buckets.css.requests, 1);
    assert.equal(gewicht.buckets.images.bytes, 4000);
    assert.deepEqual(gewicht.buckets.js, { requests: 1, bytes: 0, unknown: 1 });
    assert.deepEqual(gewicht.total, { requests: 4, bytes: 10000, unknown: 1 });
    assert.deepEqual(gewicht.thirdParty, { requests: 1, bytes: 0, unknown: 1 });
    assert.equal(gewicht.excluded, 1);
    assert.equal(gewicht.bufferFull, false);
  });

  it("misst Inline-CSS und ausgeführtes Inline-JS, nicht JSON-LD", () => {
    const gewicht = measureWeight(fenster([]));
    assert.equal(gewicht.inline.css, "body{color:red}".length);
    assert.equal(gewicht.inline.js, "console.log(1)".length);
  });

  it("gibt Zeiten an, die gemessen sind, und lässt LCP und CLS offen, wo der Browser sie nicht misst", () => {
    const { timings } = measureWeight(fenster([]));
    assert.equal(timings.ttfb, 120);
    assert.equal(timings.domContentLoaded, 400);
    assert.equal(timings.load, 900);
    assert.equal(timings.lcp, undefined);
    assert.equal(timings.cls, undefined);
  });
});

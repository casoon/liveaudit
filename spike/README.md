# Performance-Spike — Arena-Aufbau

Messaufbau des Performance-Spikes. Ergebnis: [ERGEBNIS.md](ERGEBNIS.md).

## Aufbau

```
spike/
├── corpus/          reale HTML-Dokumente, 1.2k bis 724k Nodes (nicht committet)
├── core/            Rust: Arena + 20 Tier-1-Regeln -> WASM
└── harness/
    ├── collect.js   Tier-1-Collector, naive Fassung
    ├── collect2.js  Tier-1-Collector, optimiert
    ├── rules-js.js  dieselben 20 Regeln idiomatisch in JS ueber den DOM
    ├── bench.js     Messung und Ausgabe
    └── index.html
```

Die Rust-Seite bietet zwei Aufbauwege fuer dieselbe Arena: `build_flat`
(spaltenweise Typed Arrays + ein UTF-8-Blob) und `build_json` (JSON-String, als
Vergleichsmassstab).

## Korpus beschaffen

Der Korpus ist nicht committet (siehe `.gitignore`). Neu holen:

```bash
cd spike/corpus
curl -sL "https://wordpress.org/news/"                               -o wordpress-news.html
curl -sL "https://developer.mozilla.org/en-US/docs/Web/API/Document" -o mdn-document.html
curl -sL "https://html.spec.whatwg.org/multipage/parsing.html"       -o whatwg-parsing.html
curl -sL "https://tc39.es/ecma262/"                                  -o tc39-ecma262.html
curl -sL "https://html.spec.whatwg.org/"                             -o whatwg-full.html
```

## Messung ausfuehren

```bash
cd spike/core && wasm-pack build --release --target web --out-dir ../harness/pkg
```

Danach das Repo-Wurzelverzeichnis statisch ausliefern und
`/spike/harness/` oeffnen (mit abschliessendem Schraegstrich — sonst greifen die
relativen Pfade auf `pkg/` und `../corpus/` daneben). Die Ergebnisse stehen
anschliessend auch als `window.__RESULTS__` bereit.

## Was der Spike nicht misst

Tier 3 (`getComputedStyle`, `getBoundingClientRect`), andere Browser als
Chromium, und gerenderte Live-Seiten statt `DOMParser`-Dokumente.

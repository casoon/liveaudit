# Build Plan — LiveAudit

Was zu bauen ist, in Reihenfolge, mit Abnahmekriterien. Dieses Dokument ist der
Auftragszettel: Es setzt nur voraus, was in diesem Repository und in den
veröffentlichten Crates steht — keine Vorgeschichte.

**Vorher lesen:** [project-state.md](project-state.md) (Stand),
[architecture.md](architecture.md) (Arena, Tiers, Paketstruktur),
[decisions.md](decisions.md) (warum es so ist),
[constraints.md](constraints.md) (was das Werkzeug nicht kann),
[../spike/ERGEBNIS.md](../spike/ERGEBNIS.md) (gemessene Zahlen).

## Was schon da ist

`spike/` enthält eine lauffähige Vorstufe: einen Tier-1-Collector in zwei
Fassungen (`collect.js` naiv, `collect2.js` optimiert), 20 Regeln in Rust, eine
Arena und einen Messharness. **`spike/harness/collect2.js` ist die Vorlage für
`packages/browser`** — nicht die naive Fassung. Der Spike selbst wird nicht
weiterentwickelt; er bleibt als Beleg der Messung stehen.

Der Regelbestand kommt fertig aus
[a11y-core](https://github.com/casoon/a11y-core). Regeln werden in diesem
Repository **nicht** neu geschrieben. Fehlt eine Regel, gehört sie nach
`a11y-rules`, nicht hierher.

---

## 1 — Monorepo-Grundgerüst

**Ziel:** Ein Build, der aus Rust und TypeScript `dist/inspector.js` und
`dist/inspector_bg.wasm` erzeugt.

```
packages/
├── core/     Rust → WASM (wasm-pack, target web)
├── browser/  TypeScript: DOM Collector
└── ui/       TypeScript + CSS: Inspector-Layer
```

- `packages/core` bindet `a11y-dom`, `a11y-rules`, `accname`, `a11y-report`
  als Versions-Abhängigkeiten von crates.io ein (alle `0.1.0`).
- Node ≥ 22, pnpm-Workspace. Biome für Lint und Format (kein ESLint, kein
  Prettier) — wie in den übrigen CASOON-Repositories.
- `packages/ui` hat **keine** Laufzeit-Abhängigkeit auf ein Framework. Das UI ist
  eigenes DOM im Shadow Root; eine Framework-Runtime im Bundle wäre gegen das
  Bundle-Budget.

**Abnahme:** `pnpm build` erzeugt beide Artefakte. `pnpm test` läuft. Ein
HTML-Beispiel bindet `dist/inspector.js` per `<script type="module">` ein und
lädt ohne Konsolenfehler.

---

## 2 — DOM Collector (`packages/browser`)

**Ziel:** Aus dem Live-DOM eine Arena erzeugen, über der `packages/core`
`a11y_dom::Node` implementiert. Datenformat und Begründung:
[architecture.md](architecture.md#datenmodell-die-arena).

**Ausgangspunkt:** `spike/harness/collect2.js` portieren und typisieren.
Dessen Optimierungen sind gemessen und gehören übernommen: vordimensionierte
Typed Arrays über eine `TreeWalker`-Zählung, `encodeInto` in einen wachsenden
Puffer statt `encode()` je String, keine Array-Allokation pro Knoten,
Objekt ohne Prototyp statt `Map` für die Namens-Dictionaries.

**Element-Identität:** `WeakMap<Element, NodeId>` plus `Map<NodeId, Element>` im
Speicher des Adapters. **Keine Attribute in den geprüften DOM schreiben** — siehe
[decisions.md](decisions.md), „Keine Mutation innerhalb des geprüften Teilbaums".

**Tier 2:** Rolle und Accessible Name berechnet `accname` in Rust über der Arena,
nicht JavaScript. In-Page-JS kommt nicht an den nativen Accessibility-Tree;
`getComputedRole`/`getComputedLabel` sind WebDriver-Befehle.

**Offene Fragen, die beim Bau zu entscheiden sind:**

- **Shadow DOM der geprüften Seite.** Eine flache Eltern-Kind-Beziehung bildet
  fremde Shadow Roots und `<slot>` nicht ab. Für Komponentenbibliotheken ist das
  V1-blockend. Zu klären: Wie tief traversiert der Collector, und wie wird die
  Zuordnung im Findings-Rückbezug dargestellt?
- **iframes.** Same-Origin ist erreichbar, Cross-Origin prinzipiell nicht.
  Cross-Origin muss ein `UNTESTED` erzeugen, nicht stillschweigend fehlen.
- **Ausschluss des eigenen Layers.** Der Host `<liveaudit-inspector>` darf nicht
  im Scan landen.

**Abnahme:** Auf den fünf Dokumenten in `spike/corpus/` (Beschaffung siehe
`spike/README.md`) erzeugt der Collector eine Arena, deren Knotenzahl mit einem
`TreeWalker`-Zähllauf übereinstimmt. Laufzeit bei 31.000 Knoten in derselben
Größenordnung wie im Spike gemessen (≈ 79 ms); eine deutliche Verschlechterung
ist ein Fehler, kein Ergebnis.

---

## 3 — Rule Engine anbinden (`packages/core`)

**Ziel:** `a11y-rules` über der Arena laufen lassen und `Finding[]` nach
TypeScript zurückgeben.

- `impl a11y_dom::Document` und `impl a11y_dom::Node` über die Arena.
- `impl a11y_dom::Semantics` mit `accname::name`, `accname::role`. Der
  `accname::IdIndex` wird **einmal je Scan** gebaut und gehalten, nicht je Knoten
   — sonst wird die Namensauflösung quadratisch.
- Einstieg: `a11y_rules::run_with_semantics(&arena)`.
- Findings tragen `location.node` als Arena-Index. TypeScript löst darüber auf
  das reale Element auf.

**Regeln oberhalb des verfügbaren Tiers liefern `UNTESTED`, nicht `PASS`.** Das
ist keine Formalie, sondern der fachliche Kern gegenüber Score-Werkzeugen.

**Abnahme:** Ein Dokument mit bekannten Fehlern erzeugt exakt die erwarteten
Rule-IDs. Dieselben IDs wie in astro-post-audit und auditmysite — bei
Abweichungen ist die Abweichung der Fehler.

---

## 4 — Inspector-Layer (`packages/ui`)

**Ziel:** Befunde auf der Seite sichtbar machen, ohne den geprüften Teilbaum zu
verändern. Details: [architecture.md](architecture.md#visualisierung).

**Begriff:** „Inspector-Layer", nicht „Overlay". „Overlay" bezeichnet eine
Kategorie von Werkzeugen, die die Seite zu *reparieren* vorgeben. README und UI
tragen den expliziten Satz: **prüft, repariert nicht.**

**Harte Vorgaben aus [decisions.md](decisions.md):**

- Genau **ein** Host `<liveaudit-inspector>`, letztes Kind von `<body>`, eigener
  Shadow Root.
- `position: fixed`, `pointer-events: none` als Default. Nur Marker und Panel
  setzen `pointer-events: auto`. Damit verändert der Layer weder Layout noch
  Scrollhöhe und fängt keine Klicks ab, die der Seite gelten.
- Vor `elementFromPoint()`-Messungen den Host ausblenden, oder
  `elementsFromPoint()` nutzen und den Host filtern.
- Zustand und Schweregrad **immer getrennt** anzeigen, nie zu einem Prozentwert
  verrechnet. `UNTESTED` als eigene Kategorie sichtbar, nicht weggefiltert.
- `PASS` intern führen, standardmäßig nicht anzeigen.

Vier Darstellungsvarianten: Rahmen für größere Elemente, Marker plus Popover für
kleine, Seitenleiste mit Gruppierung, und — später — nummerierte Marker über der
Tabreihenfolge.

**Abnahme:** Der Layer verändert auf einer Testseite weder `document.body`
noch die Scrollhöhe noch das Ergebnis von `getBoundingClientRect()` für ein
beliebiges Element der Seite. Ein Klick neben einen Marker erreicht die Seite.

---

## 5 — Auslieferungsmodell

Muss geklärt sein, **bevor** jemand das Script auf einer fremden Seite einbindet.
Im Ursprungskonzept kommt davon nichts vor.

- **CSP.** WASM-Instanziierung braucht in Chrome `wasm-unsafe-eval` in
  `script-src`. Bei strikter CSP scheitert das Tool — und zwar nicht
  offensichtlich. Nötig: Feature-Detection mit klarer Fehlermeldung statt stiller
  Nichtfunktion, plus eine dokumentierte CSP-Zeile für Anwender.
- **Supply Chain.** Ein gehostetes Script macht die ausliefernde Domain zur
  Abhängigkeit jeder Kundenseite. Self-Hosting als Default anbieten, npm-Paket
  statt CDN, SRI-Hash. CDN nicht als einzigen Weg.
- **Gating.** Wer darf den Inspector sehen? Ein an Endnutzer ausgelieferter
  Scanner ist Ballast. Optionen: nur auf Nicht-Produktions-Hosts, hinter
  Query-Parameter oder `localStorage`-Flag, oder ausschließlich als
  Dev-Dependency.
- **Bundle-Budget.** Zielwert festlegen und im Build erzwingen. Ausgangslage aus
  dem Spike: Arena plus 20 Regeln = **22 KB gzip** (48 KB roh) plus 11 KB
  JS-Glue. Der volle Regelbestand und das UI kommen dazu.
- **Lazy Loading.** WASM erst laden, wenn der Inspector geöffnet wird, nicht beim
  Seitenaufbau.

---

## Danach

Nicht Teil des ersten Durchgangs, aber die Reihenfolge steht:

- **Tier 3 ist gemessen** (20.09.2026, siehe
  [project-state.md](project-state.md)): mit Merkliste für den effektiven
  Hintergrund kostet es das 1,9- bis 4,6-fache des Collectors, ohne sie bis zum
  8,4-fachen davon allein. Die Merkliste ist damit Bedingung, nicht Kür.
  `getComputedStyle()` kostet pro Aufruf, nicht pro Layout — der Hebel ist die
  Zahl der Aufrufe.
- **Live-Modus.** `MutationObserver`, debounced (200 ms), Re-Scan
  **ausschließlich geänderter Teilbäume**, nie des ganzen Dokuments. Bei 79 ms
  pro Vollscan wäre ein Scan-Sturm sofort spürbar.
- **Kontrast, Fokusreihenfolge, Zielgrößen, Reflow, Medien-Prüfliste.** Die
  Regeln dafür existieren in `auditmysite` und wandern nach `a11y-rules`, sobald
  die Tier-3- und Tier-4-Traits dort bedient werden.
- **Konformitäts-Korpus.** Ein geteilter Fixture-Satz, der in allen drei
  Repositories gegen den jeweils eigenen Adapter läuft. Gepinnte Crate-Versionen
  halten den Code synchron, fangen aber nicht den wahrscheinlichsten Fehler:
  „Regel feuert in der CLI, aber nicht in-page" ist ein *Adapter*-Bug.

## Was ausdrücklich nicht in dieses Repository gehört

- **Regeln.** Die gehören nach `a11y-rules`.
- **Ein CLI.** Diese Rolle füllt `auditmysite`.
- **Build-/Quellcode-Analyse.** Die gehört zu `astro-post-audit`.
- **Alles, was den nativen Accessibility-Tree braucht** — Screenreader-
  Linearisierung, `name_source`, `ignored_reasons`. In-Page nicht erreichbar,
  bleibt bei `auditmysite`.
- **Seitenübergreifendes** — Crawl, Sitemap, hreflang, Redirects. LiveAudit ist
  naturgemäß Eine-Seite-zur-Zeit.

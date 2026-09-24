# Project State — LiveAudit

## Zweck

LiveAudit ist ein eingebetteter Accessibility Inspector für beliebige Webseiten
(WordPress, Astro, React, Vue, PHP, statisches HTML). Er wird selbst gehostet
und per Script-Tag eingebunden:

```html
<script type="module" src="/vendor/liveaudit/inspector.js"></script>
```

Das Script lädt die WASM-Analyse-Engine selbst nach und zeigt Befunde direkt auf
der untersuchten Seite an (Inspector-Layer), statt einen externen Report zu
erzeugen — das ist der Unterschied zu Lighthouse/klassischen Scan-Reports.

## Status (23.09.2026)

**LiveAudit ist veröffentlicht.** Das Repository liegt öffentlich unter
[github.com/casoon/liveaudit](https://github.com/casoon/liveaudit) unter MIT, die
Projektseite läuft auf <https://casoon.github.io/liveaudit/>. Ein npm-Paket gibt
es noch nicht; wer es einbinden will, baut die beiden Dateien selbst.

**LiveAudit ist lauffähig und auslieferbar.** Alle fünf Schritte aus
[build-plan.md](build-plan.md) sind gebaut: `pnpm build` erzeugt
`dist/inspector.js` und `dist/a11y_wasm_bg.wasm`, `LiveAudit.scan()` liefert
`Finding[]` mit den Rule-IDs aus `a11y-rules`, `LiveAudit.show()` legt den
Inspector-Layer über die Seite — Rahmen, Marker mit Popover und eine
Seitenleiste —, und ohne ausdrückliche Freischaltung ist das Script inert.
`examples/inspector.html` zeigt den Layer, `examples/csp.html` den CSP-Pfad.

**Die sichtbaren Texte sind englisch** — die des Layers ebenso wie die
Befundtexte aus `a11y-rules` seit 0.11.0. Code, Kommentare und diese Doku bleiben
deutsch; die Regel steht in [decisions.md](decisions.md).

Die Beispielseiten rufen **`enable()`** und umgehen das Flag damit bewusst —
sie sind der programmgesteuerte Fall aus [decisions.md](decisions.md). Ein
Script-Tag auf `dist/inspector.js` allein legt kein globales `LiveAudit` an;
wer sich darauf verlässt, bekommt einen `ReferenceError` statt einer Erklärung.

| | Stand |
|---|---|
| Konzept und Architekturentscheidungen | fertig, siehe [decisions.md](decisions.md) |
| Performance-Messung | fertig, siehe [../spike/ERGEBNIS.md](../spike/ERGEBNIS.md) |
| Gemeinsamer Kern in barrierlab | **veröffentlicht**, vier `a11y-*`-Crates auf crates.io, 0.11.0 mit englischen Befundtexten |
| Schritt 1 — Monorepo-Grundgerüst | **fertig** |
| Schritt 2 — `packages/browser` (DOM Collector) | **fertig** |
| Schritt 3 — WASM-Schicht (Rule Engine angebunden) | **fertig**, seit 23.09.2026 als `@casoon/a11y-wasm` ausgelagert |
| Schritt 4 — `packages/ui` (Inspector-Layer) | **fertig** |
| Schritt 5 — Auslieferungsmodell | **fertig** |
| Veröffentlichung | **fertig** — öffentliches Repository, Projektseite live |

## Was gebaut ist

```
packages/
├── browser/    TypeScript: DOM Collector, Scan-Treiber, Element-Identität
├── ui/         TypeScript + CSS: Inspector-Layer im Shadow Root
└── liveaudit/  Einstiegspaket: globale API, Bundler-Einstieg
```

Die WASM-Schicht liegt nicht mehr hier: `@casoon/a11y-wasm` bringt Arena-Adapter
und Regel-Engine als fertiges Artefakt mit, dieses Repository baut kein Rust.

Die Abhängigkeiten laufen in eine Richtung: `liveaudit → ui → browser → core`.
Das Einstiegspaket ist bewusst getrennt — läge die öffentliche API in
`browser`, entstünde ein Zyklus, weil sie `show()`/`hide()` aus `ui` braucht,
während `ui` seinerseits auf `browser` aufbaut.

- **`@casoon/a11y-wasm`** (externes Paket, Quelle in
  [barrierlab](https://github.com/casoon/barrierlab)) enthält **keine eigenen
  Regeln**. Es implementiert
  `a11y_dom::Document`/`Node` über der spaltenweisen Arena und
  `a11y_dom::Semantics` über `accname`. Einstieg ist
  `a11y_rules::run_with_semantics`; der `accname::IdIndex` entsteht **einmal je
  Scan** in `SemanticArena`, nicht je Knoten.
- **`packages/browser`** portiert `spike/harness/collect2.js` nach TypeScript und
  ergänzt die drei in [decisions.md](decisions.md) entschiedenen Punkte: offene
  Shadow Roots als flacher Baum, iframes als eigene Scans, Ausschluss des Hosts
  `<liveaudit-inspector>`.
- **`packages/liveaudit`** bündelt beides zur öffentlichen API: `init()`,
  `scan()`, `show()`, `hide()`, `isVisible()`, plus das globale `LiveAudit`-
  Objekt. Hierauf zeigt der Bundler.
- **`packages/ui`** baut den Inspector-Layer in genau einem Host
  `<liveaudit-inspector>` als letztes Kind von `<body>`, mit eigenem Shadow Root,
  `position: fixed` und `pointer-events: none`. Drei Darstellungsvarianten:
  Rahmen für Elemente ab 34 × 18 px, Marker plus Popover für jeden Befund,
  Seitenleiste mit Gruppierung nach dem Präfix der Rule-ID. Die vierte Variante
  (Fokusreihenfolge) braucht Tier 4 und ist nicht gebaut. Kein Framework zur
  Laufzeit — eigenes DOM im Shadow Root.

  **Die Seitenleiste dockt an jede der vier Kanten an** und ist in der Größe
  verstellbar; beides wird in `localStorage` gemerkt. Welche Kante frei ist,
  weiß nur der Prüfende: Eine Seite mit fixierter Kopfzeile verträgt kein
  Andocken oben, eine mit rechter Sidebar keines rechts. Quer angedockt
  verteilt sich die Liste über ein Grid statt über CSS-Spalten — Spalten
  fließen bei fester Höhe zur Seite und erzwängen waagerechtes Scrollen durch
  eine Befundliste.

  Der Ziehgriff ist `role="separator"` mit `tabindex` und reagiert auf
  Pfeiltasten. Ein Griff, der nur auf Ziehen reagiert, wäre in einem
  Prüfwerkzeug für Barrierefreiheit ein eigener Befund.

  Die Marker weichen der Leiste an **jeder** Kante aus, nicht nur rechts: ein
  fokussierbares, aber verdecktes Bedienelement wäre selbst ein Befund.
- **Element-Identität** läuft über `WeakMap<Element, NodeId>` plus
  `Map<NodeId, Element>`. In den geprüften Teilbaum wird nichts geschrieben —
  auch nicht vom Layer, der ausschließlich über `getBoundingClientRect()`
  positioniert.

Die öffentliche API ist `LiveAudit.init()`, `scan()`, `show()`, `dock()`,
`hide()` und `isVisible()`. `show(root, { rendering, dock })` schaltet den
Tier-3-Durchgang ein und wählt die Kante; `dock(seite)` wechselt sie ohne neuen
Scan.

Eine Einschränkung, die zum Andocken gehört: Eine angedockte Leiste liegt über
dem Seiteninhalt an dieser Kante und fängt dort Klicks ab. Das ist kein Fehler,
sondern der Preis dafür, dass sie bedienbar ist — deshalb vier Kanten zur
Wahl.

## Gemessen (18.09.2026, Chromium, Apple Silicon)

Collector über `spike/corpus/`, Median aus fünf Läufen nach einem Warmlauf —
dasselbe Vorgehen wie im Spike. Reproduzierbar über `examples/bench.html`.

| Seite | Knoten | TreeWalker | LiveAudit | `collect2.js` | ERGEBNIS.md |
|---|---:|---:|---:|---:|---:|
| wordpress-news | 1.244 | ✓ | 6,8 | 4,2 | 4 |
| mdn-document | 5.378 | ✓ | 3,4 | 2,7 | 16 |
| whatwg-parsing | 31.026 | ✓ | **18,9** | 13,3 | 79 |
| tc39-ecma262 | 419.252 | ✓ | 264,2 | 235,9 | 274 |
| whatwg-full | 723.613 | ✓ | 509,3 | 424,2 | 466 |

Die Knotenzahl der Arena stimmt auf allen fünf Dokumenten **exakt** mit einem
`TreeWalker`-Zähllauf überein.

Zwei Lesarten sind wichtig:

- **Gegen die Vorlage gemessen, nicht gegen die Tabelle.** Die Zahlen aus
  `ERGEBNIS.md` stammen von einem anderen Lauf; derselbe `collect2.js` ist heute
  auf dieser Maschine deutlich schneller. Aussagekräftig ist der Vergleich
  LiveAudit gegen `collect2.js` im selben Browser: **rund 1,3–1,4×**. Das ist der
  Preis für die Identitätszuordnung je Element und die Verzweigungen für Shadow
  DOM, Frames und Host-Ausschluss — Funktionalität, die der Spike nicht hatte.
- **Bei 31.000 Knoten liegt der Collector bei 18,9 ms** gegen die 79 ms, an denen
  er zu messen war. Keine Verschlechterung.

Eine Warnung aus dem Bau: Der Parent-Stack **muss** ein `Int32Array` bleiben. Ein
gewöhnliches `Array` an dieser Stelle kostete bei 723.000 Knoten das Fünffache
(2.451 ms statt 509 ms). Die Optimierungen aus `collect2.js` sind gemessen und
nicht verhandelbar.

## Der Inspector-Layer, gemessen (18.09.2026, Chromium)

Die harten Vorgaben aus [decisions.md](decisions.md) sind messbar. Gemessen
über `examples/inspector.html` (30 Elemente im Prüfbereich, 16 Befunde), jeweils
unmittelbar vor und nach `LiveAudit.show()` im selben Lauf:

| Kriterium | vorher | nachher |
|---|---:|---:|
| Attribute und Klassen an `<body>` | unverändert | unverändert |
| Kinder von `<body>` | 8 | 9 (der Host) |
| `documentElement.scrollHeight` | 2.457 | 2.457 |
| Markup des Prüfbereichs | identisch | identisch |
| `getBoundingClientRect()` verschoben | — | **0 von 30** |

Dazu: `document.elementFromPoint()` auf einer Schaltfläche der Seite liefert bei
offenem Layer die Schaltfläche, nicht den Layer; ein echter Klick daneben zählt
auf der Seite hoch. Genau ein Host im Dokument, letztes Kind von `<body>`,
`position: fixed`, `pointer-events: none`. Nach `hide()` ist kein Host mehr im
Dokument.

**Selbsttest.** Der Layer, mit dem eigenen Scanner über seinen Shadow Root
geprüft, lieferte zuerst drei Befunde. Einer war echt: `aria/reference-missing`
— das Popover trug `aria-labelledby` auf eine Überschrift, die es erst nach dem
Öffnen gibt. Behoben; die Referenz wird jetzt beim Öffnen gesetzt und beim
Schließen entfernt.

Mit `a11y-rules` 0.8.0 sind es acht Befunde über 560 Knoten — und **alle acht
sind dokumentweite Regeln auf einem Fragment**: `document/title-missing`,
`zoom/viewport-missing`, `headings/h1-missing`, die vier `landmarks/*` und
`keyboard/skip-link-missing`. Der Layer ist kein Dokument. Eine `<h1>` im Shadow
Root würde in der Seite mit deren eigener konkurrieren, die Panel-Überschrift
bleibt deshalb `<h2>`.

Entscheidend ist, was **nicht** darunter ist: kein einziger Befund an einem
Element. Andockschaltflächen, Ziehgriff und Kopfleiste tragen alle einen Namen.

## Was Tier 3 kostet (20.09.2026, Chromium, Apple Silicon)

Die Frage, was ein Durchgang mit Layout und berechneten Stilen kostet, war vor
dem Bau der Kontrastprüfung zu beantworten. Reproduzierbar über
`examples/tier3.html`.

Gemessen wird in einem **iframe mit echtem Layout**: An einem
`DOMParser`-Dokument liefern `getComputedStyle()` und
`getBoundingClientRect()` leere Werte und kosten nichts. Jeder Durchgang wird
kalt gemessen — Stil und Layout werden vorher über eine Breitenänderung am
`<html>`-Element verworfen.

| Seite | Elemente | Collector | rects kalt | Stil kalt | Hintergrund naiv | Hintergrund memo | Tier 3 gesamt |
|---|---:|---:|---:|---:|---:|---:|---:|
| wordpress-news | 658 | 0,9 | 1,2 | 1,6 | 2,3 | **1,3** | 4,1 |
| mdn-document | 2.679 | 2,9 | 3,6 | 3,2 | 13,5 | **1,9** | 8,7 |
| whatwg-parsing | 13.649 | 16,7 | 16,9 | 11,8 | 41,2 | **7,9** | **36,6** |
| tc39-ecma262 | 179.448 | 257,3 | 227,7 | 147,9 | 934,5 | **111,4** | 487,0 |
| whatwg-full | 334.391 | 482,5 | 378,1 | 358,2 | 713,9 | **231,2** | 967,5 |

Drei Befunde:

- **Die Warnung im Plan war berechtigt, aber die Ursache ist behebbar.** Die
  naive Hintergrund-Traversierung ist überall der größte Einzelposten — bei
  `tc39-ecma262` mit 934 ms mehr als das Dreifache des gesamten übrigen
  Tier-3-Aufwands. Sie läuft über dieselben Vorfahren immer wieder. Mit einer
  Merkliste je Element fällt sie auf **111 ms, also um das 8,4-fache**. Das ist
  keine Optimierung für später, sondern die Bedingung dafür, dass Tier 3
  überhaupt tragbar ist.
- **`getComputedStyle()` kostet pro Aufruf, nicht pro Layout.** Der warme Wert
  ist auf den großen Dokumenten so hoch wie der kalte (148,0 gegen 147,9 ms bei
  `tc39-ecma262`). Der Hebel ist die **Zahl der Aufrufe**, nicht das Bündeln von
  Lesezugriffen. Bei `getBoundingClientRect()` ist es umgekehrt: warm rund die
  Hälfte von kalt — dort zahlt sich aus, alle Rechtecke in einem Durchgang zu
  lesen, ohne dazwischen zu schreiben.
- **Tragbar, aber nicht gratis.** Mit Merkliste kostet Tier 3 das **1,9- bis
  4,6-fache** des Collectors. An dem Dokument, an dem der Spike zu messen war
  (`whatwg-parsing`), sind das **36,6 ms zusätzlich zu 16,7 ms** — ein
  vollständiger Scan mit Kontrast bleibt dort unter 55 ms. Der Vollscan im
  Live-Modus bleibt damit weiterhin ausgeschlossen; für den Einzelscan reicht es.

## Tier 3 ist angebunden: Kontrast

`a11y-rules` 0.7.0 bringt `contrast/text-insufficient` (WCAG 1.4.3) und
`contrast/text-undetermined`. LiveAudit bedient sie über:

- **`packages/browser/src/rendering.ts`** — ein **eigener Durchgang** nach dem
  Collector. Getrennt, weil er nach der Messung oben das 1,9- bis 4,6-fache
  kostet und nicht zu jedem Scan gehört. Er löst den **effektiven** Hintergrund
  über die Vorfahren auf, mit der Merkliste, ohne die Tier 3 nicht tragbar wäre.
- **`rendering.rs` in `@casoon/a11y-wasm`** — `RenderArena` erfüllt `Document`,
  `Semantics` und `Rendering` und ruft `a11y_rules::run_full`. Das Modul rechnet
  nichts aus; es reicht durch, was der Collector gesammelt hat.
- **`LiveAudit.scan(root, { rendering: true })`** schaltet ihn ein. Ohne ihn
  melden die Kontrastregeln `UNTESTED` — nicht `PASS` und nicht Schweigen.

**Der Aufstieg folgt dem flachen Baum, nicht `parentElement`.** An der
Shadow-Grenze endet `parentElement`, und an einem geslotteten Element zeigt es
in den Licht-DOM, während der Browser dort zeichnet, wo der Slot steht. Beides
endete in der Annahme „Weiß" — belegt am 20.09.2026 in
`tests/browser/fixtures/kontrast-shadow.html`: dunkler Text auf dunklem Host
wurde **gar nicht gemeldet** (1,3:1 als 14:1 gerechnet), heller Text auf
demselben Host zu Unrecht. Der Durchgang nimmt jetzt denselben Weg wie der
Collector — `assignedSlot`, sonst der Host des Shadow Roots, sonst
`parentElement`.

Was der Collector nicht auf eine Farbe reduzieren kann — Hintergrundbild,
Verlauf, `background-blend-mode`, teildurchsichtiger Hintergrund über einem
Vorfahren —, liefert er als „nicht bestimmbar". Die Regel meldet dann
`contrast/text-undetermined` mit `UNTESTED`. Eine Prüfung gegen geratenes Weiß
erzeugte ein `PASS`, auf das sich jemand verlässt.

Belegt an `examples/contrast.html` mit fünf bekannten Fällen: 2,85:1 fällt auf,
4,54:1 besteht, 3,5:1 besteht bei großem Text, der Verlauf wird `UNTESTED`,
`display: none` wird gar nicht erst geprüft. Alle fünf treffen, und mit
eingeschaltetem Durchgang ist `rules_not_run` null.

**Geometrie (`bounds`) ist noch nicht erhoben.** Die Kontrastregel braucht sie
nicht, und `getBoundingClientRect()` je Knoten kostet so viel wie der ganze
Collector. Sie kommt mit der ersten Regel, die sie braucht — Zielgrößen.

## Bundle-Größe

`dist/inspector.js` 46,1 KB roh / **16,1 KB gzip**, `dist/a11y_wasm_bg.wasm`
166,7 KB roh / **80,1 KB gzip**. Gesamt 96,2 KB gzip (24.09.2026, `a11y-rules`
0.11.0 über `@casoon/a11y-wasm` 0.1.1, mit Live-Modus und englischen Texten). Das JavaScript liegt damit bei
**81 % seiner Grenze von 20 KB**.

Der Zuwachs des WASM von 63,1 auf 79,5 KB verteilt sich auf `a11y-rules` 0.7.0
(Tier 3 samt Kontrastregeln) und 0.8.0 (neun Strukturregeln: Landmarks,
Sprunglink, ARIA-Pflichtattribute, `zoom/viewport-missing`,
`headings/h1-multiple`). Das Modul liegt damit bei **80 % der Grenze von
100 KB** — die am 19.09.2026 angehobene Grenze war richtig bemessen, aber bei
20 KB Luft wird der nächste Tier-Ausbau sie zum Thema machen.

Der Inspector-Layer kostet **+7,4 KB gzip** am JavaScript (vorher 3,6 KB).

Das liegt deutlich über den 22 KB gzip aus dem Spike. Der Unterschied ist nicht
die WASM-Grenze, sondern der Inhalt: Der Spike trug eine eigene Arena plus 20
einfache Regeln, hier stecken der vollständige `a11y-rules`-Bestand und die
Namensberechnung aus `accname` drin.

**Das Budget wird im Build erzwungen** — `scripts/bundle.js` bricht ab bei mehr
als 20 KB gzip für `inspector.js` oder 100 KB gzip für das WASM-Modul. Die
WASM-Grenze wurde am 19.09.2026 von 80 auf 100 KB angehoben; die Begründung
steht in [decisions.md](decisions.md). `serde-wasm-bindgen` bleibt damit an der
Grenze, und der Layer kommt mit, statt nachgeladen zu werden.

## Was ein „sauberes" Dokument heißt

Seit `a11y-rules` 0.8.0 genügt ein bloß wohlgeformtes Dokument nicht mehr, um
befundfrei zu bleiben. Landmarks, Sprunglink und Viewport-Angabe sind eigene
Erwartungen. Die Testvorlagen tragen sie deshalb ausdrücklich — das ist kein
Testartefakt, sondern der Punkt.

Die beiden Achsen tragen den Unterschied: `landmarks/main-missing` ist `FAIL`,
weil eine Seite eine main-Landmark braucht. `landmarks/navigation-missing`,
`banner-missing`, `contentinfo-missing`, `headings/h1-multiple` und
`keyboard/skip-link-missing` sind `REVIEW` — eine Seite darf ohne Navigation
auskommen, mehrere `h1` sind in HTML zulässig, und ein Sprunglink lässt sich
nur über Linktext und Klassennamen erraten.

## Stack

- **Kein Rust hier**: die WASM-Schicht kommt als `@casoon/a11y-wasm`
- **TypeScript** für Collector und UI, kein Framework zur Laufzeit
- **esbuild** bündelt zu `dist/inspector.js`, daneben liegt
  `dist/a11y_wasm_bg.wasm` aus dem Paket; das WASM lädt sich über
  `new URL(..., import.meta.url)` selbst nach
- **Node ≥ 22**, pnpm-Workspace, **Biome** für Lint und Format
- Ein `tsconfig.json` an der Wurzel prüft alle Pakete; TypeScript-Projekt-
  referenzen gibt es bewusst nicht
- Tests: `node --test` mit **jsdom** für Collector
  und Scan, **Playwright** für den Inspector-Layer — siehe unten. Der
  Arena-Adapter wird in `@casoon/a11y-wasm` getestet, nicht hier.

## Live-Modus

`LiveAudit.watch()` scannt, zeigt den Layer und hält ihn auf Stand, solange sich
die Seite ändert; `unwatch()` beendet das, `hide()` ebenfalls — ein Layer, den
niemand sieht, muss nicht mitrechnen. In der Seitenleiste steht dafür ein
Kontrollkästchen: kein stiller Automatismus, denn Mitlaufen kostet bei jeder
Änderung einen Scan, und wer prüft, soll wissen, dass unter ihm etwas rechnet.
Der Schalter meldet sich über `configureLive()` an — die Oberfläche kennt
`watch()` nicht, weil sie unter `browser` hängt und nicht über dem
Einstiegspaket.

Der Aufbau folgt der Messung aus dem Spike: Der Collector ist der Engpass
(79 ms bei 31.000 Knoten, rund 90 % der Gesamtzeit). Ein Vollscan je Mutation
wäre auf einer Seite, die sich bewegt, sofort spürbar. Deshalb:

- **Entprellt**, Vorgabe 200 ms nach der letzten Mutation.
- **Neu gescannt wird nur der geänderte Teilbaum.** Aus den Mutationszielen
  wird die kleinste Menge Wurzeln bestimmt, die sie abdeckt — wird ein ganzer
  Bereich ausgetauscht, bleibt eine Wurzel übrig statt hundert.
- **Ein neu gescannter Teilbaum ist ein eigener Geltungsbereich** in
  `documents`, genau wie ein Same-Origin-Frame und aus demselben Grund: eigener
  Scan, eigener ID-Raum. Indizes aus zwei Arenen lassen sich nicht mischen.
- Beim Einfügen fallen Befunde, ungeprüfte Bereiche und ganze Geltungsbereiche
  weg, die im geänderten Teil lagen oder nicht mehr im Dokument hängen. Die
  Element-Zuordnung wird dabei mitgeräumt, sonst hielte sie abgehängte Knoten
  fest und der Speicher wüchse mit jeder Änderung.

**Zwei Grenzen, beide ausdrücklich:**

- **Dokumentweite Regeln bleiben auf dem Stand des letzten Vollscans.** Fehlende
  `main`-Landmark, fehlender Titel, fehlende `h1`: Sie melden am Wurzelknoten
  der Arena und sind auf einem Fragment nicht sinnvoll zu prüfen — daran ist der
  Selbsttest des Layers schon aufgelaufen. Ihre Befunde bleiben deshalb stehen,
  statt zu verschwinden oder falsch neu zu entstehen. Sie sind damit so alt wie
  der letzte Vollscan; das ist lieber alt als erfunden.
- **Mutationen *innerhalb* eines Same-Origin-Frames werden nicht beobachtet.**
  Ein `MutationObserver` im Hauptdokument sieht sie nicht, und ein eigener
  Beobachter je Frame brächte Teilbäume hervor, die nicht im Hauptdokument
  hängen — deren Marker müssten den Frame-Versatz mitführen. Frames werden
  mitgescannt, sobald sich ein Teilbaum über ihnen ändert.

Shadow Roots werden mitbeobachtet: Ein Beobachter am Host sieht nicht hinein,
deshalb bekommt jeder offene Shadow Root aus dem Ergebnis einen eigenen, und
nach jedem Durchgang die neu hinzugekommenen.

Der eigene Layer ist von der Beobachtung ausgenommen. Ohne das liefe der Modus
im Kreis: `show()` hängt den Host an `<body>` und setzt Inline-Stile an ihm,
beides Mutationen, und jede löste den nächsten Scan aus.

## Browser-Regressionstests

**Der Inspector-Layer ist in jsdom nicht prüfbar** — Geometrie,
`pointer-events`, `elementFromPoint()` und Fokusverhalten bildet es nicht ab.
Bis zum 20.09.2026 war er deshalb von Hand über eine Schaltfläche in
`examples/inspector.html` gemessen. Das ist keine Regressionsprüfung: Es fällt
nur auf, wenn jemand hinsieht.

`pnpm test:browser` fährt jetzt 29 Fälle in `tests/browser/` gegen Chromium:

| Datei | Prüft |
|---|---|
| `zusicherungen.spec.ts` | genau ein Host als letztes Kind von `<body>`, `fixed` und `pointer-events: none`, unveränderter Teilbaum (Markup, Rechtecke, Scrollhöhe), restloses `hide()`, ein echter Klick neben dem Layer, Fokusrückgabe |
| `bedienung.spec.ts` | Marker, Popover, Escape, Seitenleiste, Andocken und Ziehgriff — jeweils mit Maus **und** Tastatur |
| `geometrie.spec.ts` | Marker über Same-Origin-Rahmen (samt `clientLeft`) und offenem Shadow Root, Mitwandern beim Scrollen, Neusetzen bei geänderter Fenstergröße |
| `kontrast.spec.ts` | Hintergrund an Shadow-Grenzen und am Slot, dazu die fünf bekannten Fälle aus `examples/contrast.html` als Regressionsschutz |
| `live.spec.ts` | Der Layer läuft mit: Element dazu, Element weg, Befund behoben, Nachbarbefund unberührt, `unwatch()` beendet es |
| `regeln-ohne-lauf.spec.ts` | Die Gruppe der Regeln ohne Lauf nennt die Tier-3-Kennungen samt Grund, und verschwindet, sobald der Durchgang lief |

Die Fälle laufen gegen `examples/inspector.html` und eine eigene Fixture unter
`tests/browser/fixtures/`. Der Cross-Origin-Rahmen des Beispiels wird
abgewiesen — er soll einen UNTESTED-Bereich erzeugen, und dafür genügt ein
Rahmen, in den niemand hineinsieht; die Tests brauchen kein Netz.

**Gegengeprüft, nicht nur grün.** Zwei Mutationen belegen, dass die Fälle
greifen: `pointer-events: auto` am Host lässt die Host-Zusicherung und den Klick
neben dem Layer fallen, eine entfernte Fokusrückgabe genau den Fokusfall — und
sonst nichts.

**Chromium und WebKit laufen beide durch** (29 von 29, ohne Anpassung am Test).
**Firefox startet auf dieser Maschine nicht**: „Could not find profile folder",
auch nach `playwright install --force firefox` und außerhalb der Sandbox. Das
ist ein Einrichtungsproblem, kein Befund am Layer — die Projekte sind
konfiguriert, `pnpm exec playwright test --project=firefox` läuft, sobald
Firefox startet.

## Die Projektseite

`site/` ist die GitHub-Pages-Seite (`casoon.github.io/liveaudit`) auf dem
gemeinsamen Theme `@casoon/pages-theme`. Das Theme liegt als Kopie unter
`site/vendor/pages-theme/` und wird **in `gh-pages-template` geändert, nie
hier** — `SOURCE` nennt den Stand.

Zwei Abweichungen von den übrigen Projektseiten, beide aus dem Gegenstand:

- **Die veröffentlichte Doku liegt in `site/docs/`, nicht in `docs/`.** `docs/`
  ist hier die interne Lebend-Doku und nicht für Besucher geschrieben. Die
  Sammlung zeigt deshalb über `docsCollection({ base: './docs' })` woanders hin.
- **Statt eines Showcase gibt es `/demo/`.** Ein Werkzeug, das Befunde auf die
  laufende Seite legt, ist als Standbild nicht das, was es ist. Die Demo-Seite
  lädt `dist/inspector.js`, ruft `enable()` und scannt die Seite, auf der sie
  steht — samt Theme. Dafür hat das Theme mit 0.2.0 einen Demo-Bereich bekommen:
  Die Bühne trägt `data-demo`, und nur dort dürfen eigene Skripte liegen und
  nimmt `check-site.cjs` axe zurück. Ohne diese Ausnahme meldete die Prüfung
  genau die Fehler, die die Demo vorzeigt.

`site/` hängt im pnpm-Workspace, damit es bei einem Lockfile bleibt. Gebaut wird
in zwei Schritten: `pnpm build` an der Wurzel erzeugt `dist/`,
`pnpm --filter liveaudit-site build` kopiert das Ergebnis über
`scripts/site-demo.js` nach `site/public/demo/` und baut die Seite.
`.github/workflows/pages.yml` macht beides; seit die WASM-Schicht als Paket
kommt, braucht er keine Rust-Werkzeuge mehr. Die Pages-Quelle ist „GitHub
Actions"; der Workflow läuft bei jedem Push auf `main` und veröffentlicht
`site/dist`. Die kopierten Artefakte sind
ignoriert; committet ist nur `site/public/demo/start.js`.

Biome kennt `.astro` nur bis zum Frontmatter: Es liest den TypeScript-Kopf,
sieht die Vorlage darunter aber nicht und hält jeden Import für ungenutzt. Die
beiden Regeln sind für `**/*.astro` deshalb abgeschaltet — geprüft werden diese
Dateien von `astro check`, nicht von Biome.

Gemessen am 20.09.2026: `check-site.cjs` meldet über neun Seiten in hell und
dunkel **all clean** — kein axe-Befund, keine fremde Herkunft, keine toten
Links. Die Demo selbst findet **18 Befunde über 190 Knoten**, mit
Kontrastdurchgang **27**; darunter `contrast/text-insufficient` bei 2,85:1 und
`contrast/text-undetermined` auf dem Verlauf, also ein sichtbares `UNTESTED`.

Ein Befund aus dem Bau:

- **Das Theme selbst erzeugt `contrast/text-undetermined`.** Kopfleiste und
  einige Textflächen arbeiten mit halbdurchsichtigem Hintergrund; dort lässt sich
  die Fläche hinter dem Text nicht auf eine Farbe zurückführen. Die Antwort ist
  richtig — und auf einer Demo-Seite sogar lehrreich —, aber es ist ein echter
  Befund für `gh-pages-template`.

## Nächste Schritte

Die fünf Schritte aus [build-plan.md](build-plan.md) sind abgeschlossen, dazu
Tier 3 mit Kontrast und der Live-Modus. Offen bleiben aus dem Abschnitt „Danach"
die Tier-4-Prüfungen — Fokusreihenfolge, Zielgrößen, Reflow, Medien-Prüfliste —
und der Konformitäts-Korpus über alle drei Repositories. Offen aus diesem
Durchgang:

- **Bereichsbewusste ID-Auflösung** über Shadow-Grenzen — ein Befund für
  `a11y-dom`/`accname` in barrierlab, keine Regel für dieses Repository. Siehe
  [constraints.md](constraints.md).
- **Nur Chromium gemessen.** Firefox und Safari haben andere DOM-Zugriffskosten.
- **`prefers-reduced-motion` ist umgesetzt, aber nicht per Emulation geprüft.**
  Der Pfad ist eine Media Query im Stylesheet und `matchMedia` vor
  `scrollIntoView`.

## Weiterführende Dokumente

- [architecture.md](architecture.md) — Pipeline, Datenmodell, Analysephasen, Visualisierung
- [decisions.md](decisions.md) — Namensentscheidung, Architekturentscheidungen
- [constraints.md](constraints.md) — was WASM/das Tool grundsätzlich nicht leisten kann
- [build-plan.md](build-plan.md) — was als Nächstes zu bauen ist, in Reihenfolge
- [../spike/ERGEBNIS.md](../spike/ERGEBNIS.md) — die Performance-Messung

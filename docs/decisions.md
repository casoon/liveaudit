# Decisions — LiveAudit

## Projektname: LiveAudit

Entschieden: Das Projekt heißt **LiveAudit**.

*Grund:* „Live" transportiert, dass geprüft wird, wo die Seite tatsächlich läuft —
direkt im Browser, unmittelbar sichtbar, nicht als externer Report. „Audit" sagt:
systematisches Prüfen. Das grenzt den Namen nicht auf den Inspector-Layer ein;
Tab-Reihenfolge, Kontrastmodus, Live-DOM-Änderungen, manuelle Checks oder
CI-Prüfungen passen später ohne Namenskonflikt dazu.

*Konsequenz:*
- npm-Namespace: `@liveaudit/core` (Rust/WASM), `@liveaudit/browser` (DOM Adapter),
  `@liveaudit/ui` (Inspector-Layer), später `@liveaudit/cli`.
- Öffentliche API als globales Objekt: `LiveAudit.init()`, `LiveAudit.scan()`,
  `LiveAudit.show()`, `LiveAudit.hide()`.
- Claim/Tagline zur Einordnung, da „LiveAudit" allein nicht zwingend Accessibility
  signalisiert (könnte auch Security/SEO/Analytics sein): z. B. „LiveAudit —
  Accessibility inspection, directly on your website." bzw. deutsch „LiveAudit —
  Barrierefreiheit direkt auf der Website prüfen."

## WASM ist Analyse-Engine, nicht Browser-Schicht

Entschieden: Die Rust/WASM-Engine bekommt keinen direkten Browser-Zugriff und
kein rohes DOM/HTML. Sie operiert ausschließlich auf der Arena, die der
TypeScript Browser Adapter einmal je Scan in den WASM-Speicher überträgt
(siehe [architecture.md](architecture.md)).

*Grund:* WASM kann grundsätzlich nicht auf den Accessibility Tree des Browsers,
Screenreader-Verhalten oder Browser-APIs (Fokus, Layout, Events) zugreifen — das
ist ausschließlich über JavaScript/TypeScript möglich (siehe
[constraints.md](constraints.md)).

*Warum überhaupt WASM — gemessen, nicht angenommen:* Die tragende Begründung ist
**Regel-Wiederverwendung**, nicht Geschwindigkeit. Derselbe Rust-Regelbestand
bedient Build-Zeit (astro-post-audit), CI/Crawl (auditmysite) und die laufende
Seite (LiveAudit) mit identischen Rule-IDs.

Ein Performance-Spike (2026-09-18, 5 reale Dokumente von 1.244 bis 723.613 Nodes)
hat das geprüft:

- Der **Arena-Aufbau über die WASM-Grenze ist vernachlässigbar** — 0,5 ms bei
  31.000 Nodes, 3,8 ms bei 723.000, rund 0,005 µs pro Node.
- **Der Engpass ist die DOM-Traversierung in JavaScript** (79 ms bei 31.000
  Nodes, 90 % der Gesamtzeit). Sie entsteht nicht an der WASM-Grenze, sondern
  daran, dass WASM den DOM nicht sehen kann — jeder Knoten muss einmal von JS
  abgeholt werden.
- Eine reine TypeScript-Implementierung derselben 20 Regeln ist **4–6× schneller**,
  weil sie den Sammelschritt überspringt. Der Gleichstand liegt bei grob 120
  Regeln; der Zielbestand liegt in dieser Größenordnung.
- Gesamtdurchlauf bei 50.000 Nodes: etwa 140 ms. WASM-Größe: 22 KB gzip.

**Performance ist damit weder Argument für noch gegen WASM.** Die Entscheidung
steht und fällt mit der Wiederverwendung.

*Konsequenz:*
- Jede neue Prüfung, die einen zusätzlichen Datenpunkt aus dem Browser braucht
  (z. B. berechneter Kontrast, Sichtbarkeit, Fokus-Status), muss zuerst im
  Adapter verfügbar gemacht werden, bevor eine Rust-Regel darauf zugreifen kann.
  Formal heißt das: der Host implementiert den passenden Tier-Trait aus
  `a11y-dom` (`Semantics`, `Rendering`, `Interaction`).
- Weil der Sammelschritt der Engpass ist, darf ein `MutationObserver`-getriebener
  Re-Scan im Live-Modus **nur geänderte Teilbäume** sammeln, nie das ganze
  Dokument. Bei 79 ms pro Vollscan wäre ein Scan-Sturm sofort spürbar.

## Vier Analysezustände statt Score

Entschieden: Jedes Ergebnis bekommt einen von vier Zuständen —
`FAIL` (automatisch festgestelltes Problem), `REVIEW` (potenzielles Problem,
manuell prüfen), `PASS` (automatische Prüfung bestanden), `UNTESTED` (automatisiert
nicht beurteilbar) — statt eines aggregierten Scores wie „Accessibility Score:
94/100". Dazu trägt jedes Finding eine `severity`. **Eine dritte Achse
`certainty` gibt es bewusst nicht** — die Gewissheit steckt bereits im Zustand.

*Grund:* Ein einzelner Score verschleiert den Unterschied zwischen sicher
automatisch erkannt, nur heuristisch vermutet und grundsätzlich nicht
automatisierbar (z. B. inhaltliche Qualität eines Alt-Texts) — fachlich ist das
nicht dasselbe, auch wenn beides „irgendwie ein Problem" ist.

*Zwei Achsen, nicht drei:* Ein früherer Entwurf trug `severity` **und**
`certainty` nebeneinander. Das ist weitgehend dieselbe Achse doppelt —
FAIL ≙ automatisch festgestellt, REVIEW ≙ heuristisch, UNTESTED ≙ nur manuell
beurteilbar. Drei parallele Klassifikationen sind für Leser eines Reports zu viel.
Entschieden: **Zustand + Severity**, `certainty` entfällt als eigenes Feld.

*Konsequenz:*
- `PASS` wird intern gespeichert, aber standardmäßig nicht visualisiert.
- `UNTESTED`-Fälle (z. B. gefundenes Video) erzeugen eine manuelle Prüfliste statt
  eines automatischen Fail/Pass-Urteils.
- UI (Seitenleiste, Marker-Popover) zeigt Zustand und `severity` immer getrennt an,
  nie zu einem einzigen Prozentwert verrechnet.
- Eine Regel, die ihre Aussage nur heuristisch treffen kann, liefert `REVIEW` —
  nicht `FAIL` mit niedriger Gewissheit. Der Zustand *ist* die Aussage über die
  Gewissheit.
- **Migrationsregel für den Bestand:** `astro-post-audit::Finding.confidence`
  (`Medium`/`Low`, ca. 36 Fundstellen) entfällt. Findings, die heute ein
  `confidence` tragen, werden `REVIEW`; Findings ohne `confidence` werden `FAIL`.
  Im a11y-Bereich betrifft das genau eine Regel: `a11y/invalid-img-alt`, den
  heuristischen Alt-Text-Check.

## MIT für alles, kein kommerzielles Modell

Entschieden: LiveAudit, die geteilten `a11y-*`-Crates **und auditmysite** stehen
unter MIT. Kein kommerzielles Modell, keine Dual-Lizenzierung, keine
Enterprise-Variante.

*Grund:* Eine einheitliche Lizenz über alle drei Oberflächen macht den
Crate-Zuschnitt frei von Lizenzgrenzen. Ohne das müsste bei jedem Modul, das aus
auditmysite in die geteilten Crates wandert, einzeln entschieden werden, ob es
mitdarf — eine Abgrenzung, die dauerhaft gepflegt werden müsste und quer zum
Ziel „eine Engine, drei Oberflächen" steht.

*Konsequenz:*
- astro-post-audit ist bereits MIT — unverändert.
- **auditmysite wird von BUSL-1.1 auf MIT umlizenziert.** Praktisch irreversibel:
  ein einmal unter MIT veröffentlichter Release lässt sich nicht zurückholen.
  Bewusst so entschieden.
- Die geteilten Crates (`a11y-dom`, `accname`, `a11y-rules`, `a11y-report`,
  `a11y-conformance`) werden MIT, wie `nosecrets-*`, `html-conform`, `xpath-eval`.
- Beim Verschieben von Modulen zwischen den Repos ist keine Lizenzprüfung nötig.

## Auslieferung: Self-Hosting, freigeschaltet per Flag

Entschieden: LiveAudit wird als npm-Paket ausgeliefert und vom Seitenbetreiber
**selbst gehostet**. Das Script ist ohne ausdrückliche Freischaltung **inert** —
es registriert nichts, lädt nichts nach und legt kein globales Objekt an.

*Grund — Self-Hosting:* Ein zentral gehostetes Script macht die ausliefernde
Domain zur Abhängigkeit jeder Kundenseite. Wer es einbindet, vertraut ihr auf
Dauer; ein kompromittiertes Script liefe mit vollen Rechten auf fremden Seiten.
Für ein Prüfwerkzeug, das ohnehin nur zeitweise gebraucht wird, ist das ein
schlechtes Tauschgeschäft. Kein CDN, auch nicht als Bequemlichkeitsvariante.

*Grund — Flag statt Host-Allowlist:* Der Kern von LiveAudit ist, dort zu prüfen,
wo die Seite tatsächlich läuft. Eine Allowlist auf `localhost` und Staging nähme
genau diesen Fall weg. Ein Flag erlaubt den gezielten Blick auf die echte Seite,
ohne dass Endnutzer je etwas bemerken.

*Konsequenz:*
- Freischaltung über den Query-Parameter `?liveaudit` oder den
  `localStorage`-Eintrag `liveaudit`. Ohne beides passiert nichts.
- **Inert heißt inert:** kein `globalThis.LiveAudit`, kein Nachladen des
  WASM-Moduls, keine Ereignisbehandlung. Die Kosten auf Produktion beschränken
  sich auf das Herunterladen und Parsen des Bundles.
- Das WASM-Modul lädt ohnehin erst bei `init()`, der Layer erst bei `show()`.
- Wer das Werkzeug programmgesteuert einsetzt (Tests, eigene Oberfläche), ruft
  `enable()` auf und umgeht das Flag bewusst.

## Strikte CSP wird erkannt, nicht stillschweigend hingenommen

Entschieden: Schlägt die WASM-Instanziierung an einer Content Security Policy
fehl, meldet LiveAudit das als solches — mit der konkret fehlenden Direktive.

*Grund:* Chrome verlangt `wasm-unsafe-eval` in `script-src`. Ohne sie scheitert
`WebAssembly.instantiate`, und zwar mit einem Fehler, der ohne Einordnung nicht
nach „CSP" aussieht. Wer das Werkzeug einbindet und nichts passiert, sucht sonst
an der falschen Stelle.

*Konsequenz:* `init()` fängt den Fehlschlag ab und wirft einen Fehler, der die
fehlende Direktive benennt und den Ursprungsfehler als `cause` mitführt.

## Bundle-Budget wird im Build erzwungen

Entschieden: Der Build bricht ab, wenn `dist/` die festgelegten Grenzen
überschreitet — 20 KB gzip für `inspector.js`, 100 KB gzip für das WASM-Modul.

*Grund:* Ein Budget, das nur berichtet wird, ist keins. Die Größe wächst
schleichend mit jeder Regel und jedem UI-Detail; ohne Abbruch merkt es niemand,
bis es zu spät ist.

*Konsequenz:* Die Grenzen stehen in `scripts/bundle.js`. Wer sie anhebt, tut das
sichtbar in einem Commit — das ist der Zweck.

*Angehoben am 19.09.2026:* Das WASM-Budget von 80 auf 100 KB. Mit den
Elementangaben aus `a11y-report` 0.3.0 lag das Modul bei 63,8 KB und damit bei
80 % der alten Grenze. Bei 16 KB Luft hätte der nächste spürbare Zuwachs die
Entscheidung erzwungen, und zwar mitten in einer anderen Arbeit — genau dann,
wenn man sie schlecht trifft. 100 KB lassen Raum für die Tier-3- und
Tier-4-Regeln, ohne die Grenze wirkungslos zu machen: Sie liegt weiterhin in
Reichweite, nur nicht im Weg.

## „Inspector-Layer", nicht „Overlay"

Entschieden: Der visuelle Teil des Tools heißt **Inspector-Layer**. Das Wort
„Overlay" wird für LiveAudit selbst nicht verwendet — nur, wenn die
Overlay-Anbieter-Kategorie gemeint ist.

*Grund:* „Accessibility Overlay" bezeichnet eine Kategorie von Werkzeugen, die
eine Seite zur Laufzeit per JavaScript zu *reparieren* vorgeben. Diese Assoziation
entsteht genau bei dem Publikum, das barrierefreiheitskundig ist — also bei der
Zielgruppe. Werkzeuge im selben Auslieferungsmodell, die tatsächlich prüfen,
grenzen sich aus demselben Grund ausdrücklich davon ab.

*Konsequenz:*
- Doku, UI-Texte, README und Paketbeschreibungen sagen „Inspector-Layer".
- README und Inspector-UI tragen einen expliziten Satz: **prüft, repariert nicht.**
- Der Begriff „Overlay" bleibt für die Anbieterkategorie reserviert — dort ist er
  korrekt und die Abgrenzung ist gewollt.

## Keine Mutation innerhalb des geprüften Teilbaums

Entschieden: Scan und Visualisierung verändern **den geprüften Teilbaum** nicht —
kein `data-*`-Attribut zur Element-Identifikation, kein direktes Setzen von
Inline-Styles am Zielelement.

*Grund:* Attribute oder Styles am Zielelement würden die geprüfte Seite selbst
verändern und könnten Layout oder nachfolgende Messungen (Geometrie, Kontrast)
verfälschen.

*Warum nicht absolut formuliert:* Eine Fassung „verändert den DOM der Seite gar
nicht" wäre nicht haltbar — der Inspector-Layer hängt selbst als Element im
Dokument. Die tragfähige Invariante ist deshalb die Abgrenzung auf den geprüften
Teilbaum, nicht das Dokument als Ganzes.

*Konsequenz:*
- Element-Identität läuft ausschließlich über `WeakMap<Element, NodeId>` im
  Speicher des Adapters.
- Das gesamte Inspector-UI liegt in genau **einem** Host `<liveaudit-inspector>`,
  als letztes Kind von `<body>`, mit eigenem Shadow Root.
- Der Host ist `position: fixed` und `pointer-events: none` als Default; nur
  einzelne interaktive Kinder (Marker, Panel) setzen `pointer-events: auto`.
  Damit verändert er weder Layout noch Scrollhöhe der Seite und fängt keine
  Klicks ab, die der Seite gelten.
- Der Collector schließt den Host von jedem Scan aus — der Inspector prüft sich
  nicht selbst.
- `elementFromPoint()` (Phase 3) trifft sonst den Layer statt des Zielelements.
  Vor solchen Messungen wird der Host kurzzeitig ausgeblendet, oder es wird
  `document.elementsFromPoint()` verwendet und der Host aus dem Ergebnis gefiltert.

## Phasenweise Analyse statt Vollscan

Entschieden: Die Analyse läuft in drei Phasen (Struktur → Accessibility
Properties auf Elementtyp-Whitelist → Rendering nur auf Regel-Anforderung), statt
für jeden DOM-Node sofort `getComputedStyle()` und Bounding-Box zu berechnen.

*Grund:* Bei großen Seiten (WordPress: schnell 20.000–100.000 DOM-Nodes) wäre ein
Vollscan mit teuren Browser-APIs für jeden einzelnen Node unnötig teuer.

*Konsequenz:* Neue Regeln, die Rendering-Daten brauchen (z. B. Kontrast), müssen
explizit Phase 3 anfordern, statt implizit davon auszugehen, dass diese Daten
bereits für alle Nodes vorliegen.

## Shadow DOM: offene Roots als flacher Baum, in derselben Arena

Entschieden: Der Collector traversiert **offene** Shadow Roots unbegrenzt tief
und bildet dabei den **flachen Baum** ab: Trifft er einen Shadow Host, steigt er
in dessen Shadow Root ab; Licht-Kinder erreicht er über `<slot>` mittels
`assignedNodes({ flatten: true })`. Alles landet in **einer** Arena.

*Grund:* Eine flache Eltern-Kind-Beziehung über `childNodes` bildet fremde
Shadow Roots gar nicht ab — für Komponentenbibliotheken wäre das V1-blockend.
Der flache Baum ist zugleich das, was der Browser rendert und was der
Accessibility-Tree sieht. Entscheidend für die Element-Identität: **jedes
Element erscheint darin genau einmal.** Ein Host-Kind, das keinem Slot
zugewiesen ist, wird nicht gerendert und gehört deshalb korrekterweise nicht in
den Scan.

*Konsequenz:*
- `WeakMap<Element, NodeId>` bleibt eine 1:1-Zuordnung; der Rückbezug eines
  Findings zeigt auf genau ein reales Element, auch quer über Shadow-Grenzen.
- Der Findings-Rückbezug braucht keine zusätzliche Pfadangabe. Ein Element im
  Shadow Root eines Komponenten-Hosts ist über seinen Arena-Index adressierbar
  wie jedes andere.
- **Geschlossene Shadow Roots sind von außen nicht einmal erkennbar** —
  `element.shadowRoot` liefert `null`, ununterscheidbar von „kein Shadow Root".
  Sie können deshalb auch nicht als `UNTESTED` gemeldet werden. Das ist eine
  harte Grenze, siehe [constraints.md](constraints.md).
- **Der ID-Raum wird dabei verschmolzen, und das ist nicht korrekt.** Jeder
  Shadow Root hat einen eigenen ID-Raum; `aria-labelledby` überquert eine
  Shadow-Grenze nicht. In einer gemeinsamen Arena kann `ids/duplicate` deshalb
  über legitim gleichnamige IDs in getrennten Shadow Roots fehlauslösen, und
  eine Referenz, die real nicht auflösbar ist, kann auflösbar erscheinen.
  Sauber wäre eine bereichsbewusste ID-Auflösung in `a11y-dom`/`accname` —
  **das ist ein Befund für a11y-core, keine Rechtfertigung, hier eine eigene
  Regel zu schreiben.**

## iframes: Same-Origin als eigener Scan, alles andere als `UNTESTED`

Entschieden: Der Collector **betritt kein `<iframe>`**. Ein erreichbares
Same-Origin-Frame wird als **eigenes Dokument mit eigener Arena** gescannt; ein
nicht erreichbares erzeugt einen `UNTESTED`-Geltungsbereich.

*Grund:* Ein Frame ist ein eigenes Dokument mit eigenem ID-Raum. Würde man es in
die Arena des umgebenden Dokuments einbetten, verschmölzen die ID-Räume und
dokumentweite Regeln (`document/lang`, `document/title`) bezögen sich auf das
falsche Dokument. Getrennte Arenen sind hier billig zu haben — anders als beim
Shadow DOM gibt es keine Verschränkung wie das Slotting.

*Konsequenz:*
- `ScanResult.documents` ist eine Liste; `documents[0]` ist das Hauptdokument,
  jedes weitere trägt in `parent` den Arena-Index seines `<iframe>`.
- Ein nicht erreichbares Frame erscheint als
  `{ reason: "cross-origin-frame", node, src }` in `DocumentScan.untested` —
  sichtbar, nicht weggelassen.
- **Ein Frame, dessen Navigation noch läuft, zählt ebenfalls als nicht
  erreichbar.** `contentDocument` zeigt in diesem Zustand noch das anfängliche
  `about:blank` — auch bei einem Cross-Origin-Ziel. Dieses leere Dokument zu
  prüfen erzeugte `document/lang-missing` und `document/title-missing` über ein
  Dokument, das gar nicht das gemeinte ist. In-Page-JavaScript kann die beiden
  Fälle nicht auseinanderhalten; beide landen unter derselben Begründung.
- `UNTESTED` steht hier bewusst **nicht** als `Finding` im Bericht. Ein Finding
  braucht eine Rule-ID, und eine hier zu erfinden bräche die Zusicherung
  identischer Kennungen über alle drei Oberflächen. Soll daraus eine Regel
  werden (etwa `frames/cross-origin`), gehört sie nach `a11y-rules`.

## Der eigene Host bleibt aus dem Scan

Entschieden: Der Collector überspringt jedes Element mit dem Tagnamen
`liveaudit-inspector` samt Inhalt — der Ausschluss greift also vor dem Emittieren
und schließt den Shadow Root des Hosts mit ein.

*Grund:* Der Inspector prüft sich nicht selbst. Der Ausschluss über den Tagnamen
statt über eine Referenz auf die eigene Instanz ist absichtlich: Er greift auch
dann, wenn ein Host aus einem früheren Lauf noch im Dokument hängt, und er
funktioniert, bevor `packages/ui` überhaupt existiert.

*Konsequenz:* Der Tagname ist in `@liveaudit/browser` als `HOST_TAG_NAME`
exportiert und für `packages/ui` verbindlich — genau **ein** Host, genau dieser
Name.

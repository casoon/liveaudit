# Constraints — LiveAudit

## Was WASM grundsätzlich nicht kann

Der Rust/WASM-Core ist keine Accessibility API. Er kann nicht:

- den Accessibility Tree des Browsers sehen,
- Screenreader-Verhalten (VoiceOver, NVDA, JAWS) simulieren oder verstehen,
- visuelle oder inhaltliche Bedeutung erfassen,
- Bedienbarkeit menschlich beurteilen.

Alles davon erfordert Browser-APIs, JavaScript/TypeScript oder externe
Testumgebungen — WASM liefert ausschließlich Regeln/Berechnung auf dem
normalisierten Node-Modell, das der TypeScript Browser Adapter bereitstellt
(siehe [decisions.md](decisions.md), [architecture.md](architecture.md)).

## Was generell nicht zuverlässig automatisierbar ist

Unabhängig vom WASM-Ansatz gilt für folgende Bereiche: keine verlässliche
automatische Bewertung, sondern `UNTESTED` + manuelle Prüfliste
(siehe „Vier Analysezustände" in [decisions.md](decisions.md)):

- Screenreader-Erfahrung (ein technisch korrektes Dokument kann trotzdem schlecht
  bedienbar sein)
- inhaltliche Verständlichkeit von Texten
- Sinnhaftigkeit von Alternativtexten, Überschriften, Linktexten, Accessible Names
- logische Lesereihenfolge in komplexen Layouts
- Qualität von Untertiteln und Audiodeskription
- Gebärdensprache
- Verständlichkeit von Fehlermeldungen (erfordert echte Interaktion + Kontext)
- ob eine Bedienhandlung unerwartet ist
- ob komplexe Drag-and-Drop-Funktionen gleichwertig per Tastatur bedienbar sind

## Eingeschränkt automatisierbar

Technisch prüfbar, inhaltlich nicht zuverlässig automatisch beurteilbar:

| Bereich | Automatisch prüfbar | Nicht automatisch beurteilbar |
|---|---|---|
| Alt-Texte | Attribut vorhanden? Heuristik wie „image.jpg" als Alt-Text | ob der Alt-Text den Bildinhalt angemessen beschreibt |
| Überschriften | Struktur/Hierarchie | ob eine Überschrift inhaltlich sinnvoll ist |
| Linktexte | generische Linktexte wie „hier" markierbar | ob ein konkreter Linktext im Kontext gut genug ist |
| Fehlermeldungen | Formularstruktur prüfbar | ob nach echter Fehleingabe eine verständliche Meldung erscheint |
| Fokusreihenfolge | technische Tab-Reihenfolge bestimmbar | ob sie inhaltlich sinnvoll ist |
| ARIA | Syntax und Referenzen prüfbar | ob ein komplexes Widget sich für Screenreader tatsächlich sinnvoll verhält |

## Performance

- **Tier 3 ist ein eigener Durchgang, kein Standard.** `getComputedStyle()`
  kostet pro Aufruf, nicht pro Layout; der Durchgang kostet gemessen das 1,9- bis
  4,6-fache des Collectors und läuft nur auf Anforderung
  (`scan(root, { rendering: true })`). Ohne ihn melden die betroffenen Regeln
  `UNTESTED`, nicht `PASS`.
- **`getBoundingClientRect()` je Knoten wird nicht erhoben.** Geometrie kostet
  noch einmal so viel wie der ganze Collector und kommt erst mit der ersten
  Regel, die sie braucht.
- **Re-Scans im Live-Modus sind debounced (200 ms)** und erfassen nur den
  geänderten Teilbaum. Bei 79 ms je Vollscan wäre ein Scan-Sturm sofort spürbar.

## Keine Mutation innerhalb des geprüften Teilbaums

Scan und Visualisierung dürfen den geprüften Teilbaum nicht verändern: kein
`data-*`-Attribut zur Element-Identifikation, keine Inline-Style-Änderung am
Zielelement.

Der Inspector-Layer selbst ist davon ausgenommen — er hängt als eigener Host im
Dokument, ist aber `position: fixed` + `pointer-events: none` und vom Collector
ausgeschlossen. Bei Messungen am Punkt blendet er sich **nicht** aus, sondern
filtert seinen Host aus `elementsFromPoint()`: derselbe Effekt, aber ein Layout
statt zwei und kein Flackern. Siehe [decisions.md](decisions.md).

## Was die In-Page-Lage zusätzlich verschließt

Diese Grenzen sind beim Bau des Collectors aufgetreten und nicht durch mehr
Aufwand zu beheben — sie folgen daraus, dass der Prüfer *in* der Seite sitzt.

- **Geschlossene Shadow Roots sind unsichtbar.** `element.shadowRoot` liefert
  `null`, ununterscheidbar von „dieses Element hat gar keinen Shadow Root". Ein
  geschlossener Root kann deshalb nicht einmal als `UNTESTED` gemeldet werden.
  Offene Roots traversiert der Collector unbegrenzt tief.
- **Cross-Origin-iframes bleiben zu.** Sie erzeugen einen
  `UNTESTED`-Geltungsbereich. Ein Same-Origin-Frame, dessen Navigation noch
  läuft, ist davon nicht zu unterscheiden und landet in derselben Kategorie —
  `contentDocument` zeigt in beiden Fällen ein `about:blank`.
- **Ohne `wasm-unsafe-eval` in der CSP startet das Tool nicht.** Die
  WASM-Instanziierung braucht die Direktive; fehlt sie, wirft `init()` einen
  Fehler, der sie benennt, mit dem ursprünglichen Fehlschlag als `cause`. Das ist
  keine Eigenheit von LiveAudit, sondern gilt für jedes WASM in der Seite.
- **Der ID-Raum über Shadow-Grenzen wird verschmolzen.** Der Collector legt den
  flachen Baum in *eine* Arena; die getrennten ID-Räume der Shadow Roots gehen
  dabei verloren. `ids/duplicate` kann dadurch über legitim gleichnamige IDs in
  getrennten Roots fehlauslösen, und eine Referenz, die eine Shadow-Grenze real
  nicht überqueren kann, erscheint auflösbar. Die saubere Lösung ist eine
  bereichsbewusste ID-Auflösung in `a11y-dom`/`accname` — ein Befund für
  a11y-core, siehe [decisions.md](decisions.md). iframes sind davon nicht
  betroffen: Sie werden als eigene Dokumente gescannt.

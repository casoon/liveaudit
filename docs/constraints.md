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

- Kein pauschaler `getComputedStyle()`- oder Bounding-Box-Aufruf für jeden
  DOM-Node — bei großen Seiten (WordPress u. ä.) sind 20.000–100.000 Nodes
  realistisch. Analyse läuft stattdessen phasenweise (siehe architecture.md).
- MutationObserver-getriebene Re-Scans im Live-Modus müssen debounced werden
  (200 ms), um bei DOM-Änderungsketten keinen Scan-Sturm auszulösen.

## Keine Mutation innerhalb des geprüften Teilbaums

Scan und Visualisierung dürfen den geprüften Teilbaum nicht verändern: kein
`data-*`-Attribut zur Element-Identifikation, keine Inline-Style-Änderung am
Zielelement.

Der Inspector-Layer selbst ist davon ausgenommen — er hängt als eigener Host im
Dokument, ist aber `position: fixed` + `pointer-events: none`, vom Collector
ausgeschlossen und bei `elementFromPoint()`-Messungen ausgeblendet. Siehe
[decisions.md](decisions.md).

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
- **Der ID-Raum über Shadow-Grenzen wird verschmolzen.** Der Collector legt den
  flachen Baum in *eine* Arena; die getrennten ID-Räume der Shadow Roots gehen
  dabei verloren. `ids/duplicate` kann dadurch über legitim gleichnamige IDs in
  getrennten Roots fehlauslösen, und eine Referenz, die eine Shadow-Grenze real
  nicht überqueren kann, erscheint auflösbar. Die saubere Lösung ist eine
  bereichsbewusste ID-Auflösung in `a11y-dom`/`accname` — ein Befund für
  a11y-core, siehe [decisions.md](decisions.md). iframes sind davon nicht
  betroffen: Sie werden als eigene Dokumente gescannt.

# @liveaudit/ui

Der Inspector-Layer — **Schritt 4** in [docs/build-plan.md](../../docs/build-plan.md).

**Inspector-Layer, nicht „Overlay": LiveAudit prüft, es repariert nicht.** Der
Satz steht sichtbar in der Seitenleiste — dort auf Englisch, wie alle sichtbaren
Texte: „It inspects. It does not repair."

## Drei Darstellungsvarianten

1. **Rahmen** — deckungsgleich mit `getBoundingClientRect()`, für Elemente ab
   34 × 18 px.
2. **Marker plus Popover** — ein nummerierter Knopf je Befund, auch neben einem
   Rahmen. Der Marker ist das Bedienelement; Rahmen bleiben
   `pointer-events: none`, weil ein klickbares Rechteck über einem großen
   Element genau die Klicks abfinge, die der Seite gelten.
3. **Seitenleiste** — gruppiert nach dem Präfix der Rule-ID (`images/…` →
   „Bilder"), mit Zählung je Zustand und Filtern.

Die vierte Variante — nummerierte Marker über der Tabreihenfolge — braucht
Tier 4 und steht im Bauplan unter „Danach".

## Die Invarianten

- Genau **ein** Host `<liveaudit-inspector>`, letztes Kind von `<body>`, eigener
  Shadow Root. Der Collector schließt genau diesen Tagnamen vom Scan aus
  (`HOST_TAG_NAME` in `@liveaudit/browser`).
- Der Host ist `position: fixed` und `pointer-events: none`, beides inline und
  mit `!important` — eine Seitenregel auf den Tagnamen schlüge `:host` in der
  Spezifität. Nur Marker, Popover und Panel setzen `pointer-events: auto`.
- **Der geprüfte Teilbaum wird nicht verändert.** Keine `data-*`-Attribute, keine
  Inline-Styles, keine Klassen am Zielelement. Positionierung ausschließlich
  über `getBoundingClientRect()` im eigenen Layer.
- Messungen am Punkt laufen über `elementsFromPoint()` mit gefiltertem Host,
  nicht über `elementFromPoint()` — sonst misst der Layer sich selbst.
- Zustand und Schweregrad stehen als **zwei** Badges nebeneinander, nie als
  Prozentwert. `UNTESTED` ist eine eigene sichtbare Kategorie. `PASS` wird
  gezählt und ist zuschaltbar, standardmäßig aber nicht angezeigt.
- Keine Framework-Laufzeit. Eigenes DOM im Shadow Root.

## Der Layer ist selbst ein Barrierefreiheits-Werkzeug

Tastaturbedienbar, sichtbarer Fokus (`:focus-visible`), Marker mit 24 × 24 px
Zielgröße, `prefers-reduced-motion` auch beim Springen zum Element, kein
Fokusverlust beim Öffnen und Schließen von Panel und Popover.

Der Layer lässt sich mit dem eigenen Scanner prüfen — der Shadow Root ist `open`,
und die Wurzel darin ist eine gewöhnliche `<div>`:

```js
const root = document.querySelector("liveaudit-inspector").shadowRoot.querySelector(".root");
await LiveAudit.scan(root);
```

`examples/inspector.html` hat dafür einen Knopf.

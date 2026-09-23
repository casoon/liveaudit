# Performance-Spike: Ergebnis

**Gemessen:** 2026-09-18, Chromium im Browser-Pane, Apple Silicon.
Median aus 5 Läufen je Messpunkt, ein Warmlauf vorab.
Aufbau siehe [README.md](README.md).

## Zahlen

Alle Zeiten in ms. „Collect" = DOM-Traversierung + Kodierung in JS,
„Arena" = Serialisierung über die WASM-Grenze + Arena-Aufbau in Rust,
„Regeln" = 20 Tier-1-Regeln.

| Seite | Nodes | Collect naiv | Collect opt. | Arena | Regeln (Rust) | **WASM ges.** | JSON-Weg | **JS/DOM** | Faktor |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| wordpress-news | 1.244 | 9 | 4 | 0,1 | 0,3 | **4** | 6 | **1** | 4,0× |
| mdn-document | 5.378 | 30 | 16 | 0,2 | 0,6 | **17** | 13 | **3** | 5,7× |
| whatwg-parsing | 31.026 | 152 | 79 | 0,5 | 7,9 | **88** | 101 | **21** | 4,2× |
| tc39-ecma262 | 419.252 | 704 | 274 | 2,0 | 18,6 | **294** | 452 | **58** | 5,1× |
| whatwg-full | 723.613 | 766 | 466 | 3,8 | 40,4 | **510** | 534 | **113** | 4,5× |

Ergebnisgleichheit: Die Findings stimmen auf allen fünf Dokumenten exakt
überein (23/23, 1/1, 146/146, 512/512, 1321/1321). Beide Implementierungen
messen also dasselbe.

**WASM-Größe** (Arena + 20 Regeln): 48 KB roh, **22 KB gzip**, plus 11 KB
JS-Glue. Mit `serde_json` für den JSON-Vergleichsweg wären es 127 KB — der
JSON-Weg wird nicht gebaut, also zählt er nicht.

## Was die Zahlen sagen

### 1. Die Ausgangsfrage ist beantwortet — und die Sorge war unbegründet

Gefragt war: *Was kostet der einmalige Arena-Aufbau bei 50.000+ Nodes?*

**Antwort: praktisch nichts.** 0,5 ms bei 31.000 Nodes, 3,8 ms bei 723.000 —
rund 0,005 µs pro Node. Die WASM-Grenze und der Arena-Aufbau sind über alle
Größenordnungen vernachlässigbar. Die in der Konzeptbewertung formulierte Sorge
(„Serialisierungskosten nie gemessen") ist damit **widerlegt**.

### 2. Der Kostenträger ist ein anderer — und er ist strukturell

Teuer ist die **DOM-Traversierung in JS**: 79 ms bei 31.000 Nodes, 466 ms bei
723.000. Das sind 90 % des WASM-Pfads.

Diese Kosten entstehen nicht an der WASM-Grenze, sondern daran, dass WASM den
DOM **überhaupt nicht sehen kann** — jeder Knoten muss einmal von JS abgeholt
werden. Das ist kein Implementierungsproblem, sondern die in
`docs/constraints.md` festgehaltene Grundbedingung, hier erstmals beziffert.

Die Optimierung des Collectors hat 40–60 % gebracht (naiv → optimiert:
152→79 ms bzw. 704→274 ms). Viel mehr ist nicht zu holen; die verbleibende Zeit
steckt im Zugriff auf `node.attributes` und `node.childNodes`.

### 3. Der naive JSON-Weg ist nicht dramatisch schlechter

Überraschend: JSON liegt nur bei den großen Dokumenten deutlich zurück
(452 vs. 294 ms), bei den kleinen ist er sogar gleichauf. Der Grund ist, dass
auch dort die JS-seitige Traversierung dominiert. **Die Wahl der Kodierung ist
also nicht die entscheidende Stellschraube** — entgegen der Annahme beim Aufbau
des Spikes.

### 4. Das Abbruchkriterium: eine Hälfte trifft zu

Das Abbruchkriterium des Spikes lautete:

> Liegt der Gesamtdurchlauf bei 50.000 Nodes über ~1 s **oder** schlägt die
> TS-Gegenprobe den WASM-Pfad deutlich, ist der WASM-Ansatz für die
> In-Page-Oberfläche neu zu bewerten.

- **1-Sekunden-Grenze: nicht getroffen.** Bei 31.000 Nodes sind es 88 ms,
  hochgerechnet auf 50.000 etwa 140 ms. Auch die 723.000-Node-Extremseite
  bleibt mit 510 ms darunter.
- **Gegenprobe schlägt WASM: getroffen.** Der JS/DOM-Pfad ist durchgängig
  4–6× schneller, weil er den Sammelschritt komplett überspringt.

### 5. Wo der Gleichstand läge

Der JS-Pfad spart die Sammelkosten, zahlt aber pro Regel mehr. Bei 31.000 Nodes:

- Sammelkosten WASM-Pfad: 79 ms (einmalig, unabhängig von der Regelzahl)
- Regeln: 7,9 ms in Rust vs. 21 ms in JS für dieselben 20 Regeln
  → etwa 0,40 ms/Regel (Rust) gegen 1,05 ms/Regel (JS), Differenz 0,65 ms

79 ms Sammelkosten amortisieren sich damit bei grob **120 Regeln**.

Diese Zahl ist eine lineare Hochrechnung aus einem Messpunkt und keine
Zusicherung. Zwei Dinge verschieben sie zugunsten von Rust:

- Die 20 Testregeln sind einfach. Aufwendige Regeln (Accessible-Name-Berechnung,
  Kontrast, Teilbaum-Analysen) begünstigen Rust stärker.
- Die Rust-Seite ist hier sogar benachteiligt: `subtree_text()` alloziert pro
  Aufruf einen `String`, während JS das native `textContent` nutzt. Ein
  optimierter Rust-Pfad wäre schneller als gemessen.

Der Zielbestand liegt bei 87 Regelmodulen mit jeweils mehreren Regeln — also
**in der Größenordnung des Gleichstands, vermutlich darüber.**

## Schlussfolgerung

Der Spike widerlegt nicht den WASM-Ansatz, aber er widerlegt die *Begründung*
über Performance. Für die In-Page-Oberfläche gilt:

- **Performance ist kein Argument für WASM.** Bei kleinen Regelmengen ist der
  JS-Pfad klar schneller; der Gleichstand liegt erst bei grob 120 Regeln.
- **Performance ist aber auch kein Argument dagegen.** 140 ms bei 50.000 Nodes
  sind für einen manuell ausgelösten Inspektor unproblematisch, und 22 KB gzip
  sind kein Bundle-Problem.
- **Das tragende Argument bleibt die Regel-Wiederverwendung** über
  astro-post-audit, auditmysite und LiveAudit
  mit identischen Rule-IDs — so wie in `docs/decisions.md` festgehalten.
  Die Entscheidung steht und fällt damit, nicht mit Millisekunden.

**Empfehlung:** Bei WASM bleiben, aber die Begründung in `docs/decisions.md`
ehrlich auf Wiederverwendung stützen statt auf Geschwindigkeit. Zusätzlich
aufnehmen, dass der Sammelschritt der Engpass ist — das hat Folgen für den
Live-Modus: Ein `MutationObserver`-getriebener Re-Scan darf **nur
geänderte Teilbäume** sammeln, niemals das ganze Dokument. Bei 79 ms pro
Vollscan wäre ein Scan-Sturm sonst sofort spürbar.

## Offen geblieben

- **Tier 3 nicht gemessen.** `getComputedStyle`/`getBoundingClientRect` pro Node
  sind nicht Teil dieses Spikes und mit hoher Wahrscheinlichkeit deutlich teurer
  als alles hier Gemessene. Gehört vor die Kontrastprüfung.
- **Nur Chromium.** Firefox und Safari haben andere DOM-Zugriffskosten.
- **Detached documents.** Gemessen wurde über `DOMParser`, nicht auf einer
  gerenderten Live-Seite. Für Tier 1 (kein Layout) sollte der Unterschied klein
  sein, geprüft ist es nicht.

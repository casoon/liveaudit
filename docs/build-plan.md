# Build Plan — LiveAudit

Was zu bauen ist, in Reihenfolge, mit Abnahmekriterien. Dieses Dokument ist der
Auftragszettel: Es setzt nur voraus, was in diesem Repository und in den
veröffentlichten Crates steht — keine Vorgeschichte.

**Vorher lesen:** [project-state.md](project-state.md) (Stand),
[architecture.md](architecture.md) (Arena, Tiers, Paketstruktur),
[decisions.md](decisions.md) (warum es so ist),
[constraints.md](constraints.md) (was das Werkzeug nicht kann),
[../spike/ERGEBNIS.md](../spike/ERGEBNIS.md) (gemessene Zahlen).

## Was steht

Die Schritte 1 bis 5 sind gebaut: Monorepo, DOM Collector, Rule Engine über der
Arena, Inspector-Layer und Auslieferungsmodell — dazu der Tier-3-Durchgang für
Kontrast und der Live-Modus über `MutationObserver`. Was das im Einzelnen
leistet, steht in [project-state.md](project-state.md); die Vorgaben, unter denen
es gebaut wurde, in [decisions.md](decisions.md). Sie gelten für jede Erweiterung
weiter: ein Host im Shadow Root, keine Mutation im geprüften Teilbaum, Zustand
und Schweregrad getrennt, `UNTESTED` sichtbar statt weggefiltert.

`spike/` enthält die lauffähige Vorstufe, aus der `packages/browser` entstanden
ist. Der Spike wird nicht weiterentwickelt; er bleibt als Beleg der Messung
stehen.

Der Regelbestand kommt fertig aus `a11y-rules` in
[barrierlab](https://github.com/casoon/barrierlab). Regeln werden in diesem
Repository **nicht** neu geschrieben. Fehlt eine Regel, gehört sie nach
`a11y-rules`, nicht hierher.

---

## 6 — Tier 4: Fokusreihenfolge, Zielgrößen, Reflow

**Ziel:** Die Prüfungen, die Interaktion oder Layoutänderung brauchen — und die
vierte Darstellungsvariante des Layers: nummerierte Marker über der
Tabreihenfolge.

**Vorbedingung:** Die Regeln existieren in `auditmysite` und wandern nach
`a11y-rules`, sobald die Tier-4-Traits dort bedient werden. In diesem Repository
entsteht der Adapter, nicht die Regel.

**Zu entscheiden beim Bau:** Fokusreihenfolge lässt sich nur durch tatsächliches
Fokussieren ermitteln. Ein Prüflauf, der den Fokus wandern lässt, verändert den
Zustand der Seite — anders als jede bisherige Phase. Wie das angekündigt und
zurückgesetzt wird, ist offen.

**Abnahme:** Auf einer Fixture mit bekannter Reihenfolge stimmen die
nummerierten Marker mit der tatsächlichen Tabreihenfolge überein. Ohne
Tier-4-Bedienung laufen die Regeln nicht und stehen mit Grund als nicht gelaufen
im Bericht, nicht als `PASS`. Nach dem
Lauf steht der Fokus wieder dort, wo er vorher stand.

---

## 7 — Konformitäts-Korpus

**Ziel:** Ein geteilter Fixture-Satz, der in LiveAudit, `astro-post-audit` und
`auditmysite` gegen den jeweils eigenen Adapter läuft.

*Grund:* Gepinnte Crate-Versionen halten den Code synchron, fangen aber nicht den
wahrscheinlichsten Fehler: „Regel feuert in der CLI, aber nicht in-page" ist ein
*Adapter*-Bug und in keinem der drei Repositories allein sichtbar.

**Abnahme:** Derselbe Fixture-Satz erzeugt in allen drei Oberflächen dieselben
Rule-IDs. Eine Abweichung ist ein Fehlschlag, keine Eigenheit der Oberfläche.

---

## 8 — Auslieferung als npm-Paket

**Ziel:** Was heute nur aus dem Repository gebaut werden kann, wird installierbar
— Self-Hosting bleibt der Weg, das Paket ersetzt nur das Selbstbauen.

**Vorgabe aus [decisions.md](decisions.md):** npm-Paket statt CDN. Kein zentral
gehostetes Script, auch nicht als Bequemlichkeitsvariante.

**Stand 29.09.2026: gebaut, Veröffentlichung von 0.1.0 steht aus.** Das Paket
heißt `@casoon/liveaudit`, liegt in `npm/` und trägt die gebauten Dateien; die
Versionsregel steht in [decisions.md](decisions.md). Offen bleibt nur der
`npm publish` — er braucht ein Einmal-Passwort.

**Abnahme:** Installation plus Kopieren der beiden Dateien in ein fremdes
Projekt ergibt einen lauffähigen Inspector, ohne dass dort Rust vorhanden sein
muss. Das Bundle-Budget gilt im Paket wie im Repository.

---

## 9 — Messung auf Firefox und Safari

**Ziel:** Die Zahlen in [project-state.md](project-state.md) stammen
ausschließlich aus Chromium. Firefox und Safari haben andere DOM-Zugriffskosten,
und der Collector ist der Engpass.

**Abnahme:** Collector- und Tier-3-Kosten für beide Engines gemessen und in
`project-state.md` neben den Chromium-Zahlen eingetragen. Die Browsertests laufen
über `--project=firefox` und `--project=webkit` grün, nicht nur über Chromium.

---

## 10 — Seitengewicht gegen gemeinsame Grenzwerte

**Ziel:** Das Seitengewicht nicht nur zeigen, sondern gegen ein Budget halten —
dasselbe, das auditmysite mit `[budgets]` kennt.

**Vorbedingung:** Die Kategorien und Grenzwerte (`max_js_kb`, `max_css_kb`,
`max_total_kb`, `max_third_party_kb`, `max_request_count`, LCP, CLS) liegen an
gemeinsamer Stelle in barrierlab, vermutlich in `web-checks`. LiveAudit misst
weiter selbst (`packages/browser/src/weight.ts`); geteilt wird, was gemessen
und wogegen verglichen wird.

**Abnahme:** Dieselbe Seite überschreitet in LiveAudit und auditmysite dieselben
Grenzen. Eine unbekannte Größe gilt nicht als unter der Grenze — sie macht die
Aussage für ihre Kategorie unsicher, und das steht dabei.

---

## Was ausdrücklich nicht in dieses Repository gehört

- **Regeln.** Die gehören nach `a11y-rules`.
- **Ein CLI.** Diese Rolle füllt `auditmysite`.
- **Build-/Quellcode-Analyse.** Die gehört zu `astro-post-audit`.
- **Alles, was den nativen Accessibility-Tree braucht** — Screenreader-
  Linearisierung, `name_source`, `ignored_reasons`. In-Page nicht erreichbar,
  bleibt bei `auditmysite`.
- **Seitenübergreifendes** — Crawl, Sitemap, hreflang, Redirects. LiveAudit ist
  naturgemäß Eine-Seite-zur-Zeit.

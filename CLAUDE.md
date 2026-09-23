# LiveAudit — Projektregeln

Eingebetteter Accessibility-Inspector: ein Script-Tag auf der geprüften Seite,
Befunde am betroffenen Element statt in einem externen Report.

**Zuerst lesen:** [docs/project-state.md](docs/project-state.md) für den Stand,
[docs/build-plan.md](docs/build-plan.md) für das, was zu bauen ist.

## Die vier Regeln, die am leichtesten verletzt werden

1. **Regeln gehören nicht in dieses Repository.** Der Regelbestand liegt in
   [a11y-core](https://github.com/casoon/a11y-core) und bedient auch
   `astro-post-audit` und `auditmysite`. Fehlt eine Regel, gehört sie dorthin.
   Eine Regel hier zu duplizieren bricht die Zusicherung, dass ein Befund überall
   gleich heißt.

2. **Keine Mutation innerhalb des geprüften Teilbaums.** Keine `data-*`-Attribute
   zur Element-Identifikation, keine Inline-Styles am Zielelement. Die Zuordnung
   läuft über `WeakMap<Element, NodeId>` im Speicher. Der Inspector-Layer selbst
   ist davon ausgenommen und hat dafür eigene Auflagen — siehe
   [docs/decisions.md](docs/decisions.md).

3. **„Nicht prüfbar" ist nicht „bestanden".** Eine Regel, deren Tier der Host
   nicht bedient, liefert `UNTESTED` — nicht `PASS` und nicht Schweigen. Das ist
   der fachliche Kern gegenüber Score-Werkzeugen, nicht eine Formalie.

4. **„Inspector-Layer", nicht „Overlay".** „Overlay" bezeichnet eine Kategorie
   von Werkzeugen, die die Seite zu *reparieren* vorgeben, und bleibt dieser
   Kategorie vorbehalten. Anbieter werden im Repository nicht namentlich genannt.
   In README und UI steht ausdrücklich: prüft, repariert nicht.

## Zwei Achsen, kein Score

`Outcome` (`FAIL`, `REVIEW`, `PASS`, `UNTESTED`) sagt, *wie sicher* die Aussage
ist. `Severity` (`Low` bis `Critical`) sagt, *wie schwer* das Problem wiegt. Eine
dritte Achse „certainty" gibt es bewusst nicht — eine nur heuristisch belegbare
Regel liefert `REVIEW`, nicht `FAIL` mit niedriger Gewissheit.

Nie zu einem Prozentwert verrechnen.

## Stack

- **Rust → WASM** über `wasm-pack --target web`, für `packages/core`
- **TypeScript** für Collector und UI, **kein Framework zur Laufzeit** —
  das UI ist eigenes DOM im Shadow Root, eine Framework-Runtime im Bundle wäre
  gegen das Bundle-Budget
- **Node ≥ 22**, pnpm-Workspace
- **Biome** für Lint und Format (kein ESLint, kein Prettier)

## Was gemessen ist und nicht neu diskutiert werden muss

Aus [spike/ERGEBNIS.md](spike/ERGEBNIS.md), gemessen am 18.09.2026 an fünf realen
Dokumenten von 1.244 bis 723.613 Knoten:

- Der Arena-Aufbau über die WASM-Grenze kostet **0,5 ms bei 31.000 Knoten**. Die
  Grenze ist kein Engpass.
- Der Engpass ist die **DOM-Traversierung in JavaScript** — 79 ms bei 31.000
  Knoten, rund 90 % der Gesamtzeit. Optimierungsarbeit gehört in den Collector.
- Die WASM-Größe liegt bei **22 KB gzip** für Arena plus 20 Regeln.
- Eine reine TypeScript-Implementierung derselben Regeln wäre 4–6× schneller.
  **Performance ist deshalb weder Argument für noch gegen WASM** — die Begründung
  ist die Regel-Wiederverwendung über drei Oberflächen.

## Arbeitsweise

- Vor größeren Änderungen `docs/` lesen; bei Konflikt zwischen Code und `docs/`
  ist das ein Befund, kein Freibrief.
- Nach substanziellen Änderungen `docs/project-state.md` nachziehen.
- Zielgerichtet prüfen: typecheck, lint, betroffene Tests. Nicht pauschal die
  ganze Suite.
- Keine `Co-Authored-By`-Trailer in Commit-Nachrichten.
- `plan/` ist lokal und gitignored — Inhalte daraus nie als committete Doku
  voraussetzen.

## Verwandte Repositories

| Repository | Rolle |
|---|---|
| [a11y-core](https://github.com/casoon/a11y-core) | der gemeinsame Regelkern |
| [astro-post-audit](https://github.com/casoon/astro-post-audit) | derselbe Kern zur Build-Zeit |
| [auditmysite](https://github.com/casoon/auditmysite) | derselbe Kern in CI und Crawl |

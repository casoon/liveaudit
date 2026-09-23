/**
 * Die Rechenregeln des Live-Modus, ohne Browser.
 *
 * Der `MutationObserver` und die Marker gehören in einen echten Browser und
 * stehen in `tests/browser/live.spec.ts`. Was hier geprüft wird, ist die
 * Algebra darunter: Welche Wurzeln bleiben übrig, was überlebt einen
 * Teil-Neuscan, und was darf ein Fragment über sich behaupten.
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { mergeSubtrees, minimaleWurzeln } from "../src/live.ts";
import { scan } from "../src/scan.ts";
import { initWasm, parse } from "./helpers.ts";

before(() => initWasm());

const SEITE = `<!doctype html><html lang="de"><head><title>Live</title>
  <meta name="viewport" content="width=device-width, initial-scale=1"></head><body>
  <a href="#inhalt">Zum Inhalt</a>
  <header><nav aria-label="Haupt"><a href="/">Start</a></nav></header>
  <main id="inhalt"><h1>Live</h1>
    <div id="bereich"><p>Text</p></div>
    <div id="daneben"><button type="button" id="ohne-namen"></button></div>
  </main>
  <footer>Fuß</footer></body></html>`;

/** Die Kennungen aller Befunde über alle Geltungsbereiche. */
function kennungen(ergebnis: { documents: { report: { findings: { rule_id: string }[] } }[] }) {
  return ergebnis.documents.flatMap((d) => d.report.findings.map((f) => f.rule_id));
}

describe("minimaleWurzeln", () => {
  it("lässt von verschachtelten Zielen nur das äußerste übrig", () => {
    const doc = parse(SEITE);
    const main = doc.getElementById("inhalt") as Element;
    const bereich = doc.getElementById("bereich") as Element;
    const absatz = bereich.firstElementChild as Element;

    assert.deepEqual(minimaleWurzeln([absatz, main, bereich]), [main]);
  });

  it("behält nebeneinanderliegende Ziele und wirft abgehängte weg", () => {
    const doc = parse(SEITE);
    const bereich = doc.getElementById("bereich") as Element;
    const daneben = doc.getElementById("daneben") as Element;
    const weg = doc.createElement("div");

    assert.deepEqual(minimaleWurzeln([bereich, daneben, weg]), [bereich, daneben]);
  });
});

describe("mergeSubtrees", () => {
  it("tauscht den geänderten Teilbaum aus und lässt den Rest stehen", () => {
    const doc = parse(SEITE);
    const vorher = scan(doc.documentElement);
    assert.ok(!kennungen(vorher).includes("images/alt-missing"));

    // Die Seite ändert sich: ein Bild ohne Alt-Text in den Bereich.
    const bereich = doc.getElementById("bereich") as Element;
    const bild = doc.createElement("img");
    bild.setAttribute("src", "logo.png");
    bereich.append(bild);

    const nachher = mergeSubtrees(vorher, [{ wurzel: bereich, ergebnis: scan(bereich) }]);
    const ids = kennungen(nachher);

    assert.ok(ids.includes("images/alt-missing"), "der neue Befund fehlt");
    assert.ok(ids.includes("buttons/name-missing"), "der Befund daneben ist verlorengegangen");
    // Der Teilbaum kommt als eigener Geltungsbereich dazu — eigener ID-Raum,
    // wie bei einem Frame.
    assert.equal(nachher.documents.length, 2);
    assert.equal(nachher.documents[1]?.idToElement.get(0), bereich);
  });

  it("gibt einem Fragment keine Aussagen über das Dokument", () => {
    const doc = parse(SEITE);
    const vorher = scan(doc.documentElement);
    const bereich = doc.getElementById("bereich") as Element;

    // Für sich allein gescannt hält der Bereich sich für ein Dokument ohne
    // Titel, ohne h1 und ohne main-Landmark.
    const allein = kennungen(scan(bereich));
    assert.ok(allein.some((id) => id.startsWith("landmarks/")));

    const nachher = mergeSubtrees(vorher, [{ wurzel: bereich, ergebnis: scan(bereich) }]);
    const ausDemTeilbaum = nachher.documents[1]?.report.findings ?? [];

    assert.deepEqual(
      ausDemTeilbaum.filter((f) => Number(f.location?.node ?? 0) === 0),
      [],
      "ein Teilbaum ist kein Dokument",
    );
  });

  it("nimmt einen entfernten Befund mit und räumt die Zuordnung auf", () => {
    const doc = parse(SEITE);
    const vorher = scan(doc.documentElement);
    assert.ok(kennungen(vorher).includes("buttons/name-missing"));

    const daneben = doc.getElementById("daneben") as Element;
    const knopf = doc.getElementById("ohne-namen") as Element;
    const idVorher = vorher.documents[0]?.elementToId.get(knopf) as number;
    knopf.remove();

    const nachher = mergeSubtrees(vorher, [{ wurzel: daneben, ergebnis: scan(daneben) }]);

    assert.ok(!kennungen(nachher).includes("buttons/name-missing"));
    // Sonst hielte die Zuordnung abgehängte Knoten fest.
    assert.equal(nachher.documents[0]?.idToElement.get(idVorher), undefined);
  });

  it("behält die dokumentweiten Befunde des letzten Vollscans", () => {
    const ohneMain = parse(`<!doctype html><html lang="de"><head><title>T</title></head>
      <body><h1>T</h1><div id="bereich"><p>Text</p></div></body></html>`);
    const vorher = scan(ohneMain.documentElement);
    const dokumentweit = kennungen(vorher).filter((id) => id.startsWith("landmarks/"));
    assert.ok(dokumentweit.length > 0);

    const bereich = ohneMain.getElementById("bereich") as Element;
    const nachher = mergeSubtrees(vorher, [{ wurzel: bereich, ergebnis: scan(bereich) }]);

    assert.deepEqual(
      kennungen(nachher).filter((id) => id.startsWith("landmarks/")),
      dokumentweit,
    );
  });
});

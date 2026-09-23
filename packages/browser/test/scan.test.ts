import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { elementOf, scan } from "../src/scan.ts";
import { initWasm, parse } from "./helpers.ts";

before(() => initWasm());

/** Die Kennungen aller Befunde eines Dokuments. */
function ruleIds(report: { findings: { rule_id: string }[] }): Set<string> {
  return new Set(report.findings.map((f) => f.rule_id));
}

describe("Regelbestand über der Arena", () => {
  it("erzeugt für bekannte Fehler die erwarteten Rule-IDs", () => {
    const doc = parse(`<!doctype html><html><head><title></title></head><body>
      <h3>Übersprungene Ebene</h3>
      <img src="logo.png">
      <input type="text" id="dup">
      <span id="dup"></span>
      <a href="/a"></a>
      <button tabindex="3"></button>
    </body></html>`);

    const result = scan(doc.documentElement);
    const ids = ruleIds(result.documents[0]?.report as { findings: { rule_id: string }[] });

    for (const erwartet of [
      "document/lang-missing",
      "document/title-empty",
      "headings/h1-missing",
      "images/alt-missing",
      "forms/label-missing",
      "ids/duplicate",
      "links/name-missing",
      "buttons/name-missing",
      "keyboard/positive-tabindex",
    ]) {
      assert.ok(ids.has(erwartet), `${erwartet} fehlt in ${[...ids].join(", ")}`);
    }
  });

  it("findet ein vollständiges Dokument fehlerfrei", () => {
    // Seit a11y-rules 0.8.0 genügt ein bloß wohlgeformtes Dokument nicht mehr:
    // main, navigation, banner und contentinfo sind eigene Erwartungen, und der
    // Sprunglink ist es auch. Die Vorlage hält fest, was "vollständig" heißt.
    const doc = parse(`<!doctype html><html lang="de"><head><title>Seite</title>
      <meta name="viewport" content="width=device-width, initial-scale=1"></head>
      <body>
        <a href="#inhalt" class="skip-link">Zum Inhalt springen</a>
        <header><nav><a href="/">Start</a></nav></header>
        <main id="inhalt"><h1>Titel</h1><p>Text.</p></main>
        <footer>Impressum</footer>
      </body></html>`);

    const report = scan(doc.documentElement).documents[0]?.report;
    assert.deepEqual(ruleIds(report as { findings: { rule_id: string }[] }), new Set());
  });

  it("meldet fehlende Landmarks als REVIEW, außer main", () => {
    // Zwei Achsen: main fehlt nachweislich, eine Navigation zu erwarten ist
    // dagegen eine Annahme. Der Unterschied steht im Outcome, nicht in einer
    // dritten Achse für Gewissheit.
    const doc = parse(`<!doctype html><html lang="de"><head><title>Seite</title>
      <meta name="viewport" content="width=device-width, initial-scale=1"></head>
      <body><h1>Titel</h1></body></html>`);

    const report = scan(doc.documentElement).documents[0]?.report;
    const outcome = (id: string) => report?.findings.find((f) => f.rule_id === id)?.outcome;
    assert.equal(outcome("landmarks/main-missing"), "fail");
    assert.equal(outcome("landmarks/navigation-missing"), "review");
    assert.equal(outcome("keyboard/skip-link-missing"), "review");
    assert.equal(outcome("zoom/viewport-missing"), undefined);
  });

  it("löst den Arena-Index eines Befunds auf das reale Element auf", () => {
    const doc = parse('<html lang="de"><body><h1>T</h1><img src="logo.png"></body></html>');
    const scanned = scan(doc.documentElement).documents[0];
    assert.ok(scanned);

    const finding = scanned.report.findings.find((f) => f.rule_id === "images/alt-missing");
    assert.ok(finding);
    assert.equal(elementOf(scanned, finding), doc.querySelector("img"));
  });

  it("berechnet den Accessible Name in Rust, nicht im Collector", () => {
    // Der Name steht nur über aria-labelledby zur Verfügung; eine Näherung aus
    // Teilbaumtext würde hier einen Fehler melden.
    const doc = parse(`<html lang="de"><head><title>T</title></head><body><h1>T</h1>
      <span id="l">Weiterlesen</span><a href="/a" aria-labelledby="l"></a></body></html>`);

    const report = scan(doc.documentElement).documents[0]?.report;
    assert.ok(!ruleIds(report as { findings: { rule_id: string }[] }).has("links/name-missing"));
  });
});

describe("Nicht gelaufen ist nicht bestanden", () => {
  it("gibt keine Regel als bestanden aus, die nicht geprüft wurde", () => {
    const doc = parse('<html lang="de"><head><title>T</title></head><body></body></html>');
    const report = scan(doc.documentElement).documents[0]?.report;
    assert.ok(report);
    assert.equal(report.summary.pass, 0);
    for (const run of report.rule_runs) {
      if (run.not_run !== undefined) assert.equal(run.findings, 0);
    }
  });

  it("bedient Tier 2, weil accname Rolle und Name liefert", () => {
    const doc = parse('<html lang="de"><head><title>T</title></head><body></body></html>');
    const report = scan(doc.documentElement).documents[0]?.report;
    assert.ok(
      report?.rule_runs.some((r) => r.rule_id === "links/name-missing" && r.not_run === undefined),
    );
  });

  it("vermerkt Tier 3 als nicht gelaufen, solange der Durchgang nicht lief", () => {
    // Ohne den Rendering-Durchgang hat der Host keine berechneten Stile. Die
    // Kontrastregeln verschwinden deshalb nicht aus dem Bericht -- sie stehen
    // mit capability_missing darin. Das ist der Unterschied zu Werkzeugen, die
    // eine nicht gepruefte Regel als bestanden zaehlen.
    const doc = parse('<html lang="de"><head><title>T</title></head><body></body></html>');
    const report = scan(doc.documentElement).documents[0]?.report;
    const offen = report?.rule_runs.filter((r) => r.not_run !== undefined).map((r) => r.rule_id);
    assert.deepEqual(offen, ["contrast/text-insufficient", "contrast/text-undetermined"]);
    assert.equal(report?.summary.pass, 0);
  });

  it("vermerkt jeden Befund unter derselben Kennung, unter der er gemeldet wird", () => {
    // rule_runs und findings benutzen seit a11y-rules 0.2.0 dieselbe
    // Namensmenge. Waere das nicht so, liefe ein Join ueber rule_id ins Leere.
    const doc = parse('<html><head></head><body><img src="a.png"></body></html>');
    const report = scan(doc.documentElement).documents[0]?.report;
    const vermerkt = new Set(report?.rule_runs.map((r) => r.rule_id));
    for (const f of report?.findings ?? []) {
      assert.ok(vermerkt.has(f.rule_id), `Befund ${f.rule_id} ohne Ausfuehrungsvermerk`);
    }
    assert.ok((report?.findings.length ?? 0) > 0);
  });
});

describe("iframes", () => {
  it("scannt ein Same-Origin-Frame als eigenes Dokument mit eigenem ID-Raum", () => {
    const doc = parse(
      '<html lang="de"><head><title>T</title></head><body><h1>T</h1><iframe></iframe></body></html>',
    );
    const iframe = doc.querySelector("iframe") as HTMLIFrameElement;
    const inner = iframe.contentDocument as Document;
    inner.documentElement.innerHTML = '<body><img src="i.png"><span id="dup"></span></body>';
    // Dieselbe ID wie außen wäre bei einer gemeinsamen Arena ein Fehlbefund.
    doc.body.insertAdjacentHTML("beforeend", '<span id="dup"></span>');

    const result = scan(doc.documentElement);
    assert.equal(result.documents.length, 2);

    const aussen = result.documents[0];
    const innen = result.documents[1];
    assert.ok(aussen && innen);
    assert.equal(innen.parent?.document, 0);
    assert.ok(!ruleIds(aussen.report).has("ids/duplicate"));
    assert.ok(ruleIds(innen.report).has("images/alt-missing"));
  });

  it("meldet ein unerreichbares Frame als UNTESTED statt es zu übergehen", () => {
    const doc = parse(
      '<html lang="de"><head><title>T</title></head><body><h1>T</h1><iframe src="https://fremd.example/"></iframe></body></html>',
    );
    const iframe = doc.querySelector("iframe") as Element;
    Object.defineProperty(iframe, "contentDocument", { get: () => null });

    const result = scan(doc.documentElement);
    assert.equal(result.documents.length, 1);

    const scanned = result.documents[0];
    assert.ok(scanned);
    assert.equal(scanned.untested.length, 1);
    assert.equal(scanned.untested[0]?.reason, "cross-origin-frame");
    assert.equal(scanned.untested[0]?.src, "https://fremd.example/");
    // Der Geltungsbereich zeigt auf das <iframe> selbst, nicht irgendwohin.
    assert.equal(scanned.idToElement.get(scanned.untested[0]?.node as number), iframe);
  });
});

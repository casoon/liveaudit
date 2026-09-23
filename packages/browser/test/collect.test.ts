import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { collect, countNodes } from "../src/collect.ts";
import { parse, walkerCount } from "./helpers.ts";

/** Die internierten Namen eines Dictionaries. */
function names(dict: string): string[] {
  return dict === "" ? [] : dict.split("");
}

/** Der Tagname eines Arena-Knotens. */
function tagOf(columns: { tag: Uint32Array; tagDict: string }, index: number): string {
  return names(columns.tagDict)[columns.tag[index] as number] as string;
}

describe("Knotenzahl", () => {
  it("stimmt mit einem TreeWalker-Zähllauf überein", () => {
    const doc = parse(`<!doctype html><html lang="de"><head><title>T</title></head>
      <body><!-- Kommentar --><main><h1>Titel</h1><p>Ein <a href="/x">Link</a>.</p>
      <ul><li>a</li><li>b</li></ul><img src="i.png" alt=""></main></body></html>`);
    const root = doc.documentElement;

    const collected = collect(root);
    assert.equal(collected.columns.nodes, walkerCount(root));
    assert.equal(collected.columns.nodes, countNodes(root));
  });

  it("zählt Kommentare nicht mit", () => {
    const doc = parse("<html><body><!-- x --><p>a</p></body></html>");
    const collected = collect(doc.documentElement);
    assert.equal(collected.columns.nodes, walkerCount(doc.documentElement));
  });
});

describe("Spaltenformat", () => {
  it("hält die Wurzel auf Index 0 und die Elternspalte auf -1", () => {
    const doc = parse("<html><body><p>a</p></body></html>");
    const c = collect(doc.documentElement).columns;
    assert.equal(tagOf(c, 0), "html");
    assert.equal(c.parent[0], -1);
  });

  it("adressiert Attribute über einen Bereich mit Sentinel", () => {
    const doc = parse('<html lang="de" dir="ltr"><body></body></html>');
    const c = collect(doc.documentElement).columns;
    assert.equal(c.attrStart.length, c.nodes + 1);
    assert.equal((c.attrStart[1] as number) - (c.attrStart[0] as number), 2);
    assert.equal(c.attrStart[c.nodes], c.attrName.length);
  });

  it("kodiert Text als UTF-8 in einem einzigen Blob", () => {
    const doc = parse("<html><body><p>Grüße</p></body></html>");
    const c = collect(doc.documentElement).columns;
    const text = new TextDecoder().decode(c.blob);
    assert.ok(text.includes("Grüße"));
  });
});

describe("Element-Identität", () => {
  it("bildet Elemente in beide Richtungen ab, ohne den DOM zu verändern", () => {
    const doc = parse('<html><body><a href="/x">Link</a></body></html>');
    const vorher = doc.documentElement.outerHTML;

    const { elementToId, idToElement } = collect(doc.documentElement);
    const link = doc.querySelector("a") as Element;
    const id = elementToId.get(link);

    assert.equal(typeof id, "number");
    assert.equal(idToElement.get(id as number), link);
    assert.equal(doc.documentElement.outerHTML, vorher);
  });

  it("nimmt keine Textknoten in die Zuordnung auf", () => {
    const doc = parse("<html><body><p>a</p></body></html>");
    const { idToElement, columns } = collect(doc.documentElement);
    for (const [id] of idToElement) {
      assert.notEqual(tagOf(columns, id), "#text");
    }
  });
});

describe("Ausschluss des eigenen Hosts", () => {
  it("lässt <liveaudit-inspector> und seinen Inhalt aus dem Scan", () => {
    const ohne = parse("<html><body><p>a</p></body></html>");
    const mit = parse(
      "<html><body><p>a</p><liveaudit-inspector><div>Panel</div></liveaudit-inspector></body></html>",
    );

    const a = collect(ohne.documentElement).columns;
    const b = collect(mit.documentElement).columns;

    assert.equal(b.nodes, a.nodes);
    assert.ok(!names(b.tagDict).includes("liveaudit-inspector"));
  });
});

describe("Shadow DOM", () => {
  it("nimmt offene Shadow Roots als flachen Baum mit", () => {
    const doc = parse("<html><body><my-card></my-card></body></html>");
    const host = doc.querySelector("my-card") as Element;
    host.attachShadow({ mode: "open" }).innerHTML = "<button>Mehr</button>";

    const c = collect(doc.documentElement).columns;
    const tags = Array.from({ length: c.nodes }, (_, i) => tagOf(c, i));
    assert.ok(tags.includes("button"), tags.join(","));
  });

  it("erreicht Licht-Kinder über <slot>, nicht über den Host", () => {
    const doc = parse("<html><body><my-card><span>Inhalt</span></my-card></body></html>");
    const host = doc.querySelector("my-card") as Element;
    host.attachShadow({ mode: "open" }).innerHTML = "<div><slot></slot></div>";

    const { columns, elementToId } = collect(doc.documentElement);
    const span = doc.querySelector("span") as Element;
    const slotIndex = Array.from({ length: columns.nodes }, (_, i) => i).find(
      (i) => tagOf(columns, i) === "slot",
    );

    assert.notEqual(slotIndex, undefined);
    // Genau einmal im Baum, und zwar unterhalb des Slots.
    assert.equal(columns.parent[elementToId.get(span) as number], slotIndex);
  });

  it("lässt nicht zugewiesene Licht-Kinder weg — sie werden nicht gerendert", () => {
    const doc = parse("<html><body><my-card><span>Inhalt</span></my-card></body></html>");
    const host = doc.querySelector("my-card") as Element;
    host.attachShadow({ mode: "open" }).innerHTML = "<div>nur Shadow</div>";

    const { elementToId } = collect(doc.documentElement);
    assert.equal(elementToId.get(doc.querySelector("span") as Element), undefined);
  });

  it("nimmt den Ersatzinhalt eines leeren Slots mit", () => {
    const doc = parse("<html><body><my-card></my-card></body></html>");
    const host = doc.querySelector("my-card") as Element;
    host.attachShadow({ mode: "open" }).innerHTML = "<slot><em>Ersatz</em></slot>";

    const c = collect(doc.documentElement).columns;
    const tags = Array.from({ length: c.nodes }, (_, i) => tagOf(c, i));
    assert.ok(tags.includes("em"), tags.join(","));
  });
});

describe("iframes", () => {
  it("betritt kein <iframe>, sondern meldet es als eigenen Geltungsbereich", () => {
    const doc = parse('<html><body><iframe src="/eingebettet"></iframe></body></html>');
    const { columns, frames } = collect(doc.documentElement);

    assert.equal(frames.length, 1);
    assert.equal(frames[0]?.src, "/eingebettet");
    assert.equal(tagOf(columns, frames[0]?.node as number), "iframe");
  });

  it("hält ein noch nicht navigiertes Frame für unerreichbar", () => {
    // Solange die Navigation eines Frames läuft, zeigt contentDocument im
    // Browser noch das anfängliche about:blank. Dieses leere Dokument zu
    // prüfen erzeugt Fehlbefunde über ein Dokument, das nicht das gemeinte ist.
    const doc = parse('<html><body><iframe src="https://fremd.example/"></iframe></body></html>');
    const iframe = doc.querySelector("iframe") as Element;
    const leer = parse("");
    Object.defineProperty(iframe, "contentDocument", { get: () => leer });
    assert.equal(leer.URL, "about:blank");

    const { frames } = collect(doc.documentElement);
    assert.equal(frames[0]?.document, null);
  });

  it("betritt ein Frame ohne src, dessen Dokument bereits steht", () => {
    const doc = parse("<html><body><iframe></iframe></body></html>");
    const { frames } = collect(doc.documentElement);

    assert.notEqual(frames[0]?.document, null);
  });

  it("meldet ein unerreichbares Dokument als null statt zu werfen", () => {
    const doc = parse('<html><body><iframe src="https://fremd.example/"></iframe></body></html>');
    const iframe = doc.querySelector("iframe") as Element;
    // Ein Cross-Origin-Frame liefert im Browser genau das: null.
    Object.defineProperty(iframe, "contentDocument", { get: () => null });

    const { frames } = collect(doc.documentElement);
    assert.equal(frames[0]?.document, null);
  });
});

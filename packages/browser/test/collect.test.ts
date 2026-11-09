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

describe("Baumbereiche", () => {
  /** Der Bereich des Knotens zu `el`. */
  const scopeOf = (c: ReturnType<typeof collect>, el: Element): number =>
    c.columns.scopes?.[c.elementToId.get(el) as number] as number;

  it("lässt die Spalte weg, solange kein Shadow Root betreten wurde", () => {
    const doc = parse("<html><body><p>Text</p></body></html>");
    assert.equal(collect(doc.documentElement).columns.scopes, null);
  });

  it("gibt jedem Shadow Root einen eigenen Bereich, das Dokument bleibt 0", () => {
    const doc = parse("<html><body><span id='a'>a</span><my-a></my-a><my-b></my-b></body></html>");
    const a = doc.querySelector("my-a") as Element;
    const b = doc.querySelector("my-b") as Element;
    a.attachShadow({ mode: "open" }).innerHTML = "<b id='in-a'>x</b><i>y</i>";
    b.attachShadow({ mode: "open" }).innerHTML = "<b id='in-b'>x</b>";

    const c = collect(doc.documentElement);
    const inA = (a.shadowRoot as ShadowRoot).querySelector("b") as Element;
    const inB = (b.shadowRoot as ShadowRoot).querySelector("b") as Element;

    assert.equal(c.columns.scopes?.length, c.columns.nodes);
    assert.equal(scopeOf(c, doc.querySelector("span") as Element), 0);
    assert.equal(scopeOf(c, a), 0, "der Host steht im Baum seines Elternteils");
    assert.notEqual(scopeOf(c, inA), 0);
    assert.notEqual(scopeOf(c, inB), 0);
    assert.notEqual(scopeOf(c, inA), scopeOf(c, inB));
    // Alles unterhalb des Shadow Roots, auch Textknoten und Geschwister.
    assert.equal(
      scopeOf(c, (a.shadowRoot as ShadowRoot).querySelector("i") as Element),
      scopeOf(c, inA),
    );
  });

  it("lässt einen zugewiesenen Knoten im Baum seines Hosts, nicht in dem des Slots", () => {
    const doc = parse("<html><body><my-card><span id='licht'>Licht</span></my-card></body></html>");
    const host = doc.querySelector("my-card") as Element;
    host.attachShadow({ mode: "open" }).innerHTML = "<div id='schatten'><slot></slot></div>";

    const c = collect(doc.documentElement);
    const licht = doc.getElementById("licht") as Element;
    const schatten = (host.shadowRoot as ShadowRoot).getElementById("schatten") as Element;
    const slot = (host.shadowRoot as ShadowRoot).querySelector("slot") as Element;

    assert.notEqual(scopeOf(c, schatten), 0);
    assert.equal(scopeOf(c, slot), scopeOf(c, schatten));
    // Im flachen Baum hängt das Licht-Kind unter dem Slot, seine IDs gehören aber dem Dokument.
    assert.equal(c.columns.parent[c.elementToId.get(licht) as number], c.elementToId.get(slot));
    assert.equal(scopeOf(c, licht), 0);
  });

  it("gibt dem Ersatzinhalt eines Slots den Bereich des Slots", () => {
    const doc = parse("<html><body><my-card></my-card></body></html>");
    const host = doc.querySelector("my-card") as Element;
    host.attachShadow({ mode: "open" }).innerHTML = "<slot><em>Ersatz</em></slot>";

    const c = collect(doc.documentElement);
    const em = (host.shadowRoot as ShadowRoot).querySelector("em") as Element;
    assert.notEqual(scopeOf(c, em), 0);
  });

  it("nummeriert verschachtelte Shadow Roots einzeln und beginnt in einem Teilbaum bei 0", () => {
    const doc = parse("<html><body><my-a></my-a></body></html>");
    const a = doc.querySelector("my-a") as Element;
    const wurzelA = a.attachShadow({ mode: "open" });
    wurzelA.innerHTML = "<my-b></my-b>";
    (wurzelA.querySelector("my-b") as Element).attachShadow({ mode: "open" }).innerHTML =
      "<u>tief</u>";

    const c = collect(doc.documentElement);
    const tief = (
      (wurzelA.querySelector("my-b") as Element).shadowRoot as ShadowRoot
    ).querySelector("u") as Element;
    const bereiche = new Set([
      0,
      scopeOf(c, wurzelA.querySelector("my-b") as Element),
      scopeOf(c, tief),
    ]);
    assert.equal(bereiche.size, 3);

    // Ein Teilbaum-Scan mitten in einem Shadow Root: sein eigener Baum ist 0.
    const teil = collect(wurzelA.querySelector("my-b") as Element);
    assert.equal(teil.columns.scopes?.[0], 0);
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

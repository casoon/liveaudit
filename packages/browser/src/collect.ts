/**
 * Der DOM Collector: aus dem Live-DOM eine Arena.
 *
 * Portiert aus `spike/harness/collect2.js`. Dessen Optimierungen sind gemessen
 * (152 ms → 79 ms bei 31.000 Knoten) und hier bewusst unverändert übernommen:
 *
 * - Typed Arrays vorab dimensioniert über eine `TreeWalker`-Zählung, die nativ
 *   und billig ist,
 * - `encodeInto` in einen wachsenden Puffer statt `encode()` je String,
 * - keine Array-Allokation pro Knoten — zwei parallele Stacks statt Tupel,
 * - Objekt ohne Prototyp statt `Map` für die Namens-Dictionaries.
 *
 * Dazu kommen die drei Entscheidungen aus `docs/decisions.md`: offene Shadow
 * Roots werden als flacher Baum mitgenommen, `<iframe>` wird nicht betreten
 * sondern als eigener Geltungsbereich gemeldet, und der eigene Host
 * `<liveaudit-inspector>` bleibt aus dem Scan heraus.
 */

/** Trennzeichen der internierten Namen. Kommt in Tag- und Attributnamen nicht vor. */
const SEP = "";

/** `NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT` — als Zahl, damit der
 * Collector nicht von einem globalen `NodeFilter` abhängt. */
const SHOW_ELEMENT_AND_TEXT = 0x1 | 0x4;

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/** Der Tagname, unter dem Textknoten interniert werden. Ein Element kann so
 * nicht heißen. Muss zu `TEXT_TAG` in `packages/core` passen. */
const TEXT_TAG = "#text";

/** Der eigene Inspector-Host. Er prüft sich nicht selbst. */
export const HOST_TAG_NAME = "liveaudit-inspector";

/**
 * Der Knotentyp eines `DocumentFragment` — und damit auch eines Shadow Roots.
 *
 * Kein `instanceof ShadowRoot`: Ein Same-Origin-Rahmen ist ein eigenes Realm
 * mit eigenen Konstruktoren, und der Vergleich schlüge dort fehl. Der Knotentyp
 * ist realmübergreifend derselbe.
 */
const DOCUMENT_FRAGMENT_NODE = 11;

/**
 * Das Elternteil im **flachen Baum** — der Gegenrichtung zu dem, was der
 * Collector oben absteigt.
 *
 * `parentElement` beantwortet die falsche Frage, sobald Shadow DOM im Spiel
 * ist: Am obersten Element eines Shadow Roots ist es `null`, obwohl der Host
 * darüber steht, und an einem geslotteten Element zeigt es in den Licht-DOM,
 * während das Element im flachen Baum unter seinem Slot hängt.
 *
 * Zwei Module brauchen genau diesen Weg: der Tier-3-Durchgang für die Fläche
 * hinter dem Text, und der Live-Modus für die Frage, ob ein Element unter einem
 * geänderten Teilbaum liegt.
 */
export function flatParent(el: Element): Element | null {
  const slot = el.assignedSlot;
  if (slot !== null) return slot;

  const eltern: Node | null = el.parentNode;
  if (eltern !== null && eltern.nodeType === DOCUMENT_FRAGMENT_NODE && "host" in eltern) {
    return (eltern as ShadowRoot).host;
  }

  return el.parentElement;
}

/** Die Spalten, die über die WASM-Grenze gehen. */
export interface ArenaColumns {
  tag: Uint32Array;
  parent: Int32Array;
  textOff: Uint32Array;
  textLen: Uint32Array;
  /** `n + 1` Einträge: Knoten `i` besitzt `[attrStart[i], attrStart[i + 1])`. */
  attrStart: Uint32Array;
  attrName: Uint32Array;
  attrValOff: Uint32Array;
  attrValLen: Uint32Array;
  /** Ein einziger UTF-8-Puffer für alle Texte und Attributwerte. */
  blob: Uint8Array;
  tagDict: string;
  attrDict: string;
  nodes: number;
}

/** Ein angetroffenes `<iframe>`. Ein Frame ist ein eigenes Dokument mit eigenem
 * ID-Raum und wird deshalb eigenständig gescannt, nicht eingebettet. */
export interface FrameRef {
  /** Arena-Index des `<iframe>`-Elements im umgebenden Dokument. */
  node: number;
  element: Element;
  /** Das Dokument des Frames, oder `null` wenn es nicht erreichbar ist. */
  document: Document | null;
  /** Der `src`-Wert, zur Einordnung eines nicht erreichbaren Frames. */
  src: string | null;
}

export interface Collected {
  columns: ArenaColumns;
  /** Element-Identität ohne Mutation des geprüften Teilbaums. */
  elementToId: WeakMap<Element, number>;
  idToElement: Map<number, Element>;
  frames: FrameRef[];
}

/**
 * Zählt Element- und Textknoten unterhalb von `root` mit einem nativen
 * `TreeWalker`.
 *
 * Die Zählung ist eine Vorabdimensionierung, keine Zusicherung: Offene Shadow
 * Roots sieht der `TreeWalker` nicht, dort wachsen die Spalten geometrisch
 * nach. Für Dokumente ohne Shadow DOM — den Normalfall — trifft sie exakt.
 */
export function countNodes(root: Element): number {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, SHOW_ELEMENT_AND_TEXT);
  let n = 1;
  while (walker.nextNode()) n++;
  return n;
}

function growU32(src: Uint32Array<ArrayBuffer>, capacity: number): Uint32Array<ArrayBuffer> {
  const next = new Uint32Array(capacity);
  next.set(src);
  return next;
}

/**
 * Sammelt den Baum ab `root` in die Arena-Spalten.
 *
 * Betritt keine `<iframe>`; die werden als [`FrameRef`] gemeldet und vom
 * Aufrufer eigenständig gescannt.
 */
export function collect(root: Element): Collected {
  const estimate = countNodes(root);

  let nodeCap = estimate;
  let tag = new Uint32Array(nodeCap);
  let parent = new Int32Array(nodeCap);
  let textOff = new Uint32Array(nodeCap);
  let textLen = new Uint32Array(nodeCap);
  let attrStart = new Uint32Array(nodeCap + 1);

  // Attribute wachsen geometrisch; 2 pro Knoten ist ein brauchbarer Startwert.
  let attrCap = Math.max(16, estimate * 2);
  let attrName = new Uint32Array(attrCap);
  let attrValOff = new Uint32Array(attrCap);
  let attrValLen = new Uint32Array(attrCap);
  let attrN = 0;

  let blobCap = Math.max(1024, estimate * 16);
  let blob = new Uint8Array(blobCap);
  let blobN = 0;

  const enc = new TextEncoder();
  const tagDict: Record<string, number> = Object.create(null);
  const tagNames: string[] = [];
  const attrDict: Record<string, number> = Object.create(null);
  const attrNames: string[] = [];

  const elementToId = new WeakMap<Element, number>();
  const idToElement = new Map<number, Element>();
  const frames: FrameRef[] = [];

  const growBlob = (need: number): void => {
    if (blobN + need <= blobCap) return;
    while (blobN + need > blobCap) blobCap *= 2;
    const next = new Uint8Array(blobCap);
    next.set(blob.subarray(0, blobN));
    blob = next;
  };

  const growAttrs = (): void => {
    if (attrN < attrCap) return;
    attrCap *= 2;
    attrName = growU32(attrName, attrCap);
    attrValOff = growU32(attrValOff, attrCap);
    attrValLen = growU32(attrValLen, attrCap);
  };

  const growNodes = (): void => {
    nodeCap *= 2;
    tag = growU32(tag, nodeCap);
    textOff = growU32(textOff, nodeCap);
    textLen = growU32(textLen, nodeCap);
    attrStart = growU32(attrStart, nodeCap + 1);
    const nextParent = new Int32Array(nodeCap);
    nextParent.set(parent);
    parent = nextParent;
  };

  /** Schreibt `s` als UTF-8 in den Blob und liefert den Startversatz. */
  const put = (s: string): number => {
    const off = blobN;
    if (s.length === 0) return off;
    growBlob(s.length * 3); // UTF-8 braucht höchstens 3 Byte je UTF-16-Einheit
    const { written } = enc.encodeInto(s, blob.subarray(blobN));
    blobN += written;
    return off;
  };

  const intern = (dict: Record<string, number>, names: string[], name: string): number => {
    const known = dict[name];
    if (known !== undefined) return known;
    const id = names.length;
    dict[name] = id;
    names.push(name);
    return id;
  };

  // Die Stacktiefe ist durch die Knotenzahl beschränkt, also einmal voll
  // dimensionieren statt während des Laufs zu wachsen. Ein gewöhnliches Array
  // wächst von selbst, wenn Shadow Roots über die Schätzung hinausgehen.
  const stackNode: Node[] = new Array(estimate + 1);
  let stackParent = new Int32Array(estimate + 1);
  stackNode[0] = root;
  stackParent[0] = -1;
  let sp = 1;

  const growStack = (need: number): void => {
    if (need <= stackParent.length) return;
    let cap = stackParent.length;
    while (cap < need) cap *= 2;
    const next = new Int32Array(cap);
    next.set(stackParent);
    stackParent = next;
  };

  let i = 0;
  while (sp > 0) {
    sp--;
    // biome-ignore lint/style/noNonNullAssertion: sp indiziert stets einen gesetzten Platz.
    const node = stackNode[sp]!;
    // biome-ignore lint/style/noNonNullAssertion: parallel zu stackNode gesetzt.
    const p = stackParent[sp]!;
    const type = node.nodeType;
    if (type !== ELEMENT_NODE && type !== TEXT_NODE) continue;

    let kids: ArrayLike<Node> | null = null;
    let idx: number;

    if (type === ELEMENT_NODE) {
      const el = node as Element;
      const ln = el.localName;

      // Der Inspector prüft sich nicht selbst — weder der Host noch sein
      // Shadow Root landen in der Arena.
      if (ln === HOST_TAG_NAME) continue;

      if (i === nodeCap) growNodes();
      idx = i++;
      parent[idx] = p;
      tag[idx] = intern(tagDict, tagNames, ln);
      textOff[idx] = blobN;
      textLen[idx] = 0;
      attrStart[idx] = attrN;

      const attrs = el.attributes;
      for (let k = 0; k < attrs.length; k++) {
        // biome-ignore lint/style/noNonNullAssertion: k < attrs.length.
        const a = attrs[k]!;
        growAttrs();
        attrName[attrN] = intern(attrDict, attrNames, a.name);
        const before = blobN;
        attrValOff[attrN] = put(a.value);
        attrValLen[attrN] = blobN - before;
        attrN++;
      }

      elementToId.set(el, idx);
      idToElement.set(idx, el);

      const shadow = el.shadowRoot;
      if (shadow !== null) {
        // Flacher Baum: Licht-Kinder erreichen die Arena über <slot>, nicht
        // über den Host — jedes Element erscheint damit genau einmal.
        kids = shadow.childNodes;
      } else if (ln === "slot") {
        // assignedNodes({flatten:true}) liefert die zugewiesenen Knoten, und
        // wenn nichts zugewiesen ist, den Ersatzinhalt des Slots.
        kids = (node as HTMLSlotElement).assignedNodes({ flatten: true });
      } else if (ln === "iframe") {
        frames.push({
          node: idx,
          element: el,
          document: frameDocument(el),
          src: el.getAttribute("src"),
        });
      } else {
        kids = el.childNodes;
      }
    } else {
      if (i === nodeCap) growNodes();
      idx = i++;
      parent[idx] = p;
      tag[idx] = intern(tagDict, tagNames, TEXT_TAG);
      const before = blobN;
      textOff[idx] = put((node as Text).data);
      textLen[idx] = blobN - before;
      attrStart[idx] = attrN;
    }

    if (kids !== null) {
      growStack(sp + kids.length);
      for (let k = kids.length - 1; k >= 0; k--) {
        // biome-ignore lint/style/noNonNullAssertion: k < kids.length.
        stackNode[sp] = kids[k]!;
        stackParent[sp] = idx;
        sp++;
      }
    }
  }
  attrStart[i] = attrN;

  return {
    columns: {
      tag: tag.subarray(0, i),
      parent: parent.subarray(0, i),
      textOff: textOff.subarray(0, i),
      textLen: textLen.subarray(0, i),
      attrStart: attrStart.subarray(0, i + 1),
      attrName: attrName.subarray(0, attrN),
      attrValOff: attrValOff.subarray(0, attrN),
      attrValLen: attrValLen.subarray(0, attrN),
      blob: blob.subarray(0, blobN),
      tagDict: tagNames.join(SEP),
      attrDict: attrNames.join(SEP),
      nodes: i,
    },
    elementToId,
    idToElement,
    frames,
  };
}

/**
 * Das Dokument eines `<iframe>`, soweit erreichbar.
 *
 * Bei Cross-Origin liefert `contentDocument` `null`; manche Umgebungen werfen
 * stattdessen. Beides bedeutet dasselbe: nicht prüfbar.
 *
 * Der zweite Fall ist tückischer: Solange die Navigation eines Frames läuft,
 * zeigt `contentDocument` noch das anfängliche `about:blank` — auch bei einem
 * Cross-Origin-Ziel. Dieses leere Dokument zu prüfen erzeugt Fehlbefunde
 * (`document/lang-missing`, `document/title-missing`) über ein Dokument, das
 * gar nicht das gemeinte ist. Es gilt deshalb als nicht erreichbar.
 */
function frameDocument(el: Element): Document | null {
  let doc: Document | null;
  try {
    doc = (el as HTMLIFrameElement).contentDocument;
  } catch {
    return null;
  }
  if (doc === null) return null;

  const src = el.getAttribute("src");
  const navigiertNochAnderswohin =
    doc.URL === "about:blank" && src !== null && src !== "" && !src.startsWith("about:");
  return navigiertNochAnderswohin ? null : doc;
}

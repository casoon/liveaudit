// Optimierter Tier-1-Collector. Gegenueber collect.js:
//  - keine Array-Allokation pro Knoten (zwei parallele Stacks statt Tupel)
//  - encodeInto in einen wachsenden Puffer statt encode() pro String
//  - Typed Arrays vorab dimensioniert (TreeWalker-Zaehlung ist nativ und billig)
//  - Attributnamen ueber ein Objekt ohne Prototyp statt Map

const SEP = String.fromCharCode(1);

function countNodes(root) {
  const d = root.ownerDocument || root;
  const w = d.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let n = 1;
  while (w.nextNode()) n++;
  return n;
}

export function collectFlat2(root) {
  const n = countNodes(root);

  const tag = new Uint32Array(n);
  const parent = new Int32Array(n);
  const textOff = new Uint32Array(n);
  const textLen = new Uint32Array(n);
  const attrStart = new Uint32Array(n + 1);

  // Attribute wachsen geometrisch; 2 pro Knoten ist ein brauchbarer Startwert.
  let attrCap = Math.max(16, n * 2);
  let attrName = new Uint32Array(attrCap);
  let attrValOff = new Uint32Array(attrCap);
  let attrValLen = new Uint32Array(attrCap);
  let attrN = 0;

  let blobCap = Math.max(1024, n * 16);
  let blob = new Uint8Array(blobCap);
  let blobN = 0;

  const enc = new TextEncoder();
  const tagDict = Object.create(null);
  const tagNames = [];
  const attrDict = Object.create(null);
  const attrNames = [];

  const growBlob = (need) => {
    if (blobN + need <= blobCap) return;
    while (blobN + need > blobCap) blobCap *= 2;
    const nb = new Uint8Array(blobCap);
    nb.set(blob.subarray(0, blobN));
    blob = nb;
  };
  const growAttrs = () => {
    if (attrN < attrCap) return;
    attrCap *= 2;
    const a = new Uint32Array(attrCap); a.set(attrName); attrName = a;
    const b = new Uint32Array(attrCap); b.set(attrValOff); attrValOff = b;
    const c = new Uint32Array(attrCap); c.set(attrValLen); attrValLen = c;
  };

  // Schreibt s als UTF-8 in den Blob und liefert [offset, laenge].
  const put = (s) => {
    const off = blobN;
    if (s.length === 0) return off;
    growBlob(s.length * 3); // UTF-8 braucht hoechstens 3 Byte je UTF-16-Einheit
    const { written } = enc.encodeInto(s, blob.subarray(blobN));
    blobN += written;
    return off;
  };

  // Die Stacktiefe ist durch die Gesamtzahl der Knoten beschraenkt, also einmal
  // voll dimensionieren statt waehrend des Laufs zu wachsen.
  const stackNode = new Array(n + 1);
  const stackParent = new Int32Array(n + 1);
  let sp = 0;
  stackNode[0] = root; stackParent[0] = -1; sp = 1;

  let i = 0;
  while (sp > 0) {
    sp--;
    const node = stackNode[sp];
    const p = stackParent[sp];
    const type = node.nodeType;
    if (type !== 1 && type !== 3) continue;

    const idx = i++;
    parent[idx] = p;

    if (type === 1) {
      const ln = node.localName;
      let t = tagDict[ln];
      if (t === undefined) { t = tagNames.length; tagDict[ln] = t; tagNames.push(ln); }
      tag[idx] = t;
      textOff[idx] = blobN; textLen[idx] = 0;

      attrStart[idx] = attrN;
      const at = node.attributes;
      const al = at.length;
      for (let k = 0; k < al; k++) {
        const a = at[k];
        let an = attrDict[a.name];
        if (an === undefined) { an = attrNames.length; attrDict[a.name] = an; attrNames.push(a.name); }
        growAttrs();
        attrName[attrN] = an;
        const before = blobN;
        attrValOff[attrN] = put(a.value);
        attrValLen[attrN] = blobN - before;
        attrN++;
      }
    } else {
      tag[idx] = tagDict["#text"] !== undefined
        ? tagDict["#text"]
        : (tagDict["#text"] = tagNames.push("#text") - 1);
      const before = blobN;
      textOff[idx] = put(node.data);
      textLen[idx] = blobN - before;
      attrStart[idx] = attrN;
    }

    const ch = node.childNodes;
    for (let k = ch.length - 1; k >= 0; k--) {
      stackNode[sp] = ch[k];
      stackParent[sp] = idx;
      sp++;
    }
  }
  attrStart[i] = attrN;

  return {
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
  };
}

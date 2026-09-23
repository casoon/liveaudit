// Tier-1-Collector: DOM -> spaltenweise Arrays + ein UTF-8-Blob.
// Bewusst ohne getComputedStyle/getBoundingClientRect - das ist Tier 3.

const SEP = String.fromCharCode(1); // Trenner der Namens-Dictionaries

export function collectFlat(root) {
  const tag = [], parent = [], textOff = [], textLen = [];
  const attrStart = [], attrName = [], attrValOff = [], attrValLen = [];
  const tagDict = new Map(), attrDict = new Map();
  const parts = [];           // Blob-Stuecke, am Ende einmal zusammengesetzt
  let blobLen = 0;

  const enc = new TextEncoder();
  const push = (s) => {
    const off = blobLen;
    if (s.length === 0) return [off, 0];
    const bytes = enc.encode(s);
    parts.push(bytes);
    blobLen += bytes.length;
    return [off, bytes.length];
  };
  const intern = (m, s) => {
    let i = m.get(s);
    if (i === undefined) { i = m.size; m.set(s, i); }
    return i;
  };

  // Iterativer Durchlauf, kein Rekursionsstack bei 500k Nodes.
  const stack = [[root, -1]];
  while (stack.length) {
    const [node, p] = stack.pop();
    const i = tag.length;

    let name, ownText = "";
    if (node.nodeType === 1) {
      name = node.localName;
    } else if (node.nodeType === 3) {
      name = "#text";
      ownText = node.data;
    } else {
      continue;
    }

    tag.push(intern(tagDict, name));
    parent.push(p);
    const [to, tl] = push(ownText);
    textOff.push(to); textLen.push(tl);

    attrStart.push(attrName.length);
    if (node.nodeType === 1 && node.hasAttributes()) {
      const at = node.attributes;
      for (let k = 0; k < at.length; k++) {
        attrName.push(intern(attrDict, at[k].name));
        const [vo, vl] = push(at[k].value);
        attrValOff.push(vo); attrValLen.push(vl);
      }
    }

    // In Dokumentreihenfolge: rueckwaerts auf den Stack.
    const ch = node.childNodes;
    for (let k = ch.length - 1; k >= 0; k--) stack.push([ch[k], i]);
  }
  attrStart.push(attrName.length); // Sentinel fuer attr_end des letzten Knotens

  const blob = new Uint8Array(blobLen);
  let o = 0;
  for (const b of parts) { blob.set(b, o); o += b.length; }

  return {
    tag: Uint32Array.from(tag),
    parent: Int32Array.from(parent),
    textOff: Uint32Array.from(textOff),
    textLen: Uint32Array.from(textLen),
    attrStart: Uint32Array.from(attrStart),
    attrName: Uint32Array.from(attrName),
    attrValOff: Uint32Array.from(attrValOff),
    attrValLen: Uint32Array.from(attrValLen),
    blob,
    tagDict: [...tagDict.keys()].join(SEP),
    attrDict: [...attrDict.keys()].join(SEP),
    nodes: tag.length,
  };
}

// Naiver Vergleichsweg: derselbe Baum als JSON-String.
export function collectJson(root) {
  const out = [];
  const stack = [[root, -1]];
  while (stack.length) {
    const [node, p] = stack.pop();
    const i = out.length;
    let tag, text = "", attrs = [];
    if (node.nodeType === 1) {
      tag = node.localName;
      if (node.hasAttributes()) {
        const at = node.attributes;
        for (let k = 0; k < at.length; k++) attrs.push([at[k].name, at[k].value]);
      }
    } else if (node.nodeType === 3) {
      tag = "#text"; text = node.data;
    } else continue;
    out.push({ tag, parent: p, text, attrs });
    const ch = node.childNodes;
    for (let k = ch.length - 1; k >= 0; k--) stack.push([ch[k], i]);
  }
  return JSON.stringify(out);
}

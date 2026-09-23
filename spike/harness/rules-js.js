// Gegenprobe: dieselben 20 Tier-1-Regeln, idiomatisch in JS ueber den DOM.
// So saehe eine TypeScript-Implementierung ohne WASM aus - inklusive der
// Vorteile, die sie hat (querySelectorAll, textContent, closest).

const VALID_ROLES = new Set([
  "alert", "alertdialog", "application", "article", "banner", "button", "cell",
  "checkbox", "columnheader", "combobox", "complementary", "contentinfo",
  "definition", "dialog", "directory", "document", "feed", "figure", "form",
  "grid", "gridcell", "group", "heading", "img", "link", "list", "listbox",
  "listitem", "log", "main", "marquee", "math", "menu", "menubar", "menuitem",
  "menuitemcheckbox", "menuitemradio", "navigation", "none", "note", "option",
  "presentation", "progressbar", "radio", "radiogroup", "region", "row",
  "rowgroup", "rowheader", "scrollbar", "search", "searchbox", "separator",
  "slider", "spinbutton", "status", "switch", "tab", "table", "tablist",
  "tabpanel", "term", "textbox", "timer", "toolbar", "tooltip", "tree",
  "treegrid", "treeitem",
]);

const suspiciousAlt = (alt) => {
  const a = alt.trim().toLowerCase();
  return /\.(jpe?g|png|gif|webp|svg)$/.test(a) ||
    a === "bild" || a === "image" || a === "foto" || a === "photo" || a === "grafik";
};

const hasName = (el) =>
  (el.getAttribute("aria-label") || "").trim() !== "" ||
  el.hasAttribute("aria-labelledby") ||
  (el.textContent || "").trim() !== "" ||
  (el.getAttribute("title") || "").trim() !== "" ||
  (el.getAttribute("alt") || "").trim() !== "";

export function runRulesJs(doc) {
  const f = [];
  const add = (rule) => f.push(rule);

  const allIds = new Set();
  const labelTargets = new Set();
  const seenIds = new Set();

  for (const el of doc.querySelectorAll("[id]")) {
    const id = el.id;
    if (id) {
      if (seenIds.has(id)) add("ids/duplicate");
      seenIds.add(id);
      allIds.add(id);
    }
  }
  for (const l of doc.querySelectorAll("label[for]")) labelTargets.add(l.getAttribute("for"));

  for (const img of doc.querySelectorAll("img")) {
    const alt = img.getAttribute("alt");
    if (alt === null) add("images/alt-missing");
    else if (suspiciousAlt(alt)) add("images/alt-suspicious");
  }

  for (const svg of doc.querySelectorAll("svg")) {
    const role = svg.getAttribute("role");
    if (!hasName(svg) && role !== "presentation" && role !== "none") add("svg/name-missing");
  }

  for (const a of doc.querySelectorAll("a[href]")) if (!hasName(a)) add("links/name-missing");
  for (const b of doc.querySelectorAll("button")) if (!hasName(b)) add("buttons/name-missing");

  for (const el of doc.querySelectorAll("input, select, textarea")) {
    const t = el.getAttribute("type") || "text";
    if (t === "hidden" || t === "submit" || t === "button" || t === "reset") continue;
    const ariaNamed = el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby");
    const inLabel = el.closest("label") !== null;
    const forLabelled = el.id && labelTargets.has(el.id);
    const titled = (el.getAttribute("title") || "").trim() !== "";
    if (!(ariaNamed || inLabel || forLabelled || titled)) add("forms/label-missing");
    if (el.hasAttribute("placeholder") && !ariaNamed && !inLabel && !forLabelled) {
      add("forms/placeholder-as-label");
    }
  }

  const vp = doc.querySelector('meta[name="viewport"]');
  if (vp) {
    const c = vp.getAttribute("content") || "";
    if (c.includes("user-scalable=no") || c.includes("maximum-scale=1")) add("zoom/viewport-locked");
  }

  let lastLevel = 0, hasH1 = false;
  for (const h of doc.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    const level = Number(h.localName[1]);
    if (level === 1) hasH1 = true;
    if ((h.textContent || "").trim() === "") add("headings/empty");
    if (lastLevel > 0 && level > lastLevel + 1) add("headings/skip-level");
    lastLevel = level;
  }
  if (!hasH1) add("headings/h1-missing");

  for (const el of doc.querySelectorAll("[role]")) {
    for (const r of (el.getAttribute("role") || "").split(/\s+/)) {
      if (r && !VALID_ROLES.has(r)) { add("aria/role-invalid"); break; }
    }
  }

  for (const rel of ["aria-labelledby", "aria-describedby", "aria-controls"]) {
    for (const el of doc.querySelectorAll(`[${rel}]`)) {
      const v = el.getAttribute(rel) || "";
      if (v.split(/\s+/).some((id) => id && !allIds.has(id))) add("aria/reference-missing");
    }
  }

  for (const el of doc.querySelectorAll("[tabindex]")) {
    const n = Number(el.getAttribute("tabindex"));
    if (Number.isFinite(n) && n > 0) add("keyboard/positive-tabindex");
    if (el.getAttribute("aria-hidden") === "true" && Number.isFinite(n) && n >= 0) {
      add("keyboard/hidden-focusable");
    }
  }
  for (const el of doc.querySelectorAll('[aria-hidden="true"]')) {
    if (["a", "button", "input", "select", "textarea"].includes(el.localName)) {
      add("keyboard/hidden-focusable");
    }
  }

  const html = doc.documentElement;
  if (html) {
    const lang = html.getAttribute("lang");
    if (lang === null) add("document/lang-missing");
    else if (lang.trim() === "" || lang.length < 2) add("document/lang-invalid");
  }
  const title = doc.querySelector("title");
  if (!title) add("document/title-missing");
  else if ((title.textContent || "").trim() === "") add("document/title-empty");

  return f;
}

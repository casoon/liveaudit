import init, { Session } from "./pkg/spike_core.js";
import { collectFlat, collectJson } from "./collect.js";
import { collectFlat2 } from "./collect2.js";
import { runRulesJs } from "./rules-js.js";

const CORPUS = [
  "wordpress-news.html",
  "mdn-document.html",
  "whatwg-parsing.html",
  "tc39-ecma262.html",
  "whatwg-full.html",
];

const REPEATS = 5;       // Median aus 5 Laeufen, 1 Warmlauf vorab
const log = (s) => { document.getElementById("out").textContent += s + "\n"; };

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// Misst fn REPEATS-mal und gibt den Median in ms zurueck.
function bench(fn) {
  fn(); // Warmlauf
  const ts = [];
  for (let i = 0; i < REPEATS; i++) {
    const t0 = performance.now();
    fn();
    ts.push(performance.now() - t0);
  }
  return median(ts);
}

async function loadDoc(name) {
  const html = await (await fetch(`../corpus/${name}`)).text();
  // Echtes Dokument, kein Fragment - die Regeln brauchen <html>/<title>.
  return new DOMParser().parseFromString(html, "text/html");
}

function countNodes(root) {
  let n = 0;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  while (w.nextNode()) n++;
  return n + 1;
}

async function main() {
  await init();
  const rows = [];

  for (const name of CORPUS) {
    log(`\n=== ${name} ===`);
    let doc;
    try {
      doc = await loadDoc(name);
    } catch (e) {
      log(`  uebersprungen: ${e.message}`);
      continue;
    }
    const nodes = countNodes(doc.documentElement);
    log(`  Nodes (Element + Text): ${nodes.toLocaleString("de-DE")}`);

    // --- WASM-Pfad, flache Kodierung (naiv und optimiert) ---
    const tCollect = bench(() => collectFlat(doc.documentElement));
    const tCollect2 = bench(() => collectFlat2(doc.documentElement));
    const flat = collectFlat2(doc.documentElement);

    const sess = new Session();
    const tBuildFlat = bench(() =>
      sess.build_flat(
        flat.tag, flat.parent, flat.textOff, flat.textLen, flat.attrStart,
        flat.attrName, flat.attrValOff, flat.attrValLen, flat.blob,
        flat.tagDict, flat.attrDict,
      ),
    );
    const tRulesWasm = bench(() => sess.run_rules());
    const res = sess.run_rules();

    // --- WASM-Pfad, naive JSON-Kodierung ---
    let tCollectJson = NaN, tBuildJson = NaN, jsonBytes = NaN;
    try {
      tCollectJson = bench(() => collectJson(doc.documentElement));
      const json = collectJson(doc.documentElement);
      jsonBytes = json.length;
      const s2 = new Session();
      tBuildJson = bench(() => s2.build_json(json));
    } catch (e) {
      log(`  JSON-Weg uebersprungen: ${e.message}`);
    }

    // --- Gegenprobe: dieselben Regeln in JS ueber den DOM ---
    const tRulesJs = bench(() => runRulesJs(doc));
    const fJs = runRulesJs(doc);

    const wasmTotal = tCollect2 + tBuildFlat + tRulesWasm;
    const payload = flat.tag.byteLength + flat.parent.byteLength + flat.textOff.byteLength +
      flat.textLen.byteLength + flat.attrStart.byteLength + flat.attrName.byteLength +
      flat.attrValOff.byteLength + flat.attrValLen.byteLength + flat.blob.byteLength;

    const ms = (x) => (Number.isFinite(x) ? x.toFixed(1) : "-");
    log(`  --- WASM-Pfad (flach) ---`);
    log(`  1 DOM-Traversierung, naiv       : ${ms(tCollect)} ms`);
    log(`  1 DOM-Traversierung, optimiert  : ${ms(tCollect2)} ms`);
    log(`  2 Serialisierung + Arena-Aufbau : ${ms(tBuildFlat)} ms`);
    log(`  3 Regelauswertung (Rust)        : ${ms(tRulesWasm)} ms`);
    log(`    GESAMT                        : ${ms(wasmTotal)} ms`);
    log(`    Nutzdaten ueber die Grenze    : ${(payload / 1048576).toFixed(1)} MB`);
    log(`  --- WASM-Pfad (JSON, naiv) ---`);
    log(`  1 Traversierung + JSON.stringify: ${ms(tCollectJson)} ms`);
    log(`  2 JSON-Parse + Arena-Aufbau     : ${ms(tBuildJson)} ms`);
    log(`    GESAMT (mit Regeln)           : ${ms(tCollectJson + tBuildJson + tRulesWasm)} ms`);
    log(`    JSON-Groesse                  : ${(jsonBytes / 1048576).toFixed(1)} MB`);
    log(`  --- Gegenprobe: Regeln in JS ueber den DOM ---`);
    log(`    GESAMT                        : ${ms(tRulesJs)} ms`);
    log(`  --- Ergebnisgleichheit ---`);
    log(`    Findings WASM: ${res.findings} | JS: ${fJs.length} | Nodes Arena: ${res.nodes}`);

    rows.push({
      name, nodes,
      collect: tCollect2, collectNaiv: tCollect, build: tBuildFlat, rules: tRulesWasm, wasmTotal,
      jsonTotal: tCollectJson + tBuildJson + tRulesWasm,
      jsTotal: tRulesJs,
      payloadMB: payload / 1048576,
      fWasm: res.findings, fJs: fJs.length,
    });
  }

  log(`\n\n=== ZUSAMMENFASSUNG ===`);
  log("Seite                  Nodes    WASM flach   WASM JSON    JS/DOM   Faktor");
  for (const r of rows) {
    log(
      r.name.padEnd(22) +
      String(r.nodes).padStart(8) +
      (r.wasmTotal.toFixed(0) + " ms").padStart(12) +
      ((Number.isFinite(r.jsonTotal) ? r.jsonTotal.toFixed(0) : "-") + " ms").padStart(12) +
      (r.jsTotal.toFixed(0) + " ms").padStart(10) +
      ("x" + (r.wasmTotal / r.jsTotal).toFixed(1)).padStart(9),
    );
  }
  window.__RESULTS__ = rows;
  log("\nfertig");
}

main().catch((e) => log("FEHLER: " + e.stack));

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { initSync } from "@casoon/a11y-wasm";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);

let initialized = false;

/**
 * Initialisiert das WASM-Modul aus der Datei.
 *
 * Der Glue von `wasm-pack --target web` holt das Modul im Browser über eine
 * URL; unter Node reicht `initSync` mit den Bytes.
 */
export function initWasm(): void {
  if (initialized) return;
  initSync({ module: readFileSync(require.resolve("@casoon/a11y-wasm/a11y_wasm_bg.wasm")) });
  initialized = true;
}

/** Ein Dokument aus HTML — `documentElement` ist die Wurzel des Scans. */
export function parse(html: string): Document {
  return new JSDOM(html).window.document;
}

/** Zählt Element- und Textknoten mit einem nativen `TreeWalker`. */
export function walkerCount(root: Element): number {
  const walker = root.ownerDocument.createTreeWalker(root, 0x1 | 0x4);
  let n = 1;
  while (walker.nextNode()) n++;
  return n;
}

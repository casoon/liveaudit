/**
 * Bündelt `@liveaudit/browser` zu `dist/inspector.js` und legt
 * `dist/inspector_bg.wasm` daneben.
 *
 * Der Glue-Code von wasm-pack löst das Modul über
 * `new URL("inspector_bg.wasm", import.meta.url)` auf. esbuild lässt dieses
 * Muster unangetastet, sodass es nach dem Bündeln auf die Datei neben
 * `dist/inspector.js` zeigt — der Anwender bindet nur `inspector.js` ein.
 */

import { readFileSync } from "node:fs";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { build } from "esbuild";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
const wasm = join(root, "packages", "core", "pkg", "inspector_bg.wasm");

try {
  await stat(wasm);
} catch {
  console.error("packages/core/pkg/inspector_bg.wasm fehlt — zuerst `pnpm build:wasm`.");
  process.exit(1);
}

await mkdir(dist, { recursive: true });

await build({
  entryPoints: [join(root, "packages", "liveaudit", "src", "index.ts")],
  outfile: join(dist, "inspector.js"),
  bundle: true,
  format: "esm",
  target: "es2023",
  platform: "browser",
  minify: true,
  sourcemap: true,
  legalComments: "none",
});

await copyFile(wasm, join(dist, "inspector_bg.wasm"));

/**
 * Bundle-Budget in KB gzip. Mit Absicht knapp über dem heutigen Stand: Ein
 * Budget, das nur berichtet wird, ist keins — die Größe wächst schleichend mit
 * jeder Regel und jedem UI-Detail. Wer die Grenze anhebt, tut das sichtbar in
 * einem Commit. Siehe docs/decisions.md.
 */
const BUDGET_KB_GZIP = {
  "inspector.js": 20,
  "inspector_bg.wasm": 100,
};

let ueberschritten = false;

for (const [name, grenze] of Object.entries(BUDGET_KB_GZIP)) {
  const bytes = readFileSync(join(dist, name));
  const roh = bytes.length / 1024;
  const gz = gzipSync(bytes).length / 1024;
  const anteil = Math.round((gz / grenze) * 100);
  console.log(
    `${name}: ${roh.toFixed(1)} KB roh, ${gz.toFixed(1)} KB gzip ` +
      `(${anteil}% von ${grenze} KB)`,
  );
  if (gz > grenze) {
    console.error(
      `  Budget überschritten: ${gz.toFixed(1)} KB gzip > ${grenze} KB. ` +
        "Entweder das Bundle verkleinern oder die Grenze in scripts/bundle.js " +
        "bewusst anheben.",
    );
    ueberschritten = true;
  }
}

if (ueberschritten) process.exit(1);

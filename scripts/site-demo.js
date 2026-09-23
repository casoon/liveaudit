/**
 * Legt die gebauten Artefakte neben die Demo-Seite der Projektseite.
 *
 * `site/public/demo/start.js` gehört zur Seite und liegt im Repository;
 * `inspector.js` und `inspector_bg.wasm` entstehen aus `pnpm build` und werden
 * hierher kopiert, statt committet zu werden — die Demo zeigt sonst irgendwann
 * einen Stand, den niemand mehr baut.
 */

import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
const ziel = join(root, "site", "public", "demo");

const DATEIEN = ["inspector.js", "inspector_bg.wasm"];

for (const name of DATEIEN) {
  try {
    await stat(join(dist, name));
  } catch {
    console.error(`dist/${name} fehlt — im Wurzelverzeichnis zuerst \`pnpm build\`.`);
    process.exit(1);
  }
}

await mkdir(ziel, { recursive: true });
for (const name of DATEIEN) {
  await copyFile(join(dist, name), join(ziel, name));
}

console.log(`dist/ → site/public/demo/ (${DATEIEN.join(", ")})`);

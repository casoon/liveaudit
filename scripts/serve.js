/**
 * Ein statischer Server für `examples/`.
 *
 * `dist/inspector.js` lädt sein WASM über `new URL(..., import.meta.url)` und
 * braucht dafür eine echte Herkunft — über `file://` scheitert das. Mehr macht
 * dieser Server nicht.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.PORT ?? 4173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const rel = url.pathname === "/" ? "/examples/index.html" : url.pathname;
  const file = join(root, normalize(rel).replace(/^(\.\.[/\\])+/, ""));

  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("kein File");
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "content-length": info.size,
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("404");
  }
}).listen(port, () => console.log(`http://localhost:${port}/`));

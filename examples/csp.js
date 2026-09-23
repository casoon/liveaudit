// Ohne Freischaltung ist das Bundle inert. Geprüft werden soll hier die CSP,
// nicht das Flag -- also wird ausdrücklich freigeschaltet.
import { enable } from "../dist/inspector.js";

const LiveAudit = enable();
const out = document.getElementById("out");
try {
  await LiveAudit.init();
  out.textContent = "WASM wurde instanziiert — diese Umgebung erzwingt die CSP nicht.";
} catch (err) {
  out.textContent = `${err.message}\n\nUrsprungsfehler: ${err.cause?.name}: ${err.cause?.message}`;
}

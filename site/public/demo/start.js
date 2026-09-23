/**
 * Startet den Inspector auf der Demo-Seite.
 *
 * Eigene Datei neben `inspector.js`, damit der Import relativ bleiben kann: Die
 * Seite hängt unter `/liveaudit/`, der Basispfad steht nur in der Astro-Seite,
 * und ein relativer Import kommt ohne ihn aus. Das Glue-Modul lädt sein WASM
 * genauso — über `new URL(..., import.meta.url)` — und findet es deshalb hier.
 *
 * `enable()` schaltet das Werkzeug programmgesteuert frei. Auf einer fremden
 * Seite geschieht das über `?liveaudit`; hier ist die Demo der Zweck der Seite.
 */

import LiveAudit, { enable } from "./inspector.js";

enable();

const zeigen = document.getElementById("demo-show");
const verbergen = document.getElementById("demo-hide");
const kontrast = document.getElementById("demo-contrast");
const status = document.getElementById("demo-status");

const melde = (text) => {
  status.textContent = text;
};

/** Zählt über alle gescannten Dokumente — ein iframe ist ein eigenes. */
const summe = (result, feld) =>
  result.documents.reduce(
    (n, d) => n + (feld === "nodes" ? d.nodes : d.report.findings.length),
    0,
  );

async function scannen() {
  zeigen.disabled = true;
  melde(kontrast.checked ? "Scanning, with the contrast pass…" : "Scanning…");
  try {
    const result = await LiveAudit.show(undefined, { rendering: kontrast.checked });
    const befunde = summe(result, "findings");
    const knoten = summe(result, "nodes");
    melde(
      `${befunde} findings over ${knoten} nodes of this page. ` +
        "Every marker sits on the element it belongs to; the sidebar groups them by category. " +
        (kontrast.checked
          ? "The contrast pass ran."
          : "Without the contrast pass the two contrast rules report UNTESTED, not PASS."),
    );
  } catch (err) {
    melde(`The inspector did not start: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    zeigen.disabled = false;
  }
}

zeigen.addEventListener("click", scannen);

verbergen.addEventListener("click", () => {
  LiveAudit.hide();
  melde("Inspector removed. Nothing of it is left in the document, and nothing was changed.");
});

// Der zweite Durchgang kostet ein Mehrfaches des Collectors und gehört deshalb
// nicht zu jedem Scan. Umschalten heißt hier: noch einmal scannen.
kontrast.addEventListener("change", () => {
  if (LiveAudit.isVisible()) void scannen();
});

// Erst jetzt bedienbar: Ohne JavaScript stünden hier Schaltflächen, die nichts tun.
for (const element of [zeigen, verbergen, kontrast]) element.disabled = false;
melde("Ready. The scan runs in this browser; nothing leaves the page.");

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { FLAG, forget, isEnabled, remember } from "../src/gate.ts";

/** Setzt `location.search`, ohne eine ganze DOM-Umgebung aufzuziehen. */
function mitSuche(search: string): void {
  Object.defineProperty(globalThis, "location", {
    value: { search },
    configurable: true,
    writable: true,
  });
}

/** Ein `localStorage`, das sich auf Wunsch wie ein gesperrtes verhält. */
function mitSpeicher(werte: Record<string, string> | "wirft" | "fehlt"): void {
  const value =
    werte === "fehlt"
      ? undefined
      : werte === "wirft"
        ? {
            getItem() {
              throw new DOMException("blockiert", "SecurityError");
            },
            setItem() {
              throw new DOMException("blockiert", "SecurityError");
            },
            removeItem() {
              throw new DOMException("blockiert", "SecurityError");
            },
          }
        : {
            getItem: (k: string) => werte[k] ?? null,
            setItem: (k: string, v: string) => {
              werte[k] = v;
            },
            removeItem: (k: string) => {
              delete werte[k];
            },
          };
  Object.defineProperty(globalThis, "localStorage", {
    value,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  mitSuche("");
  mitSpeicher({});
});

describe("Freischaltung", () => {
  it("ist ohne Flag und ohne Speichereintrag aus", () => {
    mitSuche("?utm_source=x");
    mitSpeicher({});
    assert.equal(isEnabled(), false);
  });

  it("schaltet über den Query-Parameter frei, auch ohne Wert", () => {
    mitSpeicher({});
    for (const search of [`?${FLAG}`, `?${FLAG}=`, `?${FLAG}=1`, `?a=b&${FLAG}=ja`]) {
      mitSuche(search);
      assert.equal(isEnabled(), true, search);
    }
  });

  it("schaltet über den Speichereintrag frei", () => {
    mitSuche("");
    mitSpeicher({ [FLAG]: "1" });
    assert.equal(isEnabled(), true);
  });

  it("versteht 0 und false als ausdrückliches Nein", () => {
    // Damit laesst sich eine vorgemerkte Freischaltung fuer einen Aufruf
    // uebersteuern, ohne sie zu loeschen.
    mitSpeicher({ [FLAG]: "1" });
    for (const search of [`?${FLAG}=0`, `?${FLAG}=false`]) {
      mitSuche(search);
      assert.equal(isEnabled(), false, search);
    }
    mitSuche("");
    for (const wert of ["0", "false"]) {
      mitSpeicher({ [FLAG]: wert });
      assert.equal(isEnabled(), false, wert);
    }
  });

  it("überlebt einen localStorage, der beim Lesen wirft", () => {
    // In einem Sandbox-iframe oder bei blockierten Site-Daten wirft schon der
    // Zugriff. Ein Pruefwerkzeug darf die geprueffte Seite nicht beschaedigen.
    mitSuche("");
    mitSpeicher("wirft");
    assert.doesNotThrow(() => isEnabled());
    assert.equal(isEnabled(), false);
    assert.doesNotThrow(() => remember());
    assert.doesNotThrow(() => forget());
  });

  it("überlebt eine Umgebung ganz ohne localStorage", () => {
    mitSuche("");
    mitSpeicher("fehlt");
    assert.doesNotThrow(() => isEnabled());
    assert.equal(isEnabled(), false);
  });

  it("merkt die Freischaltung vor und nimmt sie zurück", () => {
    mitSuche("");
    const speicher: Record<string, string> = {};
    mitSpeicher(speicher);

    assert.equal(isEnabled(), false);
    remember();
    assert.equal(speicher[FLAG], "1");
    assert.equal(isEnabled(), true);
    forget();
    assert.equal(isEnabled(), false);
  });
});

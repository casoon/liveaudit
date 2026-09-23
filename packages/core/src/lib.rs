//! Die WASM-Grenze von LiveAudit.
//!
//! Dieses Crate enthält **keinen eigenen Regelbestand**. Es bindet `a11y-dom`,
//! `a11y-rules`, `accname` und `a11y-report` aus
//! [a11y-core](https://github.com/casoon/a11y-core) ein und stellt nur zweierlei
//! bereit: den Arena-Adapter über den Baum, den der Collector liefert, und die
//! `wasm-bindgen`-Grenze darüber. Fehlt eine Regel, gehört sie nach
//! `a11y-rules` — eine Regel hier zu duplizieren bräche die Zusicherung, dass
//! ein Befund über alle drei Oberflächen gleich heißt.

#![forbid(unsafe_code)]

mod arena;
mod rendering;
mod semantics;
#[cfg(test)]
mod testing;

use wasm_bindgen::prelude::*;

pub use arena::{Arena, ArenaNode};
pub use rendering::{RenderArena, RenderingColumns};
pub use semantics::SemanticArena;

/// Ein Scan: die Arena eines Dokuments, über die der Regelbestand läuft.
///
/// Die Arena wird einmal je Scan aufgebaut und gehalten. Der `IdIndex` für die
/// Namensauflösung entsteht in [`SemanticArena`] ebenfalls einmal je Lauf.
#[wasm_bindgen]
pub struct Scan {
    arena: Arena,
    /// Tier 3, wenn der Collector den zweiten Durchgang gefahren hat. Fehlt er,
    /// laufen die Kontrastregeln nicht — und werden als solche vermerkt, nicht
    /// uebergangen.
    rendering: Option<RenderingColumns>,
}

#[wasm_bindgen]
impl Scan {
    /// Baut die Arena aus den Spalten des Collectors.
    ///
    /// `tag_dict` und `attr_dict` sind die internierten Namen, mit `\u{1}`
    /// verbunden — ein Zeichen, das in Tag- und Attributnamen nicht vorkommt.
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        tag: Vec<u32>,
        parent: Vec<i32>,
        text_off: Vec<u32>,
        text_len: Vec<u32>,
        attr_start: Vec<u32>,
        attr_name: Vec<u32>,
        attr_val_off: Vec<u32>,
        attr_val_len: Vec<u32>,
        blob: Vec<u8>,
        tag_dict: String,
        attr_dict: String,
    ) -> Scan {
        let split = |s: String| -> Vec<String> {
            if s.is_empty() {
                Vec::new()
            } else {
                s.split('\u{1}').map(str::to_string).collect()
            }
        };
        Scan {
            rendering: None,
            arena: Arena::from_columns(
                &tag,
                &parent,
                &text_off,
                &text_len,
                &attr_start,
                attr_name,
                attr_val_off,
                attr_val_len,
                blob,
                split(tag_dict),
                split(attr_dict),
            ),
        }
    }

    /// Wie viele Knoten die Arena trägt. Der Collector vergleicht das gegen
    /// seine eigene Zählung.
    #[wasm_bindgen(getter, js_name = nodeCount)]
    pub fn node_count(&self) -> u32 {
        self.arena.len() as u32
    }

    /// Nimmt die Tier-3-Spalten entgegen, die der Collector in einem eigenen
    /// Durchgang gesammelt hat.
    ///
    /// Getrennt vom Konstruktor, weil der Durchgang teuer ist und nicht zu
    /// jedem Scan gehört — siehe `packages/browser/src/rendering.ts`. Ohne ihn
    /// bleibt der Scan auf Tier 2.
    #[wasm_bindgen(js_name = withRendering)]
    pub fn with_rendering(
        &mut self,
        color: Vec<u32>,
        background: Vec<u32>,
        font_size_px: Vec<f32>,
        font_weight: Vec<u16>,
        flags: Vec<u8>,
    ) {
        self.rendering = Some(RenderingColumns {
            color,
            background,
            font_size_px,
            font_weight,
            flags,
        });
    }

    /// Lässt den Regelbestand über der Arena laufen.
    ///
    /// Der Host bedient Tier 2 immer, weil `accname` Rolle und Accessible Name
    /// über der Arena berechnet. Tier 3 nur, wenn `withRendering` gerufen
    /// wurde. Regeln oberhalb des verfügbaren Tiers vermerkt der Bericht als
    /// nicht gelaufen; sie erscheinen nie als bestanden.
    pub fn run(&self) -> Result<JsValue, JsValue> {
        let report = match &self.rendering {
            Some(spalten) => a11y_rules::run_full(&RenderArena::new(&self.arena, spalten)),
            None => a11y_rules::run_with_semantics(&SemanticArena::new(&self.arena)),
        };
        serde_wasm_bindgen::to_value(&report).map_err(JsValue::from)
    }
}

#[cfg(test)]
mod tests {
    use super::testing::build;
    use super::*;
    use std::collections::BTreeSet;

    fn rule_ids(arena: &Arena) -> BTreeSet<String> {
        let host = SemanticArena::new(arena);
        a11y_rules::run_with_semantics(&host)
            .findings
            .into_iter()
            .map(|f| f.rule_id)
            .collect()
    }

    /// Ein Dokument mit bekannten Fehlern. Die erwarteten Kennungen stammen aus
    /// `a11y-rules` — sie werden hier geprüft, nicht definiert.
    #[test]
    fn bekannte_fehler_erzeugen_die_erwarteten_rule_ids() {
        let arena = build(|b| {
            b.open("html") // kein lang
                .open("head")
                .open("title")
                .close() // leerer Titel
                .close()
                .open("body")
                .open("h3")
                .text("Übersprungene Ebene")
                .close() // kein h1, Sprung
                .open("img")
                .attr("src", "logo.png")
                .close() // kein alt
                .open("input")
                .attr("type", "text")
                .attr("id", "dup")
                .close() // kein Label
                .open("span")
                .attr("id", "dup")
                .close() // doppelte ID
                .open("a")
                .attr("href", "/a")
                .close() // kein Name
                .open("button")
                .attr("tabindex", "3")
                .close() // positiver tabindex, kein Name
                .close()
                .close();
        });

        let ids = rule_ids(&arena);
        for erwartet in [
            "document/lang-missing",
            "document/title-empty",
            "headings/h1-missing",
            "images/alt-missing",
            "forms/label-missing",
            "ids/duplicate",
            "links/name-missing",
            "buttons/name-missing",
            "keyboard/positive-tabindex",
        ] {
            assert!(ids.contains(erwartet), "{erwartet} fehlt in {ids:?}");
        }
    }

    /// Der wahrscheinlichste Fehler ist ein Adapter-Bug: „Regel feuert in der
    /// CLI, aber nicht in-page." Dagegen hilft nur, denselben Baum über beide
    /// Hosts zu schicken und die Kennungen zu vergleichen.
    #[test]
    fn adapter_liefert_dieselben_kennungen_wie_die_referenz_arena() {
        let referenz = a11y_dom::Arena::builder()
            .open("html")
            .open("body")
            .open("img")
            .attr("src", "logo.png")
            .close()
            .open("a")
            .attr("href", "/a")
            .close()
            .open("ul")
            .open("div")
            .close()
            .close()
            .close()
            .close()
            .build();

        let eigene = build(|b| {
            b.open("html")
                .open("body")
                .open("img")
                .attr("src", "logo.png")
                .close()
                .open("a")
                .attr("href", "/a")
                .close()
                .open("ul")
                .open("div")
                .close()
                .close()
                .close()
                .close();
        });

        let referenz_ids: BTreeSet<String> = a11y_rules::run(&referenz)
            .findings
            .into_iter()
            .map(|f| f.rule_id)
            .collect();
        let eigene_ids: BTreeSet<String> = a11y_rules::run(&eigene)
            .findings
            .into_iter()
            .map(|f| f.rule_id)
            .collect();

        assert_eq!(referenz_ids, eigene_ids);
    }

    /// Nicht gelaufen ist nicht bestanden: Der Bericht benennt Regeln, die der
    /// Host nicht bedienen konnte, statt zu schweigen.
    ///
    /// Ohne den Tier-3-Durchgang des Collectors sind das die Kontrastregeln.
    /// Sie verschwinden nicht aus dem Bericht — sie stehen mit
    /// `CapabilityMissing` darin.
    #[test]
    fn ohne_tier3_werden_die_kontrastregeln_vermerkt_nicht_uebergangen() {
        let arena = build(|b| {
            b.open("html").attr("lang", "de").close();
        });
        let host = SemanticArena::new(&arena);
        let report = a11y_rules::run_with_semantics(&host);

        let offen: Vec<&str> = report
            .rule_runs
            .iter()
            .filter(|r| r.not_run.is_some())
            .map(|r| r.rule_id.as_str())
            .collect();
        assert_eq!(offen, ["contrast/text-insufficient", "contrast/text-undetermined"]);

        // Kein Befund wird als bestanden ausgegeben, den niemand geprüft hat.
        assert_eq!(report.summary.pass, 0);
    }

    /// Mit dem Tier-3-Durchgang bleibt nichts offen.
    #[test]
    fn mit_tier3_bleibt_keine_regel_ungeprueft() {
        let arena = build(|b| {
            b.open("html").attr("lang", "de").close();
        });
        let spalten = RenderingColumns {
            color: vec![0; arena.len()],
            background: vec![0; arena.len()],
            font_size_px: vec![0.0; arena.len()],
            font_weight: vec![0; arena.len()],
            flags: vec![4; arena.len()],
        };
        let report = a11y_rules::run_full(&RenderArena::new(&arena, &spalten));
        assert_eq!(report.summary.rules_not_run, 0);
        assert_eq!(report.summary.pass, 0);
    }
}

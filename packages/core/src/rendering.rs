//! Tier 3 über der Arena: berechnete Stile, wie der Collector sie liefert.
//!
//! Dieses Modul rechnet nichts aus. Es reicht durch, was `packages/browser`
//! in einem eigenen Durchgang gesammelt hat — insbesondere den **effektiven**
//! Hintergrund, den der Collector über die Vorfahren auflöst. Genau das
//! verlangt `a11y_dom::ComputedStyle::background_color`, und genau dort sitzt
//! auch die Merkliste, ohne die Tier 3 nach der Messung vom 20.09.2026 nicht
//! tragbar wäre.
//!
//! Geometrie (`bounds`) ist bewusst noch nicht dabei: Die Kontrastregel braucht
//! sie nicht, und `getBoundingClientRect()` je Knoten kostet laut derselben
//! Messung so viel wie der ganze Collector. Sie kommt mit der ersten Regel, die
//! sie tatsächlich braucht — Zielgrößen.

use a11y_dom::{Color, ComputedStyle, Document, NameSource, Node, Rect, Rendering, Semantics};

use crate::arena::{Arena, ArenaNode};
use crate::semantics::SemanticArena;

/// Bit 0: `display: none`. Bit 1: `visibility: hidden`. Bit 2: Stil erfasst.
const FLAG_DISPLAY_NONE: u8 = 1;
const FLAG_VISIBILITY_HIDDEN: u8 = 2;
const FLAG_ERFASST: u8 = 4;

/// Ein Farbwert aus dem Collector, gepackt als `0xRRGGBBAA`. `0` heißt
/// „nicht bestimmbar" — nicht „schwarz und durchsichtig".
fn farbe(gepackt: u32) -> Option<Color> {
    if gepackt == 0 {
        return None;
    }
    Some(Color {
        r: (gepackt >> 24) as u8,
        g: (gepackt >> 16) as u8,
        b: (gepackt >> 8) as u8,
        a: gepackt as u8,
    })
}

/// Die Tier-3-Spalten, parallel zu den Arena-Indizes.
pub struct RenderingColumns {
    pub color: Vec<u32>,
    pub background: Vec<u32>,
    pub font_size_px: Vec<f32>,
    pub font_weight: Vec<u16>,
    pub flags: Vec<u8>,
}

/// Die Arena plus Semantik plus Darstellung — der vollständige Host.
///
/// Erfüllt `Document`, `Semantics` und `Rendering` und ist damit der Fall, für
/// den `a11y_rules::run_full` gedacht ist: Kein Tier fehlt, der Bericht enthält
/// keinen `CapabilityMissing`-Vermerk mehr.
pub struct RenderArena<'a> {
    semantik: SemanticArena<'a>,
    spalten: &'a RenderingColumns,
}

impl<'a> RenderArena<'a> {
    pub fn new(arena: &'a Arena, spalten: &'a RenderingColumns) -> Self {
        RenderArena {
            semantik: SemanticArena::new(arena),
            spalten,
        }
    }

    fn erfasst(&self, index: usize) -> bool {
        self.spalten
            .flags
            .get(index)
            .is_some_and(|f| f & FLAG_ERFASST != 0)
    }
}

impl Document for RenderArena<'_> {
    type N<'n>
        = ArenaNode<'n>
    where
        Self: 'n;

    fn root(&self) -> Self::N<'_> {
        self.semantik.root()
    }

    fn node_count(&self) -> Option<usize> {
        self.semantik.node_count()
    }
}

impl Semantics for RenderArena<'_> {
    fn role<'n>(&'n self, node: Self::N<'n>) -> Option<String> {
        self.semantik.role(node)
    }

    fn accessible_name<'n>(&'n self, node: Self::N<'n>) -> Option<String> {
        self.semantik.accessible_name(node)
    }

    fn name_source<'n>(&'n self, node: Self::N<'n>) -> Option<NameSource> {
        self.semantik.name_source(node)
    }

    fn is_ignored<'n>(&'n self, node: Self::N<'n>) -> bool {
        self.semantik.is_ignored(node)
    }
}

impl Rendering for RenderArena<'_> {
    fn computed_style<'n>(&'n self, node: Self::N<'n>) -> Option<ComputedStyle> {
        let index = node.id().0 as usize;
        if !self.erfasst(index) {
            return None;
        }
        let flags = self.spalten.flags[index];
        Some(ComputedStyle {
            color: farbe(self.spalten.color[index]),
            background_color: farbe(self.spalten.background[index]),
            font_size_px: Some(self.spalten.font_size_px[index]).filter(|px| *px > 0.0),
            font_weight: Some(self.spalten.font_weight[index]).filter(|w| *w > 0),
            display: Some(if flags & FLAG_DISPLAY_NONE != 0 {
                "none".to_string()
            } else {
                "block".to_string()
            }),
            visibility: Some(if flags & FLAG_VISIBILITY_HIDDEN != 0 {
                "hidden".to_string()
            } else {
                "visible".to_string()
            }),
        })
    }

    /// Noch nicht erhoben — siehe Modulkopf. `None` ist die ehrliche Antwort;
    /// Regeln, die Geometrie brauchen, melden damit `UNTESTED`.
    fn bounds<'n>(&'n self, _node: Self::N<'n>) -> Option<Rect> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::build;

    /// Baut Spalten, in denen jedes Element dieselben Farben trägt.
    fn spalten(nodes: usize, vorn: u32, hinten: u32) -> RenderingColumns {
        RenderingColumns {
            color: vec![vorn; nodes],
            background: vec![hinten; nodes],
            font_size_px: vec![16.0; nodes],
            font_weight: vec![400; nodes],
            flags: vec![FLAG_ERFASST; nodes],
        }
    }

    fn dokument() -> Arena {
        build(|b| {
            b.open("html")
                .attr("lang", "de")
                .open("head")
                .open("title")
                .text("Seite")
                .close()
                .close()
                .open("body")
                .open("h1")
                .text("Titel")
                .close()
                .open("p")
                .text("Ein Absatz")
                .close()
                .close()
                .close();
        })
    }

    #[test]
    fn schwacher_kontrast_wird_gemeldet() {
        let arena = dokument();
        // #999999 auf Weiß: 2,85:1.
        let s = spalten(arena.len(), 0x9999_99ff, 0xffff_ffff);
        let host = RenderArena::new(&arena, &s);
        let report = a11y_rules::run_full(&host);
        assert!(
            report
                .findings
                .iter()
                .any(|f| f.rule_id == "contrast/text-insufficient"),
            "unerwartet: {:?}",
            report
                .findings
                .iter()
                .map(|f| &f.rule_id)
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn guter_kontrast_meldet_nichts() {
        let arena = dokument();
        let s = spalten(arena.len(), 0x3333_33ff, 0xffff_ffff);
        let host = RenderArena::new(&arena, &s);
        let report = a11y_rules::run_full(&host);
        assert!(!report
            .findings
            .iter()
            .any(|f| f.rule_id == "contrast/text-insufficient"));
    }

    /// Der fachliche Kern: Was der Collector nicht auflösen konnte, wird
    /// `UNTESTED` — nicht stillschweigend bestanden.
    #[test]
    fn unbestimmbarer_hintergrund_wird_untested() {
        let arena = dokument();
        let s = spalten(arena.len(), 0x0000_00ff, 0);
        let host = RenderArena::new(&arena, &s);
        let report = a11y_rules::run_full(&host);
        let befund = report
            .findings
            .iter()
            .find(|f| f.rule_id == "contrast/text-undetermined")
            .expect("muss einen Befund erzeugen");
        assert_eq!(befund.outcome, a11y_report::Outcome::Untested);
    }

    /// Mit vollständigem Tier-Satz darf keine Regel mehr als „nicht gelaufen"
    /// vermerkt sein.
    #[test]
    fn run_full_laesst_keine_regel_ungeprueft() {
        let arena = dokument();
        let s = spalten(arena.len(), 0x3333_33ff, 0xffff_ffff);
        let host = RenderArena::new(&arena, &s);
        let report = a11y_rules::run_full(&host);
        assert_eq!(report.summary.rules_not_run, 0);
    }
}

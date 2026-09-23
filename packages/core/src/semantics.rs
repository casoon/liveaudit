//! Tier 2 über der Arena: Rolle und Accessible Name, berechnet von `accname`.
//!
//! In-Page-JavaScript kommt nicht an den nativen Accessibility-Tree —
//! `getComputedRole`/`getComputedLabel` sind WebDriver-Befehle, keine
//! In-Page-APIs. Rolle und Name entstehen deshalb in Rust über der Arena.
//!
//! Der [`IdIndex`] wird **einmal je Scan** gebaut und hier gehalten. Er löst
//! `aria-labelledby`, `aria-describedby` und `label[for]` auf; ihn je Knoten neu
//! aufzubauen machte die Namensauflösung quadratisch.
//!
//! Dass dieser Host überhaupt möglich ist, liegt an der Lebenszeit-Kopplung der
//! Tier-Traits in `a11y-dom` (`&'n self` an `Self::N<'n>`): Der Host *leiht* die
//! Arena aus und hält den daraus abgeleiteten Index daneben.

use a11y_dom::{Document, NameSource, Semantics};
use accname::IdIndex;

use crate::arena::{Arena, ArenaNode};

/// Die Arena plus der einmal je Scan gebaute ID-Index.
pub struct SemanticArena<'a> {
    arena: &'a Arena,
    ids: IdIndex<'a, ArenaNode<'a>>,
}

impl<'a> SemanticArena<'a> {
    pub fn new(arena: &'a Arena) -> Self {
        let ids = IdIndex::build(arena.root());
        SemanticArena { arena, ids }
    }
}

impl Document for SemanticArena<'_> {
    type N<'n>
        = ArenaNode<'n>
    where
        Self: 'n;

    fn root(&self) -> Self::N<'_> {
        self.arena.root()
    }

    fn node_count(&self) -> Option<usize> {
        Some(self.arena.len())
    }
}

impl Semantics for SemanticArena<'_> {
    fn role<'n>(&'n self, node: Self::N<'n>) -> Option<String> {
        accname::role(node).map(str::to_string)
    }

    fn accessible_name<'n>(&'n self, node: Self::N<'n>) -> Option<String> {
        accname::name(node, &self.ids)
    }

    /// Ohne nativen Accessibility-Tree ist nicht bekannt, *woher* ein Name
    /// stammt. `None` ist hier die ehrliche Antwort, nicht eine Lücke.
    fn name_source<'n>(&'n self, _node: Self::N<'n>) -> Option<NameSource> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::build;
    use a11y_dom::{elements, Node};

    #[test]
    fn name_kommt_ueber_aria_labelledby() {
        let arena = build(|b| {
            b.open("form")
                .open("span")
                .attr("id", "l")
                .text("Vorname")
                .close()
                .open("input")
                .attr("aria-labelledby", "l")
                .close()
                .close();
        });
        let host = SemanticArena::new(&arena);
        let feld = elements(&host).find(|n| n.local_name() == "input").unwrap();
        assert_eq!(host.accessible_name(feld).as_deref(), Some("Vorname"));
    }

    #[test]
    fn rolle_wird_implizit_abgeleitet() {
        let arena = build(|b| {
            b.open("nav").open("button").text("Menü").close().close();
        });
        let host = SemanticArena::new(&arena);
        let button = elements(&host)
            .find(|n| n.local_name() == "button")
            .unwrap();
        assert_eq!(host.role(button).as_deref(), Some("button"));
        assert_eq!(host.accessible_name(button).as_deref(), Some("Menü"));
    }

    #[test]
    fn label_for_wird_ueber_den_index_aufgeloest() {
        let arena = build(|b| {
            b.open("form")
                .open("label")
                .attr("for", "e")
                .text("E-Mail")
                .close()
                .open("input")
                .attr("id", "e")
                .attr("type", "email")
                .close()
                .close();
        });
        let host = SemanticArena::new(&arena);
        let feld = elements(&host).find(|n| n.local_name() == "input").unwrap();
        assert_eq!(host.accessible_name(feld).as_deref(), Some("E-Mail"));
    }
}

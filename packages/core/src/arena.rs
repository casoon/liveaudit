//! Die Arena: der Baum der geprüften Seite im WASM-Linearspeicher.
//!
//! Der Collector überträgt den Baum einmal je Scan spaltenweise — Typed Arrays
//! plus ein einziger UTF-8-Blob für alle Texte und Attributwerte. Darüber
//! implementiert dieses Modul [`a11y_dom::Document`] und [`a11y_dom::Node`],
//! sodass der Regelbestand aus `a11y-rules` unverändert darüber läuft.
//!
//! Warum spaltenweise und nicht als Rückrufmodell: WASM kann nicht pro
//! Trait-Methode nach JavaScript zurückrufen — jedes `children()` wäre ein
//! FFI-Übergang. Gemessen kostet der Aufbau 0,5 ms bei 31.000 Knoten
//! (siehe `spike/ERGEBNIS.md`).

use std::cmp::Ordering;

use a11y_dom::{Document, Node, NodeId, NodeKind};

/// Der Tagname, unter dem der Collector Textknoten interniert. Elemente können
/// so nicht heißen — `localName` ist nie mit `#` präfigiert.
pub const TEXT_TAG: &str = "#text";

/// Ein Knoten. Attribute liegen als Bereich `[attr_start, attr_end)` in den
/// Attributspalten der Arena, nicht pro Knoten als eigene Allokation.
struct Entry {
    tag: u32,
    parent: i32,
    text_off: u32,
    text_len: u32,
    attr_start: u32,
    attr_end: u32,
}

/// Der Baum eines Scans.
pub struct Arena {
    entries: Vec<Entry>,
    /// Kindindizes, pro Knoten zusammenhängend über `child_start` adressiert.
    children: Vec<u32>,
    child_start: Vec<u32>,
    attr_name: Vec<u32>,
    attr_val_off: Vec<u32>,
    attr_val_len: Vec<u32>,
    /// Ein einziger UTF-8-Blob für alle Texte und Attributwerte.
    blob: Vec<u8>,
    tag_names: Vec<String>,
    attr_names: Vec<String>,
    /// Die internierte Kennung von [`TEXT_TAG`], sofern das Dokument Text enthält.
    text_tag: Option<u32>,
}

impl Arena {
    /// Baut die Arena aus den Spalten des Collectors.
    #[allow(clippy::too_many_arguments)]
    pub fn from_columns(
        tag: &[u32],
        parent: &[i32],
        text_off: &[u32],
        text_len: &[u32],
        attr_start: &[u32],
        attr_name: Vec<u32>,
        attr_val_off: Vec<u32>,
        attr_val_len: Vec<u32>,
        blob: Vec<u8>,
        tag_names: Vec<String>,
        attr_names: Vec<String>,
    ) -> Self {
        let n = tag.len();
        let mut entries = Vec::with_capacity(n);
        for i in 0..n {
            entries.push(Entry {
                tag: tag[i],
                parent: parent[i],
                text_off: text_off[i],
                text_len: text_len[i],
                attr_start: attr_start[i],
                attr_end: attr_start[i + 1],
            });
        }
        let (children, child_start) = index_children(&entries);
        let text_tag = tag_names
            .iter()
            .position(|t| t == TEXT_TAG)
            .map(|i| i as u32);

        Arena {
            entries,
            children,
            child_start,
            attr_name,
            attr_val_off,
            attr_val_len,
            blob,
            tag_names,
            attr_names,
            text_tag,
        }
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    fn str_at(&self, off: u32, len: u32) -> &str {
        let (a, b) = (off as usize, (off + len) as usize);
        std::str::from_utf8(&self.blob[a..b]).unwrap_or("")
    }
}

/// Baut `children`/`child_start` aus der Elternspalte. Zwei Durchläufe, keine
/// Zwischenallokation pro Knoten.
fn index_children(entries: &[Entry]) -> (Vec<u32>, Vec<u32>) {
    let n = entries.len();
    let mut counts = vec![0u32; n];
    for e in entries {
        if e.parent >= 0 {
            counts[e.parent as usize] += 1;
        }
    }
    let mut start = vec![0u32; n + 1];
    let mut acc = 0u32;
    for i in 0..n {
        start[i] = acc;
        acc += counts[i];
    }
    start[n] = acc;

    let mut cursor = start.clone();
    let mut children = vec![0u32; acc as usize];
    for (i, e) in entries.iter().enumerate() {
        if e.parent >= 0 {
            let p = e.parent as usize;
            children[cursor[p] as usize] = i as u32;
            cursor[p] += 1;
        }
    }
    (children, start)
}

/// Ein Handle auf einen Knoten. `Copy`, weil die Traversierungs-Iteratoren aus
/// `a11y-dom` viele kurzlebige Handles erzeugen.
#[derive(Clone, Copy)]
pub struct ArenaNode<'a> {
    arena: &'a Arena,
    idx: u32,
}

impl<'a> ArenaNode<'a> {
    fn entry(self) -> &'a Entry {
        &self.arena.entries[self.idx as usize]
    }

    pub fn index(self) -> u32 {
        self.idx
    }
}

impl PartialEq for ArenaNode<'_> {
    fn eq(&self, other: &Self) -> bool {
        std::ptr::eq(self.arena, other.arena) && self.idx == other.idx
    }
}

impl Eq for ArenaNode<'_> {}

impl<'a> Node<'a> for ArenaNode<'a> {
    fn id(self) -> NodeId {
        NodeId(self.idx)
    }

    fn kind(self) -> NodeKind {
        if Some(self.entry().tag) == self.arena.text_tag {
            NodeKind::Text
        } else {
            NodeKind::Element
        }
    }

    fn parent(self) -> Option<Self> {
        let p = self.entry().parent;
        (p >= 0).then(|| ArenaNode {
            arena: self.arena,
            idx: p as u32,
        })
    }

    fn children(self) -> impl Iterator<Item = Self> + 'a {
        let arena = self.arena;
        let a = arena.child_start[self.idx as usize] as usize;
        let b = arena.child_start[self.idx as usize + 1] as usize;
        arena.children[a..b]
            .iter()
            .map(move |&idx| ArenaNode { arena, idx })
    }

    fn local_name(self) -> &'a str {
        match self.kind() {
            NodeKind::Text => "",
            NodeKind::Element => &self.arena.tag_names[self.entry().tag as usize],
        }
    }

    fn attributes(self) -> impl Iterator<Item = (&'a str, &'a str)> + 'a {
        let arena = self.arena;
        let e = self.entry();
        (e.attr_start..e.attr_end).map(move |a| {
            let a = a as usize;
            (
                arena.attr_names[arena.attr_name[a] as usize].as_str(),
                arena.str_at(arena.attr_val_off[a], arena.attr_val_len[a]),
            )
        })
    }

    fn text(self) -> &'a str {
        match self.kind() {
            NodeKind::Text => {
                let e = self.entry();
                self.arena.str_at(e.text_off, e.text_len)
            }
            NodeKind::Element => "",
        }
    }

    fn document_order(self, other: Self) -> Ordering {
        self.idx.cmp(&other.idx)
    }
}

impl Document for Arena {
    type N<'a> = ArenaNode<'a>;

    fn root(&self) -> Self::N<'_> {
        ArenaNode {
            arena: self,
            idx: 0,
        }
    }

    fn node_count(&self) -> Option<usize> {
        Some(self.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::build;
    use a11y_dom::{elements, subtree_text};

    fn doc() -> Arena {
        build(|b| {
            b.open("html")
                .attr("lang", "de")
                .open("body")
                .open("h1")
                .text("Titel")
                .close()
                .open("p")
                .text("Ein ")
                .open("a")
                .attr("href", "/x")
                .text("Link")
                .close()
                .text(".")
                .close()
                .close()
                .close();
        })
    }

    #[test]
    fn wurzel_und_attribute() {
        let d = doc();
        assert_eq!(d.root().local_name(), "html");
        assert_eq!(d.root().attr("lang"), Some("de"));
        assert!(!d.root().has_attr("dir"));
    }

    #[test]
    fn nachfahren_kommen_in_dokumentreihenfolge() {
        let d = doc();
        let namen: Vec<&str> = elements(&d).map(|n| n.local_name()).collect();
        assert_eq!(namen, vec!["html", "body", "h1", "p", "a"]);
    }

    #[test]
    fn textknoten_sind_text_und_haben_keinen_tagnamen() {
        let d = doc();
        let p = elements(&d).find(|n| n.local_name() == "p").unwrap();
        assert_eq!(p.text(), "");
        assert_eq!(subtree_text(p), "Ein Link.");
    }

    #[test]
    fn dokument_ohne_text_hat_keine_textkennung() {
        let d = build(|b| {
            b.open("html").open("img").attr("src", "a.png").close().close();
        });
        assert!(d.text_tag.is_none());
        assert_eq!(elements(&d).count(), 2);
    }
}

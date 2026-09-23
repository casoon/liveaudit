//! Zwei Aufbauwege für dieselbe Arena:
//! - `from_flat`: spaltenweise Typed Arrays + ein UTF-8-Blob (realistischer Weg)
//! - `from_json`:  JSON-String (naiver Weg, als Vergleichsmaßstab)

use serde::Deserialize;


/// Ein Knoten. Attribute liegen als Bereich [attr_start, attr_end) in den
/// Attributspalten der Arena, nicht pro Knoten als eigene Allokation.
pub struct Node {
    pub tag: u32,
    pub parent: i32,
    pub text_off: u32,
    pub text_len: u32,
    pub attr_start: u32,
    pub attr_end: u32,
}

pub struct Arena {
    pub nodes: Vec<Node>,
    /// Kindindizes, pro Knoten zusammenhängend über `child_start` adressiert.
    pub children: Vec<u32>,
    pub child_start: Vec<u32>,
    pub attr_name: Vec<u32>,
    pub attr_val_off: Vec<u32>,
    pub attr_val_len: Vec<u32>,
    /// Ein einziger UTF-8-Blob für alle Texte und Attributwerte.
    pub blob: Vec<u8>,
    pub tag_names: Vec<String>,
    pub attr_names: Vec<String>,
}

impl Arena {
    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    pub fn str_at(&self, off: u32, len: u32) -> &str {
        let (a, b) = (off as usize, (off + len) as usize);
        std::str::from_utf8(&self.blob[a..b]).unwrap_or("")
    }

    pub fn text(&self, i: usize) -> &str {
        let n = &self.nodes[i];
        self.str_at(n.text_off, n.text_len)
    }

    pub fn tag(&self, i: usize) -> &str {
        &self.tag_names[self.nodes[i].tag as usize]
    }

    pub fn attr(&self, i: usize, name: &str) -> Option<&str> {
        let n = &self.nodes[i];
        (n.attr_start..n.attr_end).find_map(|a| {
            let a = a as usize;
            (self.attr_names[self.attr_name[a] as usize] == name)
                .then(|| self.str_at(self.attr_val_off[a], self.attr_val_len[a]))
        })
    }

    pub fn has_attr(&self, i: usize, name: &str) -> bool {
        self.attr(i, name).is_some()
    }

    pub fn children_of(&self, i: usize) -> &[u32] {
        let (a, b) = (self.child_start[i] as usize, self.child_start[i + 1] as usize);
        &self.children[a..b]
    }

    /// Konkatenierter Text des gesamten Teilbaums — Grundlage für den
    /// Accessible-Name-Ersatz in den Regeln.
    pub fn subtree_text(&self, i: usize) -> String {
        let mut out = String::new();
        let mut stack = vec![i as u32];
        while let Some(n) = stack.pop() {
            let n = n as usize;
            out.push_str(self.text(n));
            stack.extend(self.children_of(n).iter().rev());
        }
        out
    }

    /// Baut `children`/`child_start` aus der Elternspalte. Zwei Durchläufe,
    /// keine Zwischenallokation pro Knoten.
    fn index_children(nodes: &[Node]) -> (Vec<u32>, Vec<u32>) {
        let n = nodes.len();
        let mut counts = vec![0u32; n + 1];
        for node in nodes {
            if node.parent >= 0 {
                counts[node.parent as usize] += 1;
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
        for (i, node) in nodes.iter().enumerate() {
            if node.parent >= 0 {
                let p = node.parent as usize;
                children[cursor[p] as usize] = i as u32;
                cursor[p] += 1;
            }
        }
        (children, start)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn from_flat(
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
        let mut nodes = Vec::with_capacity(n);
        for i in 0..n {
            nodes.push(Node {
                tag: tag[i],
                parent: parent[i],
                text_off: text_off[i],
                text_len: text_len[i],
                attr_start: attr_start[i],
                attr_end: attr_start[i + 1],
            });
        }
        let (children, child_start) = Self::index_children(&nodes);
        Arena { nodes, children, child_start, attr_name, attr_val_off, attr_val_len, blob, tag_names, attr_names }
    }

    pub fn from_json(json: &str) -> Self {
        #[derive(Deserialize)]
        struct JNode {
            tag: String,
            parent: i32,
            text: String,
            attrs: Vec<(String, String)>,
        }
        let jnodes: Vec<JNode> = serde_json::from_str(json).expect("json");

        let mut tag_names: Vec<String> = Vec::new();
        let mut attr_names: Vec<String> = Vec::new();
        let mut blob: Vec<u8> = Vec::new();
        let (mut attr_name, mut attr_val_off, mut attr_val_len) = (vec![], vec![], vec![]);
        let mut nodes = Vec::with_capacity(jnodes.len());

        let intern = |v: &mut Vec<String>, s: &str| -> u32 {
            match v.iter().position(|x| x == s) {
                Some(i) => i as u32,
                None => {
                    v.push(s.to_string());
                    (v.len() - 1) as u32
                }
            }
        };

        for j in &jnodes {
            let tag = intern(&mut tag_names, &j.tag);
            let text_off = blob.len() as u32;
            blob.extend_from_slice(j.text.as_bytes());
            let text_len = j.text.len() as u32;
            let attr_start = attr_name.len() as u32;
            for (k, v) in &j.attrs {
                attr_name.push(intern(&mut attr_names, k));
                attr_val_off.push(blob.len() as u32);
                blob.extend_from_slice(v.as_bytes());
                attr_val_len.push(v.len() as u32);
            }
            nodes.push(Node {
                tag,
                parent: j.parent,
                text_off,
                text_len,
                attr_start,
                attr_end: attr_name.len() as u32,
            });
        }
        let (children, child_start) = Self::index_children(&nodes);
        Arena { nodes, children, child_start, attr_name, attr_val_off, attr_val_len, blob, tag_names, attr_names }
    }
}

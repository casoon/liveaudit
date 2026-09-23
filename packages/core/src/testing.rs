//! Ein Spaltenaufbau für Tests.
//!
//! Erzeugt genau das Format, das der Collector über die WASM-Grenze schiebt —
//! die Tests laufen damit über denselben Pfad wie der Browser und nicht über
//! eine zweite, bequemere Konstruktion.

use crate::arena::{Arena, TEXT_TAG};

#[derive(Default)]
pub struct ColumnBuilder {
    tag: Vec<u32>,
    parent: Vec<i32>,
    text_off: Vec<u32>,
    text_len: Vec<u32>,
    attr_start: Vec<u32>,
    attr_name: Vec<u32>,
    attr_val_off: Vec<u32>,
    attr_val_len: Vec<u32>,
    blob: Vec<u8>,
    tag_names: Vec<String>,
    attr_names: Vec<String>,
    open_nodes: Vec<i32>,
}

impl ColumnBuilder {
    fn intern(names: &mut Vec<String>, s: &str) -> u32 {
        match names.iter().position(|n| n == s) {
            Some(i) => i as u32,
            None => {
                names.push(s.to_string());
                (names.len() - 1) as u32
            }
        }
    }

    fn put(&mut self, s: &str) -> (u32, u32) {
        let off = self.blob.len() as u32;
        self.blob.extend_from_slice(s.as_bytes());
        (off, s.len() as u32)
    }

    fn push(&mut self, tag: u32, text: (u32, u32)) -> i32 {
        let idx = self.tag.len() as i32;
        let parent = self.open_nodes.last().copied().unwrap_or(-1);
        self.tag.push(tag);
        self.parent.push(parent);
        self.text_off.push(text.0);
        self.text_len.push(text.1);
        self.attr_start.push(self.attr_name.len() as u32);
        idx
    }

    pub fn open(&mut self, local_name: &str) -> &mut Self {
        let tag = Self::intern(&mut self.tag_names, local_name);
        let idx = self.push(tag, (self.blob.len() as u32, 0));
        self.open_nodes.push(idx);
        self
    }

    pub fn close(&mut self) -> &mut Self {
        self.open_nodes.pop();
        self
    }

    pub fn attr(&mut self, name: &str, value: &str) -> &mut Self {
        let n = Self::intern(&mut self.attr_names, name);
        let (off, len) = self.put(value);
        self.attr_name.push(n);
        self.attr_val_off.push(off);
        self.attr_val_len.push(len);
        self
    }

    pub fn text(&mut self, data: &str) -> &mut Self {
        let tag = Self::intern(&mut self.tag_names, TEXT_TAG);
        let span = self.put(data);
        self.push(tag, span);
        self
    }

    fn build(mut self) -> Arena {
        self.attr_start.push(self.attr_name.len() as u32);
        Arena::from_columns(
            &self.tag,
            &self.parent,
            &self.text_off,
            &self.text_len,
            &self.attr_start,
            self.attr_name,
            self.attr_val_off,
            self.attr_val_len,
            self.blob,
            self.tag_names,
            self.attr_names,
        )
    }
}

/// Baut eine Arena aus einem Baum, der wie im Collector in Dokumentreihenfolge
/// entsteht.
pub fn build(f: impl FnOnce(&mut ColumnBuilder)) -> Arena {
    let mut b = ColumnBuilder::default();
    f(&mut b);
    b.build()
}

mod arena;
mod rules;

use wasm_bindgen::prelude::*;

/// Ergebnis eines Laufs: Anzahl Findings plus die in WASM gemessenen Phasen.
#[wasm_bindgen]
pub struct RunResult {
    findings: u32,
    nodes: u32,
}

#[wasm_bindgen]
impl RunResult {
    #[wasm_bindgen(getter)]
    pub fn findings(&self) -> u32 { self.findings }
    #[wasm_bindgen(getter)]
    pub fn nodes(&self) -> u32 { self.nodes }
}

#[wasm_bindgen]
pub struct Session {
    arena: Option<arena::Arena>,
}

#[wasm_bindgen]
impl Session {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Session {
        Session { arena: None }
    }

    /// Weg B: spaltenweise Typed Arrays + ein UTF-8-Blob.
    #[allow(clippy::too_many_arguments)]
    pub fn build_flat(
        &mut self,
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
    ) -> u32 {
        let tag_names: Vec<String> = tag_dict.split('\u{1}').map(str::to_string).collect();
        let attr_names: Vec<String> = attr_dict.split('\u{1}').map(str::to_string).collect();
        let a = arena::Arena::from_flat(
            &tag, &parent, &text_off, &text_len, &attr_start,
            attr_name, attr_val_off, attr_val_len, blob, tag_names, attr_names,
        );
        let n = a.len() as u32;
        self.arena = Some(a);
        n
    }

    /// Weg A: JSON-String, als Vergleichsmaßstab.
    pub fn build_json(&mut self, json: &str) -> u32 {
        let a = arena::Arena::from_json(json);
        let n = a.len() as u32;
        self.arena = Some(a);
        n
    }

    pub fn run_rules(&self) -> RunResult {
        let a = self.arena.as_ref().expect("keine Arena");
        let f = rules::run(a);
        RunResult { findings: f.len() as u32, nodes: a.len() as u32 }
    }
}

impl Default for Session {
    fn default() -> Self { Self::new() }
}

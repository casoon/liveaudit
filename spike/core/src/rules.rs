//! 20 Tier-1-Regeln aus dem V1-Katalog. Bewusst nur das, was ohne Rendering
//! und ohne nativen A11y-Tree entscheidbar ist.

use crate::arena::Arena;

pub struct Finding {
    pub rule: &'static str,
    pub node: u32,
}

const VALID_ROLES: &[&str] = &[
    "alert", "alertdialog", "application", "article", "banner", "button", "cell",
    "checkbox", "columnheader", "combobox", "complementary", "contentinfo",
    "definition", "dialog", "directory", "document", "feed", "figure", "form",
    "grid", "gridcell", "group", "heading", "img", "link", "list", "listbox",
    "listitem", "log", "main", "marquee", "math", "menu", "menubar", "menuitem",
    "menuitemcheckbox", "menuitemradio", "navigation", "none", "note", "option",
    "presentation", "progressbar", "radio", "radiogroup", "region", "row",
    "rowgroup", "rowheader", "scrollbar", "search", "searchbox", "separator",
    "slider", "spinbutton", "status", "switch", "tab", "table", "tablist",
    "tabpanel", "term", "textbox", "timer", "toolbar", "tooltip", "tree",
    "treegrid", "treeitem",
];

fn is_heading(tag: &str) -> Option<u8> {
    let b = tag.as_bytes();
    (b.len() == 2 && b[0] == b'h' && (b'1'..=b'6').contains(&b[1])).then(|| b[1] - b'0')
}

fn suspicious_alt(alt: &str) -> bool {
    let a = alt.trim().to_ascii_lowercase();
    a.ends_with(".jpg") || a.ends_with(".png") || a.ends_with(".jpeg")
        || a.ends_with(".gif") || a.ends_with(".webp") || a.ends_with(".svg")
        || a == "bild" || a == "image" || a == "foto" || a == "photo" || a == "grafik"
}

/// Ersatz für den Accessible Name, solange es kein `accname`-Crate gibt:
/// aria-label → Subtree-Text → title → alt.
fn has_name(a: &Arena, i: usize) -> bool {
    if a.attr(i, "aria-label").is_some_and(|v| !v.trim().is_empty()) { return true; }
    if a.has_attr(i, "aria-labelledby") { return true; }
    if !a.subtree_text(i).trim().is_empty() { return true; }
    if a.attr(i, "title").is_some_and(|v| !v.trim().is_empty()) { return true; }
    a.attr(i, "alt").is_some_and(|v| !v.trim().is_empty())
}

pub fn run(a: &Arena) -> Vec<Finding> {
    let mut f = Vec::new();
    let mut push = |rule, node: usize| f.push(Finding { rule, node: node as u32 });

    // Dokumentweite Zustände, in einem Durchlauf gesammelt.
    let mut seen_ids: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    let mut all_ids: std::collections::HashSet<&str> = std::collections::HashSet::new();
    let mut has_h1 = false;
    let mut title_node: Option<usize> = None;
    let mut html_node: Option<usize> = None;
    let mut last_level = 0u8;

    // Ein Vorlauf: alle IDs, alle label[for]-Ziele.
    let mut label_targets: std::collections::HashSet<&str> = std::collections::HashSet::new();
    for i in 0..a.len() {
        if let Some(id) = a.attr(i, "id") {
            all_ids.insert(id);
        }
        if a.tag(i) == "label" {
            if let Some(f) = a.attr(i, "for") {
                label_targets.insert(f);
            }
        }
    }

    // Ist ein Knoten in ein <label> eingeschachtelt?
    let in_label = |mut n: usize| -> bool {
        loop {
            let p = a.nodes[n].parent;
            if p < 0 { return false; }
            n = p as usize;
            if a.tag(n) == "label" { return true; }
        }
    };

    for i in 0..a.len() {
        let tag = a.tag(i);

        // IDs: doppelte IDs
        if let Some(id) = a.attr(i, "id") {
            if !id.is_empty() && seen_ids.insert(id, i).is_some() {
                push("ids/duplicate", i);
            }
        }

        match tag {
            "html" => html_node = Some(i),
            "title" => title_node = Some(i),
            "img" => {
                match a.attr(i, "alt") {
                    None => push("images/alt-missing", i),
                    Some(alt) if suspicious_alt(alt) => push("images/alt-suspicious", i),
                    _ => {}
                }
            }
            "svg" => {
                if !has_name(a, i) && a.attr(i, "role").map(|r| r != "presentation" && r != "none").unwrap_or(true) {
                    push("svg/name-missing", i);
                }
            }
            "a" => {
                if a.has_attr(i, "href") && !has_name(a, i) {
                    push("links/name-missing", i);
                }
            }
            "button" => {
                if !has_name(a, i) {
                    push("buttons/name-missing", i);
                }
            }
            "input" | "select" | "textarea" => {
                let t = a.attr(i, "type").unwrap_or("text");
                if t != "hidden" && t != "submit" && t != "button" && t != "reset" {
                    let aria_named = a.has_attr(i, "aria-label") || a.has_attr(i, "aria-labelledby");
                    let labelled = aria_named
                        || a.attr(i, "id").is_some_and(|id| label_targets.contains(id))
                        || in_label(i)
                        || a.attr(i, "title").is_some_and(|v| !v.trim().is_empty());
                    if !labelled {
                        push("forms/label-missing", i);
                    }
                    // Placeholder als einziger Ersatz für ein Label
                    if a.has_attr(i, "placeholder") && !aria_named && !in_label(i)
                        && !a.attr(i, "id").is_some_and(|id| label_targets.contains(id))
                    {
                        push("forms/placeholder-as-label", i);
                    }
                }
            }
            "meta" => {
                if a.attr(i, "name") == Some("viewport") {
                    if let Some(c) = a.attr(i, "content") {
                        if c.contains("user-scalable=no") || c.contains("maximum-scale=1") {
                            push("zoom/viewport-locked", i);
                        }
                    }
                }
            }
            _ => {}
        }

        // Überschriften
        if let Some(level) = is_heading(tag) {
            if level == 1 { has_h1 = true; }
            if a.subtree_text(i).trim().is_empty() {
                push("headings/empty", i);
            }
            if last_level > 0 && level > last_level + 1 {
                push("headings/skip-level", i);
            }
            last_level = level;
        }

        // ARIA
        if let Some(role) = a.attr(i, "role") {
            for r in role.split_whitespace() {
                if !VALID_ROLES.contains(&r) {
                    push("aria/role-invalid", i);
                    break;
                }
            }
        }
        for rel in ["aria-labelledby", "aria-describedby", "aria-controls"] {
            if let Some(v) = a.attr(i, rel) {
                if v.split_whitespace().any(|id| !all_ids.contains(id)) {
                    push("aria/reference-missing", i);
                }
            }
        }

        // Tastatur
        if let Some(ti) = a.attr(i, "tabindex") {
            if ti.parse::<i32>().map(|n| n > 0).unwrap_or(false) {
                push("keyboard/positive-tabindex", i);
            }
            if a.attr(i, "aria-hidden") == Some("true") && ti.parse::<i32>().map(|n| n >= 0).unwrap_or(false) {
                push("keyboard/hidden-focusable", i);
            }
        }
        if a.attr(i, "aria-hidden") == Some("true") && matches!(tag, "a" | "button" | "input" | "select" | "textarea") {
            push("keyboard/hidden-focusable", i);
        }
    }

    // Dokumentweite Regeln
    match html_node {
        Some(h) => match a.attr(h, "lang") {
            None => push("document/lang-missing", h),
            Some(l) if l.trim().is_empty() || l.len() < 2 => push("document/lang-invalid", h),
            _ => {}
        },
        None => {}
    }
    match title_node {
        None => push("document/title-missing", 0),
        Some(t) if a.subtree_text(t).trim().is_empty() => push("document/title-empty", t),
        _ => {}
    }
    if !has_h1 {
        push("headings/h1-missing", 0);
    }
    f
}

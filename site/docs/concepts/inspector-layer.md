---
title: The inspector layer
description: What the layer puts on your page, and what it guarantees about it.
order: 30
---

Findings are drawn on the page itself. Three display variants:

| Variant | For |
| --- | --- |
| Frame | Larger elements — a rectangle over the target's bounding box |
| Marker | A numbered dot; it opens a popover with the explanation, the reference and the markup |
| Sidebar | The full list, grouped by category, dockable to any of the four edges and resizable |

A fourth — numbered markers along the real tab order, so a stray `tabindex="4"` becomes
visible — needs tier 4 and is not built.

## What it guarantees about your page

The whole UI lives in one shadow root on a single host element, `<liveaudit-inspector>`, the
last child of `<body>`. The shadow root isolates it from your CSS: themes, utility
frameworks, `!important`, wild `z-index` values.

- **Nothing is written into the inspected subtree.** No `data-*` attributes for identifying
  elements, no inline styles on your elements. The mapping from element to node lives in a
  `WeakMap` in memory.
- **No layout and no scroll height change.** The host is `position: fixed` with
  `pointer-events: none`, declared inline with `!important` so a page rule on the tag name
  cannot override it. Only markers, popover and sidebar take pointer events.
- **Clicks meant for the page reach it.** Frames stay click-through on purpose: a clickable
  rectangle over a large element would intercept exactly the clicks that belong to the page.
- **It measures without measuring itself.** For hit testing it reads `elementsFromPoint()`
  and filters its own host out of the stack, rather than hiding itself and forcing a second
  layout.
- **`hide()` leaves nothing behind.** The host is removed, and if focus was inside the layer
  it returns to where it was before — the focus loss the tool reports in others.

## It inspects itself

The layer is an accessibility tool, so it is scanned with its own scanner. That found a real
defect early: the popover carried `aria-labelledby` pointing at a heading that only exists
once it opens. The reference is now set on open and removed on close.

What remains are document-wide rules complaining that a fragment is not a document — a
missing title, no `main` landmark. The layer is not a document. Not one finding sits on one
of its elements.

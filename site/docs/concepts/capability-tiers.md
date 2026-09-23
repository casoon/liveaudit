---
title: What a rule may claim
description: Capability tiers — how a rule knows whether its substrate can answer the question.
order: 20
---

The same rules run at build time on static HTML, in CI against a headless browser, and here
against a live DOM. Those substrates can answer different questions. A rule therefore
declares what it needs, and the host declares what it can serve.

| Tier | The host can | Example rule |
| --- | --- | --- |
| 1 | Read the tree: elements, attributes, text | `images/alt-missing` |
| 2 | Compute accessible name and role | `links/ambiguous-name` |
| 3 | Report computed styles and geometry | `contrast/text-insufficient` |
| 4 | Observe interaction: focus order, live regions | not built yet |

If the host does not serve a rule's tier, the rule reports `UNTESTED` — never `PASS`, and
never nothing at all. That is the fact this project is built around rather than a formality.

## What LiveAudit serves

Tiers 1 and 2 always: the collector walks the real DOM, and accessible names and roles are
computed in the core from the accname and HTML-AAM specifications.

Tier 3 on request, via `scan(root, { rendering: true })`. The pass resolves the **effective**
background behind each text node by walking its ancestors, with a memo per element — without
that memo the walk repeats over the same ancestors and becomes the single largest cost of a
scan.

Geometry is not collected yet. `getBoundingClientRect()` per node costs about as much as the
entire collector, and no rule in the current set needs it. It arrives with the first one that
does — target sizes.

Tier 4 is not built.

## When the background cannot be reduced to a colour

A background image, a gradient, `background-blend-mode`, a partly transparent background over
an ancestor: the collector reports "not determinable" and the rule answers
`contrast/text-undetermined` with `UNTESTED`. Checking against an assumed white would produce
a `PASS` that someone relies on.

You can watch that happen on the [demo page](../../../demo/): the line on the gradient stays
UNTESTED while the grey line at 2.85:1 fails.

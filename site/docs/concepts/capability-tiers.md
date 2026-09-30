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
| 3 | Report computed styles and geometry | `contrast/text-insufficient`, `targets/size` |
| 4 | Observe interaction: focus order, live regions | only focus visibility, as an opt-in pass |

If the host does not serve a rule's tier, the rule does not run — and the report says so,
with the reason, instead of passing it or saying nothing at all. That is the fact this project
is built around rather than a formality. `UNTESTED` is something else: a rule that did run but
cannot decide, such as text on a gradient.

## What LiveAudit serves

Tiers 1 and 2 always: the collector walks the real DOM, and accessible names and roles are
computed in the core from the accname and HTML-AAM specifications.

Tier 3 on request, via `scan(root, { rendering: true })`. The pass resolves the **effective**
background behind each text node by walking its ancestors, with a memo per element — without
that memo the walk repeats over the same ancestors and becomes the single largest cost of a
scan.

The same pass collects what the heuristic rules need: `flex-direction`, `order`,
`min-width`, `cursor` and `position` from the style it already read, running animations once
per scan, and geometry — but only for controls. `getBoundingClientRect()` per node would cost
about as much as the entire collector. These rules suspect rather than prove, so they answer
`REVIEW`, never `FAIL`: CSS that reorders focusable content, endless animation without a pause
control, `min-width` above 320 px, elements that look clickable but have no role, controls
covered by fixed bars or bars deeper than `scroll-padding-top`, and targets under 24 × 24 px
that also miss the spacing exception.

Of tier 4 there is one piece: focus visibility, via `{ rendering: true, focus: true }`. It
focuses each control once, compares its style, and restores focus — the one pass that changes
the page's state, so it only runs when asked. Without it, focus visibility is reported as
`UNTESTED`. Focus order is not built.

## What a rule sees

Content that is hidden is out of scope. Each rule declares whether it looks at the
accessibility tree (the default: nothing under `aria-hidden="true"`, nothing that is not
rendered), at what is rendered (keyboard and contrast rules — being focusable under
`aria-hidden` *is* the finding), or at the whole markup (document-wide rules and ID
references, since `aria-labelledby` may point at hidden text). Without the rendering pass,
"not rendered" can only be read from the `hidden` attribute.

## When the background cannot be reduced to a colour

A background image, a gradient, `background-blend-mode`, a partly transparent background over
an ancestor: the collector reports "not determinable" and the rule answers
`contrast/text-undetermined` with `UNTESTED`. Checking against an assumed white would produce
a `PASS` that someone relies on.

You can watch that happen on the [demo page](../../../demo/): the line on the gradient stays
UNTESTED while the grey line at 2.85:1 fails.

---
title: LiveAudit
description: An embedded accessibility inspector — what it is, what it deliberately does not do, and where to start.
order: 1
---

LiveAudit is an accessibility inspector that runs **inside the page it inspects**. You add
one script tag to your own site, unlock it for a visit, and the findings appear on the
elements they belong to — in the page's real state, after every script, embed and
client-side render has had its say.

That is the whole reason it exists. A build-time check sees the HTML your framework emitted;
a crawler sees the page a headless browser rendered without your session, your cookie banner
or your third-party widgets. This sees what a visitor has in front of them.

## It inspects. It does not repair.

This is not an accessibility overlay. Tools in that category modify the live page and
claim compliance from it, leaving the defects in the source. LiveAudit writes nothing into the page: no attributes on your elements, no inline
styles, no rewritten markup. Hide the layer and nothing of it remains in the document.

## Where to go next

- [Embedding it](getting-started/embedding/) — build the two files, serve them, unlock the page.
- [The JavaScript API](getting-started/api/) — `init`, `scan`, `show`, `dock`, `hide`.
- [Four states, two axes](concepts/outcomes/) — why there is no score.
- [What a rule is allowed to claim](concepts/capability-tiers/) — capability tiers and the contrast pass.
- [The inspector layer](concepts/inspector-layer/) — what it guarantees about your page.

The live demo is one level up at [Demo](../demo/): press one button and the layer appears
over the documentation site itself.

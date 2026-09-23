---
title: JavaScript API
description: init, scan, show, dock, hide — and what each of them costs.
order: 20
---

On an unlocked page the global `LiveAudit` exists. Nothing starts by itself: the WebAssembly
module loads on the first `init()`, the layer appears on the first `show()`.

```js
await LiveAudit.show();                         // scan the document, draw the layer
await LiveAudit.show(element);                  // scan a subtree instead
await LiveAudit.show(undefined, { dock: 'left' }); // and dock the sidebar left
LiveAudit.hide();                               // remove it; nothing stays behind
```

## `scan(root?, options?)`

Scans and returns the result without drawing anything — for your own UI, or for reading the
findings in the console.

```js
const result = await LiveAudit.scan(document.body);
result.documents[0].report.findings;  // Finding[]
result.documents[0].nodes;            // nodes collected
```

Each same-origin `<iframe>` is scanned as its own document with its own id space and appears
as a further entry in `documents`. A cross-origin frame cannot be entered and is reported as
an untested scope — not as a silent omission.

## `show(root?, options?)`

Scans, then draws the layer. `options` are those of `scan`, plus `dock` for the edge the
sidebar attaches to (`right`, `left`, `top`, `bottom`; the choice is remembered).

## The contrast pass: `{ rendering: true }`

Contrast needs computed styles and the effective background behind the text, which is a
second walk over the collected elements. It costs 1.9× to 4.6× the collector, so it is not
part of every scan:

```js
await LiveAudit.show(undefined, { rendering: true });
```

Without it the contrast rules report `UNTESTED` — never `PASS`, and never silence.

## Live mode: `watch(root?, options?)`

Scans, draws the layer, and keeps it current while the page changes — for pages
that build themselves after load, or that you are editing while you look at them.

```js
await LiveAudit.watch();                 // stays current
await LiveAudit.watch(undefined, { debounceMs: 500 });
LiveAudit.unwatch();                     // stop; the layer stays as it is
```

Only the **changed subtree** is scanned again, 200 ms after the last mutation.
Collecting the DOM is the measured bottleneck — about 90% of a scan — so a full
rescan per mutation would be felt on any page that moves.

Two limits, both deliberate:

- Rules that speak about the scope as a whole — a missing `main` landmark, a
  missing title, a missing `h1` — stay as the last full scan left them. A subtree
  is not a document, and answering those questions on a fragment would invent a
  verdict. They are as old as the last full scan, which beats being wrong.
- Mutations *inside* a same-origin frame are not watched. Frames are rescanned
  when a subtree above them changes.

## Unlocking from your own code

```js
import LiveAudit, { enable } from '/vendor/liveaudit/inspector.js';
enable();  // programmatic unlock, bypassing the ?liveaudit flag
```

`enable()` is what this site's own demo page uses: the page is the tool's purpose, so it says
so in code instead of relying on a query parameter.

## Others

| Call | Does |
| --- | --- |
| `init()` | Loads and instantiates the WebAssembly module; repeated calls share one load |
| `isVisible()` | Whether the layer is currently in the document |
| `dock(side)` | Moves the sidebar without scanning again |
| `remember()` / `forget()` | Keeps the unlock for this origin, or drops it |

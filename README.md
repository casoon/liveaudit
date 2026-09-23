# LiveAudit

> Accessibility inspection where the page actually runs

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![a11y-rules](https://img.shields.io/crates/v/a11y-rules?label=a11y-rules)](https://crates.io/crates/a11y-rules)
[![accname](https://img.shields.io/crates/v/accname?label=accname)](https://crates.io/crates/accname)

LiveAudit is an embedded accessibility inspector. One script tag on your own
site, and findings appear on the affected element — on the page, in its real
state after every script and embed has run — instead of in a report that sits
beside it.

**It inspects. It does not repair.** This is deliberately not an accessibility
overlay: nothing about the page is modified.

## Status

**Runnable and embeddable.** `pnpm build` produces `dist/inspector.js` and
`dist/inspector_bg.wasm`; `LiveAudit.scan()` returns `Finding[]` and
`LiveAudit.show()` puts the inspector layer on the page — frames, markers with
popovers, and a sidebar grouped by category that docks to any of the four
edges and can be resized. `LiveAudit.hide()` removes it again. Unlocked per
page with `?liveaudit`; inert without it.

**Contrast runs too**, via an opt-in second pass:
`scan(root, { rendering: true })`. It costs 1.9× to 4.6× the collector, so it
is not the default — and without it the contrast rules report `UNTESTED`, never
`PASS`.

**It can stay current while the page changes.** `LiveAudit.watch()` observes the
document and rescans **only the changed subtree**, 200 ms after the last
mutation — collecting the DOM is the measured bottleneck, so a full rescan per
mutation would be felt on any page that moves.

There is a live demo on the [project page](https://casoon.github.io/liveaudit/):
press one button and the layer appears over the documentation site itself.

Still open: checks that need interaction or geometry — focus order and target
size.

| | Status |
|---|---|
| Concept and architecture decisions | done — [docs/decisions.md](docs/decisions.md) |
| Performance measurement | done — [spike/ERGEBNIS.md](spike/ERGEBNIS.md) |
| Shared core `a11y-core` | **published**, four crates on crates.io |
| `packages/core` — WASM shell | **done** — arena adapter, tier 2 via `accname` |
| `packages/browser` — DOM collector | **done** — shadow DOM, frames, identity maps |
| `packages/ui` — inspector layer | **done** — frames, markers, dockable sidebar |
| `packages/liveaudit` — public API | **done** — `init`/`scan`/`show`/`dock`/`hide` |
| Delivery model — CSP, gating, bundle budget | **done** — see below |
| Tier 3 — contrast | **done** — opt-in pass, see above |
| Tier 3 geometry and tier 4 — focus order, target size, live mode | open |

All five steps of [docs/build-plan.md](docs/build-plan.md) are done; the current
state is in [docs/project-state.md](docs/project-state.md).

```bash
pnpm install
pnpm build     # dist/inspector.js + dist/inspector_bg.wasm
pnpm test          # Rust and TypeScript, via jsdom
pnpm test:browser  # the inspector layer in a real browser (Playwright)
pnpm serve              # or: opi serve — then open /examples/inspector.html
```

## Four states, not a score

A single percentage hides the difference between *detected*, *suspected* and
*not decidable by a machine at all*. LiveAudit keeps them apart:

| State | Meaning |
|---|---|
| `FAIL` | Detected automatically. The rule could prove it. |
| `REVIEW` | Suspected heuristically. Needs a human decision. |
| `PASS` | Passed. Kept internally, not shown by default. |
| `UNTESTED` | Not decidable automatically. Produces a checklist item, not a verdict. |

Severity is a **separate** axis (`Low` … `Critical`): how sure the statement is,
versus how much the problem weighs. There is no third "certainty" axis — a rule
that can only guess returns `REVIEW`, not `FAIL` with low confidence.

### "Did not run" is not "passed"

Every rule leaves an execution record. A contrast check without rendering access
reads like a passed check in most tools; here it is reported as
`CapabilityMissing` — the report states what it did *not* inspect.

## One rule set, three surfaces

The rules live in [a11y-core](https://github.com/casoon/a11y-core) and are shared
across three tools. A finding has the same rule ID in all of them.

| Surface | Tool | Substrate |
|---|---|---|
| Build time | [astro-post-audit](https://github.com/casoon/astro-post-audit) | static HTML from `dist/` |
| CI and crawl | [auditmysite](https://github.com/casoon/auditmysite) | Chrome via CDP, native accessibility tree |
| Live page | **LiveAudit** | the page's own DOM, via WASM |

That reuse — not speed — is the reason for the Rust core. See
[docs/decisions.md](docs/decisions.md).

| Crate | Role |
|---|---|
| [`a11y-dom`](https://crates.io/crates/a11y-dom) | tree traits and capability tiers |
| [`a11y-rules`](https://crates.io/crates/a11y-rules) | the rules themselves |
| [`accname`](https://crates.io/crates/accname) | accessible name and role per WAI-ARIA / HTML-AAM |
| [`a11y-report`](https://crates.io/crates/a11y-report) | finding and report model |

## How it works

TypeScript collects the DOM into an arena in WASM memory — once per scan, because
WASM cannot call back into JavaScript per tree method. Rust evaluates the rules
over that arena. TypeScript resolves findings back to real elements and draws the
inspector layer.

Measured on 2026-09-18 across five real documents from 1,244 to 723,613 nodes
([spike/ERGEBNIS.md](spike/ERGEBNIS.md)):

- Building the arena across the WASM boundary: **0.5 ms at 31,000 nodes**
- DOM traversal in JavaScript before it: **79 ms** — about 90% of total time, and
  the actual bottleneck
- WASM size in that spike: **22 KB gzipped** for its own arena plus 20 simple
  rules. The shipped module is larger — 80.3 KB gzipped — because it carries the
  full `a11y-rules` set and the name computation from `accname`. Performance is
  therefore neither an argument for nor against WASM; the reason is rule reuse
  across three surfaces.

## Getting it onto a page

LiveAudit is **self-hosted**: you copy `dist/` into your own project and serve it
from your own domain. There is no CDN — a centrally hosted script would make its
domain a permanent dependency of every site that embeds it, which is a poor
trade for a tool you only need occasionally.

```html
<script type="module" src="/vendor/liveaudit/inspector.js"></script>
```

**Nothing happens until you unlock it.** Without the flag the script registers
nothing, creates no global and loads no WebAssembly:

```
https://example.com/page?liveaudit
```

Then in the console, or from your own UI:

```js
await LiveAudit.show();   // scan and draw the inspector layer
await LiveAudit.watch();  // …and keep it current while the page changes
LiveAudit.unwatch();      // stop watching; the layer stays
LiveAudit.hide();         // remove it again
LiveAudit.remember();     // keep it unlocked on this origin
LiveAudit.forget();       // and undo that
```

`?liveaudit=0` overrides a remembered unlock for a single visit without clearing
it. Deliberately no host allowlist: the point of LiveAudit is inspecting where
the page actually runs, and restricting it to localhost and staging would remove
exactly that case.

### Content Security Policy

Chrome needs `wasm-unsafe-eval` in `script-src` to instantiate WebAssembly:

```
Content-Security-Policy: script-src 'self' 'wasm-unsafe-eval'
```

Without it, `init()` throws an error naming the missing directive, with the
original failure attached as `cause` — rather than failing in a way that does
not look like CSP at all.

### Budget

The build enforces a size budget and fails when it is exceeded: 20 KB gzip for
`inspector.js`, 100 KB for the WebAssembly module. A budget that is only reported
is not a budget.

## The inspector layer

The findings are drawn **on the page itself**, not in a separate report — that is
the point of the whole exercise. Three display variants:

| Variant | For |
|---|---|
| **Frame** | Larger elements — a rectangle matching the target's bounding box |
| **Marker** | Small elements and icons — a numbered dot; clicking opens a popover with the explanation, the WCAG reference and the markup |
| **Side panel** | The full list, grouped by category; clicking a finding scrolls to the element and shows its marker |

A fourth variant — numbered markers along the real tab order, so a stray
`tabindex="4"` becomes visible — needs tier 4 and is not built yet.

The whole UI lives in a single shadow root host, `<liveaudit-inspector>`, which
isolates it from the page's CSS — WordPress themes, Bootstrap, Tailwind,
`!important`, wild `z-index` rules.

**The inspected subtree is never modified.** No `data-*` attributes for element
identification, no inline styles on the target; the mapping is held in a
`WeakMap` in memory. The host is `position: fixed` and `pointer-events: none` by
default, so it changes neither layout nor scroll height and does not intercept
clicks meant for the page. It excludes itself from the scan, and filters its own
host out of `elementsFromPoint()` rather than hiding itself for a measurement —
same result, one layout instead of two.

State and severity are always shown separately, never combined into a
percentage, and `UNTESTED` is its own visible category rather than something
filtered away.

## What it cannot do

Some things are not reliably automatable, and the tool says so instead of
claiming a verdict — screen reader experience, whether an alt text describes the
image adequately, whether a reading order makes sense, whether a complex widget
behaves sensibly. These are reported as `UNTESTED` with a checklist. See
[docs/constraints.md](docs/constraints.md).

## Documentation

| | |
|---|---|
| [docs/project-state.md](docs/project-state.md) | current state, stack, package layout |
| [docs/architecture.md](docs/architecture.md) | arena, capability tiers, visualisation |
| [docs/decisions.md](docs/decisions.md) | every architectural decision and its reasoning |
| [docs/constraints.md](docs/constraints.md) | what the tool and WASM fundamentally cannot do |
| [docs/build-plan.md](docs/build-plan.md) | what to build next, with acceptance criteria |

The documentation under `docs/` is written in German; this README is the English
entry point.

## License

MIT.

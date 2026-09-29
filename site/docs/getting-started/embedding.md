---
title: Embedding it
description: Install the package, copy the two files into your own site, unlock the page.
order: 10
---

LiveAudit is **self-hosted**. There is no CDN, and that is a decision rather than an
omission: a centrally hosted script would make someone else's domain a permanent dependency
of every site that embeds it — a poor trade for a tool you need occasionally.

## Install

```bash
npm install @casoon/liveaudit
```

The package holds two files that belong next to each other:

- `inspector.js` — 18.8 kB gzipped, the collector, the API and the inspector layer
- `a11y_wasm_bg.wasm` — 80.9 kB gzipped, the rule engine

Building from this repository gives the same two files in `dist/` (`pnpm install`, then
`pnpm build`). The build enforces a size budget and fails when it is exceeded (25 kB for the
JavaScript, 100 kB for the module). A budget that is only reported is not a budget.

## Serve

Copy both files into your own site as part of your build, keeping them side by side — the
module resolves its WebAssembly relative to itself:

```bash
mkdir -p public/vendor/liveaudit
cp node_modules/@casoon/liveaudit/inspector.js node_modules/@casoon/liveaudit/a11y_wasm_bg.wasm public/vendor/liveaudit/
```

```html
<script type="module" src="/vendor/liveaudit/inspector.js"></script>
```

## Unlock

**Nothing happens until you say so.** Without the flag the script registers nothing, creates
no global object and loads no WebAssembly; on a production page the cost is downloading and
parsing the bundle.

```
https://example.com/page?liveaudit
```

`LiveAudit.remember()` keeps it unlocked for that origin, `LiveAudit.forget()` undoes it, and
`?liveaudit=0` overrides a remembered unlock for a single visit without clearing it.

There is deliberately no host allowlist. Restricting the tool to localhost and staging would
remove the one case it exists for: inspecting where the page actually runs.

## Content Security Policy

Instantiating WebAssembly needs `wasm-unsafe-eval`:

```
Content-Security-Policy: script-src 'self' 'wasm-unsafe-eval'
```

Without it, `init()` throws an error that names the missing directive, with the original
failure attached as `cause`. Browsers report this differently — a `CompileError` here, a
`TypeError` there — and none of them says "CSP" on its own.

No hash for styles is needed: the layer adopts its stylesheet through `adoptedStyleSheets`
rather than a `<style>` element, so a strict `style-src 'self'` does not block it, and nothing
in your policy has to change when LiveAudit is updated.

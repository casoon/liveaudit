---
title: Embedding it
description: Build the two files, copy them into your own site, unlock the page.
order: 10
---

LiveAudit is **self-hosted**. There is no CDN, and that is a decision rather than an
omission: a centrally hosted script would make someone else's domain a permanent dependency
of every site that embeds it — a poor trade for a tool you need occasionally.

## Build

```bash
pnpm install
pnpm build
```

The result is two files that belong next to each other:

- `dist/inspector.js` — 14.7 kB gzipped, the collector, the API and the inspector layer
- `dist/inspector_bg.wasm` — 80.3 kB gzipped, the rule engine

The build enforces a size budget and fails when it is exceeded (20 kB for the JavaScript,
100 kB for the module). A budget that is only reported is not a budget.

## Serve

Copy both files into your own site, keeping them side by side — the module resolves its
WebAssembly relative to itself:

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

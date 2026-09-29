# @casoon/liveaudit

An embedded accessibility inspector. One script on your own site, and findings
appear on the affected element — in the page as it actually runs, after every
script and embed — instead of in a report beside it.

**It inspects. It does not repair.** Nothing about the inspected page is
modified.

## What is in the package

Two files that belong next to each other, plus a source map:

| File | |
|---|---|
| `inspector.js` | the collector, the API and the inspector layer |
| `a11y_wasm_bg.wasm` | the rule engine; `inspector.js` loads it from its own directory |

The rules come from [`a11y-rules`](https://crates.io/crates/a11y-rules) in
[barrierlab](https://github.com/casoon/barrierlab) — the same rule set that
drives astro-post-audit at build time and auditmysite in CI, with the same rule
ids. Which version is bundled stands in the changelog of each release; a change
to the bundled rules that changes findings is at least a minor version.

## Self-hosted, on purpose

Serve both files from your own origin — there is no CDN. A centrally hosted
script would make someone else's domain a permanent dependency of every page
that embeds it. Copy them from `node_modules/@casoon/liveaudit/` into your
public directory at build time, keeping them side by side:

```html
<script type="module" src="/vendor/liveaudit/inspector.js"></script>
```

Updating is then an ordinary dependency update.

## Nothing happens until you unlock it

Without the flag the script registers nothing, creates no global and loads no
WebAssembly. Unlock a page with `?liveaudit`, then:

```js
await LiveAudit.show();   // scan and draw the inspector layer
await LiveAudit.watch();  // …and keep it current while the page changes
LiveAudit.hide();
```

Or import it and unlock from your own UI:

```js
const { enable } = await import("/vendor/liveaudit/inspector.js");
await enable().watch();
```

## Content Security Policy

WebAssembly needs `wasm-unsafe-eval` in `script-src`. Styles need nothing: the
layer adopts its stylesheet instead of inserting a `<style>` element, so a
strict `style-src 'self'` does not block it and no hash has to change when you
update.

## More

Documentation, the live demo and the reasoning behind all of this:
<https://casoon.github.io/liveaudit/> · source: <https://github.com/casoon/liveaudit>

MIT.

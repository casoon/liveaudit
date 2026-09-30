# @casoon/liveaudit

An embedded accessibility inspector. One script on your own site, and findings
appear on the affected element — in the page as it actually runs, after every
script and embed — instead of in a report beside it.

**It inspects. It does not repair.** Nothing about the inspected page is
modified.

## What is in the package

| File | |
|---|---|
| `inspector.js` | the collector, the API and the inspector layer — 19 KB gzipped |
| `a11y_wasm_bg.wasm` | the rule engine — 81 KB gzipped, loaded from the directory `inspector.js` lives in |
| `inspector.js.map` | source map |

The rules come from [`a11y-rules`](https://crates.io/crates/a11y-rules) in
[barrierlab](https://github.com/casoon/barrierlab) — the same rule set that
drives astro-post-audit at build time and auditmysite in CI, with the same rule
ids. The [changelog](./CHANGELOG.md) names the bundled version for each
release; a change to it that changes findings is at least a minor version.

## Serve it from your own site

There is no CDN, on purpose: a centrally hosted script would make someone
else's domain a permanent dependency of every page that embeds it. Install the
package and copy the two files into your public directory as part of your
build, side by side:

```bash
npm install @casoon/liveaudit
mkdir -p public/vendor/liveaudit
cp node_modules/@casoon/liveaudit/inspector.js node_modules/@casoon/liveaudit/a11y_wasm_bg.wasm public/vendor/liveaudit/
```

```html
<script type="module" src="/vendor/liveaudit/inspector.js"></script>
```

Updating is then an ordinary dependency update. Serve the files as they are —
running them through a bundler is not tested, and the module finds its
WebAssembly by its own URL.

## Nothing happens until you unlock it

Without unlocking, the script registers nothing, creates no global and loads no
WebAssembly. On a page where it is not unlocked, the cost is downloading and
parsing `inspector.js`; the WebAssembly loads only after unlocking.

Unlock a page with `?liveaudit` in the URL, then use the console or your own UI:

```js
await LiveAudit.show();    // scan and draw the inspector layer
await LiveAudit.watch();   // …and keep it current while the page changes
await LiveAudit.rescan();  // rescan now, e.g. after a CSS-only state change
LiveAudit.unwatch();       // stop watching; the layer stays
LiveAudit.hide();          // remove it again
LiveAudit.remember();      // keep it unlocked on this origin
LiveAudit.forget();        // and undo that
```

`?liveaudit=0` overrides a remembered unlock for one visit. To unlock from your
own code instead — a switch on your site, for example — load it on demand:

```js
const { enable } = await import("/vendor/liveaudit/inspector.js");
await enable().watch();
```

More of the API: `scan()` returns the findings without drawing anything;
`show(root, { rendering: true })` adds contrast and the layout heuristics;
`{ rendering: true, focus: true }` also measures focus visibility — it focuses
every control once and restores focus after; `dock("left")` moves
the sidebar. Full reference: <https://casoon.github.io/liveaudit/docs/getting-started/api/>

## What the sidebar shows

Findings grouped by rule id, each with a marker on its element; the rules that
could not run and why; what the last scan did (nodes, rules, time); and the
page weight by type with load timings. Nothing is combined into a score, and
what cannot be checked or measured is shown as such, never as passed or zero.

## Content Security Policy

WebAssembly needs `wasm-unsafe-eval` in `script-src`. Styles need nothing: the
layer adopts its stylesheet instead of inserting a `<style>` element, so a
strict `style-src 'self'` does not block it and no hash has to change when you
update.

## Limits

- No TypeScript declarations yet.
- Tested in Chromium and WebKit.

## More

Documentation, live demo and the reasoning behind all of this:
<https://casoon.github.io/liveaudit/> · source:
<https://github.com/casoon/liveaudit>

MIT.

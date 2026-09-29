# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Each release
names the bundled rule set; a change to it that changes findings is at least a
minor version.

## [0.1.0] - 2026-09-29

First release on npm.

**Bundled rules:** `@casoon/a11y-wasm` 0.2.1, built on `a11y-rules` 0.12.1
(finding texts in English; `ids/duplicate` per WCAG 2.2, only for referenced ids).

- Inspector layer: frames, markers with popovers, a sidebar that docks to all
  four edges; live mode that rescans only the changed subtree.
- Contrast as an opt-in second pass.
- The sidebar shows what the last scan did — nodes, rules that ran, time — and
  the page weight by type with timings. Sizes the browser does not expose are
  shown as unknown, never as zero.
- Styles are adopted, not inserted as `<style>`: a strict `style-src 'self'`
  needs no hash.
- Inert until unlocked with `?liveaudit` or `enable()`.

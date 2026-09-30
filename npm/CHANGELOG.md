# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Each release
names the bundled rule set; a change to it that changes findings is at least a
minor version.

## [Unreleased]

### Fixed

- Contrast: colours in `oklch()`, `lab()`, `color()` and other spaces are
  converted to sRGB instead of being read as transparent. A dark theme built on
  oklch tokens was checked against white and stayed silent. A background that
  cannot be read ends the search as undetermined (`UNTESTED`).
- Live mode no longer starves on pages that never settle: it rescans at the
  latest 1 s after the first pending change (`maxWaitMs`).

- Rules no longer run on hidden content: no false `FAIL` for a nameless button
  inside `hidden`, `display: none` or `aria-hidden` (a11y-rules). Labels that
  are not rendered no longer count, and focusable elements under an
  `aria-hidden` ancestor are reported.

### Added

- A checklist: criteria no machine can decide appear once per page as
  `UNTESTED` under `manual/*`.
- Heuristic `REVIEW` checks with the rendering pass: reading order, endless
  animation, reflow, pointer-only controls, obscured focus, target size.
- `scan(root, { rendering: true, focus: true })` measures focus visibility.
  It moves focus through the page once and restores it; without it, focus
  visibility is reported as `UNTESTED`.
- `LiveAudit.rescan(root?)` for changes that are not DOM mutations.
- Live mode also rescans on `change` and `transitionend`.

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

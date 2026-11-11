# Changelog

All notable changes to this repository are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The published `@casoon/liveaudit`
package keeps its own release history in [npm/CHANGELOG.md](npm/CHANGELOG.md).

## [Unreleased]

### Added

- **Collector:** the page-dependent probes of `a11y-rules` 0.28.3 (liveaudit#16). With `rendering: true`
  the collector reports frame reachability (`frames/cross-origin`) and the transform of `html`/`body`
  (`orientation/root-rotated`). `probes: ["paste", "focus", "spacing"]` opts in to the probes that touch
  the page for a moment (`auth/paste-blocked`, `focus/obscured`, `focus/obscured-enhanced`,
  `text-spacing/clipped`); each restores focus, scroll, field values and styles. Without the option those
  rules stay under "Rules that did not run". `DocumentScan.probes` lists the filled columns and any cap.
- **Collector:** the tree scope of each node is passed to the rules (liveaudit#10). The same ID in a shadow
  root and in the document is no longer a duplicate, and an ID reference only reaches targets in its own tree.

### Changed

- **Rules:** `@casoon/a11y-wasm` 0.16.0 replaces 0.15.2. A heuristic without layout columns is now recorded as
  not run instead of an `UNTESTED` finding on the root.

- **Rules:** `@casoon/a11y-wasm` 0.15.2 (`a11y-rules` 0.28.3, 169 rule ids) replaces 0.3.0. New ids
  whose probes the collector does not deliver yet (`frames/cross-origin`, `orientation/root-rotated`,
  `auth/paste-blocked`, `focus/obscured-enhanced`, `text-spacing/clipped`, plus the stylesheet rules)
  show up under "Rules that did not run", never as passed. A missing landmark `main` is now `REVIEW`.
- **Build:** the WebAssembly size budget goes from 100 to 180 KB gzip (the module is 169.3 KB now).

- **Dependencies:** Astro 7.4.7, `@astrojs/check` 0.9.12 and jsdom 30.1.3 clear the transitive `vite`, `zod`, `undici`, `fast-uri` advisories; a workspace override pins `source-map-js` to >= 1.2.2. `pnpm audit` reports none.
- **Pages:** the project site uses the current shared theme (0.12.10).
- **Site:** the footer follows the page language instead of always showing German text, and the
  start page carries a release teaser and an FAQ (theme 0.11.1).

### Fixed

- **Site:** the link to the demo page in the screenshot caption on the start page is underlined,
  so it no longer depends on colour alone.

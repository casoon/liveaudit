# Changelog

All notable changes to this repository are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The published `@casoon/liveaudit`
package keeps its own release history in [npm/CHANGELOG.md](npm/CHANGELOG.md).

## [Unreleased]

### Changed

- **Rules:** `@casoon/a11y-wasm` 0.15.2 (`a11y-rules` 0.28.3, 169 rule ids) replaces 0.3.0. New ids
  whose probes the collector does not deliver yet (`frames/cross-origin`, `orientation/root-rotated`,
  `auth/paste-blocked`, `focus/obscured-enhanced`, `text-spacing/clipped`, plus the stylesheet rules)
  show up under "Rules that did not run", never as passed. A missing landmark `main` is now `REVIEW`.
- **Build:** the WebAssembly size budget goes from 100 to 180 KB gzip (the module is 169.3 KB now).

- **Pages:** the project site uses the current shared theme (0.12.6).
- **Site:** the footer follows the page language instead of always showing German text, and the
  start page carries a release teaser and an FAQ (theme 0.11.1).

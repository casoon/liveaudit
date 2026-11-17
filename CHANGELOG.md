# Changelog

All notable changes to this repository are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The published `@casoon/liveaudit`
package keeps its own release history in [npm/CHANGELOG.md](npm/CHANGELOG.md).

## [Unreleased]

### Added

- **Collector:** supplies the measurement columns of `@casoon/a11y-wasm` 0.16 that a browser can measure
  without changing the page: tree scopes for shadow DOM (`withScopes`), frame readability
  (`withFrames`), root `transform`/`rotate` (`withTransforms`) and, in the focus pass, how far
  fixed or sticky elements cover a focused control (`withFocusCover`). Columns the collector does
  not supply (paste probe, text-spacing override, stylesheets, scroll extents) stay "not measured":
  their rules are listed under "Rules that did not run", never as passed.

### Changed

- **Dependencies:** `@casoon/a11y-wasm` 0.3 → 0.16.1 (rules from `a11y-rules` 0.30.11); `focus/indicator-unmeasured` is gone, a
  missing focus pass now shows `focus/indicator-missing` as not run.
- **Build:** the WebAssembly size budget is 200 KB gzip (was 100 KB); the module measures 195.0 KB.
- **Site:** the footer follows the page language instead of always showing German text, and the
  start page carries a release teaser and an FAQ (theme 0.11.1).

### Fixed

- **Site:** the link to the demo page in the screenshot caption on the start page is underlined,
  so it no longer depends on colour alone.

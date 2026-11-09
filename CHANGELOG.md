# Changelog

All notable changes to this repository are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The published `@casoon/liveaudit`
package keeps its own release history in [npm/CHANGELOG.md](npm/CHANGELOG.md).

## [Unreleased]

### Changed

- **Dependencies:** Astro 7.4.7, `@astrojs/check` 0.9.12 and jsdom 30.1.3 clear the transitive `vite`, `zod`, `undici`, `fast-uri` advisories; a workspace override pins `source-map-js` to >= 1.2.2. `pnpm audit` reports none.
- **Pages:** the project site uses the current shared theme (0.12.6).
- **Site:** the footer follows the page language instead of always showing German text, and the
  start page carries a release teaser and an FAQ (theme 0.11.1).

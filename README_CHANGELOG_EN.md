# README CHANGELOG

[中文](README_CHANGELOG.md)

This file tracks significant changes to the README. Format inspired by [Keep a Changelog](https://keepachangelog.com); version numbers follow CalVer (YYYY-MM-DD).

## [2026-06-15]

### Added

- Four new Route A feature rows in the features table: read-only mode default, table of contents, fullscreen reading, and folder-drop README discovery
- `toc.ts` module node in the architecture diagram with a Renderer → TOC edge
- `toc.ts` entry in the project layout (heading extraction + click-to-scroll)
- E shortcut (toggle read/edit mode) added to the shortcuts row

### Changed

- Tagline rewritten from "write on the left, watch it render on the right" to reader-first positioning: "files open straight into full-width rendered view; editing is one click away"
- Design principle paragraph now leads with "read first, edit on demand"; grant_scope description updated to mention folder README discovery
- `index.html` description changed from "split panes" to "read/edit dual mode"; `main.ts` adds "mode switching"; `style.css` adds "read/edit modes"
- "Drag & drop" merged into "Drag & drop / folders"; "Synced scrolling" folded under edit-mode live preview instead of a standalone row

## [2026-06-13]

### Added

- Two new rows in the features table: drag-and-drop file open and OS file association, matching the v0.3.0 release
- "Custom commands" node in the architecture diagram with two new edges showing how drag-drop and file-association paths flow through `grant_scope` to the fs scope
- `permissions/` directory in the project layout (auto-generated command ACLs)

### Changed

- Design principle paragraph now mentions the two custom Rust commands instead of claiming "Rust handles I/O only" — drag-drop and file association broke the zero-custom-command rule, and the README should say so honestly
- Updated `lib.rs` description to "+ custom commands" and `tauri.conf.json` to mention file association config

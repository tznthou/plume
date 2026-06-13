# CHANGELOG

[中文](CHANGELOG.md)

This file tracks notable changes to Plume. Format inspired by [Keep a Changelog](https://keepachangelog.com); versions follow [SemVer](https://semver.org).

## [0.3.0] - 2026-06-13

### Added

- Drag-and-drop file open: drop a `.md` file onto the window to open it. A themed accent-color border appears while hovering (instrument gold under Vol de Nuit, cinnabar under Inkstone), and unsaved changes trigger a save-or-discard dialog first
- OS file association: right-click a `.md` in Finder → "Open With" → Plume, or set Plume as the default handler. Double-clicking a `.md` launches Plume with the file loaded; doing so while Plume is already running opens the file in the existing window (macOS)

### Security

- Drag-and-drop and file-association paths bypass the dialog-based scope and instead go through a per-file Rust validation gate: the file must exist, be a regular file (not a directory or device), and its extension must still be `.md`/`.markdown` after resolving symlinks
- URLs received via `RunEvent::Opened` are filtered to markdown files on the Rust side before reaching the frontend

### Known Limitations

- Windows warm-start (double-clicking another `.md` while Plume is running) opens a second window instead of reusing the existing one — this requires `tauri-plugin-single-instance` to forward file paths to the running instance. macOS is unaffected (`RunEvent::Opened` handles warm-start natively)

## [0.2.1] - 2026-06-12

### Fixed

- Opening a file no longer leaves the preview stuck at the previous file's scroll position — previously, scrolling the preview to the bottom and then opening another file kept the new file's preview pinned to the bottom

### Security

- The exported HTML `<title>` is now escaped: it was the one interpolation point that bypassed sanitization. Impact is limited (the exported file opens in an external browser and can't reach the app's IPC), but it restores the "every output is sanitized" guarantee

### Accessibility

- Status-bar gauges (characters / lines / render time) and the unsaved indicator now expose screen-reader labels
- Inkstone active-line text contrast nudged to meet WCAG AA (it dipped just below the threshold at the darkest part of the active line)

## [0.2.0] - 2026-06-12

### Added

- Two themes: **Vol de Nuit** (dark, default) and **Inkstone** (light). Vol de Nuit reads like a night-flight instrument panel; Inkstone is ink-on-rice-paper monochrome with a single cinnabar accent. One click in the toolbar to switch, and the choice survives restarts
- Status bar with live numbers: character count, line count, and render time in milliseconds (the actual time from keystroke to preview update, not a vanity metric). The unsaved indicator is themed too — a drooping gauge needle under Vol de Nuit, a cinnabar seal that fades once you save under Inkstone
- Night-flight illustrations: a watercolor mail biplane drifting over the preview and a fox keeping watch at the editor's corner. Pure decoration — pointer events pass straight through, so they never get in the way of editing

### Changed

- Editor syntax colors and preview code highlighting now follow the active theme — previously hardwired to GitHub colors, which glared in the dark
- Exported HTML **keeps** the GitHub style on purpose: documents you hand to other people shouldn't inherit your app skin
- CSP now whitelists the two Google Fonts domains (style and font only; scripts stay local). Theme fonts load from the CDN and fall back to system fonts offline

## [0.1.0] - 2026-06-11

### Added

- First release: a desktop Markdown tool with the editor on the left and live preview on the right
- Render pipeline: markdown-it parsing + DOMPurify sanitization, 50ms debounce — typing feels instant
- File handling: new/open/save/save-as, a recent-files list that survives restarts, and three-way unsaved-changes protection (including window-close interception)
- Standalone HTML export: inline styles, opens offline, zero external resources
- Shortcuts: Cmd (macOS) / Ctrl (Windows) + N / O / S / Shift+S
- Cross-platform builds: macOS (Apple Silicon / Intel) and Windows x64

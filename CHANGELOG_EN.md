# CHANGELOG

[中文](CHANGELOG.md)

This file tracks notable changes to Plume. Format inspired by [Keep a Changelog](https://keepachangelog.com); versions follow [SemVer](https://semver.org).

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

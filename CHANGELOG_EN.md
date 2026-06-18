# CHANGELOG

[中文](CHANGELOG.md)

This file tracks notable changes to Plume. Format inspired by [Keep a Changelog](https://keepachangelog.com); versions follow [SemVer](https://semver.org).

## [Unreleased]

## [0.7.0] - 2026-06-18

### Added

- Native menu bar: native menus on macOS/Windows (Plume, File, Edit, View, Help) — file, edit, and view actions all have menu items with accelerators; Focus / Typewriter modes stay in sync as checked menu states
- Keyboard shortcuts overlay (Cmd+/): a floating cheat sheet listing every shortcut, showing ⌘ or Ctrl automatically per platform
- Auto theme: the theme toggle gains an "Auto" state that follows the system light/dark setting, switching between Vol de Nuit (dark) and Inkstone (light); the three states cycle Vol de Nuit → Inkstone → Auto
- Reading font preferences: in read mode, choose the body font (Default, Serif, Sans, Mono) and adjust size with ⌘=, ⌘-, ⌘0 to enlarge, shrink, or reset

## [0.6.0] - 2026-06-16

### Added

- Focus mode (Cmd+Shift+F): only the paragraph under the cursor is fully visible — the rest fades to 25% opacity. Paragraph boundaries follow blank lines and track the cursor in real time
- Typewriter mode (Cmd+T): the cursor line stays vertically centered at all times — text scrolls up as you type. Works even at the top of the document (50vh top padding + scrollPastEnd bottom padding)
- Copy as HTML (Cmd+Shift+C): renders the editor's Markdown to HTML and copies it to the clipboard, ready to paste into a CMS or blog editor. Documents with math are automatically converted to MathML
- Front matter hiding: YAML front matter blocks (wrapped in `---`) are stripped from the preview
- Footnotes: `[^1]` footnote syntax renders with a footnote section at the bottom of the preview — click a reference to jump to it
- Math rendering: inline `$...$` and display `$$...$$` math via KaTeX, lazy-loaded — files without math never load KaTeX

### Security

- KaTeX export path now has DOMPurify sanitization: `renderMathForExport` MathML output is sanitized the same way as the preview path
- KaTeX configured with `trust: false` + `maxSize: 20` to prevent malicious LaTeX macros

### Performance

- Release profile enables LTO + strip + codegen-units 1 + panic abort, shrinking the binary from ~11 MB to ~4.9 MB (−55%)

## [0.5.0] - 2026-06-15

### Added

- Mermaid diagram rendering: embed diagrams via ` ```mermaid ` fenced blocks — flowchart, sequence, class, ER, Gantt and more render as SVG in the preview pane. Read-only support: makes other people's diagrams visible without needing to edit them
- Diagram theme sync: dark (Vol de Nuit) and light (Inkstone) themes automatically switch mermaid color scheme; toggling the app theme redraws diagrams immediately

### Technical Notes

- mermaid.js is lazy-loaded: dynamically imported only when a mermaid block is first encountered — files without mermaid pay no bundle cost
- Security: mermaid runs with `securityLevel: "strict"` (internal DOMPurify + HTML encoding); post-render `cloneNode(true)` strips `addEventListener` bindings without a second DOMPurify pass (DOMPurify v3.1.7+ foreignObject mXSS mitigation strips diagram text labels)

## [0.4.0] - 2026-06-15

### Added

- Read-only mode as default: files open in full-width reading view (preview centered, max 800px). Click "編輯" in the toolbar or press Cmd/Ctrl+E to switch back to split-pane editing. New files go straight to edit mode
- Folder drop: drag a folder onto Plume and it automatically opens its README.md (case-insensitive match) — drop a project folder and see its README instantly
- Table of Contents (TOC): in read mode, click "目錄" to open a sidebar listing all h1–h6 headings with hierarchical indentation. Click any heading to smooth-scroll to it. Updates automatically on each edit
- Fullscreen reading: in read mode, click "全螢幕" to hide the toolbar and status bar, leaving just content and scrolling. A ✕ button at the top-right corner or Escape exits fullscreen. The TOC sidebar remains usable

### Security

- README paths discovered inside folders are canonicalized to resolve symlinks before granting fs scope, consistent with the direct-file security model
- Removed `data:` from CSP `img-src` — the noise texture lives in CSS `background-image` (not `<img>`), so the removal doesn't affect functionality but hardens defense-in-depth against potential DOMPurify SVG bypasses

### Changed

- The night-flight fox illustration repositions to the bottom-right corner (mirrored) in read mode to complement the full-width preview layout
- Inkstone panel background color unified into a `--bg-bar` CSS variable, replacing three hardcoded color values

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

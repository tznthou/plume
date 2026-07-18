# CHANGELOG

[中文](CHANGELOG.md)

This file tracks notable changes to Plume. Format inspired by [Keep a Changelog](https://keepachangelog.com); versions follow [SemVer](https://semver.org).

## [Unreleased]

## [0.12.0] - 2026-07-18

### Added

- Multi-language support (i18n): language selector with instant UI switching and persisted preference across sessions. Toolbar, native menus, dialogs, keyboard shortcuts overlay, and status bar are fully localized
- Locale pack system: Rust backend loads JSON locale files from `app_local_data_dir/locales/`, supporting user-customizable translations. Ships with Traditional Chinese and English
- Local image preview: relative image paths in Markdown render in the preview pane via Tauri's asset protocol for secure local file access
- Codex deletion: delete button in the codex sidebar removes a codex from the menu (does not delete the actual folder); switching to a missing codex prompts removal

### Security

- Asset protocol enabled without global scope — only dynamically authorized paths are accessible via asset URLs
- `grant_scope` remains single-file authorization, not directory-wide
- Three new custom commands: `load_locales`, `open_locales_dir`, `delete_codex_folder` (seven total)

### Acknowledgements

- Thanks to [@is90057](https://github.com/is90057) for contributing PR #16 (i18n architecture, language selector, localized dialogs, local image preview, codex import/delete)

## [0.11.0] - 2026-07-14

### Added

- Multi-tab editing: open multiple Markdown files simultaneously with tab switching, closing, dirty-state indicators (dot), and scroll-position restoration. Window close confirms each unsaved tab individually
- Export dropdown: the export button is now a dropdown menu with separate "Export HTML" and "Export PDF" options
- Context menu prevention: disables the native webview context menu to prevent accidental "Reload" which would destroy all in-memory editor content

### Acknowledgements

- Thanks to [@is90057](https://github.com/is90057) for contributing PR #15 (tab component + export dropdown). PDF export retains the v0.10.0 native print approach (vector PDF, selectable text); html2pdf.js dependency removed

## [0.10.0] - 2026-07-13

### Added

- PDF export: File > Export PDF (Cmd+P) produces vector PDF via the native macOS print dialog — text is selectable, searchable, and copyable, with zero external dependencies. Use the "PDF" dropdown at the bottom-left of the print dialog and choose "Save as PDF"

### Technical details

- Uses Tauri webview print IPC (`core:webview:allow-print`) instead of `window.print()` (unsupported in WKWebView)
- Exported content passes through the existing DOMPurify pipeline; security boundary unchanged
- KaTeX math exports as MathML (consistent with HTML export)
- Mermaid diagrams export as source text in this release; rendering support planned for a future version

## [0.9.1] - 2026-06-26

### Security

- Codex folder listing now sits behind an authorization gate (closing an XSS arbitrary-path enumeration gap): a new Rust command `pick_codex_root` holds the native folder picker on the Rust side, so only a folder the user picked by hand is approved for listing — the frontend cannot inject arbitrary paths. Approved folders are written to a private file (not via the store plugin or fs scope, so XSS cannot tamper with it) and persist across restarts; `list_codex_files` now accepts only approved codices. The load-bearing wall is unchanged — listing still opens no fs scope, and clicking a file still goes through the existing per-file grant (`grant_scope`). Custom commands go from three to four

### Changed

- After upgrading to this version, switching to a Codex you opened in an older version asks you to pick it once more via "Open Codex Folder" (the new authorization mechanism needs you to re-confirm the folder); it is remembered from then on

## [0.9.0] - 2026-06-23

### Added

- Codex folder file management: open a folder as a "Codex" — the sidebar lists every `.md` underneath in a nested tree, click to open. Mount several codices at once and switch via a dropdown, with each switch re-listing to reflect changes on disk. Read-only browsing — creating/deleting/renaming is left to your file manager; the app never takes directory write access. Open it from the toolbar "冊" button or File ▸ Open Codex Folder

### Changed

- Vol de Nuit fox illustration: when the Codex sidebar is open in Read or Split mode, the bottom-left fox moves to the bottom-right and mirrors horizontally so it no longer sits over the file tree; Compose mode (no sidebar) keeps it bottom-left

### Fixed

- Opening a Codex in Compose did nothing: Compose hides the sidebar, so opening a Codex there built the tree but left it hidden — it looked unresponsive. Opening a Codex now switches to Split and reveals the sidebar, since browsing a folder means leaving the immersive writing state

### Security

- Codex folder browsing uses a read-only listing: a new Rust command `list_codex_files` recursively returns the `.md` paths under a Codex and never opens a directory fs scope. "Can list a directory" stays separate from "can read its contents" — clicking a file still goes through the existing per-file grant (`grant_scope`), keeping the XSS load-bearing wall at zero added exposure. Custom commands go from two (`grant_scope`, `get_opened_urls`) to three

## [0.8.0] - 2026-06-19

### Added

- Three writing modes (Compose / Split / Read): the toolbar is now a three-way segmented switch, replacing the old read/edit toggle. **Compose** hides the preview and centers the editor for distraction-free writing; **Split** keeps the side-by-side editor and preview; **Read** hides the editor and centers the preview. New files open in Compose, existing files in Read, and Cmd/Ctrl+E jumps straight to Compose
- The View menu mirrors the three modes, marking the current one with ●

### Changed

- Positioning grows from "read-first, write-second" into reading and writing as equals: writing is no longer a sidecar to reading but its own immersive state (Compose), shaped by the same subtraction that defines the reading view
- Focus mode and Typewriter mode now belong to Compose only — disabled elsewhere and switched off automatically when you leave. In a split pane the preview drowns them out; they only earn their keep in immersive writing

### Fixed

- macOS app signing: added an ad-hoc signing config, fixing the "damaged app" Gatekeeper block that previously forced a manual `xattr` workaround after installing the dmg (0.7.0 dmgs remain affected; fixed from 0.8.0 — ad-hoc signing, not Apple notarization)

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

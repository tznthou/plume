use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_fs::FsExt;

struct OpenedUrls(Mutex<Option<Vec<tauri::Url>>>);

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
fn list_codex_files(root: String) -> Result<Vec<String>, String> {
    let base = PathBuf::from(&root)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !base.is_dir() {
        return Err("Path is not a folder".into());
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_opener::init())
        .manage(OpenedUrls(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            grant_scope,
            get_opened_urls,
            list_codex_files
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

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

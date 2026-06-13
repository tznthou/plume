use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_fs::FsExt;

struct OpenedUrls(Mutex<Option<Vec<tauri::Url>>>);

#[tauri::command]
fn grant_scope(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    let canonical = p.canonicalize().map_err(|e| e.to_string())?;
    if !canonical.is_file() {
        return Err("Path is not a regular file".into());
    }
    if !is_markdown(&canonical) {
        return Err("Only .md and .markdown files are allowed".into());
    }
    app.fs_scope()
        .allow_file(&canonical)
        .map_err(|e| e.to_string())?;
    Ok(canonical.to_string_lossy().into_owned())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_opener::init())
        .manage(OpenedUrls(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![grant_scope, get_opened_urls])
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

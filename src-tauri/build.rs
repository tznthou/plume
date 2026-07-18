fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new()
                .commands(&[
                    "grant_scope",
                    "get_opened_urls",
                    "list_codex_files",
                    "pick_codex_root",
                    "load_locales",
                    "open_locales_dir",
                    "delete_codex_folder",
                ]),
        ),
    )
    .expect("error while running tauri_build");
}

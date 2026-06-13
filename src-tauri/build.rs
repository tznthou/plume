fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new()
                .commands(&["grant_scope", "get_opened_urls"]),
        ),
    )
    .expect("error while running tauri_build");
}

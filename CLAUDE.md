# Plume — 輕量 Markdown 編輯+即時預覽桌面工具（Tauri 2 + Vanilla TS）

> 新 session 開始前，先讀取 .claude/RESUME.md

## 指令

- dev: `npm run tauri dev`
- build: `npm run tauri build`（產出 .app 於 src-tauri/target/release/bundle/）
- test: `npm run test`（Vitest）
- 前端單獨除錯: `npm run dev`（純 webview，IPC 功能不可用）

## 工作流程

- branch: `feat/xxx`、`fix/xxx`；commit 用 conventional commits（英文）
- 每個 task 完成：跑 Vitest + 對照 docs/PLAN.md 該 task 的完成信號
- 改動 IPC 權限時同步更新 `src-tauri/capabilities/` 與 docs/SPEC.md 權限表

## 關鍵技術約束

- 前端 Vanilla TS，不引入 UI 框架（React/Vue/Svelte 皆不要）
- Markdown 渲染留在前端（markdown-it），**不走 IPC 到 Rust**——IPC 序列化成本 > 解析收益
- 渲染輸出必過 DOMPurify，任何功能（含匯出 HTML）不可繞過——Tauri webview 內 XSS 可觸 IPC
- Rust 端只用官方 plugin（dialog/fs/store/persisted-scope/opener），自訂 command 僅限 `grant_scope`（外部路徑授權 fs scope）、`get_opened_urls`（冷啟動檔案路徑）、`pick_codex_root`（冊：Rust 持有資料夾 dialog 並核准 root）、`list_codex_files`（冊：只列已核准 root 的 `.md`，**不開目錄 fs scope**）、`load_locales`（i18n：讀取/播種語言包 JSON）、`open_locales_dir`（i18n：開啟語言包資料夾）、`delete_codex_folder`（冊：從 approved-roots 移除）、`load_custom_themes`（主題：讀取自訂主題 CSS，含 URL 淨化）、`open_themes_dir`（主題：開啟主題資料夾）、`import_theme_file`（主題：匯入 CSS 主題檔）、`copy_builtin_theme_template`（主題：複製內建主題為自訂範本）十一個
- highlight.js 只註冊語言子集（見 docs/SPEC.md），不全量 import，不開自動偵測
- 編輯內容唯一真相來源是 CM6 EditorState，不另存字串副本
- fs 權限走 dialog 授權 + persisted-scope，capabilities 不開全域路徑；外部路徑（拖曳/檔案關聯）透過 `grant_scope` command 在 Rust 端驗證副檔名後動態授權

## 參考文件（需要時再讀）

- 需求、使用者故事、功能優先級: docs/PRD.md
- 架構、模組職責、IPC 權限表、渲染管線、安全規格: docs/SPEC.md
- task 清單、測試設計、冒煙清單: docs/PLAN.md

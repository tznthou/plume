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
- Rust 端只用官方 plugin（dialog/fs/store/persisted-scope/opener），自訂 command 僅限 `grant_scope`（外部路徑授權 fs scope）、`get_opened_urls`（冷啟動檔案路徑）、`list_codex_files`（冊：唯讀遞迴列舉資料夾 `.md`，**不開目錄 fs scope**）三個——前二為拖曳開檔與 OS 檔案關聯、後者為冊資料夾瀏覽所需的最小破例（列舉不授權，點檔仍走 `grant_scope` 單檔授權）
- highlight.js 只註冊語言子集（見 docs/SPEC.md），不全量 import，不開自動偵測
- 編輯內容唯一真相來源是 CM6 EditorState，不另存字串副本
- fs 權限走 dialog 授權 + persisted-scope，capabilities 不開全域路徑；外部路徑（拖曳/檔案關聯）透過 `grant_scope` command 在 Rust 端驗證副檔名後動態授權

## 參考文件（需要時再讀）

- 需求、使用者故事、功能優先級: docs/PRD.md
- 架構、模組職責、IPC 權限表、渲染管線、安全規格: docs/SPEC.md
- task 清單、測試設計、冒煙清單: docs/PLAN.md

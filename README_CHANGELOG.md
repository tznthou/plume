# README CHANGELOG

[English](README_CHANGELOG_EN.md)

本檔記錄 README 的重大變更。格式參考 [Keep a Changelog](https://keepachangelog.com)，版本號採日期格式。

## [2026-06-15]

### 新增

- 功能表加四列 Route A 功能：閱讀模式預設、目錄導覽、全螢幕閱讀、拖曳資料夾開 README
- 架構圖加 `toc.ts` 模組節點和 Renderer → TOC 連線
- 專案結構加 `toc.ts`（目錄導覽：heading 擷取 + 點擊跳轉）
- 快捷鍵列加 E（切換閱讀/編輯）

### 調整

- 標語從「左邊寫右邊看」改為閱讀器優先定位——「開檔就是渲染好的全幅閱讀，需要改才切編輯」
- 設計原則段落加「讀為主改為輔」開頭，grant_scope 描述補充資料夾 README 查找
- `index.html` 描述從「左右分割」改為「閱讀/編輯雙模式」；`main.ts` 加「模式切換」；`style.css` 加「閱讀/編輯模式」
- 「拖曳開檔」合併為「拖曳開檔/資料夾」；「同步捲動」因屬編輯模式子功能不再獨立列出

## [2026-06-13]

### 新增

- 功能表加「拖曳開檔」和「檔案關聯」兩列——v0.3.0 的兩個新功能
- 架構圖加「自訂 Commands」節點和兩條連線（拖曳/檔案關聯 → grant_scope → fs scope 授權）
- 專案結構加 `permissions/` 目錄（自動生成的 command ACL）

### 調整

- 設計原則段落從「Rust 端只負責 I/O」補充為「加兩個自訂 command」——拖曳和檔案關聯打破了原本零自訂 command 的設計，README 要如實反映
- `src/lib.rs` 描述更新為「+ 自訂 commands」；`tauri.conf.json` 描述加「檔案關聯設定」

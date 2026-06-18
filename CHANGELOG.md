# CHANGELOG

[English](CHANGELOG_EN.md)

本檔記錄 Plume 的版本變更。格式參考 [Keep a Changelog](https://keepachangelog.com)，版本號採 [SemVer](https://semver.org)。

## [Unreleased]

## [0.7.0] - 2026-06-18

### 新增

- 原生選單列：新增 macOS/Windows 原生選單（Plume、File、Edit、View、Help），檔案、編輯、檢視操作都有對應選單項與快捷鍵；專注/打字機模式以選單勾選狀態即時同步
- 快捷鍵提示（Cmd+/）：浮層列出所有快捷鍵，依平台自動顯示 ⌘ 或 Ctrl
- 自動主題：主題切換新增「自動」態，跟隨系統明暗在夜航（深色）與硯墨（淺色）間切換；三態循環為 夜航 → 硯墨 → 自動
- 閱讀字型偏好：閱讀模式可選正文字型（預設、襯線、無襯線、等寬），並用 ⌘=、⌘-、⌘0 放大、縮小、重設字級

## [0.6.0] - 2026-06-16

### 新增

- 專注模式（Cmd+Shift+F）：開啟後只有游標所在段落完全可見，其餘段落淡出——幫你集中注意力在當前段落。段落邊界由空行決定，移動游標時即時跟隨
- 打字機模式（Cmd+T）：游標行永遠固定在畫面垂直中央，打字時文字向上捲動。文件頂部也能置中（50vh 上方留白 + scrollPastEnd 底部留白）
- 複製 HTML（Cmd+Shift+C）：把編輯器的 Markdown 渲染成 HTML 並複製到剪貼簿，可直接貼進 CMS 或部落格的 HTML 編輯器。含數學公式的文件會自動轉為 MathML
- Front matter 隱藏：YAML front matter 區塊（`---` 包圍）不會出現在預覽中
- 腳註：支援 `[^1]` 語法的腳註，預覽底部自動產生腳註區塊，點擊引用可跳轉
- 數學公式：行內 `$...$` 與獨立 `$$...$$` 數學公式渲染，KaTeX 懶載入——沒有數學的檔案不會載入 KaTeX

### 安全

- KaTeX 匯出路徑補上 DOMPurify 二次消毒：`renderMathForExport` 的 MathML 輸出現在與預覽路徑一致，都經過 DOMPurify 收尾
- KaTeX 設定 `trust: false` + `maxSize: 20`，防止惡意 LaTeX 巨集

### 效能

- Release profile 啟用 LTO + strip + codegen-units 1 + panic abort，binary 從 ~11 MB 降至 ~4.9 MB（-55%）

## [0.5.0] - 2026-06-15

### 新增

- Mermaid 圖表閱讀：在 Markdown 中用 ` ```mermaid ` 區塊嵌入 flowchart、sequence、class、ER、Gantt 等圖表，預覽區即時渲染為 SVG。不需編輯 mermaid——只是讓別人寫的圖表看得到
- 圖表主題同步：深色（夜航）和淺色（硯墨）主題自動切換 mermaid 配色，切換佈景主題後圖表即時重繪

### 技術細節

- mermaid.js 懶載入：第一次碰到 mermaid 區塊才動態 import，無 mermaid 的檔案不受 bundle 影響
- 安全：mermaid `securityLevel: "strict"`（內部 DOMPurify + HTML encode）；post-render 用 `cloneNode(true)` 剝除 `addEventListener` 綁定，不經額外 DOMPurify（DOMPurify v3.1.7+ 的 foreignObject mXSS 緩解會剝除圖表文字）

## [0.4.0] - 2026-06-15

### 新增

- 閱讀模式預設：開啟檔案自動進入全幅閱讀態（預覽置中、最寬 800px），點工具列「編輯」或 Cmd/Ctrl+E 才切回左右分欄編輯。新增檔案則直接進入編輯模式
- 資料夾拖曳：把資料夾拖進 Plume，自動找裡面的 README.md 開啟（不分大小寫）——開發者拖專案資料夾就能直接看 README
- 目錄導覽（TOC）：閱讀模式下按「目錄」展開左側章節列表，從 h1 到 h6 階層縮排，點擊即跳轉。每次內容變動自動更新
- 全螢幕閱讀：閱讀模式下按「全螢幕」隱藏工具列與狀態列，只留內容與捲動。右上角 ✕ 按鈕或 Escape 退出，目錄仍可使用

### 安全

- 資料夾拖曳找到的 README 路徑會 canonicalize 解析 symlink 後才授權，與直接拖曳 `.md` 檔案的安全模型一致
- CSP 移除 `img-src data:`——噪點材質在 CSS background-image 而非 `<img>`，移除後不影響功能但強化了對 DOMPurify SVG bypass 的縱深防禦

### 調整

- 夜航主題的守夜狐在閱讀模式下搬到右下角並鏡像，配合全幅預覽版面
- 硯墨主題的面板底色統一為 CSS 變數 `--bg-bar`，消除三處硬編碼色值

## [0.3.0] - 2026-06-13

### 新增

- 拖曳開檔：把 `.md` 拖進視窗就能直接開啟，拖曳中會有跟著佈景主題走的邊框提示（夜航是儀表金、硯墨是硃砂），有未存檔內容時會先問你要不要存
- OS 檔案關聯：macOS 的 Finder 右鍵選「以 Plume 打開」或設為預設，就能雙擊 `.md` 直接開啟 Plume（Windows 同理）；app 執行中雙擊另一個 `.md` 也會在同一個視窗載入

### 安全

- 拖曳和檔案關聯的路徑不走全域 fs scope，改由 Rust 端逐檔驗證（檔案存在、是普通檔案、解析 symlink 後副檔名仍為 `.md`/`.markdown`）才動態授權
- `RunEvent::Opened` 收到的 URL 在 Rust 端先過濾為 markdown 檔，非 markdown 路徑不會進入前端流程

### 已知限制

- Windows 暖啟動（app 已開啟時雙擊另一個 `.md`）會開第二個視窗，需要 `tauri-plugin-single-instance` 才能轉發給既有 instance——macOS 不受影響（`RunEvent::Opened` 正常處理）

## [0.2.1] - 2026-06-12

### 修復

- 開啟新檔案時，預覽不再停在前一個檔案的捲動位置——先前若把預覽捲到底再開檔，新檔的預覽會殘留在底部

### 安全

- 匯出 HTML 的標題（`<title>`）現在會轉義特殊字元：這是先前唯一沒經過消毒的插值點，補上以貫徹「所有輸出都經過消毒」的原則（影響有限——匯出檔在外部瀏覽器開啟、碰不到 app 的 IPC，但一致性該補）

### 無障礙

- 狀態列的字數／行數／渲染時間、以及未儲存指示，加上螢幕閱讀器可讀的標籤
- 硯墨主題游標行的文字對比微調至符合 WCAG AA（先前在游標行最暗處略低於門檻）

## [0.2.0] - 2026-06-12

### 新增

- 雙佈景主題：「夜航」（深色，預設）與「硯墨」（淺色）——夜航是儀表板式的深夜閱讀色調，硯墨是純墨階加一點硃砂的宣紙質感。工具列一鍵切換，選擇會記住，重開 app 不用重選
- 狀態列：字數、行數、渲染毫秒都是真數據（渲染毫秒就是這次按鍵到預覽更新實際花的時間）；未儲存指示跟著主題變——夜航是儀表指針垂落，硯墨是一枚硃砂印「未存」，存檔後印才淡去
- 夜航主題的浮飾插圖：一架郵務雙翼機飄在預覽區上空、一隻狐狸守在編輯區角落（手繪水彩風、滑鼠事件全穿透，不會擋到任何操作）

### 調整

- 編輯區的 markdown 語法色與預覽區的程式碼高亮現在跟著主題走——先前固定是 GitHub 配色，深色主題下會刺眼
- 匯出的 HTML **維持** GitHub 風不變：給別人看的文件不該跟著你的 app 佈景走
- CSP 放行 Google Fonts 兩個網域（只開 style 與 font 兩類，script 仍鎖本地）——主題字體由 CDN 載入，離線時自動退回系統字型

## [0.1.0] - 2026-06-11

### 新增

- 初版發布：左編輯、右即時預覽的桌面 Markdown 工具
- 渲染管線：markdown-it 解析 + DOMPurify 消毒，50ms debounce，輸入到預覽更新幾乎無感
- 檔案操作：新增/開啟/儲存/另存、最近檔案清單（重啟後仍可直接開）、未儲存變更三段式保護（含關窗攔截）
- 匯出獨立 HTML：樣式內嵌、離線可開、無外部資源
- 快捷鍵：Cmd（macOS）/ Ctrl（Windows）+ N / O / S / Shift+S
- 跨平台打包：macOS（Apple Silicon / Intel）與 Windows x64

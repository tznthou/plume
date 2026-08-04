# 提案：L0 宣告式外掛

> 狀態：**提案**，未定案。定案後內容併入 docs/SPEC.md，本檔刪除。
> 背景：PR #31 提出可執行 JS 的外掛系統。本提案是對同一需求的另一種解法。

## 1. 這份提案要解決什麼

PR #31 把「擴充性」與「任意程式碼執行」綁成一件事：外掛腳本經 `new Function` 在主 document 求值，因此與 Plume 本體同權限——拿得到 `window.__TAURI__`、`document`、CM6 state。這牴觸 CLAUDE.md 的核心約束（「Tauri webview 內 XSS 可觸 IPC」），也讓一個人維護的專案背上它做不到的審核責任。

本提案主張把兩者拆開：**先用零程式碼執行的宣告式層覆蓋大部分需求**，把可執行外掛留到出現具體做不到的案例時再談。

### 為什麼認為宣告式夠用

盤點 PR #31 自帶的兩個範例外掛：

| 範例 | 實際做的事 | L0 能否覆蓋 |
|---|---|---|
| `sample-stamp` | 在游標處插入格式化的當下時間 | ✅ 完全覆蓋 |
| `table-grid` | 拖曳選 N×M，產生 Markdown 表格 | ❌ 需要重複結構與互動 UI |

`table-grid` 的結論不是「L0 不夠」，而是**它根本不該是外掛**——「插入表格」是 Markdown 編輯器的基本功能，Plume 目前缺（工具列只有 new/open/codex/save/export/toc/fullscreen/settings）。把它做成內建功能，成本低於維護一套可執行外掛架構。

## 2. 設計原則

1. **零程式碼執行**。外掛是資料，不是程式。沒有 `eval`、`new Function`、`import()`、Worker、iframe。
2. **行為在啟用前完全可見**。外掛能做的事就是插入一段模板，而模板是純文字——設定頁直接把它顯示出來，使用者看得懂自己在授權什麼。這是 L1/L2 給不了的性質。
3. **偵測即拒絕，不做修補**。manifest 不合規就整份拒絕載入，不「盡量修好」。沿用 `sanitize_theme_css` 的既有哲學（見 SPEC.md「自訂主題 CSS」）。
4. **不新增 CSP 例外**。不需要 `unsafe-eval`、`blob:`、`worker-src`、`frame-src`。CSP 一個字都不用改。
5. **不新增 Rust 依賴**。不引入 zip（PR #31 的 `zip = "2"` 帶進 26 個 crate，含 aes/bzip2/lzma/zstd 與三個要編 C 的 `-sys`）。

## 3. Manifest 格式

一個外掛 = `plugins/<id>/plugin.json` 一個檔。**沒有腳本檔、沒有 icon 檔。**

```json
{
  "schema": 1,
  "id": "frontmatter",
  "version": "1.0.0",
  "author": "someone",
  "name": {
    "zh_Hant": "文章前置資料",
    "en": "Frontmatter"
  },
  "description": {
    "zh_Hant": "插入 YAML frontmatter 骨架",
    "en": "Insert a YAML frontmatter skeleton"
  },
  "icon": "calendar",
  "template": "---\ntitle: {{cursor:標題}}\ndate: {{date}}\ntags: []\n---\n\n{{cursor}}"
}
```

| 欄位 | 型別 | 必填 | 說明 |
|---|---|---|---|
| `schema` | number | ✅ | 固定為 `1`。未來格式演進的版本閘門，不符即拒絕 |
| `id` | string | ✅ | `^[a-z0-9][a-z0-9-]{0,31}$`。同時是目錄名與 DOM id 片段 |
| `version` | string | ✅ | `^\d+\.\d+\.\d+$` |
| `name` | object | ✅ | 語言碼 → 顯示名。必須含 `en` |
| `template` | string | ✅ | 見 §4。長度上限 4096 字元 |
| `description` | object | ⬜ | 同 `name` 結構 |
| `author` | string | ⬜ | 純顯示用，長度上限 64 |
| `icon` | string | ⬜ | **內建圖示集的名稱**，不是檔案路徑。不在集合內則用預設圖示 |

`icon` 刻意設計成「從 Plume 內建圖示集挑一個」而非讓外掛夾帶檔案。這樣一併消掉了 PR #31 的 base64 內嵌 icon（每次載入把所有 icon 讀進記憶體再過 IPC）、副檔名決定 MIME 的猜測、以及夾帶 SVG 的處理成本。

## 4. 模板語法

模板最終交給 `@codemirror/autocomplete` 的 `snippet()`（已在 bundle 內，`basicSetup` 的一部分，**零新增依賴**）。Plume 只負責把 `{{...}}` 變數求值後轉譯成 CM6 語法。

### 4.1 變數

| 變數 | 展開為 |
|---|---|
| `{{selection}}` | 當前選取文字；無選取時為空字串 |
| `{{date}}` | 當日日期，預設 `YYYY-MM-DD` |
| `{{date:FORMAT}}` | 指定格式，token 見下 |
| `{{time}}` | 當下時間，預設 `HH:mm:ss` |
| `{{datetime}}` | 等同 `{{date}} {{time}}` |
| `{{filename}}` | 當前檔名（含副檔名）；未存檔時為空字串 |
| `{{cursor}}` | 插入後的游標停留點 |
| `{{cursor:預設文字}}` | 同上，並預先選取「預設文字」讓使用者直接覆寫 |

格式 token：`YYYY` `MM` `DD` `HH` `mm` `ss`。刻意只收這六個——不引入 date library，實作是一組字串替換。

### 4.2 多個 `{{cursor}}`

依出現順序成為 Tab 停留點，最後一個之後游標停在該處。轉譯規則：

```
第 n 個 {{cursor}}           →  ${n}
第 n 個 {{cursor:預設文字}}   →  ${n:預設文字}
```

Tab / Shift-Tab 導航由 CM6 的 `snippetKeymap` 提供，我們不實作。

### 4.3 逸出

CM6 的 field 語法是 `/[#$]\{...\}/`——**必須有 `$` 或 `#` 前綴**。所以模板裡單純的 `{`、`}`、`{{`（如 `function() {}`、Handlebars 片段）不受影響。

需要注意的只有兩點，寫進外掛作者文件：

- 模板要字面輸出 `${` 或 `#{` 時，寫成 `\${` / `\#{`
- 模板裡的 `\{` `\}` 反斜線會被 CM6 移除

### 4.4 為什麼一個原語就夠

原本考慮過 `wrapSelection`（用前後綴包住選取）作為第二個原語，但它可以用模板表達：

```
粗體：  **{{selection}}**${0}
引用：  > {{selection}}
程式碼： ```{{cursor:language}}\n{{selection}}\n```
```

無選取時 `{{selection}}` 展開為空字串，游標停在 `${0}`，行為與「包住空選取」一致。**所以 L0 只有一個原語：插入模板。**

### 4.5 明確不收的東西

| 不收 | 理由 |
|---|---|
| 正則替換 | ReDoS 是真實風險，而且是滑向圖靈完備的第一步 |
| 條件 / 迴圈 | 同上。需要重複結構（如 N×M 表格）的請做成內建功能 |
| 呼叫 Plume 指令 | 讓外掛能觸發任意內建行為，等於重新打開授權面 |
| 讀取整份文件 | L0 外掛只寫不讀，`{{selection}}` 是唯一的讀取管道 |

## 5. 載入與驗證

沿用主題的既有模式（`load_custom_themes` / `open_themes_dir`），**不新增匯入 zip 的路徑**。

```
plugins/
  frontmatter/plugin.json
  daily-note/plugin.json
```

### 5.1 Rust 端 command（新增兩個）

| Command | 行為 |
|---|---|
| `load_plugins` | 讀 `app_local_data_dir/plugins/*/plugin.json`，逐份驗證，回傳通過的清單。首次執行種下範例外掛 |
| `open_plugins_dir` | `tauri_plugin_opener::open_path` 開啟資料夾（同 `open_themes_dir` 的 free function 理由） |

安裝方式就是「把資料夾放進去」——跟自訂主題一致。不做 zip 匯入，因此 PR #31 的以下問題全部不存在：zip bomb、entry 數無上限、解壓錯誤被吞、`file_stem()` 路徑穿越（`...zip` → `..`，見 `import_theme_file` 的正確寫法用的是 `file_name()`）、以及 `load_plugins` 自動吞掉 plugins 目錄下任何 `.zip` 造成的「放檔即武裝」。

**刻意沒有 `delete_plugin`**。刪除就是在 Finder 刪掉資料夾——自訂主題也是這樣（主題四個 command 裡沒有 delete）。少一個會遞迴刪除目錄的 IPC command，就少一份要驗證 `plugin_id` 不含 `..` 的責任。設定頁的「開啟外掛資料夾」按鈕已經讓這件事夠方便。

⚠️ 這兩個 command 會讓自訂 command 從 11 個變 13 個。定案時**必須同步更新** CLAUDE.md 的約束段落、SPEC.md:23 的 mermaid 圖、SPEC.md:59 的模組表與權限表——這正是 PR #31 漏掉的一步，而專案工作流程明文要求「改動 IPC 權限時同步更新 capabilities 與 SPEC.md 權限表」。

### 5.2 驗證規則（Rust 端，任一不符即整份拒絕）

1. `schema` 必須等於 `1`
2. `id` 必須符合 `^[a-z0-9][a-z0-9-]{0,31}$`，且必須等於所在目錄名
3. `version` 必須符合 `^\d+\.\d+\.\d+$`
4. `name` 必須是物件且含非空 `en`
5. `template` 必須是字串，長度 1..=4096
6. `{{...}}` 內容必須全部落在 §4.1 的白名單（含參數形式），出現未知變數即拒絕
7. `{{cursor}}` 數量上限 16
8. JSON 物件 key 需擋 `__proto__` / `constructor` / `prototype`（同 `load_locales` 的既有處理，見 memory 的 prototype pollution 條目）

第 6 條是關鍵：**未知變數拒絕而非忽略**。忽略會讓錯字靜默產生錯誤輸出，也讓未來新增變數時舊外掛行為漂移。

### 5.3 前端

`src/plugins.ts` 提供 `loadPluginsFromBackend` / `openPluginsFolder` / `initPlugins` / `togglePluginEnabled`，結構對齊 `theme.ts`。停用狀態存 `settings.json` 的 `disabledPlugins`。

⚠️ 存**停用**清單而非啟用清單，是為了避開 PR #31 的 bug：它存 `enabledPlugins`，而 `initPlugins` 在讀到空陣列時 fallback 成「全部啟用」，導致使用者把外掛全部停用後，下次啟動全部復活。存停用清單則空陣列的語義天然正確。

## 6. UI

工具列已有 8 個按鈕，直接攤平會擠。外掛收在一個 dropdown 內，沿用既有的 `#export-dropdown` 結構與樣式：

```
[🧩 ▾]  →  文章前置資料
           每日筆記
           時間戳記
```

設定頁的外掛清單，每張卡片顯示：名稱、版本、作者、描述、**以及模板全文**。模板是純文字，直接呈現就是最誠實的能力宣告——使用者啟用前看得到它會往文件裡寫什麼。

無外掛時 dropdown 整個不顯示（不佔工具列空間）。

## 7. 涵蓋率驗證

把 PR #31 的範例與幾個常見需求實際寫成 L0：

**時間戳記**（等價於 `sample-stamp`）
```json
{ "schema": 1, "id": "timestamp", "version": "1.0.0",
  "name": { "zh_Hant": "時間戳記", "en": "Timestamp" },
  "icon": "clock",
  "template": "{{datetime}}" }
```

**每日筆記**
```json
{ "template": "# {{date}}\n\n## 今天做了什麼\n\n{{cursor}}\n\n## 明天\n\n" }
```

**程式碼區塊**
```json
{ "template": "```{{cursor:語言}}\n{{selection}}\n```\n{{cursor}}" }
```

**引用當前選取**
```json
{ "template": "> {{selection}}\n>\n> — {{cursor:出處}}" }
```

**文章前置資料**：見 §3 範例。

做不到的：`table-grid`（需要重複結構）。**建議把「插入表格」做成 Plume 內建功能**——一個 N×M 網格選擇器，這本來就是編輯器該有的東西，不該外包給外掛層。

## 8. 非目標

- 外掛市集、線上安裝、自動更新
- 外掛之間互相呼叫
- 外掛改變 Plume 的渲染、主題、快捷鍵
- 外掛讀取文件內容（`{{selection}}` 以外）
- 相容 PR #31 的 manifest 格式（`script` 欄位不會被支援，出現即拒絕）

## 9. 未決問題

1. **快捷鍵**：外掛要不要能綁快捷鍵？綁的話要處理與 CM6 keymap 的衝突（見 memory：`basicSetup` 的 searchKeymap 已佔 Mod-d，defaultKeymap 已佔 Mod-[ / Mod-]）。傾向 v1 不做。
2. **範例外掛的重建**：PR #31 的 `create_sample_plugin` 在 plugins 為空時無條件重建，導致使用者刪光後範例復活。需要一個「已種下」標記（可存 `settings.json`），種過就不再種。
3. **模板顯示的長度**：4096 字元的模板在設定頁卡片裡要摺疊還是全展開。

（原列為未決的「`{{filename}}` 怎麼取」已確認：`file.ts` 的 `getDocState().path` 或 `getActiveTab().path` 即可，取 basename，未存檔時為 `null` → 展開成空字串。不需要新增 getter。）

## 10. 與 L1 / L2 的關係

本提案刻意不排除未來加入沙箱化的可執行外掛（Worker 或 sandboxed iframe）。真要走那條路時，第一件該實測的是 **Worker 能否從 `asset:` protocol 載入外掛檔**——`asset://localhost` 與 `tauri://localhost` 是不同 origin，而 Worker 的 script 有同源限制。這條通不通，決定 L1 能用受 fs scope 管制的 `asset:`，還是被迫用等同 `unsafe-eval` 的 `blob:`。這個問題沒法靜態驗，需要在打包的 app 內實測。

但那應該由一個「L0 做不到的具體外掛需求」來觸發，而不是現在先猜。

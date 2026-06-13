// 組裝：editor docChanged → debounce 50ms → render → preview（SPEC「渲染管線規格」，
// 同步呼叫鏈、無 async）；檔案操作接線與快捷鍵（Task 4）；最近檔案下拉（Task 6）。
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getContent, getLineCount, getScrollDOM, initEditor, onChange } from "./editor";
import { initPreview, scrollToTopOnNextUpdate, showError, update } from "./preview";
import { render } from "./renderer";
import {
  exportHtml,
  initFileModule,
  markDirty,
  newFile,
  onDirtyChange,
  onLoad,
  openExternal,
  openFile,
  openRecent,
  saveAs,
  saveFile,
} from "./file";
import { getRecent } from "./recent";
import { initTheme, toggleTheme } from "./theme";
import { initStatusbar, setDirty, updateStats } from "./statusbar";

const editorEl = document.querySelector<HTMLElement>("#editor")!;
const previewEl = document.querySelector<HTMLElement>("#preview")!;

initEditor(editorEl);
initPreview(previewEl, getScrollDOM());
initStatusbar();
onDirtyChange(setDirty); // dirty 指示：03 指針垂落 / 05 硃砂印
onLoad(scrollToTopOnNextUpdate); // 開檔/新檔：預覽回頂（避免沿用前一檔被捲到底的位置）
void initTheme(); // index.html 已帶預設主題，這裡載入使用者上次選擇

let debounceTimer: number | undefined;
onChange(() => {
  markDirty();
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    try {
      const content = getContent();
      const t0 = performance.now();
      update(render(content));
      updateStats({
        chars: content.replace(/\s/g, "").length, // 寫作直覺的「字數」：不含空白換行
        lines: getLineCount(),
        ms: Math.max(1, Math.round(performance.now() - t0)), // ETA 儀表讀數 = 真渲染耗時
      });
    } catch (e) {
      // SPEC 錯誤處理標準：編輯區不受影響；debounce 每次輸入重跑 render，天然自動重試
      showError(`渲染發生錯誤（下次輸入會自動重試）：${String(e)}`);
    }
  }, 50);
});

// ----- 最近檔案下拉（Task 6） -----

const recentSelect = document.querySelector<HTMLSelectElement>("#recent-list")!;

async function refreshRecentUI(): Promise<void> {
  const files = await getRecent();
  recentSelect.options.length = 1; // 保留 placeholder
  for (const f of files) {
    const opt = document.createElement("option");
    opt.value = f.path;
    opt.textContent = f.path.split(/[/\\]/).pop() ?? f.path; // Windows 路徑為反斜線
    opt.title = f.path;
    recentSelect.append(opt);
  }
}

recentSelect.addEventListener("change", () => {
  const path = recentSelect.value;
  recentSelect.selectedIndex = 0; // 跳回 placeholder，下拉是動作選單不是狀態
  if (path) void openRecent(path).then(refreshRecentUI);
});

// 檔案操作可能改動最近清單（addRecent/removeRecent），完成後一律刷新下拉
function withRecentRefresh(action: () => Promise<unknown>): () => void {
  return () => void action().then(refreshRecentUI);
}

const doNew = withRecentRefresh(newFile);
const doOpen = withRecentRefresh(openFile);
const doSave = withRecentRefresh(saveFile);
const doSaveAs = withRecentRefresh(saveAs);

// ----- 工具列 -----

document.querySelector("#btn-new")!.addEventListener("click", doNew);
document.querySelector("#btn-open")!.addEventListener("click", doOpen);
document.querySelector("#btn-save")!.addEventListener("click", doSave);
document.querySelector("#btn-export")!.addEventListener("click", () => void exportHtml());
document.querySelector("#btn-theme")!.addEventListener("click", () => void toggleTheme());

// ----- 快捷鍵 Cmd(mac)/Ctrl(win) + N / O / S / Shift+S -----

window.addEventListener("keydown", (e) => {
  if (!e.metaKey && !e.ctrlKey) return;
  switch (e.key.toLowerCase()) {
    case "n":
      e.preventDefault();
      doNew();
      break;
    case "o":
      e.preventDefault();
      doOpen();
      break;
    case "s":
      e.preventDefault();
      if (e.shiftKey) doSaveAs();
      else doSave();
      break;
  }
});

void initFileModule(); // onCloseRequested dirty 攔截 + 初始視窗標題
void refreshRecentUI(); // 啟動時載入既有清單

// ----- 拖曳開檔（drag & drop .md onto window） -----

const MD_EXT = /\.(md|markdown)$/i;

function openExternalWithRefresh(path: string): void {
  void openExternal(path).then(refreshRecentUI);
}

void getCurrentWebview().onDragDropEvent((event) => {
  const { type } = event.payload;
  if (type === "drop") {
    document.body.classList.remove("drag-hover");
    const md = event.payload.paths.find((p) => MD_EXT.test(p));
    if (md) openExternalWithRefresh(md);
  } else if (type === "enter" || type === "over") {
    document.body.classList.add("drag-hover");
  } else {
    document.body.classList.remove("drag-hover");
  }
});

// ----- 檔案關聯（OS file association） -----

// Cold-start：app 被雙擊檔案啟動時，Rust 已暫存路徑
void invoke<string[]>("get_opened_urls").then((urls) => {
  if (urls.length) {
    const md = urls.find((p) => MD_EXT.test(p));
    if (md) openExternalWithRefresh(md);
  }
});

// Warm-start：app 已執行中，使用者再雙擊另一個 .md
void listen<string[]>("file-open", (event) => {
  const md = event.payload.find((p) => MD_EXT.test(p));
  if (md) openExternalWithRefresh(md);
});

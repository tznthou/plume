// 組裝：editor docChanged → debounce 50ms → render → preview（SPEC「渲染管線規格」，
// 同步呼叫鏈、無 async）；檔案操作接線與快捷鍵（Task 4）；最近檔案下拉（Task 6）。
import { getContent, getScrollDOM, initEditor, onChange } from "./editor";
import { initPreview, showError, update } from "./preview";
import { render } from "./renderer";
import {
  exportHtml,
  initFileModule,
  markDirty,
  newFile,
  openFile,
  openRecent,
  saveAs,
  saveFile,
} from "./file";
import { getRecent } from "./recent";

const editorEl = document.querySelector<HTMLElement>("#editor")!;
const previewEl = document.querySelector<HTMLElement>("#preview")!;

initEditor(editorEl);
initPreview(previewEl, getScrollDOM());

let debounceTimer: number | undefined;
onChange(() => {
  markDirty();
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    try {
      update(render(getContent()));
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
    opt.textContent = f.path.split("/").pop() ?? f.path;
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

// ----- 快捷鍵 Cmd+N / Cmd+O / Cmd+S / Cmd+Shift+S -----

window.addEventListener("keydown", (e) => {
  if (!e.metaKey) return;
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

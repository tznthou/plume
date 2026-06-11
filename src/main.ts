// 組裝：editor docChanged → debounce 50ms → render → preview（SPEC「渲染管線規格」，
// 同步呼叫鏈、無 async）；檔案操作接線與快捷鍵（Task 4）。
import { getContent, initEditor, onChange } from "./editor";
import { initPreview, showError, update } from "./preview";
import { render } from "./renderer";
import {
  initFileModule,
  markDirty,
  newFile,
  openFile,
  saveAs,
  saveFile,
} from "./file";

const editorEl = document.querySelector<HTMLElement>("#editor")!;
const previewEl = document.querySelector<HTMLElement>("#preview")!;

initEditor(editorEl);
initPreview(previewEl);

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

// 工具列（#btn-export 於 Task 7 接線）
document.querySelector("#btn-new")!.addEventListener("click", () => void newFile());
document.querySelector("#btn-open")!.addEventListener("click", () => void openFile());
document.querySelector("#btn-save")!.addEventListener("click", () => void saveFile());

// 快捷鍵 Cmd+N / Cmd+O / Cmd+S / Cmd+Shift+S
window.addEventListener("keydown", (e) => {
  if (!e.metaKey) return;
  switch (e.key.toLowerCase()) {
    case "n":
      e.preventDefault();
      void newFile();
      break;
    case "o":
      e.preventDefault();
      void openFile();
      break;
    case "s":
      e.preventDefault();
      void (e.shiftKey ? saveAs() : saveFile());
      break;
  }
});

void initFileModule(); // onCloseRequested dirty 攔截 + 初始視窗標題

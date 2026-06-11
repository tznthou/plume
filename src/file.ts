// 檔案操作與文件狀態（SPEC「模組職責」「資料模型」「錯誤處理標準」）。
// 內容唯一真相來源是 CM6 EditorState：讀走 getContent()、寫走 setContent()，
// 此處只維護 path/dirty。匯出 HTML 於 Task 7 加入。
import { ask, message, open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getContent, setContent } from "./editor";

interface DocState {
  path: string | null; // null = 未命名新文件
  dirty: boolean; // 內容是否與磁碟不同步
}

const MD_FILTERS = [{ name: "Markdown", extensions: ["md", "markdown"] }];

const doc: DocState = { path: null, dirty: false };

// 程式載入內容（開檔/新增）時抑制 markDirty——setContent 會同步觸發
// CM6 docChanged → onChange → markDirty，但那不是使用者編輯
let suppressDirty = false;

export function getDocState(): Readonly<DocState> {
  return doc;
}

function fileName(): string {
  if (doc.path === null) return "未命名";
  return doc.path.split("/").pop() ?? doc.path;
}

async function updateTitle(): Promise<void> {
  await getCurrentWindow().setTitle(`${fileName()}${doc.dirty ? " ●" : ""}`);
}

export function markDirty(): void {
  if (suppressDirty || doc.dirty) return;
  doc.dirty = true;
  void updateTitle();
}

function loadContent(text: string): void {
  suppressDirty = true;
  try {
    setContent(text);
  } finally {
    suppressDirty = false;
  }
}

// dirty 確認流程，新增/開啟/關閉共用。回傳 true = 可以繼續（已存或使用者同意放棄）。
// plugin-dialog 無三鈕 API，以兩段式提供「儲存／放棄／取消」三條路徑。
async function confirmLoseChanges(): Promise<boolean> {
  if (!doc.dirty) return true;
  const wantSave = await ask(`「${fileName()}」有未儲存的變更，要儲存嗎？`, {
    title: "未儲存的變更",
    okLabel: "儲存",
    cancelLabel: "不儲存",
  });
  if (wantSave) return saveFile(); // 儲存失敗或另存被取消 → false，不繼續
  return ask("確定放棄未儲存的變更？", {
    title: "放棄變更",
    kind: "warning",
    okLabel: "放棄變更",
    cancelLabel: "取消",
  });
}

export async function newFile(): Promise<void> {
  if (!(await confirmLoseChanges())) return;
  loadContent("");
  doc.path = null;
  doc.dirty = false;
  await updateTitle();
}

export async function openFile(): Promise<void> {
  if (!(await confirmLoseChanges())) return;
  const selected = await open({ multiple: false, filters: MD_FILTERS });
  if (selected === null) return;
  try {
    const content = await readTextFile(selected);
    loadContent(content);
    doc.path = selected;
    doc.dirty = false;
    await updateTitle();
  } catch (e) {
    // SPEC 錯誤處理：讀檔失敗不載入、不改變現有編輯內容，非阻斷提示
    await message(`無法開啟檔案：${String(e)}`, { title: "開啟失敗", kind: "error" });
  }
}

export async function saveFile(): Promise<boolean> {
  if (doc.path === null) return saveAs();
  return writeTo(doc.path);
}

export async function saveAs(): Promise<boolean> {
  const target = await save({
    filters: MD_FILTERS,
    defaultPath: doc.path ?? "未命名.md",
  });
  if (target === null) return false;
  return writeTo(target);
}

async function writeTo(path: string): Promise<boolean> {
  try {
    await writeTextFile(path, getContent());
    doc.path = path;
    doc.dirty = false;
    await updateTitle();
    return true;
  } catch (e) {
    // SPEC 錯誤處理：寫檔失敗保留編輯內容與 dirty 狀態，阻斷 dialog 顯示原因
    await message(`儲存失敗：${String(e)}`, { title: "儲存失敗", kind: "error" });
    return false;
  }
}

export async function initFileModule(): Promise<void> {
  const win = getCurrentWindow();
  await win.onCloseRequested(async (event) => {
    if (!doc.dirty) return;
    event.preventDefault();
    if (await confirmLoseChanges()) {
      await win.destroy(); // close() 會再觸發本事件，確認後直接 destroy
    }
  });
  await updateTitle();
}

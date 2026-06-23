// 檔案操作與文件狀態（SPEC「模組職責」「資料模型」「錯誤處理標準」）。
// 內容唯一真相來源是 CM6 EditorState：讀走 getContent()、寫走 setContent()，
// 此處只維護 path/dirty。匯出 HTML 於 Task 7 加入。
import { invoke } from "@tauri-apps/api/core";
import { ask, message, open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { getCurrentWindow } from "@tauri-apps/api/window";
import DOMPurify from "dompurify";
import hljsThemeCss from "highlight.js/styles/github.css?raw";
import { getContent, setContent } from "./editor";
import { escapeHtml, render } from "./renderer";
import { addRecent, removeRecent } from "./recent";

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
  return doc.path.split(/[/\\]/).pop() ?? doc.path; // Windows 路徑為反斜線
}

// dirty 變化匯流點是 updateTitle（markDirty/newFile/loadPath/writeTo 都經過），
// 狀態列訂閱於此，不另開通知路徑
let dirtyListener: ((dirty: boolean) => void) | null = null;

export function onDirtyChange(cb: (dirty: boolean) => void): void {
  dirtyListener = cb;
}

// 開檔/新檔通知（main 接到後讓預覽下次渲染回頂）。沿用 onDirtyChange 的 callback 模式，
// 不讓 file 狀態層直接相依 preview 視圖層。
export type LoadKind = "new" | "open" | "codex";
let loadListener: ((kind: LoadKind) => void) | null = null;

export function onLoad(cb: (kind: LoadKind) => void): void {
  loadListener = cb;
}

async function updateTitle(): Promise<void> {
  dirtyListener?.(doc.dirty);
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
  loadListener?.("new");
}

export async function openFile(): Promise<void> {
  if (!(await confirmLoseChanges())) return;
  const selected = await open({ multiple: false, filters: MD_FILTERS });
  if (selected === null) return;
  await loadPath(selected);
}

// 最近檔案以路徑直接開啟，不走 dialog——fs scope 來自當次 dialog 授權，
// 或 persisted-scope 跨 session 恢復（Task 6 驗收點：重啟後仍可開）
export async function openRecent(path: string): Promise<void> {
  if (!(await confirmLoseChanges())) return;
  await loadPath(path);
}

async function loadPath(path: string, kind: LoadKind = "open"): Promise<void> {
  try {
    const content = await readTextFile(path);
    loadContent(content);
    doc.path = path;
    doc.dirty = false;
    await updateTitle();
    await addRecent(path);
    loadListener?.(kind);
  } catch (e) {
    // SPEC 錯誤處理：讀檔失敗不載入、不改變現有編輯內容，非阻斷提示＋自最近清單移除
    await message(`無法開啟檔案：${String(e)}`, { title: "開啟失敗", kind: "error" });
    await removeRecent(path);
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
  const ok = await writeTo(target);
  if (ok) await addRecent(target); // PLAN：open/saveAs 成功後記錄（saveFile 既有路徑不重複記）
  return ok;
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

// ----- 匯出 HTML（Task 7）-----
// SPEC 格式契約：單一獨立檔 = doctype + 內嵌 <style>（預覽同款 typography + hljs 主題）+
// 渲染後 body，無外部資源引用，離線可開。typography 與 src/style.css 的 #preview 規則
// 對應（selector 改為 body scope）。模板為字串常數，不另開檔案（PLAN 注記）。
const EXPORT_TYPOGRAPHY_CSS = `
body { max-width: 800px; margin: 0 auto; padding: 24px 32px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 16px; line-height: 1.6; color: #1f2328; word-wrap: break-word; }
h1, h2, h3, h4, h5, h6 { margin-top: 24px; margin-bottom: 16px; font-weight: 600; line-height: 1.25; }
h1 { font-size: 2em; padding-bottom: 0.3em; border-bottom: 1px solid #d1d9e0; }
h2 { font-size: 1.5em; padding-bottom: 0.3em; border-bottom: 1px solid #d1d9e0; }
h3 { font-size: 1.25em; }
h4 { font-size: 1em; }
h5 { font-size: 0.875em; }
h6 { font-size: 0.85em; color: #59636e; }
p, blockquote, ul, ol, dl, table, pre { margin-top: 0; margin-bottom: 16px; }
a { color: #0969da; text-decoration: none; }
a:hover { text-decoration: underline; }
blockquote { padding: 0 1em; color: #59636e; border-left: 0.25em solid #d1d9e0; }
ul, ol { padding-left: 2em; }
li + li { margin-top: 0.25em; }
img { max-width: 100%; }
hr { height: 0.25em; margin: 24px 0; padding: 0; background: #d1d9e0; border: 0; }
code, pre { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace; }
code { padding: 0.2em 0.4em; font-size: 85%; background: rgba(175, 184, 193, 0.2); border-radius: 6px; }
pre { padding: 16px; overflow: auto; font-size: 85%; line-height: 1.45; background: #f6f8fa; border-radius: 6px; }
pre code { padding: 0; font-size: 100%; background: transparent; border-radius: 0; }
table { display: block; max-width: 100%; overflow: auto; border-collapse: collapse; border-spacing: 0; }
th, td { padding: 6px 13px; border: 1px solid #d1d9e0; }
th { font-weight: 600; }
tbody tr:nth-child(2n) { background: #f6f8fa; }
.task-list-item { list-style-type: none; }
.task-list-item-checkbox { margin: 0 0.2em 0.25em -1.4em; vertical-align: middle; }
.footnote-ref a { text-decoration: none; color: #0969da; vertical-align: super; font-size: 0.85em; }
.footnotes-sep { margin: 2em 0 1em; border: none; border-top: 1px solid #d1d9e0; }
.footnotes { font-size: 0.9em; color: #59636e; }
.footnote-backref { text-decoration: none; margin-left: 0.25em; }
`;

// 匯出用：把 data-math-* placeholder 替換為 MathML（瀏覽器原生渲染，不需 KaTeX CSS/字型）
async function renderMathForExport(html: string): Promise<string> {
  const container = document.createElement("div");
  container.innerHTML = html;
  const els = container.querySelectorAll("[data-math-inline],[data-math-block]");
  if (els.length === 0) return html;

  const katex = (await import("katex")).default;
  for (const el of els) {
    const displayMode = el.hasAttribute("data-math-block");
    el.innerHTML = DOMPurify.sanitize(
      katex.renderToString(el.textContent!, {
        displayMode,
        throwOnError: false,
        trust: false,
        maxSize: 20,
        output: "mathml",
      }),
    );
    el.removeAttribute("data-math-inline");
    el.removeAttribute("data-math-block");
  }
  return container.innerHTML;
}

// 純函式，供測試直接驗證模板結構。bodyHtml 必須是 render() 的輸出（已過 DOMPurify）。
export function buildExportHtml(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<style>
${EXPORT_TYPOGRAPHY_CSS}
${hljsThemeCss}
</style>
</head>
<body>
${bodyHtml}
</body>
</html>
`;
}

export async function copyHtml(): Promise<void> {
  const html = await renderMathForExport(render(getContent()));
  try {
    await navigator.clipboard.writeText(html);
  } catch (e) {
    await message(`複製失敗：${String(e)}`, { title: "複製失敗", kind: "error" });
  }
}

export async function exportHtml(): Promise<void> {
  const target = await save({
    filters: [{ name: "HTML", extensions: ["html"] }],
    defaultPath: fileName().replace(/\.(md|markdown)$/i, "") + ".html",
  });
  if (target === null) return;
  // 經 render() 輸出 = 已過 DOMPurify，sanitize 不可被匯出繞過（SPEC 安全規格）
  const bodyHtml = await renderMathForExport(render(getContent()));
  const html = buildExportHtml(fileName(), bodyHtml);
  try {
    await writeTextFile(target, html);
  } catch (e) {
    // 匯出是副本輸出，不碰 DocState；失敗同寫檔標準：阻斷 dialog 顯示原因
    await message(`匯出失敗：${String(e)}`, { title: "匯出失敗", kind: "error" });
  }
}

let opening = false;

export async function openExternal(path: string, kind: LoadKind = "open"): Promise<void> {
  if (opening) return;
  opening = true;
  try {
    if (!(await confirmLoseChanges())) return;
    const resolved = await invoke<string>("grant_scope", { path });
    await loadPath(resolved, kind);
  } catch (e) {
    await message(`無法開啟檔案：${String(e)}`, {
      title: "開啟失敗",
      kind: "error",
    });
  } finally {
    opening = false;
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

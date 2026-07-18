// 檔案操作與文件狀態（SPEC「模組職責」「資料模型」「錯誤處理標準」）。
// 內容唯一真相來源是 CM6 EditorState：讀走 getContent()、寫走 setContent()，
// 此處只維護 path/dirty。匯出 HTML 於 Task 7 加入。
import { invoke } from "@tauri-apps/api/core";
import { ask, message, open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { getCurrentWindow } from "@tauri-apps/api/window";
import DOMPurify from "dompurify";
import hljsThemeCss from "highlight.js/styles/github.css?raw";
import { getContent, setContent, getScrollDOM } from "./editor";
import { escapeHtml, render } from "./renderer";
import { addRecent, removeRecent } from "./recent";
import { t } from "./i18n";

export interface Tab {
  id: string;
  path: string | null;
  dirty: boolean;
  content: string;
  scrollPos: number;
}

const MD_FILTERS = [{ name: "Markdown", extensions: ["md", "markdown"] }];

// Initialize with a single blank tab
let tabs: Tab[] = [createTab()];
let activeTabId: string = tabs[0].id;
let suppressDirty = false;

function createTab(path: string | null = null, content: string = "", dirty: boolean = false): Tab {
  return {
    id: Math.random().toString(36).substring(2, 9),
    path,
    dirty,
    content,
    scrollPos: 0,
  };
}

export function getTabs(): Tab[] {
  return tabs;
}

export function getActiveTabId(): string {
  return activeTabId;
}

export function getActiveTab(): Tab {
  return tabs.find((t) => t.id === activeTabId) ?? tabs[0];
}

// dirty 變化與 tab 改變通知
let dirtyListener: ((dirty: boolean) => void) | null = null;
let tabsChangeListener: (() => void) | null = null;

export function onDirtyChange(cb: (dirty: boolean) => void): void {
  dirtyListener = cb;
}

export function onTabsChange(cb: () => void): void {
  tabsChangeListener = cb;
}

function notifyTabsChange(): void {
  tabsChangeListener?.();
}

export type LoadKind = "new" | "open" | "codex";
let loadListener: ((kind: LoadKind) => void) | null = null;

export function onLoad(cb: (kind: LoadKind) => void): void {
  loadListener = cb;
}

export function getDocState(): Readonly<{ path: string | null; dirty: boolean }> {
  const active = getActiveTab();
  return {
    path: active.path,
    dirty: active.dirty,
  };
}

function fileName(): string {
  const active = getActiveTab();
  if (active.path === null) return "未命名";
  return active.path.split(/[/\\]/).pop() ?? active.path;
}

function fileNameForTab(tab: Tab): string {
  if (tab.path === null) return "未命名";
  return tab.path.split(/[/\\]/).pop() ?? tab.path;
}

async function updateTitle(): Promise<void> {
  const active = getActiveTab();
  dirtyListener?.(active.dirty);
  const name = fileName().replace(/\.(md|markdown)$/i, "");
  document.title = name;
  await getCurrentWindow().setTitle(`${fileName()}${active.dirty ? " ●" : ""}`);
}

export function markDirty(): void {
  const active = getActiveTab();
  if (suppressDirty || active.dirty) return;
  active.dirty = true;
  void updateTitle();
  notifyTabsChange();
}

function loadContent(text: string): void {
  suppressDirty = true;
  try {
    setContent(text);
  } finally {
    suppressDirty = false;
  }
}

// Select a tab and restore content and scroll position
// Select a tab and restore content and scroll position
export async function selectTab(id: string): Promise<void> {
  if (id === activeTabId) return;
  const current = getActiveTab();
  if (current) {
    current.content = getContent ? (getContent() || "") : "";
    const scrollDom = getScrollDOM ? getScrollDOM() : null;
    current.scrollPos = scrollDom ? scrollDom.scrollTop : 0;
  }

  activeTabId = id;
  const target = getActiveTab();
  if (target) {
    loadContent(target.content);
    requestAnimationFrame(() => {
      const scrollDom = getScrollDOM ? getScrollDOM() : null;
      if (scrollDom) scrollDom.scrollTop = target.scrollPos;
    });
    await updateTitle();
  }
  notifyTabsChange();
}

// Close a tab
export async function closeTab(id: string): Promise<boolean> {
  const index = tabs.findIndex((t) => t.id === id);
  if (index === -1) return false;

  const tabToClose = tabs[index];
  if (id === activeTabId) {
    tabToClose.content = getContent ? (getContent() || "") : "";
    const scrollDom = getScrollDOM ? getScrollDOM() : null;
    tabToClose.scrollPos = scrollDom ? scrollDom.scrollTop : 0;
  }

  if (tabToClose.dirty) {
    const wantSave = await ask(t("dialogs.unsavedChangesMessage", { file: fileNameForTab(tabToClose) }), {
      title: t("dialogs.unsavedChangesTitle"),
      okLabel: t("dialogs.saveLabel"),
      cancelLabel: t("dialogs.dontSaveLabel"),
    });
    if (wantSave) {
      const ok = await saveTab(tabToClose);
      if (!ok) return false;
    } else {
      const confirmAbandon = await ask(t("dialogs.discardChangesMessage"), {
        title: t("dialogs.discardChangesTitle"),
        kind: "warning",
        okLabel: t("dialogs.discardLabel"),
        cancelLabel: t("dialogs.cancelLabel"),
      });
      if (!confirmAbandon) return false;
    }
  }

  tabs.splice(index, 1);

  if (tabs.length === 0) {
    const newTab = createTab();
    tabs.push(newTab);
    activeTabId = newTab.id;
    loadContent("");
    await updateTitle();
    loadListener?.("new");
  } else if (id === activeTabId) {
    const nextActiveIndex = Math.min(index, tabs.length - 1);
    const targetTab = tabs[nextActiveIndex];
    activeTabId = targetTab.id;
    loadContent(targetTab.content);
    requestAnimationFrame(() => {
      const scrollDom = getScrollDOM ? getScrollDOM() : null;
      if (scrollDom) scrollDom.scrollTop = targetTab.scrollPos;
    });
    await updateTitle();
    loadListener?.("open");
  }

  notifyTabsChange();
  return true;
}

async function saveTab(tab: Tab): Promise<boolean> {
  if (tab.id === activeTabId) {
    tab.content = getContent ? (getContent() || "") : "";
  }
  if (tab.path === null) {
    const target = await save({
      filters: MD_FILTERS,
      defaultPath: tab.path ?? "未命名.md",
    });
    if (target === null) return false;
    const ok = await writeToPath(tab, target);
    if (ok) await addRecent(target);
    return ok;
  } else {
    return writeToPath(tab, tab.path);
  }
}

async function writeToPath(tab: Tab, path: string): Promise<boolean> {
  try {
    const contentToSave = tab.id === activeTabId ? (getContent ? (getContent() || "") : "") : tab.content;
    await writeTextFile(path, contentToSave);
    try {
      await invoke("grant_scope", { path });
    } catch (e) {
      console.warn("grant_scope failed in writeToPath:", e);
    }
    tab.path = path;
    tab.dirty = false;
    if (tab.id === activeTabId) {
      await updateTitle();
      dirtyListener?.(false);
    }
    notifyTabsChange();
    return true;
  } catch (e) {
    await message(t("dialogs.saveFailedMessage", { error: String(e) }), { title: t("dialogs.saveFailedTitle"), kind: "error" });
    return false;
  }
}

async function confirmLoseChangesForTab(tab: Tab): Promise<boolean> {
  if (!tab.dirty) return true;
  const wantSave = await ask(t("dialogs.unsavedChangesMessage", { file: fileNameForTab(tab) }), {
    title: t("dialogs.unsavedChangesTitle"),
    okLabel: t("dialogs.saveLabel"),
    cancelLabel: t("dialogs.dontSaveLabel"),
  });
  if (wantSave) return saveTab(tab);
  return ask(t("dialogs.discardChangesMessage"), {
    title: t("dialogs.discardChangesTitle"),
    kind: "warning",
    okLabel: t("dialogs.discardLabel"),
    cancelLabel: t("dialogs.cancelLabel"),
  });
}

export async function newFile(): Promise<void> {
  const active = getActiveTab();
  if (active) {
    active.content = getContent ? (getContent() || "") : "";
    const scrollDom = getScrollDOM ? getScrollDOM() : null;
    active.scrollPos = scrollDom ? scrollDom.scrollTop : 0;
  }

  const newTab = createTab();
  tabs.push(newTab);
  activeTabId = newTab.id;

  loadContent("");
  await updateTitle();
  loadListener?.("new");
  notifyTabsChange();
}

export async function openFile(): Promise<void> {
  const selected = await open({ multiple: false, filters: MD_FILTERS });
  if (selected === null) return;
  await openFileInTab(selected);
}

export async function openRecent(path: string): Promise<void> {
  await openFileInTab(path);
}

export async function openFileInTab(path: string, kind: LoadKind = "open"): Promise<void> {
  const existingTab = tabs.find((t) => t.path === path);
  if (existingTab) {
    await selectTab(existingTab.id);
    return;
  }

  try {
    await invoke("grant_scope", { path });
  } catch (e) {
    console.warn("grant_scope failed in openFileInTab:", e);
  }

  try {
    const content = await readTextFile(path);
    const current = getActiveTab();
    const currentContent = getContent ? (getContent() || "") : "";

    if (current && current.path === null && !current.dirty && current.content === "" && currentContent === "") {
      // Reuse current tab
      current.path = path;
      current.content = content;
      current.dirty = false;
      loadContent(content);
      await updateTitle();
      await addRecent(path);
      loadListener?.(kind);
    } else {
      // Create new tab
      if (current) {
        current.content = currentContent;
        const scrollDom = getScrollDOM ? getScrollDOM() : null;
        current.scrollPos = scrollDom ? scrollDom.scrollTop : 0;
      }
      const newTab = createTab(path, content, false);
      tabs.push(newTab);
      activeTabId = newTab.id;
      loadContent(content);
      await updateTitle();
      await addRecent(path);
      loadListener?.(kind);
    }
    notifyTabsChange();
  } catch (e) {
    await message(t("dialogs.openFailedMessage", { error: String(e) }), { title: t("dialogs.openFailedTitle"), kind: "error" });
    await removeRecent(path);
  }
}

export async function saveFile(): Promise<boolean> {
  const active = getActiveTab();
  return saveTab(active);
}

export async function saveAs(): Promise<boolean> {
  const active = getActiveTab();
  const target = await save({
    filters: MD_FILTERS,
    defaultPath: active.path ?? "未命名.md",
  });
  if (target === null) return false;
  const ok = await writeToPath(active, target);
  if (ok) {
    await addRecent(target);
    notifyTabsChange();
  }
  return ok;
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
  const html = await renderMathForExport(render(getContent(), getActiveTab().path, false));
  try {
    await navigator.clipboard.writeText(html);
  } catch (e) {
    await message(t("dialogs.copyFailedMessage", { error: String(e) }), { title: t("dialogs.copyFailedTitle"), kind: "error" });
  }
}

export async function exportHtml(): Promise<void> {
  const target = await save({
    filters: [{ name: "HTML", extensions: ["html"] }],
    defaultPath: fileName().replace(/\.(md|markdown)$/i, "") + ".html",
  });
  if (target === null) return;
  // 經 render() 輸出 = 已過 DOMPurify，sanitize 不可被匯出繞過（SPEC 安全規格）
  const bodyHtml = await renderMathForExport(render(getContent(), getActiveTab().path, false));
  const html = buildExportHtml(fileName(), bodyHtml);
  try {
    await writeTextFile(target, html);
  } catch (e) {
    // 匯出是副本輸出，不碰 DocState；失敗同寫檔標準：阻斷 dialog 顯示原因
    await message(t("dialogs.exportFailedMessage", { error: String(e) }), { title: t("dialogs.exportFailedTitle"), kind: "error" });
  }
}

let printing = false;

export async function exportPdf(): Promise<void> {
  if (printing) return;
  printing = true;
  try {
    document.getElementById("print-container")?.remove();
    const bodyHtml = await renderMathForExport(render(getContent(), getActiveTab().path, true));
    const container = document.createElement("div");
    container.id = "print-container";
    container.innerHTML =
      `<style>@media print {\n${EXPORT_TYPOGRAPHY_CSS}\n${hljsThemeCss}\n}</style>${bodyHtml}`;
    document.body.appendChild(container);
    await invoke("plugin:webview|print");
  } catch (e) {
    document.getElementById("print-container")?.remove();
    await message(t("dialogs.exportPdfFailedMessage", { error: String(e) }), { title: t("dialogs.exportFailedTitle"), kind: "error" });
  } finally {
    printing = false;
  }
}

let opening = false;

export async function openExternal(path: string, kind: LoadKind = "open"): Promise<void> {
  if (opening) return;
  opening = true;
  try {
    const resolved = await invoke<string>("grant_scope", { path });
    await openFileInTab(resolved, kind);
  } catch (e) {
    await message(t("dialogs.openFailedMessage", { error: String(e) }), {
      title: t("dialogs.openFailedTitle"),
      kind: "error",
    });
  } finally {
    opening = false;
  }
}

export async function initFileModule(): Promise<void> {
  const win = getCurrentWindow();
  await win.onCloseRequested(async (event) => {
    const active = getActiveTab();
    if (active) {
      active.content = getContent();
    }
    const dirtyTabs = tabs.filter((t) => t.dirty);
    if (dirtyTabs.length === 0) return;
    event.preventDefault();
    for (const tab of dirtyTabs) {
      await selectTab(tab.id);
      if (!(await confirmLoseChangesForTab(tab))) {
        return;
      }
    }
    await win.destroy();
  });
  await updateTitle();
}

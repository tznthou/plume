// 組裝：editor docChanged → debounce 50ms → render → preview（SPEC「渲染管線規格」，
// 同步呼叫鏈、無 async）；檔案操作接線與快捷鍵（Task 4）；最近檔案下拉（Task 6）。
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getContent, getLineCount, getScrollDOM, initEditor, onChange, reconfigureFocus, reconfigureTypewriter, remeasure } from "./editor";
import { focusExtension } from "./focus-mode";
import { typewriterExtension } from "./typewriter";
import { initPreview, scrollToTopOnNextUpdate, showError, update } from "./preview";
import { render } from "./renderer";
import {
  copyHtml,
  exportHtml,
  exportPdf,
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
  getTabs,
  getActiveTabId,
  selectTab,
  closeTab,
  onTabsChange,
  getActiveTab,
} from "./file";
import { getRecent } from "./recent";
import { initCodex, openCodexFolder, restoreCodices, importCodexFolder, deleteCurrentCodex } from "./codex";
import { currentChoice, getCustomThemes, initTheme, onThemeChange, openThemesFolder, setTheme, toggleTheme, type ThemeChoice } from "./theme";
import { currentFont, decreaseSize, increaseSize, initReadingPrefs, resetSize, setFont } from "./reading-prefs";
import { initStatusbar, setDirty, updateStats } from "./statusbar";
import { initToc, updateToc } from "./toc";
import { initMenu, resetWritingToolsMenu, setWritingToolsEnabled, updateModeMenu, updateThemeMenu, type Mode } from "./menu";
import { toggleShortcuts, hideShortcuts, clearShortcutsOverlay } from "./shortcuts";
import { initI18n, t, currentLanguage, setLanguage, getAvailableLanguages, onLanguageChange } from "./i18n";
import { initSettings, hideSettings } from "./settings";

const editorEl = document.querySelector<HTMLElement>("#editor")!;
const previewEl = document.querySelector<HTMLElement>("#preview")!;

initEditor(editorEl);
initPreview(previewEl, getScrollDOM());
initToc(document.querySelector<HTMLElement>("#toc")!, previewEl);
initCodex(document.querySelector<HTMLElement>("#codex")!);
initStatusbar();
initSettings({
  onOpenThemesFolder: () => void openThemesFolder(),
});
onDirtyChange(setDirty); // dirty 指示：03 指針垂落 / 05 硃砂印
onLoad((kind) => {
  scrollToTopOnNextUpdate();
  if (kind === "codex") return; // 冊點檔：停在當前模式（不強制切閱），沉浸/對照不被打斷
  setMode(kind === "new" ? "write" : "read"); // 新檔進「撰」沉浸寫、開檔進「閱」先讀
});

const modeSwitch = document.querySelector<HTMLElement>("#mode-switch")!;
const modeButtons = modeSwitch.querySelectorAll<HTMLButtonElement>("button"); // 靜態三鈕，查一次重用
updateModeSwitch((document.body.dataset.mode as Mode) || "read"); // 啟動即同步 segmented，避免初始/openExternal 失敗路徑懸空

function setMode(mode: Mode): void {
  document.body.dataset.mode = mode;
  if (mode !== "read") {
    // 撰／參都需編輯器：退出全螢幕與目錄、重新量測
    delete document.body.dataset.toc;
    delete document.body.dataset.fullscreen;
    remeasure();
  }
  if (mode === "write") {
    setWritingToolsEnabled(true); // 撰態才開放 Focus/Typewriter
  } else {
    // Focus/Typewriter 只歸「撰」：離開沉浸態即關閉並停用選單（決策 42，split 裡開會被預覽稀釋）
    reconfigureFocus([]);
    reconfigureTypewriter([]);
    resetWritingToolsMenu();
    setWritingToolsEnabled(false);
  }
  updateModeSwitch(mode);
  updateModeMenu(mode);
}

function updateModeSwitch(mode: Mode): void {
  for (const btn of modeButtons) {
    btn.setAttribute("aria-pressed", String(btn.dataset.modeTarget === mode));
  }
}

function toggleToc(): void {
  document.body.dataset.toc = document.body.dataset.toc === "open" ? "closed" : "open";
}
function toggleCodex(): void {
  if (document.body.dataset.mode === "write") {
    // 撰態側欄被沉浸規則隱藏（決策 49）；點「冊」＝要瀏覽檔案＝切出撰態並開側欄，避免「點了沒反應」
    setMode("split");
    document.body.dataset.codex = "open";
    return;
  }
  document.body.dataset.codex = document.body.dataset.codex === "open" ? "closed" : "open";
}
// 開冊後顯示側欄；若在撰態則切「參」態（撰態藏側欄，開冊＝瀏覽檔案＝離開沉浸寫作）
function openCodexAndReveal(): void {
  void openCodexFolder().then(() => {
    if (document.body.dataset.mode === "write") setMode("split");
    document.body.dataset.codex = "open";
  });
}
function importCodexAndReveal(): void {
  void importCodexFolder().then(() => {
    if (document.body.dataset.mode === "write") setMode("split");
    document.body.dataset.codex = "open";
  });
}
onThemeChange(() => {
  refreshThemeUI();
  update(render(getContent(), getActiveTab().path, true));
});

const langSelect = document.querySelector<HTMLSelectElement>("#lang-list")!;
const themeSelect = document.querySelector<HTMLSelectElement>("#theme-list");

function refreshThemeUI(): void {
  if (!themeSelect) return;

  const current = currentChoice();
  themeSelect.options.length = 0;

  const optVol = document.createElement("option");
  optVol.value = "vol-de-nuit";
  optVol.textContent = t("menu.themeVolDeNuit");
  themeSelect.append(optVol);

  const optInk = document.createElement("option");
  optInk.value = "inkstone";
  optInk.textContent = t("menu.themeInkstone");
  themeSelect.append(optInk);

  const optAuto = document.createElement("option");
  optAuto.value = "auto";
  optAuto.textContent = t("menu.themeAuto");
  themeSelect.append(optAuto);

  const customThemes = getCustomThemes();
  if (customThemes.length > 0) {
    const sepOpt = document.createElement("option");
    sepOpt.disabled = true;
    sepOpt.textContent = "─── " + t("ui.customThemesGroup") + " ───";
    themeSelect.append(sepOpt);

    for (const theme of customThemes) {
      const opt = document.createElement("option");
      opt.value = theme.id;
      opt.textContent = theme.name;
      themeSelect.append(opt);
    }
  }

  const sepActions = document.createElement("option");
  sepActions.disabled = true;
  sepActions.textContent = "──────────";
  themeSelect.append(sepActions);

  const openOpt = document.createElement("option");
  openOpt.value = "__open_themes__";
  openOpt.textContent = "📂 " + t("ui.openThemesFolder");
  themeSelect.append(openOpt);

  themeSelect.value = current;
}

themeSelect?.addEventListener("change", () => {
  const val = themeSelect.value;
  if (val === "__open_themes__") {
    themeSelect.value = currentChoice();
    void openThemesFolder();
  } else if (val) {
    void setTheme(val).then(() => {
      update(render(getContent(), getActiveTab().path, true));
      updateThemeMenu(val);
    });
  }
});

function refreshLangUI(): void {
  const langs = getAvailableLanguages();
  langSelect.options.length = 1; // 保留 placeholder
  for (const l of langs) {
    const opt = document.createElement("option");
    opt.value = l.code;
    opt.textContent = l.name;
    opt.selected = l.code === currentLanguage();
    langSelect.append(opt);
  }

  // Add separator
  const separatorOpt = document.createElement("option");
  separatorOpt.disabled = true;
  separatorOpt.textContent = "──────────";
  langSelect.append(separatorOpt);

  // Add open folder option
  const openOpt = document.createElement("option");
  openOpt.value = "__open_folder__";
  openOpt.textContent = "📂 " + t("ui.openLocalesFolder");
  langSelect.append(openOpt);
}

langSelect.addEventListener("change", () => {
  const lang = langSelect.value;
  if (lang === "__open_folder__") {
    langSelect.value = currentLanguage(); // reset back to active lang
    invoke("open_locales_dir").catch(console.error);
  } else if (lang) {
    void setLanguage(lang);
  }
});

function rebuildMenu(): Promise<void> {
  return initMenu({
    onNew: doNew,
    onOpen: doOpen,
    onOpenCodex: openCodexAndReveal,
    onSave: doSave,
    onSaveAs: doSaveAs,
    onExport: () => void exportHtml(),
    onExportPdf: () => void exportPdf(),
    onSetMode: setMode,
    onToggleFocus: (checked) => {
      reconfigureFocus(checked ? focusExtension() : []);
    },
    onToggleTypewriter: (checked) => {
      reconfigureTypewriter(checked ? typewriterExtension() : []);
    },
    onToggleToc: toggleToc,
    onFullscreen: () => { document.body.dataset.fullscreen = "on"; },
    onCopyHtml: () => void copyHtml(),
    onShortcuts: toggleShortcuts,
    onSetTheme: (choice) => {
      void setTheme(choice).then(() => {
        update(render(getContent(), getActiveTab().path, true));
        refreshThemeUI();
      });
    },
    onSetFont: (family) => { void setFont(family); },
    onFontIncrease: () => { void increaseSize(); },
    onFontDecrease: () => { void decreaseSize(); },
    onFontReset: () => { void resetSize(); },
  }, {
    themeChoice: currentChoice(),
    fontFamily: currentFont(),
  });
}

onLanguageChange(() => {
  void rebuildMenu();
  clearShortcutsOverlay();
  refreshLangUI();
});

void Promise.all([initI18n(), initTheme(), initReadingPrefs()]).then(() => {
  refreshLangUI();
  refreshThemeUI();
  void rebuildMenu();
});

let debounceTimer: number | undefined;
onChange(() => {
  markDirty();
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    try {
      const content = getContent();
      const t0 = performance.now();
      update(render(content, getActiveTab().path, true));
      updateToc();
      updateStats({
        chars: content.replace(/\s/g, "").length, // 寫作直覺的「字數」：不含空白換行
        lines: getLineCount(),
        ms: Math.max(1, Math.round(performance.now() - t0)), // ETA 儀表讀數 = 真渲染耗時
      });
    } catch (e) {
      // SPEC 錯誤處理標準：編輯區不受影響；debounce 每次輸入重跑 render，天然自動重試
      showError(t("dialogs.renderErrorMessage", { error: String(e) }));
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
const exportDropdown = document.querySelector("#export-dropdown")!;
const btnExport = document.querySelector("#btn-export")!;
btnExport.addEventListener("click", (e) => {
  e.stopPropagation();
  const isOpen = exportDropdown.classList.contains("open");
  if (isOpen) {
    exportDropdown.classList.remove("open");
    btnExport.setAttribute("aria-expanded", "false");
  } else {
    exportDropdown.classList.add("open");
    btnExport.setAttribute("aria-expanded", "true");
  }
});
document.addEventListener("click", () => {
  exportDropdown.classList.remove("open");
  btnExport.setAttribute("aria-expanded", "false");
});

document.querySelector("#btn-export-html")!.addEventListener("click", () => void exportHtml());
document.querySelector("#btn-export-pdf")!.addEventListener("click", () => void exportPdf());
document.querySelector("#btn-toc")?.addEventListener("click", toggleToc);
document.querySelector("#btn-codex")!.addEventListener("click", toggleCodex);
document.querySelector(".codex-add")!.addEventListener("click", openCodexAndReveal);
document.querySelector(".codex-import")!.addEventListener("click", importCodexAndReveal);
document.querySelector(".codex-delete")!.addEventListener("click", () => void deleteCurrentCodex());
document.querySelector("#btn-fullscreen")!.addEventListener("click", () => {
  document.body.dataset.fullscreen = "on";
});
document.querySelector("#btn-exit-fullscreen")!.addEventListener("click", () => {
  delete document.body.dataset.fullscreen;
});
for (const btn of modeButtons) {
  btn.addEventListener("click", () => setMode(btn.dataset.modeTarget as Mode));
}

// ----- Escape（選單 accelerator 不處理的按鍵） -----

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (hideSettings()) return;
    if (hideShortcuts()) return;
    if (document.body.dataset.fullscreen === "on") {
      delete document.body.dataset.fullscreen;
    }
  }
});

// ----- 分頁 UI 渲染與事件處理 -----

const tabsListEl = document.querySelector<HTMLElement>("#tabs-list")!;

function renderTabs(): void {
  const allTabs = getTabs();
  const activeId = getActiveTabId();

  tabsListEl.innerHTML = "";

  for (const tab of allTabs) {
    const tabEl = document.createElement("div");
    tabEl.className = "tab";
    if (tab.id === activeId) {
      tabEl.classList.add("active");
    }
    if (tab.dirty) {
      tabEl.classList.add("dirty");
    }

    const titleEl = document.createElement("span");
    titleEl.className = "tab-title";
    const name = tab.path ? (tab.path.split(/[/\\]/).pop() ?? tab.path) : "未命名";
    titleEl.textContent = name;
    tabEl.appendChild(titleEl);

    // 狀態點（未儲存時顯示）
    const statusEl = document.createElement("span");
    statusEl.className = "tab-status";
    tabEl.appendChild(statusEl);

    // 關閉按鈕
    const closeEl = document.createElement("span");
    closeEl.className = "tab-close";
    closeEl.textContent = "✕";
    closeEl.title = "關閉分頁";
    closeEl.addEventListener("click", (e) => {
      e.stopPropagation(); // 阻止點擊關閉按鈕觸發分頁切換
      void closeTab(tab.id);
    });
    tabEl.appendChild(closeEl);

    tabEl.addEventListener("click", () => {
      void selectTab(tab.id);
    });

    tabsListEl.appendChild(tabEl);
  }
}

onTabsChange(renderTabs);

void initFileModule(); // onCloseRequested dirty 攔截 + 初始視窗標題
void refreshRecentUI(); // 啟動時載入既有清單
void restoreCodices(); // 啟動載入冊清單填下拉（不自動列舉，使用者選冊才開）
renderTabs(); // 初始渲染分頁列

// ----- 拖曳開檔（drag & drop .md onto window） -----

const MD_EXT = /\.(md|markdown)$/i;

function openExternalWithRefresh(path: string): void {
  void openExternal(path).then(refreshRecentUI);
}

void getCurrentWebview().onDragDropEvent((event) => {
  const { type } = event.payload;
  if (type === "drop") {
    document.body.classList.remove("drag-hover");
    const paths = event.payload.paths;
    const md = paths.find((p) => MD_EXT.test(p));
    if (md) openExternalWithRefresh(md);
    else if (paths.length > 0) openExternalWithRefresh(paths[0]);
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
  } else {
    setMode("write"); // cold-start 無檔：直接進「撰」沉浸寫
  }
});

// Warm-start：app 已執行中，使用者再雙擊另一個 .md
void listen<string[]>("file-open", (event) => {
  const md = event.payload.find((p) => MD_EXT.test(p));
  if (md) openExternalWithRefresh(md);
});

// 停用 WebView 原生右鍵選單（含「重新載入」）：本 app 無自訂選單可替代，
// 誤按「重新載入」會讓 webview 整頁重載，記憶體中的 CM6 內容/DocState 全部消失變空白。
document.addEventListener("contextmenu", (e) => e.preventDefault());

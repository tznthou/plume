import { invoke } from "@tauri-apps/api/core";
import { load, type Store } from "@tauri-apps/plugin-store";

const STORE_FILE = "settings.json";
const STORE_KEY = "language";
const DEFAULT_LANG: string = "zh_Hant";

let storePromise: Promise<Store> | null = null;
let activeLang = DEFAULT_LANG;
let allLocales: Record<string, any> = {
  zh_Hant: {
    languageName: "正體中文",
    ui: {
      new: "新增",
      open: "開啟",
      codex: "冊",
      save: "儲存",
      export: "匯出",
      exportHtml: "匯出 HTML",
      exportPdf: "匯出 PDF",
      toc: "目錄",
      fullscreen: "全螢幕",
      exitFullscreen: "退出全螢幕",
      writeMode: "撰",
      splitMode: "參",
      readMode: "閱",
      writeModeDesc: "撰：沉浸寫作",
      splitModeDesc: "參：邊寫邊對照",
      readModeDesc: "閱：閱讀",
      recentFiles: "最近檔案",
      switchCodex: "切換冊",
      openCodexFolder: "開啟冊資料夾",
      importCodexFolder: "匯入冊資料夾",
      deleteCodex: "刪除冊",
      chars: "字數",
      lines: "行數",
      render: "渲染",
      charsUnit: "字",
      linesUnit: "行",
      msUnit: "ms",
      saved: "已儲存",
      unsaved: "未儲存",
      unsavedSeal: "未存",
      language: "語言",
      design: "設計",
      settings: "設定",
      version: "版本",
      close: "關閉",
      checkUpdate: "檢查更新",
      checkingUpdate: "檢查中…",
      upToDate: "已是最新版本",
      newVersionAvailable: "發現新版本：{version}",
      downloadUpdate: "下載更新",
      checkUpdateFailed: "無法取得更新資訊",
      codexDesc: "冊：資料夾檔案樹",
      newDesc: "新增檔案",
      openDesc: "開啟檔案",
      saveDesc: "儲存檔案",
      tocDesc: "目錄",
      fullscreenDesc: "全螢幕閱讀",
      exportDesc: "匯出選項",
      themeDesc: "切換佈景主題",
      modeSwitchDesc: "寫作模式",
      charsAlt: "ALT",
      linesAlt: "HDG",
      renderAlt: "ETA",
      openLocalesFolder: "開啟語言包資料夾",
      openThemesFolder: "開啟佈景主題資料夾",
      importTheme: "複製/匯入佈景主題…",
      copyBuiltinTheme: "複製內建主題為範本",
      customThemesGroup: "自訂主題"
    },
    dialogs: {
      openCodexErrorTitle: "開啟冊失敗",
      openCodexErrorMessage: "無法開啟資料夾。",
      importCodexErrorTitle: "匯入冊失敗",
      importCodexErrorMessage: "無法匯入資料夾。",
      deleteCodexConfirmTitle: "刪除冊",
      deleteCodexConfirmMessage: "確定要將冊「{name}」從選單中移除嗎？這不會刪除您硬碟上的實際資料夾。",
      switchCodexErrorTitle: "開啟冊失敗",
      switchCodexErrorMessage: "無法開啟此冊，可能已移動、刪除，或需重新授權；請用「開啟冊」重新選取。",
      deleteNonExistentCodexTitle: "此冊已不存在",
      deleteNonExistentCodexMessage: "此冊「{name}」可能已被移動或刪除。是否將其從下拉選單中移除？",
      deleteLabel: "刪除",
      unsavedChangesTitle: "未儲存的變更",
      unsavedChangesMessage: "「{file}」有未儲存的變更，要儲存嗎？",
      saveLabel: "儲存",
      dontSaveLabel: "不儲存",
      discardChangesTitle: "放棄變更",
      discardChangesMessage: "確定放棄未儲存的變更？",
      discardLabel: "放棄變更",
      cancelLabel: "取消",
      saveFailedTitle: "儲存失敗",
      saveFailedMessage: "儲存失敗：{error}",
      openFailedTitle: "開啟失敗",
      openFailedMessage: "無法開啟檔案：{error}",
      copyFailedTitle: "複製失敗",
      copyFailedMessage: "複製失敗：{error}",
      exportFailedTitle: "匯出失敗",
      exportFailedMessage: "匯出失敗：{error}",
      exportPdfFailedTitle: "匯出失敗",
      exportPdfFailedMessage: "匯出 PDF 失敗：{error}",
      renderErrorMessage: "渲染發生錯誤（下次輸入會自動重試）：{error}"
    },
    menu: {
      file: "檔案",
      new: "新增",
      open: "開啟…",
      openCodex: "開啟冊資料夾…",
      save: "儲存",
      saveAs: "另存新檔…",
      exportHtml: "匯出 HTML…",
      exportPdf: "匯出 PDF…",
      edit: "編輯",
      undo: "復原",
      redo: "重做",
      cut: "剪下",
      copy: "複製",
      paste: "貼上",
      selectAll: "全選",
      view: "檢視",
      focusMode: "專注模式",
      typewriterMode: "打字機模式",
      theme: "佈景主題",
      readingFont: "閱讀字型",
      fontSize: "字型大小",
      fontIncrease: "放大",
      fontDecrease: "縮小",
      fontReset: "重設",
      toc: "目錄",
      fullscreen: "全螢幕閱讀",
      copyHtml: "複製為 HTML",
      help: "輔助說明",
      shortcuts: "鍵盤快捷鍵",
      compose: "Compose",
      split: "Split",
      read: "Read",
      themeVolDeNuit: "暗夜飛行",
      themeInkstone: "硯台",
      themeAuto: "自動",
      fontDefault: "預設",
      fontSerif: "襯線體",
      fontSans: "無襯線體",
      fontMono: "等寬體"
    },
    shortcuts: {
      fileGroup: "檔案",
      newFile: "新增檔案",
      openFile: "開啟檔案",
      save: "儲存",
      saveAs: "另存新檔",
      exportPdf: "匯出 PDF",
      viewGroup: "檢視",
      toggleEditRead: "切換編輯／閱讀",
      fontGroup: "字型",
      increaseFont: "放大字型",
      decreaseFont: "縮小字型",
      resetFont: "重設字型大小",
      toolsGroup: "工具",
      copyHtml: "複製為 HTML",
      exitFullscreen: "退出全螢幕",
      shortcutsTip: "快捷鍵提示",
      overlayTitle: "Keyboard Shortcuts"
    }
  },
  en: {
    languageName: "English",
    ui: {
      new: "New",
      open: "Open",
      codex: "Codex",
      save: "Save",
      export: "Export",
      exportHtml: "Export HTML",
      exportPdf: "Export PDF",
      toc: "TOC",
      fullscreen: "Fullscreen",
      exitFullscreen: "Exit Fullscreen",
      writeMode: "Write",
      splitMode: "Split",
      readMode: "Read",
      writeModeDesc: "Write: Immersive mode",
      splitModeDesc: "Split: Compare mode",
      readModeDesc: "Read: Reading mode",
      recentFiles: "Recent Files",
      switchCodex: "Switch Codex",
      openCodexFolder: "Open Codex Folder",
      importCodexFolder: "Import Codex Folder",
      deleteCodex: "Delete Codex",
      chars: "Chars",
      lines: "Lines",
      render: "Render",
      charsUnit: " chars",
      linesUnit: " lines",
      msUnit: "ms",
      saved: "Saved",
      unsaved: "Unsaved",
      unsavedSeal: "Dirty",
      language: "Language",
      design: "Design",
      settings: "Settings",
      version: "Version",
      close: "Close",
      checkUpdate: "Check for Updates",
      checkingUpdate: "Checking for updates…",
      upToDate: "You are using the latest version",
      newVersionAvailable: "New version available: {version}",
      downloadUpdate: "Download Update",
      checkUpdateFailed: "Failed to check for updates",
      codexDesc: "Codex: folder tree",
      newDesc: "New File",
      openDesc: "Open File",
      saveDesc: "Save File",
      tocDesc: "TOC",
      fullscreenDesc: "Fullscreen",
      exportDesc: "Export options",
      themeDesc: "Switch theme",
      modeSwitchDesc: "Writing mode",
      charsAlt: "ALT",
      linesAlt: "HDG",
      renderAlt: "ETA",
      openLocalesFolder: "Open Locales Folder",
      openThemesFolder: "Open Themes Folder",
      importTheme: "Copy/Import Theme File…",
      copyBuiltinTheme: "Copy Built-in Theme Template",
      customThemesGroup: "Custom Themes"
    },
    dialogs: {
      openCodexErrorTitle: "Open Codex Failed",
      openCodexErrorMessage: "Cannot open folder.",
      importCodexErrorTitle: "Import Codex Failed",
      importCodexErrorMessage: "Cannot import folder.",
      deleteCodexConfirmTitle: "Delete Codex",
      deleteCodexConfirmMessage: "Are you sure you want to remove the codex '{name}' from the menu? This will not delete the folder on your hard drive.",
      switchCodexErrorTitle: "Open Codex Failed",
      switchCodexErrorMessage: "Cannot open this codex, it might have been moved, deleted, or needs re-authorization. Please use 'Open Codex Folder' to re-select.",
      deleteNonExistentCodexTitle: "Codex Does Not Exist",
      deleteNonExistentCodexMessage: "This codex '{name}' might have been moved or deleted. Do you want to remove it from the menu?",
      deleteLabel: "Delete",
      unsavedChangesTitle: "Unsaved Changes",
      unsavedChangesMessage: "\"{file}\" has unsaved changes. Do you want to save them?",
      saveLabel: "Save",
      dontSaveLabel: "Don't Save",
      discardChangesTitle: "Discard Changes",
      discardChangesMessage: "Are you sure you want to discard unsaved changes?",
      discardLabel: "Discard Changes",
      cancelLabel: "Cancel",
      saveFailedTitle: "Save Failed",
      saveFailedMessage: "Save failed: {error}",
      openFailedTitle: "Open Failed",
      openFailedMessage: "Cannot open file: {error}",
      copyFailedTitle: "Copy Failed",
      copyFailedMessage: "Copy failed: {error}",
      exportFailedTitle: "Export Failed",
      exportFailedMessage: "Export failed: {error}",
      exportPdfFailedTitle: "Export Failed",
      exportPdfFailedMessage: "Export PDF failed: {error}",
      renderErrorMessage: "Render error (will retry automatically on next input): {error}"
    },
    menu: {
      file: "File",
      new: "New",
      open: "Open…",
      openCodex: "Open Codex Folder…",
      save: "Save",
      saveAs: "Save As…",
      exportHtml: "Export HTML…",
      exportPdf: "Export PDF…",
      edit: "Edit",
      undo: "Undo",
      redo: "Redo",
      cut: "Cut",
      copy: "Copy",
      paste: "Paste",
      selectAll: "Select All",
      view: "View",
      focusMode: "Focus Mode",
      typewriterMode: "Typewriter Mode",
      theme: "Theme",
      readingFont: "Reading Font",
      fontSize: "Font Size",
      fontIncrease: "Increase",
      fontDecrease: "Decrease",
      fontReset: "Reset",
      toc: "Table of Contents",
      fullscreen: "Fullscreen Reading",
      copyHtml: "Copy as HTML",
      help: "Help",
      shortcuts: "Keyboard Shortcuts",
      compose: "Compose",
      split: "Split",
      read: "Read",
      themeVolDeNuit: "Night Flight",
      themeInkstone: "Inkstone",
      themeAuto: "Auto",
      fontDefault: "Default",
      fontSerif: "Serif",
      fontSans: "Sans-serif",
      fontMono: "Monospace"
    },
    shortcuts: {
      fileGroup: "File",
      newFile: "New File",
      openFile: "Open File",
      save: "Save",
      saveAs: "Save As",
      exportPdf: "Export PDF",
      viewGroup: "View",
      toggleEditRead: "Toggle Edit/Read",
      fontGroup: "Font",
      increaseFont: "Increase Font Size",
      decreaseFont: "Decrease Font Size",
      resetFont: "Reset Font Size",
      toolsGroup: "Tools",
      copyHtml: "Copy as HTML",
      exitFullscreen: "Exit Fullscreen",
      shortcutsTip: "Shortcuts Helper",
      overlayTitle: "Keyboard Shortcuts"
    }
  }
};
let changeCallback: (() => void) | null = null;

function getStore(): Promise<Store> {
  storePromise ??= load(STORE_FILE, { defaults: { [STORE_KEY]: DEFAULT_LANG }, autoSave: false });
  return storePromise;
}

export function currentLanguage(): string {
  return activeLang;
}

export function onLanguageChange(cb: () => void): void {
  changeCallback = cb;
}

export function getAvailableLanguages(): { code: string; name: string }[] {
  return Object.keys(allLocales).map((code) => ({
    code,
    name: allLocales[code].languageName || code,
  }));
}

export function t(key: string, params?: Record<string, string>): string {
  // 1. Try active language
  let val = getDeepValue(allLocales[activeLang], key);
  // 2. Fallback to English
  if (val === undefined && activeLang !== "en") {
    val = getDeepValue(allLocales["en"], key);
  }
  // 3. Fallback to default language
  if (val === undefined && activeLang !== DEFAULT_LANG && DEFAULT_LANG !== "en") {
    val = getDeepValue(allLocales[DEFAULT_LANG], key);
  }

  if (typeof val === "string") {
    return formatString(val, params);
  }
  return key;
}

function getDeepValue(obj: any, path: string): any {
  if (!obj) return undefined;
  return path.split(".").reduce((acc, part) => acc && acc[part], obj);
}

function formatString(str: string, params?: Record<string, string>): string {
  if (!params) return str;
  return str.replace(/{([^{}]+)}/g, (match, key) => {
    return params[key] !== undefined ? params[key] : match;
  });
}

export function updateDOMTranslations(): void {
  // Update elements with text translation
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n")!;
    el.textContent = t(key);
  });

  // Update elements with aria-label translation
  document.querySelectorAll<HTMLElement>("[data-i18n-aria-label]").forEach((el) => {
    const key = el.getAttribute("data-i18n-aria-label")!;
    el.setAttribute("aria-label", t(key));
  });

  // Update elements with title translation
  document.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title")!;
    el.setAttribute("title", t(key));
  });

  // Update elements with tooltip translation
  document.querySelectorAll<HTMLElement>("[data-i18n-tooltip]").forEach((el) => {
    const key = el.getAttribute("data-i18n-tooltip")!;
    const translated = t(key);
    el.setAttribute("data-tooltip", translated);
    el.setAttribute("title", translated);
    el.setAttribute("aria-label", translated);
  });

  // Update elements with custom data-vol translation (g-label status ALT)
  document.querySelectorAll<HTMLElement>("[data-i18n-data-vol]").forEach((el) => {
    const key = el.getAttribute("data-i18n-data-vol")!;
    el.setAttribute("data-vol", t(key));
  });

  // Update elements with custom data-ink translation (g-label status 中文)
  document.querySelectorAll<HTMLElement>("[data-i18n-data-ink]").forEach((el) => {
    const key = el.getAttribute("data-i18n-data-ink")!;
    el.setAttribute("data-ink", t(key));
  });
}

export async function initI18n(): Promise<void> {
  try {
    const loaded = await invoke<Record<string, any>>("load_locales");
    // Deep merge loaded locales into allLocales to preserve static fallbacks for new keys
    for (const [lang, data] of Object.entries(loaded)) {
      if (!allLocales[lang]) {
        allLocales[lang] = {};
      }
      for (const [section, keys] of Object.entries(data)) {
        if (typeof keys === "object" && keys !== null) {
          allLocales[lang][section] = {
            ...allLocales[lang][section],
            ...keys,
          };
        } else {
          allLocales[lang][section] = keys;
        }
      }
    }
  } catch (err) {
    console.error("Failed to load locales from Rust backend", err);
    // 保留載入時已 statically 宣告之完整預設語系（zh_Hant 和 en），不予覆寫
  }

  try {
    const store = await getStore();
    const saved = await store.get(STORE_KEY);
    if (saved && typeof saved === "string" && allLocales[saved]) {
      activeLang = saved;
    } else {
      activeLang = DEFAULT_LANG;
    }
  } catch {
    activeLang = DEFAULT_LANG;
  }

  updateDOMTranslations();
}

export async function setLanguage(lang: string): Promise<void> {
  if (!allLocales[lang]) return;
  activeLang = lang;
  updateDOMTranslations();

  try {
    const store = await getStore();
    await store.set(STORE_KEY, lang);
    await store.save();
  } catch (err) {
    console.error("Failed to save language setting", err);
  }

  // Trigger callbacks (e.g. to rebuild native menu)
  changeCallback?.();
}

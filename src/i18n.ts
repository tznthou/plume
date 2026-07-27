import { invoke } from "@tauri-apps/api/core";
import { load, type Store } from "@tauri-apps/plugin-store";
import zhHant from "../locales/zh_Hant.json";
import en from "../locales/en.json";
import zhHans from "../locales/zh_Hans.json";
import ja from "../locales/ja.json";

const STORE_FILE = "settings.json";
const STORE_KEY = "language";
const DEFAULT_LANG: string = "zh_Hant";

// 語言包來自使用者可寫的目錄，檔名與 section 名都會成為物件 key。`__proto__` 這種 key
// 走 IPC（response.json() 解析，是真的 own property）後，`allLocales[lang][section] = …`
// 會寫穿到 Object.prototype——Tauri 的 freezePrototype 預設關閉，本專案沒開。
// Rust 端已擋檔名，這裡再擋一層：merge 這個 pattern 本身可能被複製到別處。
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

let storePromise: Promise<Store> | null = null;
let activeLang = DEFAULT_LANG;
// 翻譯真相唯一來源是 locales/*.json（Rust 端 load_locales 亦 include_str! 同一組檔案）。
// 此處為 disk 語言包缺鍵時的 fallback；淺拷貝讓 initI18n 的 merge 打在副本上，不動 module export
// ——它只寫到 section 層（allLocales[lang][section] = {...}），拷貝深度對齊寫入深度即足夠。
// 宣告順序即語言選單順序：新語言 append 在後，不動 zh_Hant/en 既有位置。
let allLocales: Record<string, any> = {
  zh_Hant: { ...zhHant },
  en: { ...en },
  zh_Hans: { ...zhHans },
  ja: { ...ja },
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
  // 螢幕閱讀器靠 <html lang> 挑發音語音。index.html 寫死 zh-Hant，切語言時不更新
  // 就會用中文語音念英文介面。這裡是 initI18n 與 setLanguage 的共同出口，設一次兩條路都覆蓋。
  // locale code 與 BCP 47 只差分隔符（zh_Hant → zh-Hant），使用者自備的語言包同樣適用。
  document.documentElement.lang = activeLang.replace(/_/g, "-");

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
      if (UNSAFE_KEYS.has(lang)) continue;
      if (!allLocales[lang]) {
        allLocales[lang] = {};
      }
      for (const [section, keys] of Object.entries(data)) {
        if (UNSAFE_KEYS.has(section)) continue;
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
    // 保留 module 內建的 static registry，不予覆寫（此處刻意不列舉語言碼——
    // 每加一種語言就多一處要記得改，正是這類註解會過時的原因）
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

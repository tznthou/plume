import { invoke } from "@tauri-apps/api/core";
import { load, type Store } from "@tauri-apps/plugin-store";
import zhHant from "../locales/zh_Hant.json";
import en from "../locales/en.json";

const STORE_FILE = "settings.json";
const STORE_KEY = "language";
const DEFAULT_LANG: string = "zh_Hant";

let storePromise: Promise<Store> | null = null;
let activeLang = DEFAULT_LANG;
// 翻譯真相唯一來源是 locales/*.json（Rust 端 load_locales 亦 include_str! 同一組檔案）。
// 此處為 disk 語言包缺鍵時的 fallback；淺拷貝讓 initI18n 的 merge 打在副本上，不動 module export
// ——它只寫到 section 層（allLocales[lang][section] = {...}），拷貝深度對齊寫入深度即足夠。
let allLocales: Record<string, any> = { zh_Hant: { ...zhHant }, en: { ...en } };
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

import { invoke } from "@tauri-apps/api/core";
import { load, type Store } from "@tauri-apps/plugin-store";

export interface CustomTheme {
  id: string;
  name: string;
  cssContent: string;
  filePath: string;
}

export type ThemeChoice = string;

const STORE_FILE = "settings.json";
const KEY = "theme";
const DEFAULT_CHOICE: ThemeChoice = "vol-de-nuit";

let storePromise: Promise<Store> | null = null;
let choice: ThemeChoice = DEFAULT_CHOICE;
let customThemes: CustomTheme[] = [];
let changeCallback: (() => void) | null = null;
let mq: MediaQueryList | null = null;

function getStore(): Promise<Store> {
  storePromise ??= load(STORE_FILE, { defaults: { [KEY]: DEFAULT_CHOICE }, autoSave: false });
  return storePromise;
}

function systemIsDark(): boolean {
  return mq?.matches ?? false;
}

export function getCustomThemes(): CustomTheme[] {
  return customThemes;
}

export function isBuiltinTheme(name: string): boolean {
  return name === "vol-de-nuit" || name === "inkstone" || name === "auto";
}

export function injectCustomThemeStyles(themes: CustomTheme[]): void {
  if (typeof document === "undefined") return;
  let styleEl = document.getElementById("plume-custom-themes") as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "plume-custom-themes";
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = themes.map((t) => t.cssContent).join("\n\n");
}

function resolve(c: ThemeChoice): string {
  if (c === "auto") return systemIsDark() ? "vol-de-nuit" : "inkstone";
  return c;
}

function applyToDOM(): void {
  if (typeof document === "undefined") return;
  const resolved = resolve(choice);
  document.documentElement.dataset.themeChoice = choice;
  document.documentElement.dataset.theme = resolved;
}

export function currentTheme(): string {
  if (typeof document === "undefined") return "vol-de-nuit";
  return document.documentElement.dataset.theme || "vol-de-nuit";
}

export function currentChoice(): ThemeChoice {
  return choice;
}

export function onThemeChange(cb: () => void): void {
  changeCallback = cb;
}

export async function loadCustomThemesFromBackend(): Promise<CustomTheme[]> {
  try {
    const themes = await invoke<CustomTheme[]>("load_custom_themes");
    if (Array.isArray(themes)) {
      customThemes = themes;
      injectCustomThemeStyles(customThemes);
      return customThemes;
    }
  } catch {
    // Fallback for non-tauri or test environments
  }
  return customThemes;
}

export async function openThemesFolder(): Promise<void> {
  try {
    await invoke("open_themes_dir");
  } catch (e) {
    console.error("Failed to open themes directory:", e);
  }
}

export async function importThemeFile(): Promise<CustomTheme[] | null> {
  try {
    const updated = await invoke<CustomTheme[] | null>("import_theme_file");
    if (updated) {
      customThemes = updated;
      injectCustomThemeStyles(customThemes);
      changeCallback?.();
      return customThemes;
    }
    return null;
  } catch (e) {
    console.error("Failed to import theme file:", e);
    throw e;
  }
}

export async function copyBuiltinThemeTemplate(themeId: string): Promise<CustomTheme[]> {
  try {
    const updated = await invoke<CustomTheme[]>("copy_builtin_theme_template", { themeId });
    customThemes = updated;
    injectCustomThemeStyles(customThemes);
    changeCallback?.();
    return customThemes;
  } catch (e) {
    console.error("Failed to copy built-in theme template:", e);
    throw e;
  }
}

export async function initTheme(): Promise<void> {
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", () => {
      if (choice === "auto") {
        applyToDOM();
        changeCallback?.();
      }
    });
  }

  await loadCustomThemesFromBackend();

  try {
    const saved = await (await getStore()).get(KEY);
    if (typeof saved === "string" && saved) {
      const isBuiltin = isBuiltinTheme(saved);
      const isCustom = customThemes.some((t) => t.id === saved);
      if (isBuiltin || isCustom) {
        choice = saved;
      } else {
        choice = DEFAULT_CHOICE;
      }
    }
  } catch {
    choice = DEFAULT_CHOICE;
  }

  applyToDOM();
}

export async function setTheme(next: ThemeChoice): Promise<void> {
  choice = next;
  applyToDOM();
  try {
    const store = await getStore();
    await store.set(KEY, next);
    await store.save();
  } catch {}
}

export async function toggleTheme(): Promise<ThemeChoice> {
  const customIds = customThemes.map((t) => t.id);
  const order: ThemeChoice[] = ["vol-de-nuit", "inkstone", "auto", ...customIds];
  const idx = order.indexOf(choice);
  const next = order[idx >= 0 ? (idx + 1) % order.length : 0];
  await setTheme(next);
  return next;
}


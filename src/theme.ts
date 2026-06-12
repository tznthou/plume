// 佈景主題：vol-de-nuit（夜航儀表・深）/ inkstone（硯墨五階・淺）。
// 切換 = html[data-theme]，樣式全在 style.css 變數組；plugin-store 持久化 settings.json。
import { load, type Store } from "@tauri-apps/plugin-store";

export type ThemeName = "vol-de-nuit" | "inkstone";

const STORE_FILE = "settings.json";
const KEY = "theme";
const DEFAULT_THEME: ThemeName = "vol-de-nuit";

let storePromise: Promise<Store> | null = null;

function getStore(): Promise<Store> {
  storePromise ??= load(STORE_FILE, { defaults: { [KEY]: DEFAULT_THEME }, autoSave: false });
  return storePromise;
}

function isTheme(v: unknown): v is ThemeName {
  return v === "vol-de-nuit" || v === "inkstone";
}

export function currentTheme(): ThemeName {
  const v = document.documentElement.dataset.theme;
  return isTheme(v) ? v : DEFAULT_THEME;
}

function apply(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme;
}

// index.html 已寫死預設 data-theme 防首幀閃爍；這裡只在儲存值不同時切換
export async function initTheme(): Promise<void> {
  try {
    const saved = await (await getStore()).get(KEY);
    if (isTheme(saved)) apply(saved);
  } catch {
    // store 損毀：維持預設，靜默（同 recent.ts 錯誤標準）
  }
}

export async function toggleTheme(): Promise<ThemeName> {
  const next: ThemeName = currentTheme() === "vol-de-nuit" ? "inkstone" : "vol-de-nuit";
  apply(next);
  try {
    const store = await getStore();
    await store.set(KEY, next);
    await store.save();
  } catch {
    // 持久化失敗不阻斷切換，代價只是下次啟動回到上次成功儲存的主題
  }
  return next;
}

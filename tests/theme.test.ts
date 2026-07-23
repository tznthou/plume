// 佈景主題測試：store 持久化 round-trip 與損毀 fallback（裝飾性的 toggle 循環不測）。
// mock 模式同 recent.test.ts：in-memory map + resetModules 取乾淨模組單例。
import { beforeEach, describe, expect, it, vi } from "vitest";

const storeMocks = vi.hoisted(() => {
  const data = new Map<string, unknown>();
  return {
    data,
    failing: { value: false },
    fakeStore: {
      get: vi.fn((key: string) => {
        if (storeMocks.failing.value) return Promise.reject(new Error("store 損毀"));
        return Promise.resolve(data.get(key));
      }),
      set: vi.fn((key: string, value: unknown) => {
        data.set(key, value);
        return Promise.resolve();
      }),
      save: vi.fn(() => Promise.resolve()),
    },
  };
});

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(() => Promise.resolve(storeMocks.fakeStore)),
}));

async function loadThemeModule() {
  vi.resetModules();
  return await import("../src/theme");
}

beforeEach(() => {
  vi.clearAllMocks();
  storeMocks.data.clear();
  storeMocks.failing.value = false;
  // index.html 的寫死預設由 jsdom fixture 模擬
  document.documentElement.dataset.theme = "vol-de-nuit";
});

describe("theme", () => {
  it("test_theme_init_savedInkstone_appliesToHtml", async () => {
    storeMocks.data.set("theme", "inkstone");
    const theme = await loadThemeModule();
    await theme.initTheme();
    expect(document.documentElement.dataset.theme).toBe("inkstone");
  });

  it("test_theme_toggle_switchesAndPersists", async () => {
    const theme = await loadThemeModule();
    const next = await theme.toggleTheme();
    expect(next).toBe("inkstone");
    expect(document.documentElement.dataset.theme).toBe("inkstone");
    expect(storeMocks.data.get("theme")).toBe("inkstone"); // 重啟後記得住
    expect(storeMocks.fakeStore.save).toHaveBeenCalled();
  });

  it("test_theme_init_corruptStore_keepsDefaultSilently", async () => {
    storeMocks.failing.value = true;
    const theme = await loadThemeModule();
    await expect(theme.initTheme()).resolves.toBeUndefined(); // 不丟例外
    expect(document.documentElement.dataset.theme).toBe("vol-de-nuit"); // 維持預設
  });

  it("test_theme_init_garbageValue_ignored", async () => {
    storeMocks.data.set("theme", "neon-disco"); // 非法值（手改 settings.json 的情境）
    const theme = await loadThemeModule();
    await theme.initTheme();
    expect(document.documentElement.dataset.theme).toBe("vol-de-nuit");
  });

  it("test_custom_theme_style_injection_and_setTheme", async () => {
    const theme = await loadThemeModule();
    const custom = {
      id: "emerald-forest",
      name: "翠綠森林 (Emerald Forest)",
      cssContent: 'html[data-theme="emerald-forest"] { --bg: #0d1b1e; }',
      filePath: "/path/to/emerald-forest.css",
    };

    theme.injectCustomThemeStyles([custom]);
    const styleEl = document.getElementById("plume-custom-themes");
    expect(styleEl).not.toBeNull();
    expect(styleEl?.textContent).toContain("emerald-forest");

    await theme.setTheme("emerald-forest");
    expect(document.documentElement.dataset.theme).toBe("emerald-forest");
    expect(document.documentElement.dataset.themeChoice).toBe("emerald-forest");
    expect(storeMocks.data.get("theme")).toBe("emerald-forest");
  });

  it("test_isBuiltinTheme", async () => {
    const theme = await loadThemeModule();
    expect(theme.isBuiltinTheme("vol-de-nuit")).toBe(true);
    expect(theme.isBuiltinTheme("inkstone")).toBe(true);
    expect(theme.isBuiltinTheme("auto")).toBe(true);
    expect(theme.isBuiltinTheme("emerald-forest")).toBe(false);
  });
});

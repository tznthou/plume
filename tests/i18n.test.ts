// <html lang> 是螢幕閱讀器挑發音語音的依據。index.html 寫死 zh-Hant，
// 切語言時若不同步就會用中文語音念英文介面——這組測試守住那個同步。
import { beforeEach, describe, expect, it, vi } from "vitest";

const storeMocks = vi.hoisted(() => ({
  fakeStore: {
    get: vi.fn(),
    set: vi.fn(() => Promise.resolve()),
    save: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(() => Promise.resolve(storeMocks.fakeStore)),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.reject(new Error("no backend in tests"))),
}));

async function loadI18n() {
  vi.resetModules();
  return await import("../src/i18n");
}

beforeEach(() => {
  vi.clearAllMocks();
  document.documentElement.lang = "zh-Hant";
});

describe("i18n html lang", () => {
  it("test_i18n_setLanguage_syncsHtmlLangToBcp47", async () => {
    const i18n = await loadI18n();

    await i18n.setLanguage("en");
    expect(document.documentElement.lang).toBe("en");

    // locale 檔名用底線，BCP 47 用連字號——轉換必須發生
    await i18n.setLanguage("zh_Hant");
    expect(document.documentElement.lang).toBe("zh-Hant");
  });

  it("test_i18n_setLanguage_unknownCode_leavesHtmlLangUntouched", async () => {
    const i18n = await loadI18n();
    await i18n.setLanguage("en");

    await i18n.setLanguage("kl_Ingon"); // 沒有這個語言包
    expect(document.documentElement.lang).toBe("en");
    expect(i18n.currentLanguage()).toBe("en");
  });

  it("test_i18n_updateDOMTranslations_setsLangWithoutLanguageChange", async () => {
    // initI18n 走的是同一個出口；直接呼 updateDOMTranslations 也該把 lang 補上，
    // 這樣冷啟動時 disk 設定是英文也不會留著 index.html 的寫死值
    const i18n = await loadI18n();
    document.documentElement.lang = "";

    i18n.updateDOMTranslations();

    expect(document.documentElement.lang).toBe("zh-Hant");
  });
});

import { describe, expect, it } from "vitest";
import zhHant from "../locales/zh_Hant.json";
import en from "../locales/en.json";

// locales/*.json 是翻譯的唯一真相：前端 i18n.ts import 它、Rust load_locales include_str! 它。
// 收斂前 Rust 種子與 TS 內建曾漂移 25 個鍵（v0.13–v0.14 新增的字串只加在 TS 側），
// 使用者語言包因此永遠缺鍵。以下守住收斂後唯一還會漂移的地方：語言之間的鍵集合。

function flattenKeys(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => flattenKeys(v, prefix ? `${prefix}.${k}` : k));
}

describe("locales", () => {
  it("zh_Hant 與 en 的鍵集合完全一致（新增字串時不可只加一種語言）", () => {
    const zhKeys = flattenKeys(zhHant).sort();
    const enKeys = flattenKeys(en).sort();

    expect(enKeys.filter((k) => !zhKeys.includes(k))).toEqual([]);
    expect(zhKeys.filter((k) => !enKeys.includes(k))).toEqual([]);
  });

  it("兩份語言包都具備 i18n.ts 與 native menu 依賴的頂層 section", () => {
    for (const locale of [zhHant, en]) {
      expect(Object.keys(locale)).toEqual(
        expect.arrayContaining(["languageName", "ui", "dialogs", "menu", "shortcuts"])
      );
    }
  });

  it("所有翻譯值都是非空字串（空字串會讓 UI 顯示空白而非 fallback）", () => {
    for (const [name, locale] of [["zh_Hant", zhHant], ["en", en]] as const) {
      const empty = flattenKeys(locale).filter((path) => {
        const val = path.split(".").reduce<any>((acc, part) => acc?.[part], locale);
        return typeof val !== "string" || val.trim() === "";
      });
      expect(empty, `${name} 有空值鍵`).toEqual([]);
    }
  });
});

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// i18n.ts 在 module 頂層 import Tauri API；測試只需要它的 static registry，
// 故比照 i18n.test.ts mock 掉後端（vi.mock 會被 hoist 到下面的 import 之上）。
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(() => Promise.resolve({ get: vi.fn(), set: vi.fn(), save: vi.fn() })),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.reject(new Error("no backend in tests"))),
}));

import { getAvailableLanguages } from "../src/i18n";

// locales/*.json 是翻譯的唯一真相：前端 i18n.ts import 它、Rust load_locales include_str! 它。
// 收斂前 Rust 種子與 TS 內建曾漂移 25 個鍵（v0.13–v0.14 新增的字串只加在 TS 側），
// 使用者語言包因此永遠缺鍵。以下守住語言之間的鍵集合，以及前端 registry 是否跟上目錄。
// Rust 種子那側改由 src-tauri 的 `seeds_cover_every_locale_file` 對常數本身斷言——
// 從 TS grep 原始碼擋不住「檔名改成 ja.json.disabled」或區塊註解包住整張表。
//
// 刻意動態掃目錄而非寫死語言清單——寫死的話，新增語言時忘記更新測試就等於沒測到。

const BASE_LANG = "zh_Hant";
// vitest 的 import.meta.url 不保證是 file: scheme，改用 cwd（vitest root = 專案根）。
const localesDir = join(process.cwd(), "locales");

const localeFiles = readdirSync(localesDir)
  .filter((f) => f.endsWith(".json"))
  .sort();

const locales = localeFiles.map((file) => {
  const raw = readFileSync(join(localesDir, file), "utf8");
  try {
    // JSON.parse 的錯誤不含檔名，四份檔案裡少一個逗號會很難查
    return { name: file.replace(/\.json$/, ""), file, data: JSON.parse(raw) as unknown };
  } catch (e) {
    throw new Error(`${file} 不是合法 JSON: ${(e as Error).message}`);
  }
});

const base = locales.find((l) => l.name === BASE_LANG);
if (!base) throw new Error(`找不到基準語言包 ${BASE_LANG}.json——它是所有 parity 斷言的對照組`);

// 回傳 entries 而非純路徑：路徑字串再 split(".") 走回去取值的話，會隱含
// 「沒有任何 key 含 .」這個前提，而那個前提沒人保證。
function flattenEntries(obj: unknown, prefix = ""): [string, unknown][] {
  if (typeof obj !== "object" || obj === null) return [[prefix, obj]];
  return Object.entries(obj).flatMap(([k, v]) =>
    flattenEntries(v, prefix ? `${prefix}.${k}` : k)
  );
}

// 與 i18n.ts formatString 同 pattern，兩邊要一起動：那邊會替換 {file name}、{a.b}
// 這類非 \w 佔位符，守門的 regex 若比 runtime 窄，漏掉的就看不見。
function placeholderNames(s: unknown): string[] {
  return [...String(s).matchAll(/{([^{}]+)}/g)].map((m) => m[1]).sort();
}

describe("locales", () => {
  it("目錄裡至少有預期的四種語言（少了代表檔案被誤刪）", () => {
    expect(localeFiles).toEqual(
      expect.arrayContaining(["en.json", "ja.json", "zh_Hans.json", "zh_Hant.json"])
    );
  });

  it("所有語言的鍵集合完全一致（新增字串時不可只加一種語言）", () => {
    const baseKeys = flattenEntries(base.data).map(([k]) => k).sort();

    for (const locale of locales) {
      const keys = flattenEntries(locale.data).map(([k]) => k).sort();
      expect(baseKeys.filter((k) => !keys.includes(k)), `${locale.name} 缺鍵`).toEqual([]);
      expect(keys.filter((k) => !baseKeys.includes(k)), `${locale.name} 多出鍵`).toEqual([]);
    }
  });

  it("每份語言包都具備 i18n.ts 與 native menu 依賴的頂層 section", () => {
    for (const locale of locales) {
      expect(Object.keys(locale.data as object), `${locale.name} 缺 section`).toEqual(
        expect.arrayContaining(["languageName", "ui", "dialogs", "menu", "shortcuts"])
      );
    }
  });

  it("插值佔位符與基準一致（漏一個 {error} 就是「儲存失敗：」後面空白）", () => {
    const baseEntries = new Map(flattenEntries(base.data));

    for (const locale of locales) {
      for (const [key, val] of flattenEntries(locale.data)) {
        expect(
          placeholderNames(val),
          `${locale.name} [${key}] 佔位符與 ${BASE_LANG} 不符`
        ).toEqual(placeholderNames(baseEntries.get(key)));
      }
    }
  });

  it("所有翻譯值都是非空字串（空字串會讓 UI 顯示空白而非 fallback）", () => {
    for (const locale of locales) {
      const empty = flattenEntries(locale.data)
        .filter(([, val]) => typeof val !== "string" || val.trim() === "")
        .map(([path]) => path);
      expect(empty, `${locale.name} 有空值鍵`).toEqual([]);
    }
  });

  it("i18n.ts 的 registry 涵蓋每一份語言包，且 code 綁到正確的資料", () => {
    // 語義驗證而非原始碼字串比對：先前版本用 regex 找 `ja: {`，把 registry 整行
    // 註解掉照樣通過（註解也是原始碼字串）。連 languageName 一起比對，是因為只比
    // code 集合的話，把 zh_Hans 綁到 ja 的資料仍會全綠——選單顯示「简体中文」點下去
    // 卻是日文。
    const registered = getAvailableLanguages()
      .map((l) => `${l.code}=${l.name}`)
      .sort();
    const expected = locales
      .map((l) => `${l.name}=${(l.data as { languageName: string }).languageName}`)
      .sort();

    expect(registered).toEqual(expected);
  });
});

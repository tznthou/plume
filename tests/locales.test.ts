import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

// i18n.ts 在 module 頂層 import Tauri API；測試只需要它的 static registry，
// 故比照 i18n.test.ts mock 掉後端（invoke 會被 initI18n 呼叫，這裡不呼叫）。
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(() => Promise.resolve({ get: vi.fn(), set: vi.fn(), save: vi.fn() })),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.reject(new Error("no backend in tests"))),
}));

// locales/*.json 是翻譯的唯一真相：前端 i18n.ts import 它、Rust load_locales include_str! 它。
// 收斂前 Rust 種子與 TS 內建曾漂移 25 個鍵（v0.13–v0.14 新增的字串只加在 TS 側），
// 使用者語言包因此永遠缺鍵。以下守住兩種漂移：語言之間的鍵集合，以及三處引用是否跟上目錄。
//
// 刻意動態掃目錄而非寫死語言清單——寫死的話，新增語言時忘記更新測試就等於沒測到。

// vitest 的 import.meta.url 不保證是 file: scheme，改用 cwd（vitest root = 專案根）。
const root = resolve(process.cwd());
const localesDir = join(root, "locales");
// 剝掉行註解再比對：註解掉的 include_str! 仍是原始碼裡的字串，
// 純 contains 會把「被停用的種子」當成還在，守門就形同虛設。
const rustSource = readFileSync(join(root, "src-tauri", "src", "lib.rs"), "utf8")
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

const localeFiles = readdirSync(localesDir)
  .filter((f) => f.endsWith(".json"))
  .sort();
const locales = localeFiles.map((file) => ({
  name: file.replace(/\.json$/, ""),
  file,
  data: JSON.parse(readFileSync(join(localesDir, file), "utf8")) as unknown,
}));

// 回傳 entries 而非純路徑：路徑字串再 split(".") 走回去取值的話，會隱含
// 「沒有任何 key 含 .」這個前提，而那個前提沒人保證。
function flattenEntries(obj: unknown, prefix = ""): [string, unknown][] {
  if (typeof obj !== "object" || obj === null) return [[prefix, obj]];
  return Object.entries(obj).flatMap(([k, v]) =>
    flattenEntries(v, prefix ? `${prefix}.${k}` : k)
  );
}

describe("locales", () => {
  it("目錄裡至少有預期的四種語言（少了代表檔案被誤刪）", () => {
    expect(localeFiles).toEqual(
      expect.arrayContaining(["en.json", "ja.json", "zh_Hans.json", "zh_Hant.json"])
    );
  });

  it("所有語言的鍵集合完全一致（新增字串時不可只加一種語言）", () => {
    const base = locales.find((l) => l.name === "zh_Hant")!;
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
    const base = new Map(flattenEntries(locales.find((l) => l.name === "zh_Hant")!.data));
    const names = (s: unknown) =>
      [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

    for (const locale of locales) {
      for (const [key, val] of flattenEntries(locale.data)) {
        expect(names(val), `${locale.name} [${key}] 佔位符與 zh_Hant 不符`).toEqual(
          names(base.get(key))
        );
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

  it("i18n.ts 的 registry 涵蓋目錄裡的每一份語言包（漏接的語言在純 webview 模式不存在）", async () => {
    // 語義驗證而非原始碼字串比對：先前版本用 regex 找 `ja: {`，
    // 把 registry 整行註解掉照樣通過（註解也是原始碼裡的字串）。
    // 直接問 getAvailableLanguages 就不受註解、改寫、換寫法影響。
    const { getAvailableLanguages } = await import("../src/i18n");
    const registered = getAvailableLanguages().map((l) => l.code).sort();
    expect(registered).toEqual(locales.map((l) => l.name).sort());
  });

  it("Rust load_locales 有 include_str! 目錄裡的每一份語言包（漏接則新使用者拿不到種子檔）", () => {
    for (const { file } of locales) {
      expect(rustSource, `lib.rs 未種下 ${file}`).toContain(`../../locales/${file}`);
    }
  });
});

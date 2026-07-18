// 開檔預覽回頂的 regression（子超 2026-06-12 回報：預覽捲到底後開新檔，預覽殘留在底）。
// 註：scrollTop 的「視覺捲動」是 layout 行為，jsdom 不做 layout，故以攔截 scrollTop setter
// 驗證「開檔旗標下 update 會置頂、無旗標時不動」這個邏輯意圖——邏輯被改壞時這兩條會變紅。
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost${path.replace(/\\/g, "/")}`,
}));

import { initPreview, scrollToTopOnNextUpdate, update } from "../src/preview";

// 以 defineProperty 攔截 scrollTop（jsdom 預設 no-op 讀回 0，攔截後可觀察寫入值）
function spyScrollTop(el: HTMLElement): { get value(): number } {
  let v = 0;
  Object.defineProperty(el, "scrollTop", {
    get: () => v,
    set: (n: number) => {
      v = n;
    },
    configurable: true,
  });
  return {
    get value() {
      return v;
    },
  };
}

describe("preview scroll reset on file open", () => {
  let el: HTMLElement;
  let editorScroller: HTMLElement;

  beforeEach(() => {
    el = document.createElement("div");
    editorScroller = document.createElement("div");
    initPreview(el, editorScroller);
  });

  it("test_preview_update_withOpenFlag_resetsScrollToTop", () => {
    const scroll = spyScrollTop(el);
    el.scrollTop = 500; // 前一個檔的預覽被捲到底

    scrollToTopOnNextUpdate(); // 開檔信號
    update("<p>new file</p>");

    expect(scroll.value).toBe(0); // 開新檔預覽必須回頂
  });

  it("test_preview_update_withoutFlag_keepsScrollPosition", () => {
    const scroll = spyScrollTop(el);
    el.scrollTop = 500; // 正常編輯中，預覽停在某處

    update("<p>typing…</p>"); // 無開檔旗標（一般渲染）

    expect(scroll.value).toBe(500); // 不可重設，否則打字時預覽會一直跳頂
  });

  it("test_preview_update_flagConsumedOnce", () => {
    const scroll = spyScrollTop(el);

    scrollToTopOnNextUpdate();
    update("<p>open</p>"); // 消費旗標
    el.scrollTop = 300; // 之後正常編輯捲動
    update("<p>edit</p>"); // 旗標已清，不應再回頂

    expect(scroll.value).toBe(300);
  });
});

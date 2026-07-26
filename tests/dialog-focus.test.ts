// dialog-focus 的 focus trap。設定面板與快捷鍵浮層都掛 aria-modal="true"，
// 這組測試守的是那句宣稱兌現得了——焦點進得去、Tab 出不去、關閉還得回原處。
import { beforeEach, describe, expect, it } from "vitest";
import { trapFocus } from "../src/dialog-focus";

// jsdom 不實作 layout，offsetParent 恆為 null，實作的可見性過濾會濾掉全部元素。
// 這裡明確把元素標成可見，才測得到 Tab 環繞而不是一路掉進「無可聚焦元素」分支。
function markVisible(...els: HTMLElement[]): void {
  for (const el of els) {
    Object.defineProperty(el, "offsetParent", {
      get: () => document.body,
      configurable: true,
    });
  }
}

function pressTab(shift = false): void {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Tab", shiftKey: shift, bubbles: true })
  );
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("dialog-focus", () => {
  it("test_trapFocus_open_focusesFirstFocusableChild", () => {
    document.body.innerHTML = `
      <button id="outside">outside</button>
      <div id="card">
        <button id="close">close</button>
        <select id="theme"><option>a</option></select>
      </div>`;
    const card = document.querySelector<HTMLElement>("#card")!;
    const close = document.querySelector<HTMLElement>("#close")!;
    markVisible(close, document.querySelector<HTMLElement>("#theme")!);

    trapFocus(card);

    expect(document.activeElement).toBe(close);
  });

  it("test_trapFocus_tabAtLastChild_wrapsToFirst", () => {
    document.body.innerHTML = `
      <button id="outside">outside</button>
      <div id="card"><button id="a">a</button><button id="b">b</button></div>`;
    const card = document.querySelector<HTMLElement>("#card")!;
    const a = document.querySelector<HTMLElement>("#a")!;
    const b = document.querySelector<HTMLElement>("#b")!;
    markVisible(a, b);

    trapFocus(card);
    b.focus();
    pressTab();

    expect(document.activeElement).toBe(a);
  });

  it("test_trapFocus_shiftTabAtFirstChild_wrapsToLast", () => {
    document.body.innerHTML = `
      <div id="card"><button id="a">a</button><button id="b">b</button></div>`;
    const card = document.querySelector<HTMLElement>("#card")!;
    const a = document.querySelector<HTMLElement>("#a")!;
    const b = document.querySelector<HTMLElement>("#b")!;
    markVisible(a, b);

    trapFocus(card);
    a.focus();
    pressTab(true);

    expect(document.activeElement).toBe(b);
  });

  it("test_trapFocus_focusEscapedOutside_pullsBackIntoRing", () => {
    document.body.innerHTML = `
      <button id="outside">outside</button>
      <div id="card"><button id="a">a</button><button id="b">b</button></div>`;
    const card = document.querySelector<HTMLElement>("#card")!;
    const outside = document.querySelector<HTMLElement>("#outside")!;
    const a = document.querySelector<HTMLElement>("#a")!;
    markVisible(outside, a, document.querySelector<HTMLElement>("#b")!);

    trapFocus(card);
    outside.focus(); // 模擬焦點被別的程式碼搶到背景去
    pressTab();

    expect(document.activeElement).toBe(a);
  });

  it("test_trapFocus_noFocusableChild_keepsFocusOnContainer", () => {
    // 快捷鍵浮層就是這種：整張卡只有文字，靠容器自身的 tabIndex -1 收焦點
    document.body.innerHTML = `
      <button id="outside">outside</button>
      <div id="card" tabindex="-1"><dl><dt>⌘S</dt><dd>save</dd></dl></div>`;
    const card = document.querySelector<HTMLElement>("#card")!;

    trapFocus(card);
    expect(document.activeElement).toBe(card);

    pressTab();
    expect(document.activeElement).toBe(card);
  });

  it("test_trapFocus_release_restoresPreviousFocusAndStopsTrapping", () => {
    document.body.innerHTML = `
      <button id="outside">outside</button>
      <div id="card"><button id="a">a</button></div>`;
    const card = document.querySelector<HTMLElement>("#card")!;
    const outside = document.querySelector<HTMLElement>("#outside")!;
    const a = document.querySelector<HTMLElement>("#a")!;
    markVisible(outside, a);

    outside.focus();
    const release = trapFocus(card);
    expect(document.activeElement).toBe(a);

    release();
    expect(document.activeElement).toBe(outside);

    // 釋放後 handler 必須拆掉，否則下次 Tab 還會被已關閉的面板攔住
    outside.focus();
    pressTab();
    expect(document.activeElement).toBe(outside);
  });
});

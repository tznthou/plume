// Modal 浮層的焦點管理（設定面板、快捷鍵浮層共用）。
// 兩者都掛 aria-modal="true"，那句話對輔助技術的意思是「背景不可及」——
// 沒有 focus trap 就是謊報：螢幕閱讀器照著把背景藏了，Tab 焦點卻還跑得出去，
// 使用者會落在「聽不到但焦點在那裡」的狀態。此模組負責兌現那個宣稱。
// 命名刻意避開 focus-mode.ts（那是寫作專注模式，不同一件事）。

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "select:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableIn(container: HTMLElement): HTMLElement[] {
  // offsetParent 為 null 即不可見（display:none 或 hidden 祖先），不該進 Tab 環
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null
  );
}

/**
 * 把焦點關進 container，回傳釋放函式（釋放時把焦點交還開啟前的元素）。
 * 呼叫端必須在關閉浮層時呼叫釋放函式，否則 keydown handler 會留著。
 */
export function trapFocus(container: HTMLElement): () => void {
  const prevFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const onKeydown = (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const items = focusableIn(container);
    if (items.length === 0) {
      // 純文字浮層（快捷鍵面板）沒有可聚焦子元素：焦點釘在容器上，Tab 不出去
      e.preventDefault();
      container.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !items.includes(active)) {
      // 焦點在容器本身或跑到外面：拉回環的頭尾
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
      return;
    }
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // capture phase：CM6 也吃 Tab（縮排），不搶在它之前攔就環不住
  document.addEventListener("keydown", onKeydown, true);

  const items = focusableIn(container);
  (items[0] ?? container).focus();

  return () => {
    document.removeEventListener("keydown", onKeydown, true);
    // 焦點交還原處（通常是編輯器），否則看完面板得重新點一次才能打字。
    // 元素可能已被移除（語言切換會重建浮層），focus() 對脫離文件的節點是 no-op
    prevFocus?.focus();
  };
}

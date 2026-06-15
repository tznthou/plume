// 預覽 DOM 更新 + 同步捲動（編輯→預覽單向比例式）+ 外部連結攔截（SPEC「模組職責」、Task 5）。
import { openUrl } from "@tauri-apps/plugin-opener";
import { currentTheme } from "./theme";

let container: HTMLElement | null = null;

// mermaid 懶載入：第一次碰到 ```mermaid block 才 import，避免無 mermaid 的檔案吃 bundle 成本。
// generation 計數器防 rapid update 時對已脫離 DOM 的舊元素操作。
let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
let mermaidGen = 0;
let lastMermaidTheme: string | undefined;

function getMermaid(): Promise<typeof import("mermaid").default> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => m.default);
  }
  return mermaidPromise;
}

async function renderMermaid(gen: number): Promise<void> {
  if (!container!.querySelector("pre.mermaid")) return;

  const mermaid = await getMermaid();
  if (gen !== mermaidGen) return;

  const theme = currentTheme() === "vol-de-nuit" ? "dark" : "default";
  if (theme !== lastMermaidTheme) {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme });
    lastMermaidTheme = theme;
  }

  try {
    await mermaid.run({ nodes: container!.querySelectorAll<HTMLElement>("pre.mermaid") });
  } catch (err) {
    console.warn("[mermaid]", err);
    return;
  }

  // 剝除 mermaid bindFunctions 附加的 click handler（會繞過外部連結攔截）。
  // cloneNode(true) deep-clone DOM 但不複製 addEventListener 綁定；
  // 安全靠 mermaid securityLevel:'strict'（內部 DOMPurify + HTML encode）+ pre-render DOMPurify。
  for (const el of container!.querySelectorAll<HTMLElement>("pre.mermaid")) {
    const clean = el.cloneNode(true) as HTMLElement;
    el.replaceChildren(...clean.childNodes);
  }
}

// 開檔/新檔旗標：換 innerHTML 時瀏覽器會保留舊 scrollTop，若前一個檔的預覽被捲到底，
// 新檔渲染後會殘留在底（甚至被 clamp 到新檔底部）。開檔時設旗標，下次 update 後回頂。
// 不在每次 update 無條件回頂——那會害正常編輯打字時預覽一直跳回頂端。
let resetScrollOnUpdate = false;

export function scrollToTopOnNextUpdate(): void {
  resetScrollOnUpdate = true;
}

export function initPreview(el: HTMLElement, editorScroller: HTMLElement): void {
  container = el;

  // 編輯→預覽單向比例捲動。scroll 事件高頻，rAF 節流：一幀最多映射一次。
  // 單向：預覽自身捲動不回寫編輯區。
  let scheduled = false;
  editorScroller.addEventListener("scroll", () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const editorRange = editorScroller.scrollHeight - editorScroller.clientHeight;
      if (editorRange <= 0) return; // 內容比視窗短，無捲動量可映射
      const ratio = editorScroller.scrollTop / editorRange;
      el.scrollTop = ratio * (el.scrollHeight - el.clientHeight);
    });
  });

  // 外部連結攔截（SPEC 安全規格：webview 不導航離開 app）。click delegation +
  // closest 處理巢狀元素；一律 preventDefault（相對路徑/檔案連結不放行），
  // 僅 http/https 交 opener 走系統瀏覽器。
  el.addEventListener("click", (e) => {
    const anchor = (e.target as HTMLElement).closest("a");
    if (!anchor) return;
    e.preventDefault();
    // 取原始 href：resolved 的 anchor.href 會把相對路徑補成 http://localhost，誤判為外部連結
    const href = anchor.getAttribute("href");
    if (href && /^https?:\/\//i.test(href)) void openUrl(href);
  });
}

export function update(html: string): void {
  container!.innerHTML = html;
  if (resetScrollOnUpdate) {
    container!.scrollTop = 0;
    resetScrollOnUpdate = false;
  }
  const gen = ++mermaidGen;
  void renderMermaid(gen);
}

// SPEC 錯誤處理標準：渲染例外時預覽顯示錯誤帶。textContent 寫入，錯誤訊息不走 HTML。
export function showError(text: string): void {
  container!.textContent = text;
}

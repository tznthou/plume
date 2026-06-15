// Task 2 測試（docs/PLAN.md「Task 2: 渲染管線」測試設計）。
// 測試是 spec：斷言驗證實際輸出 HTML 結構，不只驗「有輸出」。
import { describe, expect, it } from "vitest";

import { render } from "../src/renderer";

/** 把 render() 輸出（已消毒）掛進 jsdom，以 DOM 結構驗證屬性與文字。 */
function parse(html: string): HTMLDivElement {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container;
}

describe("renderer.render", () => {
  it("test_renderer_render_gfmTable_outputsTableTag", () => {
    const out = render(
      ["| Name | Role |", "| ---- | ---- |", "| Plume | editor |"].join("\n"),
    );

    const table = parse(out).querySelector("table");
    expect(table).not.toBeNull();
    expect(table!.querySelector("thead th")?.textContent).toBe("Name");
    expect(table!.querySelector("tbody td")?.textContent).toBe("Plume");
  });

  it("test_renderer_render_taskList_outputsCheckbox", () => {
    const out = render("- [ ] write tests\n- [x] build renderer");

    const boxes = parse(out).querySelectorAll<HTMLInputElement>(
      'li input[type="checkbox"]',
    );
    expect(boxes).toHaveLength(2);
    // GFM checkbox 渲染為 disabled checkbox（SPEC 渲染管線規格）
    expect(boxes[0].hasAttribute("disabled")).toBe(true);
    expect(boxes[0].hasAttribute("checked")).toBe(false);
    expect(boxes[1].hasAttribute("disabled")).toBe(true);
    expect(boxes[1].hasAttribute("checked")).toBe(true);
  });

  it("test_renderer_render_fencedCodeTs_hasHljsClass", () => {
    const out = render("```ts\nconst n: number = 1;\n```");

    const code = parse(out).querySelector("pre > code");
    expect(code).not.toBeNull();
    // .hljs 讓主題 CSS 選得到；language-ts 來自 fence info string
    expect(code!.classList.contains("hljs")).toBe(true);
    expect(code!.classList.contains("language-ts")).toBe(true);
    // 確認真的高亮過：含 hljs token span，而非整段純文字
    expect(code!.querySelector(".hljs-keyword")).not.toBeNull();
    expect(code!.textContent).toContain("const n: number = 1;");
  });

  it("test_renderer_render_bareUrl_autolinks", () => {
    const out = render("Docs at https://example.com for details");

    const link = parse(out).querySelector("a");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("https://example.com");
    expect(link!.textContent).toBe("https://example.com");
  });

  it("test_renderer_render_emptyString_returnsEmpty", () => {
    expect(render("")).toBe("");
  });

  it("test_renderer_render_mermaid_outputsMermaidContainer", () => {
    const out = render("```mermaid\ngraph TD\n  A --> B\n```");

    const pre = parse(out).querySelector("pre.mermaid");
    expect(pre).not.toBeNull();
    // mermaid container 無 <code> 包裹、無 hljs class — 供 mermaid.js post-render 使用
    expect(pre!.querySelector("code")).toBeNull();
    expect(pre!.classList.contains("hljs")).toBe(false);
    // 原始圖表文字被 escape 保留（含 -->）
    expect(pre!.textContent).toContain("A --> B");
  });

  it("test_renderer_render_unknownLang_fallsBackPlaintext", () => {
    const out = render('```foobar\nlet a = "<b>";\n```');

    const code = parse(out).querySelector("pre > code");
    expect(code).not.toBeNull();
    // fallback：只有 hljs class，不拼未知語言名，也沒有 token span
    expect(code!.getAttribute("class")).toBe("hljs");
    expect(code!.querySelector("span")).toBeNull();
    // 原始碼被 escape 成純文字：<b> 沒有變成元素
    expect(code!.querySelector("b")).toBeNull();
    expect(code!.textContent).toBe('let a = "<b>";\n');
  });

  it("test_renderer_render_scriptTag_stripped", () => {
    const out = render("before\n\n<script>alert(1)</script>\n\nafter");

    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
    // 消毒只剝惡意碼，正常內容保留
    expect(out).toContain("before");
    expect(out).toContain("after");
  });

  it("test_renderer_render_imgOnerror_attributeStripped", () => {
    const out = render('<img src="x" onerror="alert(2)">');

    expect(out).not.toContain("onerror");
    expect(out).not.toContain("alert(2)");
    // img 本身是合法標籤要保留，只剝 event handler 屬性
    const img = parse(out).querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("x");
    expect(img!.getAttribute("onerror")).toBeNull();
  });
});

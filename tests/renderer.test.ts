// Task 2 測試（docs/PLAN.md「Task 2: 渲染管線」測試設計）。
// 測試是 spec：斷言驗證實際輸出 HTML 結構，不只驗「有輸出」。
import { describe, expect, it, vi } from "vitest";
import { render, resolvePath } from "../src/renderer";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost${path.replace(/\\/g, "/")}`,
}));

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

  it("test_renderer_render_frontMatter_strippedFromOutput", () => {
    const out = render("---\ntitle: My Doc\ntags: [a, b]\n---\n\n# Content");

    expect(out).not.toContain("title:");
    expect(out).not.toContain("My Doc");
    expect(out).toContain("Content");
    expect(parse(out).querySelector("h1")).not.toBeNull();
  });

  it("test_renderer_render_footnote_outputsSuperscriptLink", () => {
    const out = render(
      "Text with a footnote[^1].\n\n[^1]: This is the footnote content.",
    );

    const ref = parse(out).querySelector(".footnote-ref a");
    expect(ref).not.toBeNull();
    expect(ref!.getAttribute("href")).toMatch(/^#fn/);
    expect(ref!.closest("sup")).not.toBeNull();
  });

  it("test_renderer_render_footnote_outputsFootnoteSection", () => {
    const out = render(
      "Text[^note].\n\n[^note]: Footnote body here.",
    );

    const section = parse(out).querySelector(".footnotes");
    expect(section).not.toBeNull();
    expect(section!.querySelector(".footnote-item")).not.toBeNull();
    expect(section!.textContent).toContain("Footnote body here");
  });

  it("test_renderer_render_inlineMath_outputsMathInlineAttr", () => {
    const out = render("The equation $E=mc^2$ is famous.");

    const el = parse(out).querySelector("[data-math-inline]");
    expect(el).not.toBeNull();
    expect(el!.tagName).toBe("SPAN");
    expect(el!.textContent).toBe("E=mc^2");
  });

  it("test_renderer_render_blockMath_outputsMathBlockAttr", () => {
    const out = render("$$\n\\sum_{i=1}^{n} i\n$$");

    const el = parse(out).querySelector("[data-math-block]");
    expect(el).not.toBeNull();
    expect(el!.tagName).toBe("DIV");
    expect(el!.textContent).toContain("\\sum_{i=1}^{n} i");
  });

  it("test_renderer_render_mathCodeFence_outputsMathBlockAttr", () => {
    const out = render("```math\nf(x) = x^2\n```");

    const el = parse(out).querySelector("[data-math-block]");
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain("f(x) = x^2");
  });

  it("test_renderer_render_thematicBreak_notEatenByFrontMatter", () => {
    const out = render("---\nSome content after a thematic break");

    expect(out).toContain("Some content");
  });

  it("test_renderer_render_dollarInText_notMisdetectedAsMath", () => {
    const out = render("Prices are $5 and $10 per unit.");

    expect(parse(out).querySelector("[data-math-inline]")).toBeNull();
    expect(out).toContain("$5");
    expect(out).toContain("$10");
  });

  it("test_renderer_render_singleLineDollarDollar_outputsMathBlock", () => {
    const out = render("$$ E = mc^2 $$");

    const el = parse(out).querySelector("[data-math-block]");
    expect(el).not.toBeNull();
    expect(el!.textContent).toBe("E = mc^2");
  });

  it("test_resolvePath", () => {
    expect(resolvePath("/a/b/c.md", "images/01.png")).toBe("/a/b/images/01.png");
    expect(resolvePath("/a/b/c.md", "./images/01.png")).toBe("/a/b/images/01.png");
    expect(resolvePath("/a/b/c.md", "../images/01.png")).toBe("/a/images/01.png");
    expect(resolvePath("C:\\a\\b\\c.md", "images\\01.png")).toBe("C:\\a\\b\\images\\01.png");
    expect(resolvePath("/a/b/c.md", "http://example.com/img.png")).toBe("http://example.com/img.png");
  });

  it("test_renderer_render_relativeImage_forPreview", () => {
    const out = render("![alt](images/02.png)", "/Users/james/doc.md", true);
    const img = parse(out).querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("asset://localhost/Users/james/images/02.png");
  });

  it("test_renderer_render_relativeImage_notForPreview", () => {
    const out = render("![alt](images/02.png)", "/Users/james/doc.md", false);
    const img = parse(out).querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("images/02.png");
  });
});

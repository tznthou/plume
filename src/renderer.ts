// 渲染管線（SPEC「渲染管線規格」）：
// md 字串 → markdown-it.render() → raw HTML → DOMPurify.sanitize() → 安全 HTML
//
// 安全承重牆（SPEC「安全規格」）：Tauri webview 內的 XSS 可呼叫已授權的 IPC API，
// 因此 render() 的最後一步必是 DOMPurify.sanitize()，任何呼叫路徑不可繞過。
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
// markdown-it-front-matter 有 edge case：以 --- 開頭但無閉合 --- 的文件會被整個吃掉。
// 改用 render() 前置 regex 剝除，只處理有效閉合的 YAML block。
// import frontMatter from "markdown-it-front-matter";
import taskLists from "markdown-it-task-lists";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";
import { convertFileSrc } from "@tauri-apps/api/core";

// highlight.js 只註冊 16 語言子集（CLAUDE.md 硬約束：不全量 import、不開自動偵測），
// 控制 bundle 體積與渲染時間。alias（ts/js/sh/html/yml…）由各語言定義自帶。
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("c", c);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("css", css);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("go", go);
hljs.registerLanguage("java", java);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml); // 含 html alias
hljs.registerLanguage("yaml", yaml);

// default preset（含 GFM 表格/刪除線）；html: true 讓 inline HTML 進 parser，
// 安全交給 DOMPurify 把關；linkify: true 提供 GFM 裸網址 autolink。
const md: MarkdownIt = new MarkdownIt("default", {
  html: true,
  linkify: true,
  // 回傳以 <pre 開頭的字串時 markdown-it 直接採用，藉此輸出
  // <pre><code class="hljs ..."> 結構，讓主題 CSS 的 .hljs 選擇器吃得到。
  highlight(code: string, lang: string): string {
    // mermaid：輸出 <pre class="mermaid">，post-render 由 preview.ts 懶載入 mermaid.js 渲染。
    if (lang === "mermaid") {
      return `<pre class="mermaid">${md.utils.escapeHtml(code)}</pre>`;
    }
    if (lang === "math" || lang === "katex") {
      return `<div data-math-block>${md.utils.escapeHtml(code)}</div>`;
    }
    // fence info string 來自文件作者，拼進 class 屬性前必先 escape 防注入。
    if (lang && hljs.getLanguage(lang)) {
      const { value } = hljs.highlight(code, { language: lang, ignoreIllegals: true });
      return `<pre><code class="hljs language-${md.utils.escapeHtml(lang)}">${value}</code></pre>`;
    }
    // 未標注或未知語言：escape 後的 plaintext，不丟 hljs、不開自動偵測。
    return `<pre><code class="hljs">${md.utils.escapeHtml(code)}</code></pre>`;
  },
})
  .use(taskLists)
  .use(footnote);

// --- 數學公式解析（$...$ inline / $$...$$ block）---
// 輸出 placeholder HTML，由 preview.ts 懶載入 KaTeX 渲染（同 mermaid 模式）。

function mathBlockRule(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  const startPos = state.bMarks[startLine] + state.tShift[startLine];
  if (startPos + 2 > state.eMarks[startLine]) return false;
  if (state.src.charCodeAt(startPos) !== 0x24 || state.src.charCodeAt(startPos + 1) !== 0x24)
    return false;

  const startContent = state.src.slice(startPos + 2, state.eMarks[startLine]).trim();
  if (startContent.length > 0 && startContent.endsWith("$$")) {
    // single-line: $$ ... $$
    if (silent) return true;
    const token = state.push("math_block", "div", 0);
    token.content = startContent.slice(0, -2).trim();
    token.map = [startLine, startLine + 1];
    state.line = startLine + 1;
    return true;
  }

  let nextLine = startLine;
  while (++nextLine < endLine) {
    const pos = state.bMarks[nextLine] + state.tShift[nextLine];
    const lineText = state.src.slice(pos, state.eMarks[nextLine]).trim();
    if (lineText === "$$") {
      if (silent) return true;
      const token = state.push("math_block", "div", 0);
      token.content = state.getLines(startLine + 1, nextLine, state.tShift[startLine], false).trim();
      if (startContent.length > 0) token.content = startContent + "\n" + token.content;
      token.map = [startLine, nextLine + 1];
      state.line = nextLine + 1;
      return true;
    }
  }
  return false;
}

function mathInlineRule(state: StateInline, silent: boolean): boolean {
  if (state.src.charCodeAt(state.pos) !== 0x24) return false;
  if (state.src.charCodeAt(state.pos + 1) === 0x24) return false;
  // flanking: $ 前面不能是字母或數字（防 $5 and $10 誤判）
  if (state.pos > 0) {
    const prev = state.src.charCodeAt(state.pos - 1);
    if ((prev >= 0x30 && prev <= 0x39) || (prev >= 0x41 && prev <= 0x5a) || (prev >= 0x61 && prev <= 0x7a))
      return false;
  }

  const start = state.pos + 1;
  let end = start;
  while (end < state.posMax) {
    if (state.src.charCodeAt(end) === 0x24 &&
        (end === start || state.src.charCodeAt(end - 1) !== 0x5c)) break;
    end++;
  }
  if (end >= state.posMax) return false;
  // flanking: $ 後面不能是字母或數字
  if (end + 1 < state.src.length) {
    const next = state.src.charCodeAt(end + 1);
    if ((next >= 0x30 && next <= 0x39) || (next >= 0x41 && next <= 0x5a) || (next >= 0x61 && next <= 0x7a))
      return false;
  }
  const content = state.src.slice(start, end).trim();
  if (content.length === 0) return false;

  if (!silent) {
    const token = state.push("math_inline", "span", 0);
    token.content = content;
  }
  state.pos = end + 1;
  return true;
}

md.block.ruler.before("fence", "math_block", mathBlockRule, {
  alt: ["paragraph", "reference", "blockquote", "list"],
});
md.inline.ruler.after("escape", "math_inline", mathInlineRule);

md.renderer.rules.math_block = (tokens, idx) =>
  `<div data-math-block>${md.utils.escapeHtml(tokens[idx].content)}</div>`;
md.renderer.rules.math_inline = (tokens, idx) =>
  `<span data-math-inline>${md.utils.escapeHtml(tokens[idx].content)}</span>`;

export function resolvePath(basePath: string, relativePath: string): string {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(relativePath) || relativePath.startsWith("/") || /^[a-zA-Z]:[/\\]/.test(relativePath)) {
    return relativePath;
  }
  const lastSlash = Math.max(basePath.lastIndexOf("/"), basePath.lastIndexOf("\\"));
  if (lastSlash === -1) {
    return relativePath;
  }
  const dir = basePath.slice(0, lastSlash);
  const isWindows = basePath.includes("\\");
  const separator = isWindows ? "\\" : "/";
  const dirParts = dir.split(/[/\\]/);
  const relParts = relativePath.split(/[/\\]/);
  for (const part of relParts) {
    if (part === "." || part === "") {
      continue;
    }
    if (part === "..") {
      const isRoot = dirParts.length === 1 && (dirParts[0] === "" || /^[a-zA-Z]:$/.test(dirParts[0]));
      if (isRoot) {
        continue;
      } else if (dirParts.length > 0 && dirParts[dirParts.length - 1] !== "..") {
        dirParts.pop();
      } else {
        dirParts.push("..");
      }
    } else {
      dirParts.push(part);
    }
  }
  return dirParts.join(separator);
}

const defaultImageRender = md.renderer.rules.image || function (tokens, idx, options, _env, self) {
  return self.renderToken(tokens, idx, options);
};

md.renderer.rules.image = function (tokens, idx, options, env, self) {
  const token = tokens[idx];
  const srcIdx = token.attrIndex("src");
  if (srcIdx >= 0 && token.attrs && env && env.docPath) {
    const rawSrc = token.attrs[srcIdx][1];
    token.attrSet("data-original-src", rawSrc);
    const resolvedPath = resolvePath(env.docPath, rawSrc);
    if (env.forPreview && resolvedPath && (resolvedPath.startsWith("/") || /^[a-zA-Z]:[/\\]/.test(resolvedPath))) {
      try {
        token.attrs[srcIdx][1] = convertFileSrc(resolvedPath);
      } catch (err) {
        console.warn("[renderer] convertFileSrc failed", err);
      }
    }
  }
  return defaultImageRender(tokens, idx, options, env, self);
};

/**
 * 將 Markdown 渲染為可直接放入預覽區 innerHTML 的安全 HTML。
 */
const FRONT_MATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

export function render(source: string, docPath?: string | null, forPreview: boolean = true): string {
  const env = { docPath, forPreview };
  return DOMPurify.sanitize(md.render(source.replace(FRONT_MATTER_RE, ""), env), {
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|asset):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  });
}

/**
 * 轉義純文字以便安全插入 HTML 屬性/標籤內容（如匯出 HTML 的 <title>）。
 * 複用 markdown-it 的 escapeHtml，使全專案的 HTML 轉義走單一實作。
 */
export function escapeHtml(text: string): string {
  return md.utils.escapeHtml(text);
}

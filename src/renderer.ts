// 渲染管線（SPEC「渲染管線規格」）：
// md 字串 → markdown-it.render() → raw HTML → DOMPurify.sanitize() → 安全 HTML
//
// 安全承重牆（SPEC「安全規格」）：Tauri webview 內的 XSS 可呼叫已授權的 IPC API，
// 因此 render() 的最後一步必是 DOMPurify.sanitize()，任何呼叫路徑不可繞過。
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";

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
    // fence info string 來自文件作者，拼進 class 屬性前必先 escape 防注入。
    if (lang && hljs.getLanguage(lang)) {
      const { value } = hljs.highlight(code, { language: lang, ignoreIllegals: true });
      return `<pre><code class="hljs language-${md.utils.escapeHtml(lang)}">${value}</code></pre>`;
    }
    // 未標注或未知語言：escape 後的 plaintext，不丟 hljs、不開自動偵測。
    return `<pre><code class="hljs">${md.utils.escapeHtml(code)}</code></pre>`;
  },
}).use(taskLists); // GFM checkbox，預設渲染為 disabled checkbox

/**
 * 將 Markdown 渲染為可直接放入預覽區 innerHTML 的安全 HTML。
 * 純函式：相同輸入恆得相同輸出，無 IPC、無副作用。
 */
export function render(source: string): string {
  return DOMPurify.sanitize(md.render(source));
}

/**
 * 轉義純文字以便安全插入 HTML 屬性/標籤內容（如匯出 HTML 的 <title>）。
 * 複用 markdown-it 的 escapeHtml，使全專案的 HTML 轉義走單一實作。
 */
export function escapeHtml(text: string): string {
  return md.utils.escapeHtml(text);
}

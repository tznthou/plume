// L0 宣告式外掛的模板轉譯契約測試（docs/proposals/plugin-l0-declarative.md §4）。
//
// 提案尚未實作。本檔的參考實作就是提案 §4 的可執行規格——提案裡每條關於
// 逸出與 tabstop 編號的斷言，在這裡都有一個會紅的測試撐著。定案併入
// src/plugins.ts 時，把 REFERENCE IMPLEMENTATION 整段搬過去，測試留在原地。
//
// 測試對象有二：
//   1. @codemirror/autocomplete 的 snippet() 行為契約。提案的地基是「模板引擎
//      不自己寫」，所以 CM6 改行為等於提案的前提變了，要在這裡先紅。
//   2. 參考實作的逸出與轉譯。守兩件事：使用者選取的文字不被 CM6 吃掉、
//      tabstop 編號不與模板作者手寫的內容撞號。
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { snippet, snippetKeymap } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";

// ---------------------------------------------------------------------------
// 測試工具：跑一次真實的 snippet()，回傳插入後的文件與初始選取範圍
// ---------------------------------------------------------------------------

function applySnippet(template: string): { text: string; ranges: [number, number][] } {
  // 對齊真實環境：src/editor.ts 用 basicSetup，而 basicSetup 內含
  // allowMultipleSelections.of(true)。少了它，撞號時的多重選取會被靜默截成一個，
  // 測試就看不到真正的危害。
  const state = EditorState.create({
    doc: "",
    extensions: [EditorState.allowMultipleSelections.of(true)],
  });
  let tr: { state: EditorState } | null = null;
  snippet(template)({ state, dispatch: (t: unknown) => (tr = t as { state: EditorState }) }, null, 0, 0);
  if (!tr) throw new Error("snippet() 未 dispatch");
  const next = (tr as { state: EditorState }).state;
  return {
    text: next.doc.toString(),
    ranges: next.selection.ranges.map((r) => [r.from, r.to] as [number, number]),
  };
}

// ---------------------------------------------------------------------------
// REFERENCE IMPLEMENTATION —— 提案 §4 的規格，定案後搬進 src/plugins.ts
// ---------------------------------------------------------------------------

/** §4.1：變數展開值一律逸出，讓它在 CM6 snippet parser 下字面還原。 */
export function escapeExpansion(raw: string): string {
  // 先護住 `{`/`}` 前的反斜線（CM6 會吃掉一層），再讓 `${`/`#{` 失去 field 語義。
  return raw.replace(/\\(?=[{}])/g, "\\\\").replace(/([#$])\{/g, "$1\\{");
}

/** §4.1 支援的變數；`cursor` 另行處理，不在此表。 */
export type TemplateVars = {
  selection: string;
  filename: string;
  date: string;
  time: string;
  datetime: string;
};

const KNOWN_VARS = ["selection", "filename", "date", "time", "datetime"] as const;
const MAX_CURSORS = 16;
const MAX_TEMPLATE = 4096;

/** §5.2：驗證模板。回傳錯誤訊息，通過則回傳 null。 */
export function validateTemplate(template: string): string | null {
  if (template.length < 1 || template.length > MAX_TEMPLATE) {
    return `template 長度須在 1..=${MAX_TEMPLATE}`;
  }
  // §4.3：模板不得含原始 CM6 field 語法，tabstop 的唯一來源是 {{cursor}}。
  if (/[#$]\{/.test(template)) {
    return "template 不可含 `${` 或 `#{`；tabstop 請用 {{cursor}}";
  }
  let cursors = 0;
  for (const m of template.matchAll(/\{\{([^}]*)\}\}/g)) {
    const body = m[1];
    const colon = body.indexOf(":");
    const name = colon === -1 ? body : body.slice(0, colon);
    const arg = colon === -1 ? null : body.slice(colon + 1);
    if (name === "cursor") {
      // §4.2：CM6 的 default text regex 是 [^{}]*，含大括號會讓整個 field
      // 靜默失效、字面輸出到文件裡。偵測即拒絕。
      if (arg !== null && /[{}]/.test(arg)) {
        return "{{cursor:...}} 的預設文字不可含大括號";
      }
      if (++cursors > MAX_CURSORS) return `{{cursor}} 數量上限 ${MAX_CURSORS}`;
      continue;
    }
    if (name === "date" && arg !== null) {
      if (!/^[YMDHms:\-/. ]+$/.test(arg)) return `不支援的日期格式：${arg}`;
      continue;
    }
    if (arg !== null) return `變數 ${name} 不接受參數`;
    if (!(KNOWN_VARS as readonly string[]).includes(name)) {
      // §5.2 第 6 條：未知變數拒絕而非忽略。
      return `未知變數：{{${name}}}`;
    }
  }
  return null;
}

/**
 * §4.2：把模板轉譯成 CM6 snippet 字串。
 * 前 n-1 個 {{cursor}} 依序成為 ${1}..${n-1}，最後一個成為 ${0}（CM6 的
 * 最終游標位置）。變數展開值一律過 escapeExpansion。
 */
export function translateTemplate(template: string, vars: TemplateVars): string {
  const total = [...template.matchAll(/\{\{cursor(?::[^}]*)?\}\}/g)].length;
  let seen = 0;
  return template.replace(/\{\{([^}]*)\}\}/g, (_all, body: string) => {
    const colon = body.indexOf(":");
    const name = colon === -1 ? body : body.slice(0, colon);
    const arg = colon === -1 ? null : body.slice(colon + 1);
    if (name === "cursor") {
      seen += 1;
      const seq = seen === total ? 0 : seen;
      return arg === null ? `\${${seq}}` : `\${${seq}:${arg}}`;
    }
    if (name === "date" && arg !== null) return escapeExpansion(vars.date);
    return escapeExpansion(vars[name as keyof TemplateVars] ?? "");
  });
}

// ---------------------------------------------------------------------------

const VARS: TemplateVars = {
  selection: "",
  filename: "note.md",
  date: "2026-08-06",
  time: "09:30:00",
  datetime: "2026-08-06 09:30:00",
};

describe("CM6 snippet() 行為契約（提案的地基，升版改行為要在這裡先紅）", () => {
  it("${0} 是最終游標位置，排在所有 tabstop 之後", () => {
    // CM6 6.20.3 的 Snippet.parse 有 `if (seq === 0) seq = 1e9`。
    const { text, ranges } = applySnippet("a${0}b${1}c");
    expect(text).toBe("abc");
    // 初始停在第一個 field，也就是 ${1} 的位置（b 之後），不是 ${0}。
    expect(ranges).toEqual([[2, 2]]);
  });

  it("`\\${` 不是有效逸出——反斜線留著，${...} 照樣被吃掉", () => {
    // 這是提案原稿寫錯的地方，留一個測試釘住反例。
    expect(applySnippet("literal \\${0} here").text).toBe("literal \\ here");
  });

  it("`$\\{` 才是有效逸出", () => {
    expect(applySnippet("literal $\\{0} here").text).toBe("literal ${0} here");
  });

  it("預設文字含大括號會讓整個 field 靜默失效、字面輸出", () => {
    // CM6 的 default text regex 是 [^{}]*，所以 ${1:a{b}} 完全不被解析。
    expect(applySnippet("x${1:a{b}}y").text).toBe("x${1:a{b}}y");
  });

  it("沒有 $/# 前綴的大括號不受影響", () => {
    const src = "function() {}\n{{ handlebars }}";
    expect(applySnippet(src).text).toBe(src);
  });

  it("相同編號的 field 會合併，兩處同時被選取", () => {
    // 這是「模板作者手寫 ${1} 會跟 {{cursor}} 撞號」的機制證據，
    // 也是 validateTemplate 拒絕原始 ${ 的理由：使用者打一次字，兩處一起被改。
    const { text, ranges } = applySnippet("${1:author}-${1:translated}");
    expect(text).toBe("author-translated");
    expect(ranges).toEqual([
      [0, 6],
      [7, 17],
    ]);
  });
});

describe("Tab 導航不需要我們註冊 keymap", () => {
  // basicSetup 確實不含 snippetKeymap（它只 import closeBracketsKeymap /
  // completionKeymap），但這不代表要自己掛：snippet() 在插入時會用
  // StateEffect.appendConfig 動態注入 snippetState + addSnippetKeymap。
  // 提案 §4.2 說「Tab 導航由 CM6 提供，我們不實作」靠的是這個機制，
  // 所以這裡用真實 EditorView 驗一次，而不是相信任何一方的說法。
  function mount(doc: string) {
    return new EditorView({
      state: EditorState.create({ doc, extensions: [basicSetup] }),
      parent: document.body,
    });
  }

  function pressTab(view: EditorView) {
    // 走真實的 keydown 路徑。直接呼叫 binding 的 run() 會繞過 keymap 註冊，
    // 那樣測不出 extension 到底有沒有進 state。
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", code: "Tab", keyCode: 9, bubbles: true, cancelable: true }),
    );
    return view.state.selection.main.from;
  }

  it("basicSetup 本身不含 snippetKeymap，Tab 不會移動游標（對照組）", () => {
    // 沒有這組，下面那個 PASS 可能只是因為 Tab 本來就會做點什麼。
    const view = mount("abc");
    view.dispatch({ selection: { anchor: 1 } });
    expect(pressTab(view)).toBe(1);
    view.destroy();
  });

  it("插入模板後 Tab 跳到下一個 tabstop——snippet() 自行注入了 keymap", () => {
    const view = mount("");
    snippet("a${1}b${2}c${0}")(view, null, 0, 0);
    expect(view.state.selection.main.from).toBe(1); // 停在 ${1}
    expect(pressTab(view)).toBe(2); // Tab → ${2}
    expect(pressTab(view)).toBe(3); // Tab → ${0}
    view.destroy();
  });

  it("facet 查詢本身沒有鑑別力，不能拿來當註冊證據", () => {
    // snippetKeymap 的 combine 是 `maps.length ? maps[0] : defaultSnippetKeymap`，
    // 所以連一個沒插入過 snippet 的 editor 都查得到 Tab binding。
    const view = mount("abc");
    expect(view.state.facet(snippetKeymap).some((b) => b.key === "Tab")).toBe(true);
    view.destroy();
  });
});

describe("escapeExpansion：使用者的文字不能被 CM6 吃掉", () => {
  // 全是 Markdown 筆記裡的日常內容，不是邊緣案例。
  const samples = [
    ["shell 變數", "deploy to ${ENV}"],
    ["shell 變數含預設值", "${HOME:-/root}"],
    ["JS 模板字串", "`hello ${name}`"],
    ["GitHub Actions", "${{ github.sha }}"],
    ["Ruby 字串插值", "#{user.name}"],
    ["反斜線接大括號", "C:\\{weird}"],
    ["連續反斜線", "a\\\\{b"],
    ["純大括號", "plain {braces} ok"],
    // 以下把 escapeExpansion 當攻擊目標：刻意讓輸入長得像「已經逸出過」。
    ["原文就長得像逸出", "$\\{not a field}"],
    ["雙錢字號", "$${nested}"],
    ["反斜線在錢字號前", "\\${escaped}"],
    ["井字號版本", "#\\{ruby}"],
    ["連續 field 開頭", "${${double}"],
  ] as const;

  it.each(samples)("%s 原樣還原", (_label, raw) => {
    expect(applySnippet("> " + escapeExpansion(raw)).text).toBe("> " + raw);
  });

  it("對照組：不逸出就會被竄改", () => {
    // 沒有這組，上面的 PASS 可能只是因為那些字串本來就無害。
    expect(applySnippet("> deploy to ${ENV}").text).toBe("> deploy to ENV");
    expect(applySnippet("> `hello ${name}`").text).toBe("> `hello name`");
    expect(applySnippet("> C:\\{weird}").text).toBe("> C:{weird}");
  });
});

describe("translateTemplate：tabstop 編號", () => {
  it("單一 {{cursor}} 轉成 ${0}", () => {
    expect(translateTemplate("a{{cursor}}b", VARS)).toBe("a${0}b");
  });

  it("多個 {{cursor}} 依序 ${1}..${n-1}，最後一個是 ${0}", () => {
    expect(translateTemplate("{{cursor}}a{{cursor}}b{{cursor}}", VARS)).toBe("${1}a${2}b${0}");
  });

  it("{{cursor:預設文字}} 帶進 default text", () => {
    expect(translateTemplate("{{cursor:標題}}x{{cursor}}", VARS)).toBe("${1:標題}x${0}");
  });

  it("唯一的 {{cursor}} 帶預設文字時是 ${0:...}，仍會被選取", () => {
    // §7「引用當前選取」就是這個形狀，${0} 帶 default text 是合法組合。
    const out = translateTemplate("{{cursor:出處}}", VARS);
    expect(out).toBe("${0:出處}");
    const { text, ranges } = applySnippet(out);
    expect(text).toBe("出處");
    expect(ranges).toEqual([[0, 2]]);
  });

  it("提案 §7 的 frontmatter 範例，Tab 順序正確", () => {
    const tpl = "---\ntitle: {{cursor:標題}}\ndate: {{date}}\ntags: []\n---\n\n{{cursor}}";
    const out = translateTemplate(tpl, VARS);
    expect(out).toBe("---\ntitle: ${1:標題}\ndate: 2026-08-06\ntags: []\n---\n\n${0}");
    const { text, ranges } = applySnippet(out);
    expect(text).toBe("---\ntitle: 標題\ndate: 2026-08-06\ntags: []\n---\n\n");
    // 初始選取落在「標題」上，使用者可直接覆寫。
    expect(ranges).toEqual([[11, 13]]);
  });

  it("選取內容含 ${...} 時，引用外掛不竄改它", () => {
    const vars = { ...VARS, selection: "run ${CMD} twice" };
    const out = translateTemplate("> {{selection}}\n>\n> — {{cursor:出處}}", vars);
    expect(applySnippet(out).text).toBe("> run ${CMD} twice\n>\n> — 出處");
  });
});

describe("validateTemplate：偵測即拒絕", () => {
  it("接受合法模板", () => {
    expect(validateTemplate("# {{date}}\n\n{{cursor}}")).toBeNull();
    expect(validateTemplate("```{{cursor:語言}}\n{{selection}}\n```\n{{cursor}}")).toBeNull();
  });

  it("拒絕原始 CM6 field 語法", () => {
    expect(validateTemplate("**{{selection}}**${0}")).toMatch(/tabstop 請用/);
    expect(validateTemplate("#{oops}")).toMatch(/tabstop 請用/);
  });

  it("拒絕未知變數而非忽略", () => {
    expect(validateTemplate("{{clipbaord}}")).toMatch(/未知變數/);
  });

  it("拒絕預設文字含大括號", () => {
    expect(validateTemplate("{{cursor:a{b}}}")).toMatch(/不可含大括號/);
  });

  it("拒絕不接受參數的變數帶參數", () => {
    expect(validateTemplate("{{selection:x}}")).toMatch(/不接受參數/);
  });

  it("拒絕超量 {{cursor}}", () => {
    expect(validateTemplate("{{cursor}}".repeat(17))).toMatch(/數量上限/);
  });

  it("拒絕空模板與超長模板", () => {
    expect(validateTemplate("")).toMatch(/長度/);
    expect(validateTemplate("x".repeat(4097))).toMatch(/長度/);
  });
});

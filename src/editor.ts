// 封裝 CM6：行號、markdown 語法、變更通知（SPEC「模組職責」）。
// 編輯內容唯一真相來源是 EditorState，讀取一律走 getContent()，不另存字串副本。
import { basicSetup, EditorView } from "codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting } from "@codemirror/language";
import { Compartment, type Extension } from "@codemirror/state";
import { classHighlighter } from "@lezer/highlight";

const typewriterComp = new Compartment();
const focusComp = new Compartment();

let view: EditorView | null = null;
const changeListeners: Array<() => void> = [];

export function initEditor(parent: HTMLElement): void {
  view = new EditorView({
    parent,
    extensions: [
      basicSetup,
      markdown({ base: markdownLanguage }),
      // 語法 token 輸出 .tok-* class，色彩全交 CSS 主題變數（style.css 的 #editor .tok-*
      // 以 ID specificity 蓋過 basicSetup 內建 defaultHighlightStyle 的單 class 規則）
      syntaxHighlighting(classHighlighter),
      EditorView.lineWrapping,
      typewriterComp.of([]),
      focusComp.of([]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          for (const cb of changeListeners) cb();
        }
      }),
    ],
  });
}

export function getContent(): string {
  return view!.state.doc.toString();
}

export function getLineCount(): number {
  return view!.state.doc.lines; // O(1)，狀態列用
}

// 編輯區真正的捲動容器（.cm-scroller），供 preview 同步捲動監聽（Task 5）。
export function getScrollDOM(): HTMLElement {
  return view!.scrollDOM;
}

export function setContent(text: string): void {
  view!.dispatch({
    changes: { from: 0, to: view!.state.doc.length, insert: text },
    // 開檔/新檔帶回開頭：不置頂的話會沿用前一檔的捲動量，換內容時 .cm-scroller 被
    // clamp 觸發 scroll 事件 → 預覽同步捲動的 ratio 失真成 ~1，把預覽推到文件底
    // （開檔後預覽跳到尾端的根因）。scrollIntoView 置頂後 ratio=0，預覽同步回頂。
    selection: { anchor: 0 },
    scrollIntoView: true,
  });
}

export function remeasure(): void {
  view!.requestMeasure();
}

export function reconfigureTypewriter(ext: Extension): void {
  view!.dispatch({ effects: typewriterComp.reconfigure(ext) });
}

export function reconfigureFocus(ext: Extension): void {
  view!.dispatch({ effects: focusComp.reconfigure(ext) });
}

export function onChange(cb: () => void): void {
  changeListeners.push(cb);
}

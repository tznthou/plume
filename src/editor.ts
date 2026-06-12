// 封裝 CM6：行號、markdown 語法、變更通知（SPEC「模組職責」）。
// 編輯內容唯一真相來源是 EditorState，讀取一律走 getContent()，不另存字串副本。
import { basicSetup, EditorView } from "codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting } from "@codemirror/language";
import { classHighlighter } from "@lezer/highlight";

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
  });
}

export function onChange(cb: () => void): void {
  changeListeners.push(cb);
}

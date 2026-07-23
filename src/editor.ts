// 封裝 CM6：行號、markdown 語法、變更通知（SPEC「模組職責」）。
// 編輯內容唯一真相來源是 EditorState，讀取一律走 getContent()，不另存字串副本。
import { basicSetup, EditorView } from "codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { classHighlighter } from "@lezer/highlight";

const typewriterComp = new Compartment();
const focusComp = new Compartment();

let view: EditorView | null = null;
const changeListeners: Array<() => void> = [];
let baseExtensions: Extension[] = [];

export function initEditor(parent: HTMLElement): void {
  baseExtensions = [
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
  ];
  view = new EditorView({
    parent,
    extensions: baseExtensions,
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

export function getEditorState(): EditorState {
  return view!.state;
}

export function restoreEditorState(state: EditorState): void {
  view!.setState(state);
  // setState() 不觸發 updateListener（無 transaction → docChanged=false），
  // 手動通知讓 preview/TOC/stats 重算。
  for (const cb of changeListeners) cb();
}

export function createEditorState(doc: string = ""): EditorState {
  return EditorState.create({ doc, extensions: baseExtensions });
}

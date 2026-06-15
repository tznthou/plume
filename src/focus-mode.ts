import { EditorView, Decoration, type DecorationSet } from "@codemirror/view";
import { StateField, type Extension, type EditorState, type Text } from "@codemirror/state";

const focusLineDecoration = Decoration.line({ class: "cm-line-focus" });

export function findParagraphLines(doc: Text, pos: number): number[] {
  const cursorLine = doc.lineAt(pos);
  if (cursorLine.text.trim() === "") return [cursorLine.from];

  let startNum = cursorLine.number;
  let endNum = cursorLine.number;

  while (startNum > 1 && doc.line(startNum - 1).text.trim() !== "") startNum--;
  while (endNum < doc.lines && doc.line(endNum + 1).text.trim() !== "") endNum++;

  const result: number[] = [];
  for (let i = startNum; i <= endNum; i++) result.push(doc.line(i).from);
  return result;
}

function buildDecorations(state: EditorState): DecorationSet {
  const lines = findParagraphLines(state.doc, state.selection.main.head);
  return Decoration.set(lines.map((pos) => focusLineDecoration.range(pos)));
}

const focusField = StateField.define<DecorationSet>({
  create: buildDecorations,
  update(value, tr) {
    const oldHead = tr.startState.selection.main.head;
    const newHead = tr.state.selection.main.head;
    if (tr.docChanged || oldHead !== newHead) return buildDecorations(tr.state);
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function focusExtension(): Extension {
  return [EditorView.editorAttributes.of({ class: "cm-focus-mode" }), focusField];
}

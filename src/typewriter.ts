import { EditorView, scrollPastEnd } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

export function typewriterExtension(): Extension {
  let scheduled = false;
  return [
    scrollPastEnd(),
    EditorView.updateListener.of((update) => {
      if ((!update.selectionSet && !update.docChanged) || scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        const head = update.view.state.selection.main.head;
        update.view.dispatch({
          effects: EditorView.scrollIntoView(head, { y: "center" }),
        });
      });
    }),
  ];
}

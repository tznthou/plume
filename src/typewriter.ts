import { EditorView, scrollPastEnd } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

export function typewriterExtension(): Extension {
  let scheduled = false;
  return [
    scrollPastEnd(),
    EditorView.editorAttributes.of({ class: "cm-typewriter" }),
    EditorView.updateListener.of((update) => {
      if ((!update.selectionSet && !update.docChanged) || scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        const head = update.view.state.selection.main.head;
        const coords = update.view.coordsAtPos(head);
        if (!coords) return;
        const scroller = update.view.scrollDOM;
        const rect = scroller.getBoundingClientRect();
        const delta = coords.top - rect.top - rect.height / 2;
        if (Math.abs(delta) > 2) {
          scroller.scrollBy({ top: delta });
        }
      });
    }),
  ];
}

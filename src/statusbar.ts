// 狀態列純呈現：字數/行數/渲染耗時 + dirty 指示（03 指針垂落、05 硃砂印實印，
// 形態由 style.css 依 data-theme 決定，這裡只切 class 與文字）。
import { t } from "./i18n";

interface StatElements {
  chars: HTMLElement;
  lines: HTMLElement;
  ms: HTMLElement;
  indicator: HTMLElement;
  saveText: HTMLElement;
}

let els: StatElements | null = null;

export function initStatusbar(root: ParentNode = document): void {
  els = {
    chars: root.querySelector<HTMLElement>("#stat-chars")!,
    lines: root.querySelector<HTMLElement>("#stat-lines")!,
    ms: root.querySelector<HTMLElement>("#stat-ms")!,
    indicator: root.querySelector<HTMLElement>("#dirty-indicator")!,
    saveText: root.querySelector<HTMLElement>("#save-text")!,
  };
}

export function updateStats(stats: { chars: number; lines: number; ms: number }): void {
  if (!els) return;
  els.chars.textContent = String(stats.chars);
  els.lines.textContent = String(stats.lines);
  els.ms.textContent = String(stats.ms);
}

export function setDirty(dirty: boolean): void {
  if (!els) return;
  els.indicator.classList.toggle("dirty", dirty);
  els.indicator.classList.toggle("saved", !dirty);
  els.saveText.textContent = dirty ? t("ui.unsaved") : t("ui.saved");
}

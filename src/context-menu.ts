import { t } from "./i18n";

let menuEl: HTMLElement | null = null;
let savedRange: Range | null = null;
let savedActiveElement: Element | null = null;

interface MenuItem {
  label: string;
  shortcut: string;
  action: () => void;
  disabled: boolean;
}

function hasSelection(): boolean {
  const sel = window.getSelection();
  return sel !== null && !sel.isCollapsed;
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.closest(".cm-editor") !== null ||
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  );
}

function saveSelection(): void {
  savedActiveElement = document.activeElement;
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    savedRange = sel.getRangeAt(0).cloneRange();
  } else {
    savedRange = null;
  }
}

function restoreSelection(): void {
  if (savedRange) {
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(savedRange);
  }
  if (savedActiveElement instanceof HTMLElement) {
    savedActiveElement.focus();
  }
}

function buildMenu(): HTMLElement {
  const el = document.createElement("div");
  el.className = "context-menu";
  el.setAttribute("role", "menu");
  document.body.appendChild(el);
  return el;
}

function show(x: number, y: number, items: MenuItem[]): void {
  if (!menuEl) menuEl = buildMenu();
  menuEl.innerHTML = "";

  for (const item of items) {
    const btn = document.createElement("button");
    btn.className = "context-menu-item";
    btn.setAttribute("role", "menuitem");
    btn.tabIndex = -1;
    btn.disabled = item.disabled;

    const labelSpan = document.createElement("span");
    labelSpan.textContent = item.label;
    const shortcutSpan = document.createElement("span");
    shortcutSpan.className = "context-menu-shortcut";
    shortcutSpan.textContent = item.shortcut;
    btn.appendChild(labelSpan);
    btn.appendChild(shortcutSpan);

    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => {
      hide();
      restoreSelection();
      item.action();
    });
    menuEl.appendChild(btn);
  }

  menuEl.style.left = `${x}px`;
  menuEl.style.top = `${y}px`;
  menuEl.classList.add("visible");

  requestAnimationFrame(() => {
    if (!menuEl) return;
    const rect = menuEl.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menuEl.style.left = `${window.innerWidth - rect.width - 4}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menuEl.style.top = `${window.innerHeight - rect.height - 4}px`;
    }
  });
}

function hide(): void {
  menuEl?.classList.remove("visible");
}

const MOD = navigator.platform.includes("Mac") ? "⌘" : "Ctrl+";

export function initContextMenu(): void {
  document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    saveSelection();

    const editable = isEditable(e.target);
    const selected = hasSelection();
    const items: MenuItem[] = [];

    if (editable) {
      items.push({
        label: t("menu.cut"),
        shortcut: `${MOD}X`,
        action: () => document.execCommand("cut"),
        disabled: !selected,
      });
    }

    items.push({
      label: t("menu.copy"),
      shortcut: `${MOD}C`,
      action: () => document.execCommand("copy"),
      disabled: !selected,
    });

    if (editable) {
      items.push({
        label: t("menu.paste"),
        shortcut: `${MOD}V`,
        action: () => document.execCommand("paste"),
        disabled: false,
      });
    }

    items.push({
      label: t("menu.selectAll"),
      shortcut: `${MOD}A`,
      action: () => document.execCommand("selectAll"),
      disabled: false,
    });

    show(e.clientX, e.clientY, items);
  });

  document.addEventListener("mousedown", (e) => {
    if (menuEl && !menuEl.contains(e.target as Node)) hide();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });

  window.addEventListener("blur", hide);
}

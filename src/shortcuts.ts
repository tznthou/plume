import { t } from "./i18n";

const isMac = navigator.platform.startsWith("Mac");

function getGroups() {
  const MOD = isMac ? "⌘" : "Ctrl+";
  const SHIFT = isMac ? "⇧" : "Shift+";
  return [
    { title: t("shortcuts.fileGroup"), items: [
      [`${MOD}N`, t("shortcuts.newFile")],
      [`${MOD}O`, t("shortcuts.openFile")],
      [`${MOD}S`, t("shortcuts.save")],
      [`${MOD}${SHIFT}S`, t("shortcuts.saveAs")],
      [`${MOD}P`, t("shortcuts.exportPdf")],
    ]},
    { title: t("shortcuts.tabGroup"), items: [
      [`${MOD}${SHIFT}[`, t("menu.prevTab")],
      [`${MOD}${SHIFT}]`, t("menu.nextTab")],
      [`${MOD}W`, t("menu.closeTab")],
    ]},
    { title: t("shortcuts.viewGroup"), items: [
      [`${MOD}E`, t("shortcuts.toggleEditRead")],
      [`${MOD}${SHIFT}F`, t("menu.focusMode")],
      [`${MOD}T`, t("menu.typewriterMode")],
    ]},
    { title: t("shortcuts.fontGroup"), items: [
      [`${MOD}=`, t("shortcuts.increaseFont")],
      [`${MOD}-`, t("shortcuts.decreaseFont")],
      [`${MOD}0`, t("shortcuts.resetFont")],
    ]},
    { title: t("shortcuts.toolsGroup"), items: [
      [`${MOD}${SHIFT}C`, t("shortcuts.copyHtml")],
      ["Esc", t("shortcuts.exitFullscreen")],
      [`${MOD}/`, t("shortcuts.shortcutsTip")],
    ]},
  ];
}

let overlay: HTMLElement | null = null;
let hideAbort: AbortController | null = null;
let prevFocus: HTMLElement | null = null;

function build(): HTMLElement {
  const el = document.createElement("div");
  el.className = "shortcuts-overlay";
  el.addEventListener("click", (e) => {
    if (e.target === el) hide();
  });

  const card = document.createElement("div");
  card.className = "shortcuts-card";
  // 視窗矮到面板溢出時 card 會變捲動容器；不可聚焦的話鍵盤使用者到不了被捲掉的那幾組
  card.tabIndex = -1;

  const heading = document.createElement("h2");
  heading.textContent = t("shortcuts.overlayTitle");
  card.appendChild(heading);

  const grid = document.createElement("div");
  grid.className = "shortcuts-grid";

  for (const group of getGroups()) {
    const section = document.createElement("section");
    const h3 = document.createElement("h3");
    h3.textContent = group.title;
    section.appendChild(h3);

    const dl = document.createElement("dl");
    for (const [key, desc] of group.items) {
      const row = document.createElement("div");
      const dt = document.createElement("dt");
      const kbd = document.createElement("kbd");
      kbd.textContent = key;
      dt.appendChild(kbd);
      const dd = document.createElement("dd");
      dd.textContent = desc;
      row.append(dt, dd);
      dl.appendChild(row);
    }
    section.appendChild(dl);
    grid.appendChild(section);
  }

  card.appendChild(grid);
  el.appendChild(card);
  return el;
}

function show(): void {
  hideAbort?.abort();
  hideAbort = null;
  if (!overlay) {
    overlay = build();
    document.body.appendChild(overlay);
  }
  prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  overlay.hidden = false;
  overlay.querySelector<HTMLElement>(".shortcuts-card")?.focus();
  requestAnimationFrame(() => overlay!.classList.add("visible"));
}

function hide(): void {
  if (!overlay) return;
  // 焦點交還原處（通常是編輯器），否則看完快捷鍵得重新點一次才能打字
  prevFocus?.focus();
  prevFocus = null;
  hideAbort?.abort();
  const ac = new AbortController();
  hideAbort = ac;
  overlay.classList.remove("visible");
  const done = () => {
    ac.abort();
    overlay!.hidden = true;
    hideAbort = null;
  };
  const style = getComputedStyle(overlay);
  const dur = parseFloat(style.transitionDuration || "0");
  if (dur <= 0) {
    done();
  } else {
    overlay.addEventListener("transitionend", done, { once: true, signal: ac.signal });
    setTimeout(() => { if (hideAbort === ac) done(); }, dur * 1000 + 100);
  }
}

export function toggleShortcuts(): void {
  if (overlay && !overlay.hidden) hide();
  else show();
}

export function hideShortcuts(): boolean {
  if (!overlay || overlay.hidden) return false;
  hide();
  return true;
}

export function clearShortcutsOverlay(): void {
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
  prevFocus = null;
}

const isMac = navigator.platform.startsWith("Mac");
const MOD = isMac ? "⌘" : "Ctrl+";
const SHIFT = isMac ? "⇧" : "Shift+";

const GROUPS = [
  { title: "檔案", items: [
    [`${MOD}N`, "新增檔案"],
    [`${MOD}O`, "開啟檔案"],
    [`${MOD}S`, "儲存"],
    [`${MOD}${SHIFT}S`, "另存新檔"],
    [`${MOD}P`, "匯出 PDF"],
  ]},
  { title: "檢視", items: [
    [`${MOD}E`, "切換編輯／閱讀"],
    [`${MOD}${SHIFT}F`, "Focus Mode"],
    [`${MOD}T`, "Typewriter Mode"],
  ]},
  { title: "字型", items: [
    [`${MOD}=`, "放大字型"],
    [`${MOD}-`, "縮小字型"],
    [`${MOD}0`, "重設字型大小"],
  ]},
  { title: "工具", items: [
    [`${MOD}${SHIFT}C`, "複製為 HTML"],
    ["Esc", "退出全螢幕"],
    [`${MOD}/`, "快捷鍵提示"],
  ]},
];

let overlay: HTMLElement | null = null;
let hideAbort: AbortController | null = null;

function build(): HTMLElement {
  const el = document.createElement("div");
  el.className = "shortcuts-overlay";
  el.addEventListener("click", (e) => {
    if (e.target === el) hide();
  });

  const card = document.createElement("div");
  card.className = "shortcuts-card";

  const heading = document.createElement("h2");
  heading.textContent = "Keyboard Shortcuts";
  card.appendChild(heading);

  const grid = document.createElement("div");
  grid.className = "shortcuts-grid";

  for (const group of GROUPS) {
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
  overlay.hidden = false;
  requestAnimationFrame(() => overlay!.classList.add("visible"));
}

function hide(): void {
  if (!overlay) return;
  hideAbort?.abort();
  const ac = new AbortController();
  hideAbort = ac;
  overlay.classList.remove("visible");
  overlay.addEventListener("transitionend", () => { overlay!.hidden = true; hideAbort = null; }, { once: true, signal: ac.signal });
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

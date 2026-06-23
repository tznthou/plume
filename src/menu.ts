import { Menu } from "@tauri-apps/api/menu/menu";
import { Submenu } from "@tauri-apps/api/menu/submenu";
import { MenuItem } from "@tauri-apps/api/menu/menuItem";
import { CheckMenuItem } from "@tauri-apps/api/menu/checkMenuItem";
import type { ThemeChoice } from "./theme";
import type { FontFamily } from "./reading-prefs";

export type Mode = "read" | "write" | "split";

export interface MenuCallbacks {
  onNew: () => void;
  onOpen: () => void;
  onOpenCodex: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExport: () => void;
  onSetMode: (mode: Mode) => void;
  onToggleFocus: (checked: boolean) => void;
  onToggleTypewriter: (checked: boolean) => void;
  onToggleToc: () => void;
  onFullscreen: () => void;
  onCopyHtml: () => void;
  onShortcuts: () => void;
  onSetTheme: (choice: ThemeChoice) => void;
  onSetFont: (family: FontFamily | null) => void;
  onFontIncrease: () => void;
  onFontDecrease: () => void;
  onFontReset: () => void;
}

export interface MenuInit {
  themeChoice: ThemeChoice;
  fontFamily: FontFamily | null;
}

interface RadioEntry { item: MenuItem; label: string }

const MARK = "● ";

function radioText(label: string, active: boolean): string {
  return active ? `${MARK}${label}` : label;
}

function setRadioActive(group: RadioEntry[], activeIdx: number): void {
  for (let i = 0; i < group.length; i++) {
    void group[i].item.setText(radioText(group[i].label, i === activeIdx));
  }
}

let focusState = false;
let typewriterState = false;
let focusMenuItem: CheckMenuItem | undefined;
let typewriterMenuItem: CheckMenuItem | undefined;

const MODE_ORDER: Mode[] = ["write", "split", "read"];
const MODE_LABELS = ["撰 Compose", "參 Split", "閱 Read"];
const modeRadio: RadioEntry[] = [];

const THEME_ORDER: ThemeChoice[] = ["vol-de-nuit", "inkstone", "auto"];
const THEME_LABELS = ["Night Flight", "Inkstone", "Auto"];
const themeRadio: RadioEntry[] = [];

const FONT_KEYS: (FontFamily | null)[] = [null, "serif", "sans", "mono"];
const FONT_LABELS = ["Default", "Serif", "Sans-serif", "Monospace"];
const fontRadio: RadioEntry[] = [];

export async function initMenu(cb: MenuCallbacks, init: MenuInit): Promise<void> {
  const appSubmenu = await Submenu.new({
    text: "Plume",
    items: [
      { item: { About: null } },
      { item: "Separator" },
      { item: "Services" },
      { item: "Separator" },
      { item: "Hide" },
      { item: "HideOthers" },
      { item: "ShowAll" },
      { item: "Separator" },
      { item: "Quit" },
    ],
  });

  const fileSubmenu = await Submenu.new({
    text: "File",
    items: [
      { text: "New", accelerator: "CmdOrCtrl+N", action: () => cb.onNew() },
      { text: "Open…", accelerator: "CmdOrCtrl+O", action: () => cb.onOpen() },
      { text: "Open Codex Folder…", action: () => cb.onOpenCodex() },
      { item: "Separator" },
      { text: "Save", accelerator: "CmdOrCtrl+S", action: () => cb.onSave() },
      { text: "Save As…", accelerator: "CmdOrCtrl+Shift+S", action: () => cb.onSaveAs() },
      { item: "Separator" },
      { text: "Export HTML…", action: () => cb.onExport() },
    ],
  });

  const editSubmenu = await Submenu.new({
    text: "Edit",
    items: [
      { item: "Undo" },
      { item: "Redo" },
      { item: "Separator" },
      { item: "Cut" },
      { item: "Copy" },
      { item: "Paste" },
      { item: "SelectAll" },
    ],
  });

  focusMenuItem = await CheckMenuItem.new({
    text: "Focus Mode",
    accelerator: "CmdOrCtrl+Shift+F",
    checked: false,
    enabled: document.body.dataset.mode === "write", // 只歸「撰」（決策 42）
    action: () => {
      focusState = !focusState;
      cb.onToggleFocus(focusState);
    },
  });

  typewriterMenuItem = await CheckMenuItem.new({
    text: "Typewriter Mode",
    accelerator: "CmdOrCtrl+T",
    checked: false,
    enabled: document.body.dataset.mode === "write", // 只歸「撰」（決策 42）
    action: () => {
      typewriterState = !typewriterState;
      cb.onToggleTypewriter(typewriterState);
    },
  });

  // Mode radio（撰／參／閱）；Cmd+E 直接進「撰」沉浸寫作
  for (let i = 0; i < MODE_ORDER.length; i++) {
    const idx = i;
    const item = await MenuItem.new({
      text: radioText(MODE_LABELS[i], document.body.dataset.mode === MODE_ORDER[i]),
      accelerator: MODE_ORDER[i] === "write" ? "CmdOrCtrl+E" : undefined,
      action: () => {
        cb.onSetMode(MODE_ORDER[idx]); // setMode → updateModeMenu 已同步 radio，無需再 setRadioActive
      },
    });
    modeRadio.push({ item, label: MODE_LABELS[i] });
  }

  // Theme radio submenu
  for (let i = 0; i < THEME_ORDER.length; i++) {
    const idx = i;
    const item = await MenuItem.new({
      text: radioText(THEME_LABELS[i], init.themeChoice === THEME_ORDER[i]),
      action: () => {
        cb.onSetTheme(THEME_ORDER[idx]);
        setRadioActive(themeRadio, idx);
      },
    });
    themeRadio.push({ item, label: THEME_LABELS[i] });
  }

  const themeSubmenu = await Submenu.new({
    text: "Theme",
    items: themeRadio.map((r) => r.item),
  });

  // Reading Font radio submenu
  for (let i = 0; i < FONT_KEYS.length; i++) {
    const idx = i;
    const item = await MenuItem.new({
      text: radioText(FONT_LABELS[i], init.fontFamily === FONT_KEYS[i]),
      action: () => {
        cb.onSetFont(FONT_KEYS[idx]);
        setRadioActive(fontRadio, idx);
      },
    });
    fontRadio.push({ item, label: FONT_LABELS[i] });
  }

  const fontSubmenu = await Submenu.new({
    text: "Reading Font",
    items: fontRadio.map((r) => r.item),
  });

  const sizeSubmenu = await Submenu.new({
    text: "Font Size",
    items: [
      { text: "Increase", accelerator: "CmdOrCtrl+=", action: () => cb.onFontIncrease() },
      { text: "Decrease", accelerator: "CmdOrCtrl+-", action: () => cb.onFontDecrease() },
      { text: "Reset", accelerator: "CmdOrCtrl+0", action: () => cb.onFontReset() },
    ],
  });

  const viewSubmenu = await Submenu.new({
    text: "View",
    items: [
      ...modeRadio.map((r) => r.item),
      { item: "Separator" },
      focusMenuItem!,
      typewriterMenuItem!,
      { item: "Separator" },
      themeSubmenu,
      fontSubmenu,
      sizeSubmenu,
      { item: "Separator" },
      { text: "Table of Contents", action: () => cb.onToggleToc() },
      { text: "Fullscreen Reading", action: () => cb.onFullscreen() },
      { item: "Separator" },
      { text: "Copy as HTML", accelerator: "CmdOrCtrl+Shift+C", action: () => cb.onCopyHtml() },
    ],
  });

  const helpSubmenu = await Submenu.new({
    text: "Help",
    items: [
      { text: "Keyboard Shortcuts", accelerator: "CmdOrCtrl+/", action: () => cb.onShortcuts() },
    ],
  });
  await helpSubmenu.setAsHelpMenuForNSApp();

  const menu = await Menu.new({
    items: [appSubmenu, fileSubmenu, editSubmenu, viewSubmenu, helpSubmenu],
  });
  await menu.setAsAppMenu();
}

export function updateModeMenu(mode: Mode): void {
  const idx = MODE_ORDER.indexOf(mode);
  if (idx >= 0) setRadioActive(modeRadio, idx);
}

// Focus/Typewriter 只歸「撰」：離開沉浸態時 main.ts 呼叫此處同步取消選單勾選（決策 42）
export function resetWritingToolsMenu(): void {
  focusState = false;
  typewriterState = false;
  void focusMenuItem?.setChecked(false);
  void typewriterMenuItem?.setChecked(false);
}

// Focus/Typewriter 只歸「撰」：非撰態停用選單項，從根本擋掉 split/read 開啟（決策 42）
export function setWritingToolsEnabled(enabled: boolean): void {
  void focusMenuItem?.setEnabled(enabled);
  void typewriterMenuItem?.setEnabled(enabled);
}

export function updateThemeMenu(choice: ThemeChoice): void {
  const idx = THEME_ORDER.indexOf(choice);
  if (idx >= 0) setRadioActive(themeRadio, idx);
}

export function updateFontMenu(family: FontFamily | null): void {
  const idx = FONT_KEYS.indexOf(family);
  if (idx >= 0) setRadioActive(fontRadio, idx);
}

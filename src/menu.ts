import { Menu } from "@tauri-apps/api/menu/menu";
import { Submenu } from "@tauri-apps/api/menu/submenu";
import { CheckMenuItem } from "@tauri-apps/api/menu/checkMenuItem";

export interface MenuCallbacks {
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExport: () => void;
  onToggleMode: () => void;
  onToggleFocus: (checked: boolean) => void;
  onToggleTypewriter: (checked: boolean) => void;
  onToggleToc: () => void;
  onFullscreen: () => void;
  onCopyHtml: () => void;
  onShortcuts: () => void;
}

let focusMenuItem: CheckMenuItem;
let typewriterMenuItem: CheckMenuItem;
let focusState = false;
let typewriterState = false;

export async function initMenu(cb: MenuCallbacks): Promise<void> {
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
    action: () => {
      focusState = !focusState;
      cb.onToggleFocus(focusState);
    },
  });

  typewriterMenuItem = await CheckMenuItem.new({
    text: "Typewriter Mode",
    accelerator: "CmdOrCtrl+T",
    checked: false,
    action: () => {
      typewriterState = !typewriterState;
      cb.onToggleTypewriter(typewriterState);
    },
  });

  const viewSubmenu = await Submenu.new({
    text: "View",
    items: [
      { text: "Edit / Read Mode", accelerator: "CmdOrCtrl+E", action: () => cb.onToggleMode() },
      { item: "Separator" },
      focusMenuItem,
      typewriterMenuItem,
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


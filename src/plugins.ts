import { invoke } from "@tauri-apps/api/core";
import { load, type Store } from "@tauri-apps/plugin-store";
import { currentLanguage, t } from "./i18n";

export interface PluginManifest {
  id: string;
  name: string | Record<string, string>;
  version: string;
  description?: string | Record<string, string>;
  author?: string;
  icon?: string;
  script?: string;
  locales?: Record<string, Record<string, any>>;
  dirPath: string;
  iconContent?: string;
  scriptContent?: string;
}

const STORE_FILE = "settings.json";
const KEY_ENABLED_PLUGINS = "enabledPlugins";

let storePromise: Promise<Store> | null = null;
let installedPlugins: PluginManifest[] = [];
let enabledPluginIds: Set<string> = new Set();
let pluginChangeCallback: (() => void) | null = null;

function getStore(): Promise<Store> {
  storePromise ??= load(STORE_FILE, { defaults: { [KEY_ENABLED_PLUGINS]: [] }, autoSave: false });
  return storePromise;
}

export function getPluginName(plugin: PluginManifest, lang = currentLanguage()): string {
  if (plugin.locales && typeof plugin.locales === "object") {
    const locObj = plugin.locales[lang];
    if (locObj && typeof locObj.name === "string" && locObj.name) {
      return locObj.name;
    }
    const enObj = plugin.locales["en"];
    if (enObj && typeof enObj.name === "string" && enObj.name) {
      return enObj.name;
    }
  }
  if (typeof plugin.name === "object" && plugin.name !== null) {
    const map = plugin.name as Record<string, string>;
    return map[lang] || map["en"] || Object.values(map)[0] || "Unnamed Plugin";
  }
  if (typeof plugin.name === "string" && plugin.name) {
    return plugin.name;
  }
  return plugin.id || "Unnamed Plugin";
}

export function getPluginDescription(plugin: PluginManifest, lang = currentLanguage()): string {
  if (plugin.locales && typeof plugin.locales === "object") {
    const locObj = plugin.locales[lang];
    if (locObj && typeof locObj.description === "string" && locObj.description) {
      return locObj.description;
    }
    const enObj = plugin.locales["en"];
    if (enObj && typeof enObj.description === "string" && enObj.description) {
      return enObj.description;
    }
  }
  if (typeof plugin.description === "object" && plugin.description !== null) {
    const map = plugin.description as Record<string, string>;
    return map[lang] || map["en"] || Object.values(map)[0] || "";
  }
  if (typeof plugin.description === "string") {
    return plugin.description;
  }
  return "";
}

export function getInstalledPlugins(): PluginManifest[] {
  return installedPlugins;
}

export function getEnabledPluginIds(): Set<string> {
  return enabledPluginIds;
}

export function isPluginEnabled(id: string): boolean {
  return enabledPluginIds.has(id);
}

export function onPluginsChange(cb: () => void): void {
  pluginChangeCallback = cb;
}

export async function loadPluginsFromBackend(): Promise<PluginManifest[]> {
  try {
    const res = await invoke<PluginManifest[]>("load_plugins");
    if (Array.isArray(res)) {
      installedPlugins = res;
      return installedPlugins;
    }
  } catch {
    // Fallback for non-tauri or test environment
  }
  return installedPlugins;
}

export async function openPluginsFolder(): Promise<void> {
  try {
    await invoke("open_plugins_dir");
  } catch (e) {
    console.error("Failed to open plugins directory:", e);
  }
}

export async function importPluginZip(): Promise<PluginManifest[] | null> {
  try {
    const res = await invoke<PluginManifest[] | null>("import_plugin_zip");
    if (res) {
      installedPlugins = res;
      for (const p of res) {
        if (!enabledPluginIds.has(p.id)) {
          enabledPluginIds.add(p.id);
        }
      }
      await saveEnabledPluginsState();
      renderToolbarPlugins();
      renderSettingsPluginList();
      pluginChangeCallback?.();
      return installedPlugins;
    }
  } catch (e) {
    console.error("Failed to import plugin archive:", e);
    throw e;
  }
  return null;
}

export async function deletePlugin(id: string): Promise<PluginManifest[]> {
  try {
    const res = await invoke<PluginManifest[]>("delete_plugin", { pluginId: id });
    installedPlugins = res;
    enabledPluginIds.delete(id);
    await saveEnabledPluginsState();
    renderToolbarPlugins();
    renderSettingsPluginList();
    pluginChangeCallback?.();
    return installedPlugins;
  } catch (e) {
    console.error("Failed to delete plugin:", e);
    throw e;
  }
}

export async function togglePluginEnabled(id: string, enabled: boolean): Promise<void> {
  if (enabled) {
    enabledPluginIds.add(id);
  } else {
    enabledPluginIds.delete(id);
  }
  await saveEnabledPluginsState();
  renderToolbarPlugins();
  renderSettingsPluginList();
  pluginChangeCallback?.();
}

async function saveEnabledPluginsState(): Promise<void> {
  try {
    const store = await getStore();
    await store.set(KEY_ENABLED_PLUGINS, Array.from(enabledPluginIds));
    await store.save();
  } catch {}
}

export function executePluginAction(plugin: PluginManifest): void {
  const pName = getPluginName(plugin);
  const pDesc = getPluginDescription(plugin);
  if (plugin.scriptContent) {
    try {
      const fn = new Function("plugin", plugin.scriptContent);
      fn(plugin);
    } catch (e) {
      console.error(`Error executing plugin script for ${pName}:`, e);
      alert(`[Plugin Error] ${pName}: ${String(e)}`);
    }
  } else {
    alert(`[Plugin] ${pName} (v${plugin.version})\n${pDesc}`);
  }
}

export function renderToolbarPlugins(): void {
  if (typeof document === "undefined") return;
  const toolbar = document.querySelector<HTMLElement>("#toolbar");
  if (!toolbar) return;

  let pluginContainer = toolbar.querySelector<HTMLElement>("#toolbar-plugins");
  if (!pluginContainer) {
    pluginContainer = document.createElement("div");
    pluginContainer.id = "toolbar-plugins";
    pluginContainer.className = "toolbar-plugins-group";
    const recentList = toolbar.querySelector("#recent-list");
    if (recentList) {
      toolbar.insertBefore(pluginContainer, recentList);
    } else {
      toolbar.appendChild(pluginContainer);
    }
  }

  pluginContainer.innerHTML = "";

  const enabledPlugins = installedPlugins.filter((p) => enabledPluginIds.has(p.id));

  for (const plugin of enabledPlugins) {
    const pName = getPluginName(plugin);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = `btn-plugin-${plugin.id}`;
    btn.className = "plugin-toolbar-btn";
    btn.title = `${pName} (v${plugin.version})`;
    btn.setAttribute("aria-label", pName);
    btn.setAttribute("data-tooltip", pName);

    if (plugin.iconContent) {
      const img = document.createElement("img");
      img.src = plugin.iconContent;
      img.alt = pName;
      img.className = "icon-toolbar plugin-icon-img";
      btn.appendChild(img);
    } else {
      btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-toolbar"><path d="M19.439 7.85c-.049-.322.059-.648.289-.878l1.564-1.564a1.5 1.5 0 0 0-2.121-2.121l-1.564 1.564c-.23.23-.556.338-.878.289a3.001 3.001 0 0 0-3.414 3.414c.049.322-.059.648-.289.878l-4.14 4.14c-.23.23-.556.338-.878.289a3.001 3.001 0 0 0-3.414 3.414l1.564 1.564a1.5 1.5 0 0 0 2.121-2.121l-1.564-1.564c-.23-.23-.338-.556-.289-.878a3.001 3.001 0 0 0 3.414-3.414c.322.049.648-.059.878-.289l4.14-4.14c.23-.23.338-.556.289-.878a3.001 3.001 0 0 0 3.414-3.414z"/></svg>`;
    }

    btn.addEventListener("click", () => {
      executePluginAction(plugin);
    });

    pluginContainer.appendChild(btn);
  }
}

export function renderSettingsPluginList(container?: HTMLElement | null): void {
  if (typeof document === "undefined") return;
  const listEl = container || document.querySelector<HTMLElement>("#plugin-list");
  if (!listEl) return;

  listEl.innerHTML = "";

  if (installedPlugins.length === 0) {
    const emptyEl = document.createElement("div");
    emptyEl.className = "plugin-empty-hint";
    emptyEl.textContent = t("ui.noPlugins");
    listEl.appendChild(emptyEl);
    return;
  }

  for (const plugin of installedPlugins) {
    const pName = getPluginName(plugin);
    const pDesc = getPluginDescription(plugin);

    const card = document.createElement("div");
    card.className = "plugin-card";

    const left = document.createElement("div");
    left.className = "plugin-card-left";

    if (plugin.iconContent) {
      const iconImg = document.createElement("img");
      iconImg.src = plugin.iconContent;
      iconImg.alt = pName;
      iconImg.className = "plugin-card-icon";
      left.appendChild(iconImg);
    } else {
      const iconBox = document.createElement("div");
      iconBox.className = "plugin-card-icon-placeholder";
      iconBox.textContent = "🧩";
      left.appendChild(iconBox);
    }

    const info = document.createElement("div");
    info.className = "plugin-card-info";

    const titleRow = document.createElement("div");
    titleRow.className = "plugin-card-title-row";

    const nameSpan = document.createElement("span");
    nameSpan.className = "plugin-card-name";
    nameSpan.textContent = pName;
    titleRow.appendChild(nameSpan);

    const verSpan = document.createElement("span");
    verSpan.className = "plugin-card-version";
    verSpan.textContent = `v${plugin.version}`;
    titleRow.appendChild(verSpan);

    info.appendChild(titleRow);

    if (pDesc) {
      const desc = document.createElement("div");
      desc.className = "plugin-card-desc";
      desc.textContent = pDesc;
      info.appendChild(desc);
    }

    left.appendChild(info);
    card.appendChild(left);

    const right = document.createElement("div");
    right.className = "plugin-card-right";

    const label = document.createElement("label");
    label.className = "plugin-switch";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = enabledPluginIds.has(plugin.id);
    checkbox.addEventListener("change", (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      void togglePluginEnabled(plugin.id, checked);
    });

    const slider = document.createElement("span");
    slider.className = "plugin-slider";

    label.appendChild(checkbox);
    label.appendChild(slider);
    right.appendChild(label);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "plugin-delete-btn";
    deleteBtn.title = t("ui.deletePlugin");
    deleteBtn.textContent = "🗑️";
    deleteBtn.addEventListener("click", () => {
      if (confirm(t("ui.deletePluginConfirmMessage", { name: pName }))) {
        void deletePlugin(plugin.id);
      }
    });
    right.appendChild(deleteBtn);

    card.appendChild(right);
    listEl.appendChild(card);
  }
}

export async function initPlugins(): Promise<void> {
  await loadPluginsFromBackend();

  try {
    const saved = await (await getStore()).get(KEY_ENABLED_PLUGINS);
    if (Array.isArray(saved) && saved.length > 0) {
      enabledPluginIds = new Set(saved.map(String));
    } else {
      enabledPluginIds = new Set(installedPlugins.map((p) => p.id));
    }
  } catch {
    enabledPluginIds = new Set(installedPlugins.map((p) => p.id));
  }

  renderToolbarPlugins();
  renderSettingsPluginList();
}

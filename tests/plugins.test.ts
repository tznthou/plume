import { beforeEach, describe, expect, it, vi } from "vitest";

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  storeGet: vi.fn(),
  storeSet: vi.fn(),
  storeSave: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => tauriMocks.invoke(cmd, args),
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  load: () =>
    Promise.resolve({
      get: (key: string) => tauriMocks.storeGet(key),
      set: (key: string, val: unknown) => tauriMocks.storeSet(key, val),
      save: () => tauriMocks.storeSave(),
    }),
}));

async function loadPluginsModule() {
  vi.resetModules();
  return await import("../src/plugins");
}

const mockPlugin1 = {
  id: "test-plugin-1",
  name: "Test Plugin 1",
  version: "1.0.0",
  description: "Description 1",
  author: "Author 1",
  icon: "icon.svg",
  dirPath: "/plugins/test-plugin-1",
  iconContent: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
  scriptContent: "window.testPlugin1Ran = true;",
};

const mockPlugin2 = {
  id: "test-plugin-2",
  name: "Test Plugin 2",
  version: "2.0.0",
  description: "Description 2",
  author: "Author 2",
  dirPath: "/plugins/test-plugin-2",
};

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = `
    <header id="toolbar">
      <select id="recent-list"></select>
      <button id="btn-settings">Settings</button>
    </header>
    <div id="settings-overlay">
      <div id="plugin-list"></div>
    </div>
  `;

  tauriMocks.invoke.mockImplementation((cmd: string) => {
    if (cmd === "load_plugins") return Promise.resolve([mockPlugin1, mockPlugin2]);
    if (cmd === "delete_plugin") return Promise.resolve([mockPlugin2]);
    if (cmd === "import_plugin_zip") return Promise.resolve([mockPlugin1, mockPlugin2]);
    return Promise.resolve(null);
  });

  tauriMocks.storeGet.mockResolvedValue(["test-plugin-1"]);
});

describe("plugins module", () => {
  it("test_loadPluginsFromBackend_returnsPlugins", async () => {
    const pluginsMod = await loadPluginsModule();
    const plugins = await pluginsMod.loadPluginsFromBackend();
    expect(plugins).toHaveLength(2);
    expect(plugins[0].id).toBe("test-plugin-1");
  });

  it("test_initPlugins_rendersToolbarAndSettingsList", async () => {
    const pluginsMod = await loadPluginsModule();
    await pluginsMod.initPlugins();

    // Check toolbar rendering
    const toolbarGroup = document.querySelector("#toolbar-plugins");
    expect(toolbarGroup).not.toBeNull();

    const btn1 = toolbarGroup?.querySelector("#btn-plugin-test-plugin-1");
    expect(btn1).not.toBeNull();
    expect(btn1?.getAttribute("title")).toContain("Test Plugin 1");

    // Plugin 2 is not in enabled list mock, so shouldn't render in toolbar
    const btn2 = toolbarGroup?.querySelector("#btn-plugin-test-plugin-2");
    expect(btn2).toBeNull();

    // Check settings list rendering
    const settingsList = document.querySelector("#plugin-list");
    expect(settingsList?.children).toHaveLength(2);
  });

  it("test_togglePluginEnabled_updatesStateAndToolbar", async () => {
    const pluginsMod = await loadPluginsModule();
    await pluginsMod.initPlugins();

    expect(pluginsMod.isPluginEnabled("test-plugin-2")).toBe(false);

    await pluginsMod.togglePluginEnabled("test-plugin-2", true);

    expect(pluginsMod.isPluginEnabled("test-plugin-2")).toBe(true);
    expect(tauriMocks.storeSet).toHaveBeenCalledWith("enabledPlugins", expect.arrayContaining(["test-plugin-1", "test-plugin-2"]));

    const btn2 = document.querySelector("#btn-plugin-test-plugin-2");
    expect(btn2).not.toBeNull();
  });

  it("test_executePluginAction_runsScriptContent", async () => {
    const pluginsMod = await loadPluginsModule();
    (window as unknown as Record<string, boolean>).testPlugin1Ran = false;

    pluginsMod.executePluginAction(mockPlugin1);

    expect((window as unknown as Record<string, boolean>).testPlugin1Ran).toBe(true);
  });

  it("test_deletePlugin_callsBackendAndDeleteFromState", async () => {
    const pluginsMod = await loadPluginsModule();
    await pluginsMod.initPlugins();

    await pluginsMod.deletePlugin("test-plugin-1");

    expect(tauriMocks.invoke).toHaveBeenCalledWith("delete_plugin", { pluginId: "test-plugin-1" });
    expect(pluginsMod.isPluginEnabled("test-plugin-1")).toBe(false);
  });

  it("test_getPluginName_and_Description_resolves_multilang", async () => {
    const pluginsMod = await loadPluginsModule();
    const multilangPlugin = {
      id: "multi-lang-plugin",
      name: { zh_Hant: "多語系外掛", en: "Multilang Plugin" },
      version: "1.0.0",
      description: { zh_Hant: "描述訊息", en: "Description message" },
      dirPath: "/plugins/multi",
      locales: {
        zh_Hant: { name: "多語系外掛 (Locale)", description: "描述訊息 (Locale)" },
      },
    };

    expect(pluginsMod.getPluginName(multilangPlugin, "zh_Hant")).toBe("多語系外掛 (Locale)");
    expect(pluginsMod.getPluginDescription(multilangPlugin, "zh_Hant")).toBe("描述訊息 (Locale)");

    expect(pluginsMod.getPluginName(multilangPlugin, "en")).toBe("Multilang Plugin");
    expect(pluginsMod.getPluginDescription(multilangPlugin, "en")).toBe("Description message");
  });

  it("test_importPluginZip_autoEnablesImportedPlugins", async () => {
    const pluginsMod = await loadPluginsModule();
    await pluginsMod.initPlugins();

    await pluginsMod.importPluginZip();

    expect(pluginsMod.isPluginEnabled("test-plugin-1")).toBe(true);
    expect(pluginsMod.isPluginEnabled("test-plugin-2")).toBe(true);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const tauriMocks = vi.hoisted(() => ({
  getVersion: vi.fn(() => Promise.reject(new Error("Not in Tauri"))),
  openUrl: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: () => tauriMocks.getVersion(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (url: string) => tauriMocks.openUrl(url),
}));

async function loadSettingsModule() {
  vi.resetModules();
  return await import("../src/settings");
}

beforeEach(() => {
  vi.clearAllMocks();
  tauriMocks.getVersion.mockImplementation(() => Promise.reject(new Error("Not in Tauri")));
  document.body.innerHTML = `
    <header id="toolbar">
      <button id="btn-settings">Gear</button>
    </header>
    <div id="settings-overlay" class="settings-overlay" hidden>
      <div class="settings-card">
        <button id="btn-close-settings">✕</button>
        <select id="theme-list">
          <option value="vol-de-nuit">暗夜飛行</option>
          <option value="inkstone">硯台</option>
          <option value="auto">自動</option>
        </select>
        <select id="lang-list"></select>
        <span id="app-version"></span>
        <button id="btn-check-update">檢查更新</button>
        <div id="update-status" hidden></div>
      </div>
    </div>
  `;
});

describe("settings module", () => {
  it("test_getAppVersion_fallback_formatsVersionWithV", async () => {
    const settings = await loadSettingsModule();
    const ver = await settings.getAppVersion();
    expect(ver).toMatch(/^v\d+\.\d+\.\d+/);
  });

  it("test_getAppVersion_tauriVersion_returnsTauriVersion", async () => {
    tauriMocks.getVersion.mockResolvedValue("1.5.0");
    const settings = await loadSettingsModule();
    const ver = await settings.getAppVersion();
    expect(ver).toBe("v1.5.0");
  });

  it("test_compareVersions_comparesSemverCorrectly", async () => {
    const settings = await loadSettingsModule();
    expect(settings.compareVersions("v0.11.0", "v0.12.0")).toBe(1);
    expect(settings.compareVersions("v0.11.0", "v0.11.0")).toBe(0);
    expect(settings.compareVersions("v1.0.0", "v0.11.0")).toBe(-1);
  });

  it("test_getDirectDownloadUrl_findsPlatformMatchingAsset", async () => {
    const settings = await loadSettingsModule();
    const assets = [
      { name: "Plume_0.12.0_x64-setup.exe", browser_download_url: "https://github.com/win/Plume_0.12.0_x64-setup.exe" },
      { name: "Plume_0.12.0_aarch64.dmg", browser_download_url: "https://github.com/mac/Plume_0.12.0_aarch64.dmg" },
    ];

    const macUrl = settings.getDirectDownloadUrl(assets, "https://fallback.url", "Macintosh", "MacIntel");
    expect(macUrl).toContain("dmg");

    const winUrl = settings.getDirectDownloadUrl(assets, "https://fallback.url", "Windows", "Win32");
    expect(winUrl).toContain("exe");
  });

  it("test_checkForUpdates_newVersionAvailable_triggersDirectAssetDownload", async () => {
    tauriMocks.getVersion.mockResolvedValue("0.11.0");
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          tag_name: "v0.12.0",
          assets: [
            { name: "Plume_0.12.0_aarch64.dmg", browser_download_url: "https://github.com/tznthou/plume/releases/download/v0.12.0/Plume_0.12.0_aarch64.dmg" }
          ]
        }),
      } as Response)
    ));

    const settings = await loadSettingsModule();
    settings.initSettings();

    await settings.runUpdateCheckUI();

    const statusEl = document.querySelector("#update-status");
    expect(statusEl?.classList.contains("has-update")).toBe(true);
    expect(statusEl?.textContent).toContain("v0.12.0");

    const downloadBtn = statusEl?.querySelector<HTMLButtonElement>("#btn-download-update");
    expect(downloadBtn).not.toBeNull();
    expect(downloadBtn?.textContent).toBe("下載更新");

    downloadBtn?.click();
    expect(tauriMocks.openUrl).toHaveBeenCalledWith("https://github.com/tznthou/plume/releases/download/v0.12.0/Plume_0.12.0_aarch64.dmg");
  });

  it("test_checkForUpdates_upToDate_showsUpToDate", async () => {
    tauriMocks.getVersion.mockResolvedValue("0.12.0");
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ tag_name: "v0.12.0" }),
      } as Response)
    ));

    const settings = await loadSettingsModule();
    settings.initSettings();

    await settings.runUpdateCheckUI();

    const statusEl = document.querySelector("#update-status");
    expect(statusEl?.classList.contains("has-update")).toBe(false);
  });

  it("test_initSettings_populatesVersionAndTogglesOverlay", async () => {
    tauriMocks.getVersion.mockResolvedValue("0.11.0");
    const settings = await loadSettingsModule();
    settings.initSettings();

    const versionEl = document.querySelector("#app-version");
    await vi.waitFor(() => {
      expect(versionEl?.textContent).toBe("v0.11.0");
    });

    const overlay = document.querySelector<HTMLElement>("#settings-overlay")!;
    expect(overlay.hidden).toBe(true);

    document.querySelector<HTMLElement>("#btn-settings")!.click();
    expect(overlay.hidden).toBe(false);

    const closed = settings.hideSettings();
    expect(closed).toBe(true);
  });
});

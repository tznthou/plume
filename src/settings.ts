import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { t } from "./i18n";

const GITHUB_LATEST_RELEASE_API = "https://api.github.com/repos/tznthou/plume/releases/latest";
const GITHUB_LATEST_RELEASE_URL = "https://github.com/tznthou/plume/releases/latest";

let overlay: HTMLElement | null = null;
let hideAbort: AbortController | null = null;

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export async function getAppVersion(): Promise<string> {
  try {
    const ver = await getVersion();
    if (ver) return ver.startsWith("v") ? ver : `v${ver}`;
  } catch {
    // Fallback for non-Tauri or dev test environment
  }
  const fallback = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.11.0";
  return fallback.startsWith("v") ? fallback : `v${fallback}`;
}

export function compareVersions(v1: string, v2: string): number {
  const parse = (v: string) =>
    v
      .replace(/^v/i, "")
      .split("-")[0]
      .split(".")
      .map((n) => parseInt(n, 10) || 0);

  const parts1 = parse(v1);
  const parts2 = parse(v2);

  const maxLen = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < maxLen; i++) {
    const p1 = parts1[i] ?? 0;
    const p2 = parts2[i] ?? 0;
    if (p2 > p1) return 1;
    if (p2 < p1) return -1;
  }
  return 0;
}

export function getDirectDownloadUrl(
  assets: ReleaseAsset[] = [],
  fallbackUrl: string = GITHUB_LATEST_RELEASE_URL,
  customUA?: string,
  customPlatform?: string
): string {
  if (!assets || assets.length === 0) return fallbackUrl;

  const ua = (customUA ?? (typeof navigator !== "undefined" && navigator.userAgent ? navigator.userAgent : "")).toLowerCase();
  const platform = (customPlatform ?? (typeof navigator !== "undefined" && navigator.platform ? navigator.platform : "")).toLowerCase();

  const isMac = platform.includes("mac") || ua.includes("mac");
  const isWin = platform.includes("win") || ua.includes("win");

  if (isMac) {
    const isArm = ua.includes("arm") || ua.includes("aarch64");
    if (isArm) {
      const armMatch = assets.find(
        (a) => /\.dmg$/i.test(a.name) && (a.name.includes("aarch64") || a.name.includes("arm64"))
      );
      if (armMatch) return armMatch.browser_download_url;
    }
    const macMatch = assets.find((a) => /\.dmg$/i.test(a.name) || /\.pkg$/i.test(a.name));
    if (macMatch) return macMatch.browser_download_url;
  }

  if (isWin) {
    const winMatch = assets.find((a) => /\.exe$/i.test(a.name) || /\.msi$/i.test(a.name));
    if (winMatch) return winMatch.browser_download_url;
  }

  const fallbackAsset = assets.find((a) => /\.(dmg|exe|msi|pkg|appimage|deb)$/i.test(a.name));
  return fallbackAsset ? fallbackAsset.browser_download_url : fallbackUrl;
}

export async function checkForUpdates(): Promise<{
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion?: string;
  downloadUrl?: string;
  error?: string;
}> {
  const currentVersion = await getAppVersion();
  try {
    const res = await fetch(GITHUB_LATEST_RELEASE_API, {
      headers: { Accept: "application/vnd.github.v3+json" },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = (await res.json()) as { tag_name?: string; html_url?: string; assets?: ReleaseAsset[] };
    if (!data.tag_name) {
      throw new Error("No tag_name returned");
    }
    const latestVersion = data.tag_name.startsWith("v") ? data.tag_name : `v${data.tag_name}`;
    const cmp = compareVersions(currentVersion, latestVersion);
    const downloadUrl = getDirectDownloadUrl(data.assets ?? [], data.html_url ?? GITHUB_LATEST_RELEASE_URL);
    return {
      hasUpdate: cmp > 0,
      currentVersion,
      latestVersion,
      downloadUrl,
    };
  } catch (err) {
    return {
      hasUpdate: false,
      currentVersion,
      error: String(err),
    };
  }
}

export async function runUpdateCheckUI(): Promise<void> {
  const statusEl = document.querySelector<HTMLElement>("#update-status");
  const checkBtn = document.querySelector<HTMLButtonElement>("#btn-check-update");
  if (!statusEl) return;

  statusEl.hidden = false;
  statusEl.className = "settings-update-status";
  statusEl.textContent = t("ui.checkingUpdate");
  if (checkBtn) checkBtn.disabled = true;

  const res = await checkForUpdates();

  if (checkBtn) checkBtn.disabled = false;

  if (res.error) {
    statusEl.textContent = t("ui.checkUpdateFailed");
    return;
  }

  if (res.hasUpdate && res.latestVersion) {
    statusEl.className = "settings-update-status has-update";
    statusEl.innerHTML = "";

    const msgSpan = document.createElement("span");
    msgSpan.textContent = t("ui.newVersionAvailable", { version: res.latestVersion });
    statusEl.appendChild(msgSpan);

    const downloadBtn = document.createElement("button");
    downloadBtn.type = "button";
    downloadBtn.id = "btn-download-update";
    downloadBtn.className = "btn-update-download";
    downloadBtn.textContent = t("ui.downloadUpdate");
    const targetUrl = res.downloadUrl || GITHUB_LATEST_RELEASE_URL;
    downloadBtn.addEventListener("click", () => {
      openUrl(targetUrl).catch((e) => {
        window.open(targetUrl, "_blank");
        console.error(e);
      });
    });
    statusEl.appendChild(downloadBtn);
  } else {
    statusEl.textContent = t("ui.upToDate");
  }
}

export function initSettings(options?: {
  onOpenThemesFolder?: () => void;
}): void {
  overlay = document.querySelector<HTMLElement>("#settings-overlay");
  const btnSettings = document.querySelector<HTMLButtonElement>("#btn-settings");
  const btnClose = document.querySelector<HTMLButtonElement>("#btn-close-settings");
  const versionEl = document.querySelector<HTMLElement>("#app-version");
  const btnCheckUpdate = document.querySelector<HTMLButtonElement>("#btn-check-update");
  const btnOpenThemes = document.querySelector<HTMLButtonElement>("#btn-open-themes");

  if (versionEl) {
    void getAppVersion().then((ver) => {
      versionEl.textContent = ver;
    });
  }

  btnSettings?.addEventListener("click", () => {
    showSettings();
  });

  btnClose?.addEventListener("click", hideSettings);

  btnCheckUpdate?.addEventListener("click", () => {
    void runUpdateCheckUI();
  });

  btnOpenThemes?.addEventListener("click", () => {
    options?.onOpenThemesFolder?.();
  });

  overlay?.addEventListener("click", (e) => {
    if (e.target === overlay) hideSettings();
  });
}

export function showSettings(): void {
  if (!overlay) return;
  hideAbort?.abort();
  hideAbort = null;
  overlay.hidden = false;
  requestAnimationFrame(() => overlay!.classList.add("visible"));
}

export function hideSettings(): boolean {
  if (!overlay || overlay.hidden) return false;
  hideAbort?.abort();
  const ac = new AbortController();
  hideAbort = ac;
  overlay.classList.remove("visible");
  overlay.addEventListener(
    "transitionend",
    () => {
      if (overlay) overlay.hidden = true;
      hideAbort = null;
    },
    { once: true, signal: ac.signal }
  );
  return true;
}

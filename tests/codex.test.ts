// 冊（Codex）測試（決策 44-49 / PRD US-7）。codex.ts 的 store 與冊狀態是模組級單例，
// 每測 resetModules + 動態 import 取乾淨狀態（仿 recent.test.ts）。
import { beforeEach, describe, expect, it, vi } from "vitest";

const storeMocks = vi.hoisted(() => {
  const data = new Map<string, unknown>();
  return {
    data,
    fakeStore: {
      get: vi.fn((key: string) => Promise.resolve(data.get(key))),
      set: vi.fn((key: string, value: unknown) => {
        data.set(key, value);
        return Promise.resolve();
      }),
      save: vi.fn(() => Promise.resolve()),
    },
  };
});

const dialogMocks = vi.hoisted(() => ({ open: vi.fn(), message: vi.fn() }));
const coreMocks = vi.hoisted(() => ({ invoke: vi.fn() }));
const fileMocks = vi.hoisted(() => ({ openExternal: vi.fn(() => Promise.resolve()) }));

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(() => Promise.resolve(storeMocks.fakeStore)),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: dialogMocks.open, message: dialogMocks.message }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: coreMocks.invoke }));
vi.mock("../src/file", () => ({ openExternal: fileMocks.openExternal }));

async function loadCodexModule() {
  vi.resetModules();
  return await import("../src/codex");
}

beforeEach(() => {
  vi.clearAllMocks();
  storeMocks.data.clear();
  coreMocks.invoke.mockResolvedValue([]); // 預設列舉回空
});

describe("buildTree", () => {
  it("test_buildTree_flatPaths_buildsNestedTree", async () => {
    const { buildTree } = await loadCodexModule();
    const tree = buildTree("/c", ["/c/a.md", "/c/sub/b.md", "/c/sub/deep/d.md"]);

    // 頂層：sub(dir) 排在 a.md(file) 前
    expect(tree.map((n) => n.name)).toEqual(["sub", "a.md"]);
    const sub = tree[0];
    expect(sub.isDir).toBe(true);
    expect(sub.children.map((n) => n.name)).toEqual(["deep", "b.md"]);
    expect(sub.children[0].children.map((n) => n.name)).toEqual(["d.md"]);
    // 葉節點 path = 絕對路徑（供 grant_scope），isDir false
    const aLeaf = tree.find((n) => n.name === "a.md")!;
    expect(aLeaf.path).toBe("/c/a.md");
    expect(aLeaf.isDir).toBe(false);
  });

  it("test_buildTree_sortsDirsFirstThenAlpha", async () => {
    const { buildTree } = await loadCodexModule();
    const tree = buildTree("/c", ["/c/b.md", "/c/a.md", "/c/sub/x.md"]);
    expect(tree.map((n) => n.name)).toEqual(["sub", "a.md", "b.md"]); // dir 先，檔案字母序
    expect(tree[0].isDir).toBe(true);
  });

  it("test_buildTree_emptyList_returnsEmpty", async () => {
    const { buildTree } = await loadCodexModule();
    expect(buildTree("/c", [])).toEqual([]);
  });

  it("test_buildTree_windowsBackslash_splitsSegments", async () => {
    const { buildTree } = await loadCodexModule();
    const tree = buildTree("C:\\notes", ["C:\\notes\\a.md", "C:\\notes\\sub\\b.md"]);
    expect(tree.map((n) => n.name)).toEqual(["sub", "a.md"]);
    expect(tree[0].children.map((n) => n.name)).toEqual(["b.md"]);
    expect(tree[0].children[0].path).toBe("C:\\notes\\sub\\b.md");
  });

  it("test_buildTree_cjkNames_noThrowAndPresent", async () => {
    const { buildTree } = await loadCodexModule();
    const tree = buildTree("/c", ["/c/筆記.md", "/c/草稿.md"]);
    expect(tree).toHaveLength(2);
    expect(tree.map((n) => n.name).sort()).toEqual(["筆記.md", "草稿.md"].sort());
  });
});

describe("codex store", () => {
  it("test_openCodexFolder_invokesListWithRoot", async () => {
    const codex = await loadCodexModule();
    dialogMocks.open.mockResolvedValueOnce("/proj/a");
    coreMocks.invoke.mockResolvedValueOnce(["/proj/a/x.md"]);

    await codex.openCodexFolder();

    expect(coreMocks.invoke).toHaveBeenCalledWith("list_codex_files", { root: "/proj/a" });
    expect(storeMocks.data.get("codices")).toEqual([{ path: "/proj/a", name: "a" }]);
  });

  it("test_openCodexFolder_twoFolders_prependsAndPersists", async () => {
    const codex = await loadCodexModule();
    dialogMocks.open.mockResolvedValueOnce("/proj/a");
    await codex.openCodexFolder();
    dialogMocks.open.mockResolvedValueOnce("/proj/b");
    await codex.openCodexFolder();

    expect(storeMocks.data.get("codices")).toEqual([
      { path: "/proj/b", name: "b" }, // 新冊置頂
      { path: "/proj/a", name: "a" },
    ]);
    expect(storeMocks.fakeStore.save).toHaveBeenCalled();
  });

  it("test_openCodexFolder_duplicate_dedupes", async () => {
    const codex = await loadCodexModule();
    dialogMocks.open.mockResolvedValueOnce("/proj/a");
    await codex.openCodexFolder();
    dialogMocks.open.mockResolvedValueOnce("/proj/a"); // 再開同一冊
    await codex.openCodexFolder();

    expect(storeMocks.data.get("codices")).toEqual([{ path: "/proj/a", name: "a" }]);
  });

  it("test_openCodexFolder_cancel_noInvoke", async () => {
    const codex = await loadCodexModule();
    dialogMocks.open.mockResolvedValueOnce(null); // 使用者取消
    await codex.openCodexFolder();
    expect(coreMocks.invoke).not.toHaveBeenCalled();
  });

  it("test_restoreCodices_corruptStore_rebuildsEmpty", async () => {
    storeMocks.data.set("codices", "不是陣列"); // store 損毀
    const codex = await loadCodexModule();
    await expect(codex.restoreCodices()).resolves.toBeUndefined(); // 靜默不 throw

    // 損毀殘留不污染：開新冊後清單只含新冊
    dialogMocks.open.mockResolvedValueOnce("/proj/a");
    await codex.openCodexFolder();
    expect(storeMocks.data.get("codices")).toEqual([{ path: "/proj/a", name: "a" }]);
  });

  it("test_restoreCodices_filtersMalformedEntries", async () => {
    storeMocks.data.set("codices", [
      { path: "/proj/good", name: "good" },
      { path: 123, name: null }, // 竄改：非字串
      { name: "no-path" }, // 缺 path
      "not-an-object",
    ]);
    const codex = await loadCodexModule();
    await codex.restoreCodices();
    // 開新冊觸發 save，驗證持久化清單已濾掉 malformed（只剩 good + 新冊）
    dialogMocks.open.mockResolvedValueOnce("/proj/new");
    coreMocks.invoke.mockResolvedValueOnce([]);
    await codex.openCodexFolder();
    expect(storeMocks.data.get("codices")).toEqual([
      { path: "/proj/new", name: "new" },
      { path: "/proj/good", name: "good" },
    ]);
  });

  it("test_switchCodex_enumFails_alertsNotSilent", async () => {
    const codex = await loadCodexModule();
    dialogMocks.open.mockResolvedValueOnce("/proj/a");
    coreMocks.invoke.mockResolvedValueOnce(["/proj/a/x.md"]);
    await codex.openCodexFolder();
    dialogMocks.open.mockResolvedValueOnce("/proj/b");
    coreMocks.invoke.mockResolvedValueOnce(["/proj/b/y.md"]);
    await codex.openCodexFolder();

    // 切回 A 但資料夾已被刪 → 列舉失敗：提示而非靜默（避免 select/樹 stale 不一致）
    coreMocks.invoke.mockRejectedValueOnce(new Error("Path is not a folder"));
    await codex.switchCodex("/proj/a");

    expect(dialogMocks.message).toHaveBeenCalled();
  });
});

// Task 4 檔案操作測試（docs/PLAN.md 測試設計）。Tauri IPC 全部 mock，
// file.ts 的 DocState 是模組級單例，每個測試以 resetModules + 動態 import 取得乾淨狀態。
import { beforeEach, describe, expect, it, vi } from "vitest";

const dialogMocks = vi.hoisted(() => ({
  open: vi.fn(),
  save: vi.fn(),
  ask: vi.fn(),
  message: vi.fn(),
}));
const fsMocks = vi.hoisted(() => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));
const editorMocks = vi.hoisted(() => ({
  getContent: vi.fn(),
  setContent: vi.fn(),
  onChange: vi.fn(),
  getScrollDOM: vi.fn().mockReturnValue({ scrollTop: 0 }),
}));
const windowMocks = vi.hoisted(() => ({
  setTitle: vi.fn(),
  onCloseRequested: vi.fn(),
  destroy: vi.fn(),
}));
const recentMocks = vi.hoisted(() => ({
  getRecent: vi.fn(),
  addRecent: vi.fn(),
  removeRecent: vi.fn(),
}));
const coreMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => dialogMocks);
vi.mock("@tauri-apps/plugin-fs", () => fsMocks);
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => windowMocks,
}));
vi.mock("@tauri-apps/api/core", () => coreMocks);
vi.mock("../src/editor", () => editorMocks);
vi.mock("../src/recent", () => recentMocks);

async function loadFileModule() {
  vi.resetModules();
  return await import("../src/file");
}

beforeEach(() => {
  vi.clearAllMocks();
  editorMocks.getContent.mockReturnValue("");
});

describe("file", () => {
  it("test_file_open_validPath_loadsContentAndSetsPath", async () => {
    dialogMocks.open.mockResolvedValue("/tmp/a.md");
    fsMocks.readTextFile.mockResolvedValue("# 哈囉");

    const file = await loadFileModule();
    await file.openFile();

    expect(editorMocks.setContent).toHaveBeenCalledWith("# 哈囉");
    expect(file.getDocState()).toEqual({ path: "/tmp/a.md", dirty: false });
    expect(windowMocks.setTitle).toHaveBeenCalledWith("a.md");
    expect(recentMocks.addRecent).toHaveBeenCalledWith("/tmp/a.md"); // Task 6：開啟成功記錄
  });

  it("test_file_save_dirtyDoc_writesAndClearsDirty", async () => {
    dialogMocks.open.mockResolvedValue("/tmp/a.md");
    fsMocks.readTextFile.mockResolvedValue("原始內容");
    fsMocks.writeTextFile.mockResolvedValue(undefined);
    editorMocks.getContent.mockReturnValue("改過的內容");

    const file = await loadFileModule();
    await file.openFile();
    file.markDirty(); // 模擬使用者編輯
    expect(file.getDocState().dirty).toBe(true);

    const ok = await file.saveFile();

    expect(ok).toBe(true);
    expect(fsMocks.writeTextFile).toHaveBeenCalledWith("/tmp/a.md", "改過的內容");
    expect(file.getDocState()).toEqual({ path: "/tmp/a.md", dirty: false });
    // 儲存後標題不帶 dirty 標記
    expect(windowMocks.setTitle).toHaveBeenLastCalledWith("a.md");
  });

  it("test_file_save_noPath_delegatesToSaveAs", async () => {
    dialogMocks.save.mockResolvedValue("/tmp/new.md");
    fsMocks.writeTextFile.mockResolvedValue(undefined);
    editorMocks.getContent.mockReturnValue("新文件");

    const file = await loadFileModule();
    const ok = await file.saveFile(); // path 為 null，應委派另存流程

    expect(ok).toBe(true);
    expect(dialogMocks.save).toHaveBeenCalledOnce();
    expect(fsMocks.writeTextFile).toHaveBeenCalledWith("/tmp/new.md", "新文件");
    expect(file.getDocState()).toEqual({ path: "/tmp/new.md", dirty: false });
  });

  it("test_file_open_readFails_keepsCurrentDoc", async () => {
    dialogMocks.open.mockResolvedValue("/tmp/a.md");
    fsMocks.readTextFile.mockResolvedValue("好文件");

    const file = await loadFileModule();
    await file.openFile();
    expect(editorMocks.setContent).toHaveBeenCalledTimes(1);

    dialogMocks.open.mockResolvedValue("/tmp/broken.md");
    fsMocks.readTextFile.mockRejectedValue(new Error("EACCES"));
    await file.openFile();

    // SPEC 錯誤處理：不載入、不改變現有編輯內容，非阻斷提示
    expect(editorMocks.setContent).toHaveBeenCalledTimes(1);
    expect(file.getDocState()).toEqual({ path: "/tmp/a.md", dirty: false });
    expect(dialogMocks.message).toHaveBeenCalledOnce();
  });

  it("test_recent_open_missingFile_removesEntry", async () => {
    fsMocks.readTextFile.mockRejectedValue(new Error("ENOENT"));

    const file = await loadFileModule();
    await file.openRecent("/tmp/gone.md"); // 最近清單點到已刪除的檔

    // SPEC 錯誤處理：非阻斷提示 + 自動從最近清單移除，現有文件不受影響
    expect(editorMocks.setContent).not.toHaveBeenCalled();
    expect(file.getDocState()).toEqual({ path: null, dirty: false });
    expect(dialogMocks.message).toHaveBeenCalledOnce();
    expect(recentMocks.removeRecent).toHaveBeenCalledWith("/tmp/gone.md");
  });

  it("test_file_openExternal_validMd_grantsAndLoads", async () => {
    coreMocks.invoke.mockResolvedValue("/real/dragged.md");
    fsMocks.readTextFile.mockResolvedValue("# 拖曳開啟");

    const file = await loadFileModule();
    await file.openExternal("/tmp/dragged.md");

    expect(coreMocks.invoke).toHaveBeenCalledWith("grant_scope", {
      path: "/tmp/dragged.md",
    });
    expect(editorMocks.setContent).toHaveBeenCalledWith("# 拖曳開啟");
    expect(file.getDocState()).toEqual({ path: "/real/dragged.md", dirty: false });
    expect(recentMocks.addRecent).toHaveBeenCalledWith("/real/dragged.md");
  });

  it("test_file_openExternal_dirty_createsNewTabWithoutPrompting", async () => {
    coreMocks.invoke.mockResolvedValue("/real/new.md");
    fsMocks.readTextFile.mockResolvedValueOnce("原始").mockResolvedValueOnce("# 新檔");
    dialogMocks.open.mockResolvedValue("/tmp/a.md");

    const file = await loadFileModule();
    await file.openFile();
    file.markDirty();

    await file.openExternal("/tmp/new.md");

    // In a multi-tab system, we do NOT prompt to discard changes since we open in a new tab
    expect(dialogMocks.ask).not.toHaveBeenCalled();
    expect(file.getTabs().length).toBe(2);
    expect(file.getDocState()).toEqual({ path: "/real/new.md", dirty: false });
  });

  it("test_file_openExternal_scopeFails_showsError", async () => {
    coreMocks.invoke.mockRejectedValue(
      new Error("Only .md and .markdown files are allowed"),
    );

    const file = await loadFileModule();
    await file.openExternal("/tmp/bad.txt");

    expect(dialogMocks.message).toHaveBeenCalledOnce();
    expect(fsMocks.readTextFile).not.toHaveBeenCalled();
    expect(editorMocks.setContent).not.toHaveBeenCalled();
  });

  it("test_file_openExternal_codexKind_firesCodexLoad", async () => {
    coreMocks.invoke.mockResolvedValue("/codex/note.md");
    fsMocks.readTextFile.mockResolvedValue("# 冊內文章");

    const file = await loadFileModule();
    const loadSpy = vi.fn();
    file.onLoad(loadSpy);
    await file.openExternal("/codex/note.md", "codex");

    // 決策 1：冊點檔走 "codex" kind，main 的 onLoad 據此停在當前模式（不切閱）
    expect(loadSpy).toHaveBeenCalledWith("codex");
    expect(editorMocks.setContent).toHaveBeenCalledWith("# 冊內文章");
  });

  it("test_file_openExternal_defaultKind_firesOpen", async () => {
    coreMocks.invoke.mockResolvedValue("/real/dragged.md");
    fsMocks.readTextFile.mockResolvedValue("# 拖曳");

    const file = await loadFileModule();
    const loadSpy = vi.fn();
    file.onLoad(loadSpy);
    await file.openExternal("/tmp/dragged.md"); // 不傳 kind → 向後相容

    expect(loadSpy).toHaveBeenCalledWith("open"); // 既有行為不變
  });
});

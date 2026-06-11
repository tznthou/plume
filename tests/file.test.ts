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
}));
const windowMocks = vi.hoisted(() => ({
  setTitle: vi.fn(),
  onCloseRequested: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => dialogMocks);
vi.mock("@tauri-apps/plugin-fs", () => fsMocks);
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => windowMocks,
}));
vi.mock("../src/editor", () => editorMocks);

async function loadFileModule() {
  vi.resetModules();
  return await import("../src/file");
}

beforeEach(() => {
  vi.clearAllMocks();
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
});

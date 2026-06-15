// Task 7 匯出 HTML 測試（docs/PLAN.md 測試設計）。
// renderer 刻意不 mock——sanitize 不可被匯出繞過是整鏈行為，必須走真 render()。
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
const recentMocks = vi.hoisted(() => ({
  getRecent: vi.fn(),
  addRecent: vi.fn(),
  removeRecent: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => dialogMocks);
vi.mock("@tauri-apps/plugin-fs", () => fsMocks);
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setTitle: vi.fn(), onCloseRequested: vi.fn(), destroy: vi.fn() }),
}));
vi.mock("../src/editor", () => editorMocks);
vi.mock("../src/recent", () => recentMocks);

async function loadFileModule() {
  vi.resetModules();
  return await import("../src/file");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("export", () => {
  it("test_export_buildHtml_containsRenderedBodyAndInlineCss", async () => {
    dialogMocks.save.mockResolvedValue("/tmp/out.html");
    fsMocks.writeTextFile.mockResolvedValue(undefined);
    editorMocks.getContent.mockReturnValue("# 匯出標題\n\n一段文字");

    const file = await loadFileModule();
    await file.exportHtml();

    const [target, html] = fsMocks.writeTextFile.mock.calls[0] as [string, string];
    expect(target).toBe("/tmp/out.html");
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain("<style>"); // 內嵌樣式，無外部資源
    expect(html).toContain("hljs"); // hljs 主題已內嵌
    expect(html).toContain("<h1>匯出標題</h1>"); // 渲染後 body
    expect(html).not.toMatch(/<link\s/); // 無外部 stylesheet 引用
    // 匯出是副本輸出，不碰 DocState
    expect(file.getDocState()).toEqual({ path: null, dirty: false });
  });

  it("test_export_buildHtml_outputPassedThroughSanitizer", async () => {
    dialogMocks.save.mockResolvedValue("/tmp/evil.html");
    fsMocks.writeTextFile.mockResolvedValue(undefined);
    editorMocks.getContent.mockReturnValue(
      '惡意內容：<script>alert(1)</script> 與 <img src=x onerror="alert(2)">',
    );

    const file = await loadFileModule();
    await file.exportHtml();

    const html = fsMocks.writeTextFile.mock.calls[0][1] as string;
    expect(html).not.toContain("<script>"); // sanitize 不可被匯出繞過
    expect(html).not.toContain("onerror");
  });

  it("test_copyHtml_writesRenderedHtmlToClipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    editorMocks.getContent.mockReturnValue("# 標題\n\n段落文字");

    const file = await loadFileModule();
    await file.copyHtml();

    expect(writeText).toHaveBeenCalledOnce();
    const html = writeText.mock.calls[0][0] as string;
    expect(html).toContain("<h1>標題</h1>");
    expect(html).toContain("<p>段落文字</p>");
  });

  it("test_copyHtml_clipboardFails_showsErrorDialog", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.assign(navigator, { clipboard: { writeText } });
    editorMocks.getContent.mockReturnValue("text");

    const file = await loadFileModule();
    await file.copyHtml();

    expect(dialogMocks.message).toHaveBeenCalledWith(
      expect.stringContaining("denied"),
      expect.objectContaining({ kind: "error" }),
    );
  });

  it("test_export_buildHtml_titleEscaped", async () => {
    const file = await loadFileModule();
    // 檔名可能來自外部來源（開啟他人提供的檔案），title 是唯一非 render 的插值點，
    // 必須與 body 一樣不可被注入（L01 縱深防禦）。
    const html = file.buildExportHtml(
      "evil</title><script>alert(1)</script>.md",
      "<p>body</p>",
    );
    expect(html).not.toContain("</title><script>"); // 未轉義會破出 title 注入 script
    expect(html).toContain("&lt;/title&gt;&lt;script&gt;"); // 轉義後為純文字
  });
});

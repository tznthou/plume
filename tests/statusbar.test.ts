// 狀態列測試：dirty 指示切換與統計寫入——破了 = 儲存狀態誤導使用者，會 red 的真行為。
import { beforeEach, describe, expect, it } from "vitest";
import { initStatusbar, setDirty, updateStats } from "../src/statusbar";

beforeEach(() => {
  document.body.innerHTML = `
    <footer id="statusbar">
      <span id="stat-chars">0</span>
      <span id="stat-lines">1</span>
      <span id="stat-ms">0</span>
      <div id="dirty-indicator" class="saved"><span id="save-text">已儲存</span></div>
    </footer>`;
  initStatusbar();
});

describe("statusbar", () => {
  it("test_statusbar_setDirtyTrue_showsUnsavedState", () => {
    setDirty(true);
    const indicator = document.querySelector("#dirty-indicator")!;
    expect(indicator.classList.contains("dirty")).toBe(true);
    expect(indicator.classList.contains("saved")).toBe(false);
    expect(document.querySelector("#save-text")!.textContent).toBe("未儲存");
  });

  it("test_statusbar_setDirtyFalse_restoresSavedState", () => {
    setDirty(true);
    setDirty(false);
    const indicator = document.querySelector("#dirty-indicator")!;
    expect(indicator.classList.contains("dirty")).toBe(false);
    expect(indicator.classList.contains("saved")).toBe(true);
    expect(document.querySelector("#save-text")!.textContent).toBe("已儲存");
  });

  it("test_statusbar_updateStats_writesAllThreeGauges", () => {
    updateStats({ chars: 318, lines: 26, ms: 3 });
    expect(document.querySelector("#stat-chars")!.textContent).toBe("318");
    expect(document.querySelector("#stat-lines")!.textContent).toBe("26");
    expect(document.querySelector("#stat-ms")!.textContent).toBe("3");
  });
});

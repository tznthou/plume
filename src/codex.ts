// 冊（Codex）檔案管理 L1（PRD US-7 / 決策 44-49）：開資料夾為「冊」，側邊欄巢狀樹瀏覽 .md，
// 點檔即編輯，可切換多個冊。安全（決策 46 方案 B）：列舉走 Rust 唯讀 command list_codex_files
// （不開目錄 fs scope），點檔才沿用 per-file grant_scope（openExternal）。
// 冊清單持久化 codex.json，只存根路徑——每次切冊/啟動重新列舉（反映 Finder 增刪）；
// 授權靠 persisted-scope 自動恢復「點過的單檔」，前端不存授權。
import { invoke } from "@tauri-apps/api/core";
import { message, open } from "@tauri-apps/plugin-dialog";
import { load, type Store } from "@tauri-apps/plugin-store";
import { openExternal } from "./file";

export interface CodexMeta {
  path: string; // 冊根資料夾絕對路徑
  name: string; // 顯示名（basename）
}

export interface TreeNode {
  name: string;
  path: string; // 資料夾：中繼 key；檔案：.md 絕對路徑
  isDir: boolean;
  children: TreeNode[];
}

const STORE_FILE = "codex.json";
const KEY = "codices";

let storePromise: Promise<Store> | null = null;
function getStore(): Promise<Store> {
  storePromise ??= load(STORE_FILE, { defaults: { [KEY]: [] }, autoSave: false });
  return storePromise;
}

// 模組級單例狀態（仿 file.ts doc / recent.ts store 單例慣例）
let codexList: CodexMeta[] = [];
let currentCodex: CodexMeta | null = null;
let currentTreeNodes: TreeNode[] = [];
const expanded = new Set<string>(); // 展開的資料夾路徑（記憶體，L1 不持久化）

// DOM（initCodex 注入；未注入時渲染函式 no-op，便於純邏輯測試）
let treeRoot: HTMLElement | null = null;
let switchSelect: HTMLSelectElement | null = null;

// ----- 持久化（仿 recent.ts） -----

// 驗 field 型別：path 會直接當 list_codex_files 的 root 傳進 Rust IPC，
// 過濾 malformed/被竄改的持久化項（fail-close 輸入驗證）
function isValidCodexMeta(x: unknown): x is CodexMeta {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as CodexMeta).path === "string" &&
    (x as CodexMeta).path.length > 0 &&
    typeof (x as CodexMeta).name === "string"
  );
}

async function loadCodexList(): Promise<CodexMeta[]> {
  try {
    const list = await (await getStore()).get<CodexMeta[]>(KEY);
    return Array.isArray(list) ? list.filter(isValidCodexMeta) : []; // store 損毀/竄改靜默過濾
  } catch {
    return [];
  }
}

async function saveCodexList(): Promise<void> {
  const store = await getStore();
  await store.set(KEY, codexList);
  await store.save();
}

// ----- 純函式：扁平 .md 絕對路徑清單 → 巢狀樹（匯出供測試） -----

export function buildTree(rootPath: string, files: string[]): TreeNode[] {
  const root: TreeNode = { name: "", path: rootPath, isDir: true, children: [] };
  const dirCache = new Map<string, TreeNode>([[rootPath, root]]);
  const sep = rootPath.includes("\\") ? "\\" : "/"; // 跨平台（仿 file.ts fileName 雙分隔處理）

  for (const file of files) {
    const prefix = rootPath + sep;
    const rel = file.startsWith(prefix) ? file.slice(prefix.length) : file;
    const parts = rel.split(/[/\\]/);
    let parent = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const dirPath = parent.path + sep + parts[i];
      let dir = dirCache.get(dirPath);
      if (!dir) {
        dir = { name: parts[i], path: dirPath, isDir: true, children: [] };
        dirCache.set(dirPath, dir);
        parent.children.push(dir);
      }
      parent = dir;
    }
    parent.children.push({
      name: parts[parts.length - 1],
      path: file,
      isDir: false,
      children: [],
    });
  }
  sortTree(root.children);
  return root.children;
}

// 資料夾優先、同類字母序（localeCompare 對中文檔名亦正確排序）
function sortTree(nodes: TreeNode[]): void {
  nodes.sort((a, b) =>
    a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name),
  );
  for (const n of nodes) if (n.isDir) sortTree(n.children);
}

// ----- 對外操作 -----

export async function openCodexFolder(): Promise<void> {
  const folder = await open({ directory: true });
  if (typeof folder !== "string") return; // 取消（multiple 未開，回 string | null）
  await loadCodex(folder, true);
}

export async function switchCodex(path: string): Promise<void> {
  if (!codexList.some((c) => c.path === path)) return;
  await loadCodex(path, false);
}

// 開冊共用：列舉 → 建樹 → 設為當前 → 渲染。isNew 控制是否加入清單並持久化。
async function loadCodex(folder: string, isNew: boolean): Promise<void> {
  let files: string[];
  try {
    files = await invoke<string[]>("list_codex_files", { root: folder });
  } catch {
    // 列舉失敗（資料夾已刪/移）：提示 + 復原下拉到目前的冊，
    // 避免 select 已切到新冊、樹卻仍是舊冊的 stale 陷阱（從錯誤專案開檔）
    await message("無法讀取此資料夾，可能已被移動或刪除。", { title: "開啟冊失敗", kind: "error" });
    renderHeader();
    return;
  }
  if (isNew && !codexList.some((c) => c.path === folder)) {
    const name = folder.split(/[/\\]/).pop() || folder;
    codexList = [{ path: folder, name }, ...codexList]; // 新冊置頂
    await saveCodexList();
  }
  currentCodex = codexList.find((c) => c.path === folder) ?? null;
  currentTreeNodes = buildTree(folder, files);
  expanded.clear(); // 新開的冊預設全收合
  renderHeader();
  refreshTree();
}

export async function restoreCodices(): Promise<void> {
  codexList = await loadCodexList();
  renderHeader(); // L1：啟動僅填下拉，不自動列舉；使用者選冊才開
}

// ----- DOM 渲染（initCodex 後生效；未 init 則 no-op，純邏輯測試不需 DOM） -----

export function initCodex(container: HTMLElement): void {
  treeRoot = container.querySelector<HTMLElement>("ul.codex-tree");
  switchSelect = container.querySelector<HTMLSelectElement>(".codex-switch");

  // 單一事件委派（仿 toc.ts closest + dataset）
  treeRoot?.addEventListener("click", (e) => {
    const li = (e.target as HTMLElement).closest("li");
    if (!li) return;
    if (li.dataset.dir !== undefined) {
      const path = li.dataset.dir;
      if (expanded.has(path)) expanded.delete(path);
      else expanded.add(path);
      refreshTree();
    } else if (li.dataset.file !== undefined) {
      void openExternal(li.dataset.file, "codex"); // 點檔停在當前模式（決策 1）
    }
  });

  switchSelect?.addEventListener("change", () => {
    const path = switchSelect!.value;
    if (path) void switchCodex(path);
  });
}

function renderHeader(): void {
  if (!switchSelect) return;
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = codexList.length ? "切換冊…" : "尚無冊";
  const opts = codexList.map((c) => {
    const opt = document.createElement("option");
    opt.value = c.path;
    opt.textContent = c.name;
    opt.title = c.path;
    return opt;
  });
  switchSelect.replaceChildren(placeholder, ...opts);
  switchSelect.value = currentCodex ? currentCodex.path : "";
}

// 遞迴建 DOM：資料夾 <li> 帶 data-dir + data-open + 子 <ul>；檔案 <li> 帶 data-file
function renderNode(node: TreeNode): HTMLElement {
  const li = document.createElement("li");
  if (node.isDir) {
    li.dataset.dir = node.path;
    li.dataset.open = String(expanded.has(node.path));
    const label = document.createElement("span");
    label.className = "codex-dir-label";
    label.textContent = node.name;
    li.append(label);
    const ul = document.createElement("ul");
    for (const child of node.children) ul.append(renderNode(child));
    li.append(ul);
  } else {
    li.dataset.file = node.path;
    li.textContent = node.name;
  }
  return li;
}

export function refreshTree(): void {
  if (!treeRoot) return;
  treeRoot.replaceChildren(...currentTreeNodes.map(renderNode)); // 仿 toc.ts 一次替換
}

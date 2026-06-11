// Vite ?raw import：檔案內容以字串打包（匯出 HTML 模板內嵌 hljs 主題用）
declare module "*.css?raw" {
  const content: string;
  export default content;
}

declare module "markdown-it-front-matter" {
  import type MarkdownIt from "markdown-it";
  function plugin(md: MarkdownIt, cb: (fm: string) => void): void;
  export default plugin;
}

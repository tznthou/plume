const HEADING_SEL = "h1, h2, h3, h4, h5, h6";

let tocList: HTMLElement;
let previewEl: HTMLElement;

export function initToc(toc: HTMLElement, preview: HTMLElement): void {
  tocList = toc.querySelector("ul")!;
  previewEl = preview;

  tocList.addEventListener("click", (e) => {
    const li = (e.target as HTMLElement).closest("li");
    if (!li || li.dataset.idx === undefined) return;
    const heading = previewEl.querySelectorAll(HEADING_SEL)[Number(li.dataset.idx)];
    heading?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

export function updateToc(): void {
  const headings = previewEl.querySelectorAll<HTMLElement>(HEADING_SEL);
  const items = Array.from(headings, (h, i) => {
    const li = document.createElement("li");
    li.dataset.level = h.tagName[1];
    li.dataset.idx = String(i);
    li.textContent = h.textContent ?? "";
    return li;
  });
  tocList.replaceChildren(...items);
}

let tocList: HTMLElement;
let previewEl: HTMLElement;

export function initToc(toc: HTMLElement, preview: HTMLElement): void {
  tocList = toc.querySelector("ul")!;
  previewEl = preview;

  tocList.addEventListener("click", (e) => {
    const li = (e.target as HTMLElement).closest("li");
    if (!li) return;
    const idx = [...tocList.children].indexOf(li);
    const heading = previewEl.querySelectorAll("h1, h2, h3, h4, h5, h6")[idx];
    heading?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

export function updateToc(): void {
  const headings = previewEl.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6");
  tocList.innerHTML = "";
  for (const h of headings) {
    const li = document.createElement("li");
    li.dataset.level = h.tagName[1];
    li.textContent = h.textContent ?? "";
    tocList.appendChild(li);
  }
}

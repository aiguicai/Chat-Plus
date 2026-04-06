const DEFAULT_LINE_HEIGHT_RATIO = 1.55;

function parseLineHeight(style: CSSStyleDeclaration) {
  const parsed = Number.parseFloat(style.lineHeight || "");
  if (Number.isFinite(parsed) && parsed > 0) return parsed;

  const fontSize = Number.parseFloat(style.fontSize || "");
  if (Number.isFinite(fontSize) && fontSize > 0) return fontSize * DEFAULT_LINE_HEIGHT_RATIO;

  return 0;
}

export function exceedsLineClamp(element: HTMLElement, maxLines = 3) {
  const width = Math.ceil(element.getBoundingClientRect().width);
  if (width <= 0) return false;

  const computedStyle = window.getComputedStyle(element);
  const lineHeight = parseLineHeight(computedStyle);
  if (lineHeight <= 0) return false;

  const clone = element.cloneNode(true) as HTMLElement;
  clone.setAttribute("aria-hidden", "true");
  clone.style.setProperty("position", "fixed", "important");
  clone.style.setProperty("left", "-9999px", "important");
  clone.style.setProperty("top", "0", "important");
  clone.style.setProperty("visibility", "hidden", "important");
  clone.style.setProperty("pointer-events", "none", "important");
  clone.style.setProperty("z-index", "-1", "important");
  clone.style.setProperty("width", `${width}px`, "important");
  clone.style.setProperty("min-width", `${width}px`, "important");
  clone.style.setProperty("max-width", `${width}px`, "important");
  clone.style.setProperty("height", "auto", "important");
  clone.style.setProperty("max-height", "none", "important");
  clone.style.setProperty("overflow", "visible", "important");
  clone.style.setProperty("display", "block", "important");
  clone.style.setProperty("text-overflow", "clip", "important");
  clone.style.setProperty("white-space", "normal", "important");
  clone.style.setProperty("box-sizing", computedStyle.boxSizing || "border-box", "important");
  clone.style.setProperty("-webkit-line-clamp", "unset", "important");
  clone.style.setProperty("-webkit-box-orient", "initial", "important");

  const container = element.parentElement ?? document.body;
  container.appendChild(clone);
  const fullHeight = clone.getBoundingClientRect().height;
  clone.remove();

  return fullHeight > lineHeight * maxLines + 1;
}

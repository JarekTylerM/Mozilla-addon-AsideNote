/* ══════════════════════════════════════════════════════════════
   utils.js — czyste funkcje pomocnicze
   ══════════════════════════════════════════════════════════════ */

export function debounce(fn, delay = 600) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

export function getCurrentLine() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return "";
  return sel.anchorNode?.textContent || "";
}

export function clearCurrentLine() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const node = sel.anchorNode;
  if (node?.nodeType === 3) node.textContent = "";
}

/**
 * editor-selection.js — DOM selection helpers
 *
 * Funkcje pomocnicze do odczytu i manipulacji pozycją kursora.
 * Zero stanu modułu — każda funkcja jest czysta (operuje na
 * przekazanych węzłach DOM lub na window.getSelection()).
 *
 * Używane przez: editor.js (_handleEnter, _handleBackspace,
 *                _handleTab, _handleAltArrow, _initKeydown)
 */

const getEditor = () => document.getElementById("editor");

export function _getListItem() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  const node = sel.getRangeAt(0).startContainer;
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  return el.closest("li");
}

export function _isCursorAtListStart(li) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  // Guard: kursor musi być wewnątrz li — inaczej setEnd rzuci (cross-tree),
  // a logicznie kursor poza li z definicji nie jest "na początku listy"
  if (!li.contains(range.startContainer)) return false;
  const check = document.createRange();
  check.setStart(li, 0);
  check.setEnd(range.startContainer, range.startOffset);
  return check.toString() === "";
}

export function _focusLi(li) {
  const range = document.createRange();
  range.setStart(li, 0);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  getEditor().focus();
}

export function _indentListItem(li) {
  const prev = li.previousElementSibling;
  if (!prev || prev.tagName !== "LI") return;

  const tag = li.parentElement.tagName;
  let nested = prev.querySelector(`:scope > ${tag}`);
  if (!nested) {
    nested = document.createElement(tag);
    prev.appendChild(nested);
  }

  nested.appendChild(li);
  _focusLi(li);
}

export function _outdentListItem(li) {
  const parentList = li.parentElement;
  const parentLi = parentList.parentElement;
  if (!parentLi || parentLi.tagName !== "LI") return;

  parentLi.after(li);
  if (parentList.children.length === 0) parentList.remove();
  _focusLi(li);
}

export function _getCurrentBlock() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;

  const node = sel.getRangeAt(0).startContainer;
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;

  // Block tagi które obsługujemy
  const blockTags = ["P", "H1", "H2", "H3", "BLOCKQUOTE", "LI"];

  // DIV traktujemy jako block TYLKO jeśli to nie jest sam #editor
  let current = el;
  while (current && current !== getEditor()) {
    if (blockTags.includes(current.tagName)) return current;
    if (current.tagName === "DIV") return current;
    current = current.parentElement;
  }

  // Fallback: text bezpośrednio w editorze, bez wrappera
  return getEditor();
}

export function _clearBlock(block) {
  if (!block) return;

  if (block === getEditor()) {
    // Specjalna obsługa: editor jako block — wyczyść wszystko, ale zachowaj
    // pusty wrapper żeby formatBlock miał do czego się przyczepić
    getEditor().innerHTML = "";
    const p = document.createElement("p");
    p.innerHTML = "<br>";
    getEditor().appendChild(p);

    const r = document.createRange();
    r.setStart(p, 0);
    r.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    return;
  }

  block.textContent = "";

  const r = document.createRange();
  r.setStart(block, 0);
  r.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

export function _restoreCursorTo(el) {
  // Znajdź pierwszy węzeł tekstowy lub fallback na sam element
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const textNode = walker.nextNode();
  const sel = window.getSelection();
  const range = document.createRange();
  if (textNode) {
    range.setStart(textNode, 0);
  } else {
    range.setStart(el, 0);
  }
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  getEditor().focus();
}

/* ── Context Resume — pozycja kursora jako offset tekstowy ────
   Przeniesione z editor.js: notes.js potrzebuje setCursorOffset przy
   selectNote, a import z editor.js tworzył cykl notes.js ↔ editor.js
   (działał dzięki hoistingowi ESM, ale był miną na przyszłość). */

/**
 * Zwraca pozycję kursora jako liczbę znaków tekstu od początku edytora
 * (offset niezależny od struktury DOM — przeżywa re-render innerHTML).
 * @returns {number|null} null gdy brak selekcji lub kursor poza edytorem
 */
export function getCursorOffset(editorEl) {
  const sel = window.getSelection();
  if (!sel?.rangeCount || !editorEl) return null;
  const range = sel.getRangeAt(0);
  try {
    const pre = document.createRange();
    pre.selectNodeContents(editorEl);
    pre.setEnd(range.startContainer, range.startOffset);
    return pre.toString().length;
  } catch {
    return null;
  }
}

/**
 * Ustawia kursor na zadanym offsecie tekstowym (odwrotność getCursorOffset).
 * Offset poza zakresem → kursor na końcu edytora.
 */
export function setCursorOffset(editorEl, offset) {
  if (offset == null || offset < 0) return;
  const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let node = walker.nextNode();
  while (node) {
    if (remaining <= node.textContent.length) {
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      node.parentElement?.scrollIntoView?.({ block: "nearest" });
      return;
    }
    remaining -= node.textContent.length;
    node = walker.nextNode();
  }
  // Fallback: kursor na końcu
  const range = document.createRange();
  range.selectNodeContents(editorEl);
  range.collapse(false);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
}

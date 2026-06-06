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
  if (!prev) return;

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

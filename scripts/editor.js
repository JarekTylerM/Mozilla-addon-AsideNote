/* ══════════════════════════════════════════════════════════════
   editor.js — toolbar + skróty + markdown + paste + listy
   ══════════════════════════════════════════════════════════════ */

import { getCurrentLine, clearCurrentLine } from "./utils.js";
import { debouncedSave } from "./notes.js";

const editor      = document.getElementById("editor");
const formatBlock = document.getElementById("formatBlock");

export function initEditor() {
  _initToolbar();
  _initCodeBtn();
  _initKeydown();
  _initPaste();
  editor.addEventListener("input", debouncedSave);
}

/* ── List item helpers ────────────────────────── */

function _getListItem() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  const node = sel.getRangeAt(0).startContainer;
  const el   = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  return el.closest("li");
}

function _isCursorAtListStart(li) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  const check = document.createRange();
  check.setStart(li, 0);
  check.setEnd(range.startContainer, range.startOffset);
  return check.toString() === "";
}

function _focusLi(li) {
  const range = document.createRange();
  range.setStart(li, 0);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  editor.focus();
}

function _indentListItem(li) {
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

function _outdentListItem(li) {
  const parentList = li.parentElement;
  const parentLi   = parentList.parentElement;
  if (!parentLi || parentLi.tagName !== "LI") return;

  parentLi.after(li);
  if (parentList.children.length === 0) parentList.remove();
  _focusLi(li);
}

/* ── Toolbar ──────────────────────────────────── */

function _initToolbar() {
  document.querySelectorAll("#toolbar button").forEach(btn => {
    if (btn.id === "code-btn") return;
    btn.onclick = () => {
      document.execCommand(btn.dataset.cmd, false, btn.dataset.value ?? null);
      editor.focus();
    };
  });

  formatBlock.onchange = () => {
    document.execCommand("formatBlock", false, formatBlock.value);
    editor.focus();
  };
}

function _initCodeBtn() {
  document.getElementById("code-btn").onclick = () => {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;

    const range  = sel.getRangeAt(0);
    const codeEl = document.createElement("code");
    codeEl.textContent = sel.toString() || "code";

    if (sel.toString()) range.deleteContents();
    range.insertNode(codeEl);
    range.setStartAfter(codeEl);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    editor.focus();
  };
}

/* ── Keydown ──────────────────────────────────── */

function _initKeydown() {
  editor.addEventListener("keydown", e => {
    if (e.key === "Enter")     _handleEnter(e);
    if (e.key === " ")         _handleSpace(e);
    if (e.key === "Tab")       _handleTab(e);
    if (e.key === "Backspace") _handleBackspace(e);
    if (e.ctrlKey || e.metaKey) _handleCtrl(e);
  });
}

function _handleEnter(e) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;

  const range      = sel.getRangeAt(0);
  const node       = range.startContainer;
  const element    = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  const blockquote = element.closest("blockquote");

  if (blockquote) {
    if (blockquote.textContent.trim() === "") {
      e.preventDefault();
      const p = document.createElement("p");
      p.innerHTML = "<br>";
      blockquote.replaceWith(p);
      range.setStart(p, 0);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }

    setTimeout(() => {
      const last = blockquote.lastElementChild;
      const prev = blockquote.children[blockquote.children.length - 2];
      if (last?.textContent.trim() === "" && prev?.textContent.trim() === "") {
        const newP = document.createElement("p");
        newP.innerHTML = "<br>";
        blockquote.after(newP);
        last.remove();
        prev.remove();
        const r = document.createRange();
        r.setStart(newP, 0);
        r.collapse(true);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
      }
    }, 0);
    return;
  }

  if (/^---$/.test(getCurrentLine().trim())) {
    e.preventDefault();
    clearCurrentLine();
    document.execCommand("insertHorizontalRule");
    setTimeout(() => document.execCommand("insertParagraph"), 0);
  }
}

function _handleSpace(e) {
  const line = getCurrentLine().trim();

  if (/^#{1,3}$/.test(line)) {
    e.preventDefault();
    clearCurrentLine();
    document.execCommand("formatBlock", false, `h${line.length}`);
    return;
  }
  if (/^[-*]$/.test(line)) {
    e.preventDefault();
    clearCurrentLine();
    document.execCommand("insertUnorderedList");
    return;
  }
  if (/^1\.$/.test(line)) {
    e.preventDefault();
    clearCurrentLine();
    document.execCommand("insertOrderedList");
    return;
  }
  if (/^>$/.test(line)) {
    e.preventDefault();
    clearCurrentLine();
    document.execCommand("formatBlock", false, "blockquote");
  }
}

function _handleTab(e) {
  const li = _getListItem();
  if (!li) return;
  e.preventDefault();
  e.shiftKey ? _outdentListItem(li) : _indentListItem(li);
}

function _handleBackspace(e) {
  const li = _getListItem();
  if (!li || !_isCursorAtListStart(li)) return;
  e.preventDefault();
  _outdentListItem(li);
}

function _handleCtrl(e) {
  switch (e.key) {
    case "b":
      e.preventDefault();
      document.execCommand("bold");
      break;
    case "i":
      e.preventDefault();
      document.execCommand("italic");
      break;
    case "`":
      e.preventDefault();
      document.getElementById("code-btn").click();
      break;
    case "X":
      if (e.shiftKey) {
        e.preventDefault();
        document.execCommand("strikeThrough");
      }
      break;
  }
}

/* ── Paste ────────────────────────────────────── */

function _initPaste() {
  editor.addEventListener("paste", e => {
    e.preventDefault();
    document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
  });
}

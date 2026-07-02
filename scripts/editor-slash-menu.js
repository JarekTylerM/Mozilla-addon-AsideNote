/**
 * editor-slash-menu.js — menu komend / (slash commands)
 *
 * Otwiera się gdy użytkownik wpisze / w pustej linii (p, h1-h3).
 * Przechwytuje klawiaturę i filtruje komendy po nazwie.
 *
 * Publiczne API:
 *   initSlashMenu() — wywołaj z initEditor()
 */

import { t } from "./i18n.js";
import * as undo from "./undo.js";
import { _getCurrentBlock } from "./editor-selection.js";
import { debouncedSave } from "./notes.js";
import { openLinkModal } from "./editor-link-modal.js";

/* ── Definicje komend ────────────────────────── */

const COMMANDS = [
  {
    id: "paragraph",
    group: "text",
    icon: "icon--paragraph",
    labelKey: "slash_cmd_paragraph",
  },
  { id: "h1", group: "text", icon: "icon--h1", labelKey: "slash_cmd_h1" },
  { id: "h2", group: "text", icon: "icon--h2", labelKey: "slash_cmd_h2" },
  { id: "h3", group: "text", icon: "icon--h3", labelKey: "slash_cmd_h3" },
  {
    id: "bullet",
    group: "lists",
    icon: "icon--list-bullet",
    labelKey: "slash_cmd_bullet",
  },
  {
    id: "ordered",
    group: "lists",
    icon: "icon--list-number",
    labelKey: "slash_cmd_ordered",
  },
  {
    id: "checklist",
    group: "lists",
    icon: "icon--checklist",
    labelKey: "slash_cmd_checklist",
  },
  {
    id: "toggle",
    group: "lists",
    icon: "icon--toggle-list",
    labelKey: "slash_cmd_toggle",
  },
  {
    id: "link",
    group: "blocks",
    icon: "icon--link",
    labelKey: "slash_cmd_link",
  },
  {
    id: "code",
    group: "blocks",
    icon: "icon--codeblock",
    labelKey: "slash_cmd_code",
  },
  {
    id: "quote",
    group: "blocks",
    icon: "icon--quote",
    labelKey: "slash_cmd_quote",
  },
  {
    id: "callout-note",
    group: "callout",
    icon: "callout-dropdown__icon--note",
    labelKey: "slash_cmd_callout_note",
  },
  {
    id: "callout-tip",
    group: "callout",
    icon: "callout-dropdown__icon--tip",
    labelKey: "slash_cmd_callout_tip",
  },
  {
    id: "callout-important",
    group: "callout",
    icon: "callout-dropdown__icon--important",
    labelKey: "slash_cmd_callout_important",
  },
  {
    id: "callout-warning",
    group: "callout",
    icon: "callout-dropdown__icon--warning",
    labelKey: "slash_cmd_callout_warning",
  },
  {
    id: "callout-caution",
    group: "callout",
    icon: "callout-dropdown__icon--caution",
    labelKey: "slash_cmd_callout_caution",
  },
];

const GROUP_LABELS = {
  text: "slash_group_text",
  lists: "slash_group_lists",
  blocks: "slash_group_blocks",
  callout: "slash_group_callout",
};

/* ── Stan ────────────────────────────────────── */

let _open = false;
let _activeIdx = 0;
let _filtered = [...COMMANDS];
let _savedBlock = null;

/* ── DOM helpers ─────────────────────────────── */

const _getMenu = () => document.getElementById("slash-menu");
const _getInput = () => document.getElementById("slash-menu-input");
const _getList = () => document.getElementById("slash-menu-list");
const _getEditor = () => document.getElementById("editor");

/* ── Filtrowanie ─────────────────────────────── */

function _filter(query) {
  if (!query) return [...COMMANDS];
  const q = query.toLowerCase();
  return COMMANDS.filter((cmd) => t(cmd.labelKey).toLowerCase().includes(q));
}

/* ── Render ──────────────────────────────────── */

function _render() {
  const list = _getList();
  if (!list) return;
  list.innerHTML = "";

  if (_filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "slash-menu__empty";
    empty.textContent = t("slash_no_results");
    list.appendChild(empty);
    return;
  }

  const groups = {};
  _filtered.forEach((cmd) => (groups[cmd.group] ||= []).push(cmd));

  let itemIndex = 0;
  Object.entries(groups).forEach(([groupId, cmds]) => {
    const groupEl = document.createElement("div");
    groupEl.className = "slash-menu__group-label";
    groupEl.textContent = t(GROUP_LABELS[groupId] ?? groupId);
    list.appendChild(groupEl);

    cmds.forEach((cmd) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "slash-menu__item";
      item.dataset.id = cmd.id;
      if (itemIndex === _activeIdx) item.classList.add("is-active");

      const isCallout = cmd.icon.startsWith("callout-dropdown__icon");
      const icon = document.createElement("span");
      icon.className = isCallout
        ? `slash-menu__icon--callout ${cmd.icon}`
        : `slash-menu__icon ${cmd.icon}`;

      const label = document.createElement("span");
      label.className = "slash-menu__label";
      label.textContent = t(cmd.labelKey);

      item.appendChild(icon);
      item.appendChild(label);

      // mousedown: zapobiega utracie fokusu z edytora
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      // click: wykonuje komendę
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        _execute(cmd.id);
      });

      list.appendChild(item);
      itemIndex++;
    });
  });
}

/* ── Nawigacja ───────────────────────────────── */

function _setActive(idx) {
  _activeIdx = Math.max(0, Math.min(idx, _filtered.length - 1));
  _render();
  _getList()
    ?.querySelector(".slash-menu__item.is-active")
    ?.scrollIntoView({ block: "nearest" });
}

/* ── Cleanup DOM ─────────────────────────────── */

function _cleanupSlashBlock() {
  const editor = _getEditor();
  if (!editor) return;
  editor.querySelectorAll(".slash-active").forEach((el) => {
    el.removeAttribute("data-slash-placeholder");
    el.classList.remove("slash-active");
  });
}

/* ── Otwieranie / zamykanie ──────────────────── */

export function openSlashMenu(block) {
  if (_open) return;

  const menu = _getMenu();
  if (!menu) return;

  _open = true;
  _filtered = [...COMMANDS];
  _activeIdx = 0;

  // Zapisz blok najwyższego poziomu (direct child editora)
  const editor = _getEditor();
  let topBlock = block;
  if (block && block !== editor) {
    while (topBlock && topBlock.parentElement !== editor) {
      topBlock = topBlock.parentElement;
    }
  }
  _savedBlock = topBlock && topBlock !== editor ? topBlock : block;

  // Placeholder na bloku z "/"
  if (_savedBlock && _savedBlock !== editor) {
    _savedBlock.dataset.slashPlaceholder = t("slash_block_hint");
    _savedBlock.classList.add("slash-active");
  }

  // Pozycjonowanie — najpierw poza ekranem, potem mierzymy
  const savedBlock = _savedBlock;
  if (savedBlock && savedBlock !== editor) {
    const rect = savedBlock.getBoundingClientRect();
    const panel = menu.querySelector(".slash-menu__panel");
    menu.style.setProperty("--slash-top", "-9999px");
    menu.style.setProperty("--slash-left", "-9999px");
    menu.hidden = false;
    requestAnimationFrame(() => {
      // Zoom UI działa przez font-size na <html> (panel.js::_applyZoom) —
      // getBoundingClientRect zwraca realne px, bez przeliczeń.
      const panelRect = panel?.getBoundingClientRect();
      const panelH = panelRect?.height || 320;
      const topAbove = rect.top - panelH - 4;
      const top = topAbove >= 0 ? topAbove : rect.bottom + 4;
      const left = Math.max(0, rect.left);
      menu.style.setProperty("--slash-top", `${top}px`);
      menu.style.setProperty("--slash-left", `${left}px`);
    });
  } else {
    menu.hidden = false;
  }

  const input = _getInput();
  if (input) {
    input.value = "";
    input.focus();
  }
  _render();
}

export function closeSlashMenu(restoreFocus = true) {
  if (!_open) return;
  _open = false;

  const menu = _getMenu();
  if (menu) menu.hidden = true;

  if (_savedBlock) {
    delete _savedBlock.dataset.slashPlaceholder;
    _savedBlock.classList.remove("slash-active");
  }
  _savedBlock = null;

  requestAnimationFrame(() => _cleanupSlashBlock());

  if (restoreFocus) _getEditor()?.focus();
}

/* ── Wykonanie komendy ───────────────────────── */

function _execute(id) {
  const editor = _getEditor();
  const block = _savedBlock ?? _getCurrentBlock();

  closeSlashMenu(false);
  undo.checkpoint();

  // Ustaw selekcję w bloku przed execCommand
  editor?.focus();
  if (block && block !== editor) {
    const r = document.createRange();
    r.setStart(block, 0);
    r.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }

  switch (id) {
    // ── Bloki tekstowe — tworzymy ręcznie, bez execCommand
    //    (execCommand kopiuje atrybuty ze starego elementu)
    case "paragraph":
    case "h1":
    case "h2":
    case "h3": {
      const tag = id === "paragraph" ? "p" : id;
      const newEl = document.createElement(tag);
      newEl.innerHTML = "<br>";
      if (block && block !== editor) {
        block.replaceWith(newEl);
      } else {
        editor.innerHTML = "";
        editor.appendChild(newEl);
      }
      const r = document.createRange();
      r.setStart(newEl, 0);
      r.collapse(true);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      break;
    }

    // ── Listy — czyścimy "/" przed execCommand
    case "bullet":
      if (block && block !== editor) block.innerHTML = "<br>";
      else
        editor.childNodes.forEach((n) => {
          if (n.nodeType === Node.TEXT_NODE) n.remove();
        });
      document.execCommand("insertUnorderedList");
      break;

    case "ordered":
      if (block && block !== editor) block.innerHTML = "<br>";
      else
        editor.childNodes.forEach((n) => {
          if (n.nodeType === Node.TEXT_NODE) n.remove();
        });
      document.execCommand("insertOrderedList");
      break;

    case "checklist": {
      const ul = document.createElement("ul");
      ul.setAttribute("data-list", "checklist");
      const li = document.createElement("li");
      li.setAttribute("data-checked", "false");
      li.innerHTML = "<br>";
      ul.appendChild(li);
      if (block && block !== editor) block.replaceWith(ul);
      else editor?.appendChild(ul);
      const r = document.createRange();
      r.setStart(li, 0);
      r.collapse(true);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      break;
    }

    case "toggle": {
      const details = document.createElement("details");
      details.open = true;
      const summary = document.createElement("summary");
      summary.innerHTML = "<br>";
      summary.dataset.placeholder = t("editor_summary_placeholder");
      const content = document.createElement("p");
      content.innerHTML = "<br>";
      content.dataset.placeholder = t("editor_details_placeholder");
      details.appendChild(summary);
      details.appendChild(content);
      if (block && block !== editor) block.replaceWith(details);
      else editor?.appendChild(details);
      const r = document.createRange();
      r.setStart(summary, 0);
      r.collapse(true);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      break;
    }

    case "code": {
      const pre = document.createElement("pre");
      pre.spellcheck = false;
      const code = document.createElement("code");
      code.spellcheck = false;
      code.innerHTML = "<br>";
      pre.appendChild(code);
      if (block && block !== editor) block.replaceWith(pre);
      else editor?.appendChild(pre);
      const r = document.createRange();
      r.setStart(code, 0);
      r.collapse(true);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      break;
    }

    case "link":
      if (block && block !== editor) block.innerHTML = "<br>";
      openLinkModal();
      break;

    case "quote":
      if (block && block !== editor) block.innerHTML = "<br>";
      document.execCommand("formatBlock", false, "blockquote");
      break;

    default:
      if (id.startsWith("callout-")) {
        const type = id.replace("callout-", "");
        if (block && block !== editor) block.innerHTML = "<br>";
        document.execCommand("formatBlock", false, "blockquote");
        requestAnimationFrame(() => {
          const sel = window.getSelection();
          const node = sel?.rangeCount
            ? sel.getRangeAt(0).startContainer
            : null;
          const bq = node
            ? (node.nodeType === Node.TEXT_NODE
                ? node.parentElement
                : node
              ).closest("blockquote")
            : null;
          if (bq) bq.dataset.callout = type;
          debouncedSave();
        });
        return;
      }
  }

  debouncedSave();
}

/* ── Inicjalizacja ───────────────────────────── */

export function initSlashMenu() {
  const editor = _getEditor();
  const input = _getInput();
  const menu = _getMenu();
  if (!editor || !input || !menu) return;

  // Trigger: "/" wpisane w pustym bloku najwyższego poziomu
  editor.addEventListener("input", () => {
    if (_open) return;

    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const node = sel.getRangeAt(0).startContainer;
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;

    // Nie otwieraj gdy kursor jest w li, summary ani ich dzieciach
    if (el?.closest("li, summary")) return;

    // Znajdź direct child editora
    let block = el;
    while (block && block.parentElement !== editor) {
      block = block.parentElement;
    }

    // Przypadek: "/" bezpośrednio w edytorze bez wrappera
    if (!block || block === editor) {
      if (editor.textContent === "/") {
        // Owij text node w <p> żeby mieć właściwy blok
        const p = document.createElement("p");
        p.textContent = "/";
        editor.innerHTML = "";
        editor.appendChild(p);
        // Przywróć kursor
        const r = document.createRange();
        r.setStart(p.firstChild, 1);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
        openSlashMenu(p);
      }
      return;
    }

    // Nie otwieraj gdy top-level block to lista lub details
    if (["UL", "OL", "DETAILS"].includes(block.tagName)) return;

    if (block.textContent === "/") openSlashMenu(block);
  });

  // Klawiatura w polu szukania
  input.addEventListener("keydown", (e) => {
    if (!_open) return;

    switch (e.key) {
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        if (_savedBlock) _savedBlock.innerHTML = "<br>";
        closeSlashMenu(true);
        break;

      case "Backspace":
        if (input.value === "") {
          e.preventDefault();
          if (_savedBlock) _savedBlock.innerHTML = "<br>";
          closeSlashMenu(true);
        }
        break;

      case " ":
        e.preventDefault();
        if (_savedBlock) {
          const textNode = document.createTextNode("/ ");
          _savedBlock.innerHTML = "";
          _savedBlock.appendChild(textNode);
          const r = document.createRange();
          r.setStart(textNode, 2);
          r.collapse(true);
          const s = window.getSelection();
          s.removeAllRanges();
          s.addRange(r);
        }
        closeSlashMenu(true);
        break;

      case "Tab":
        e.preventDefault();
        _setActive(
          e.shiftKey
            ? _activeIdx - 1 < 0
              ? _filtered.length - 1
              : _activeIdx - 1
            : (_activeIdx + 1) % _filtered.length,
        );
        break;

      case "ArrowDown":
        e.preventDefault();
        _setActive((_activeIdx + 1) % _filtered.length);
        break;

      case "ArrowUp":
        e.preventDefault();
        _setActive(_activeIdx - 1 < 0 ? _filtered.length - 1 : _activeIdx - 1);
        break;

      case "Enter":
        e.preventDefault();
        e.stopPropagation();
        if (_filtered[_activeIdx]) _execute(_filtered[_activeIdx].id);
        break;
    }
  });

  // Filtrowanie
  input.addEventListener("input", () => {
    _filtered = _filter(input.value);
    _activeIdx = 0;
    _render();
  });

  // Kliknięcie poza — zamknij
  document.addEventListener("mousedown", (e) => {
    if (!_open) return;
    const panel = document.querySelector(".slash-menu__panel");
    if (panel && !panel.contains(e.target)) {
      if (_savedBlock) _savedBlock.innerHTML = "<br>";
      closeSlashMenu(true);
    }
  });
}

// @ts-check
/* ══════════════════════════════════════════════════════════════
   editor.js — toolbar + skróty + markdown + paste + listy
   ══════════════════════════════════════════════════════════════ */
import { saveUiSettings } from './storage.js';
import { debouncedSave, state } from './notes.js';
import { debounce } from './utils.js';
import * as undo from './undo.js';
import { t } from './i18n.js';
import { sanitizeHTMLToBody, MAX_PASTE_LEN } from './sanitize.js';
import { looksLikeUrl, normalizeUrl } from './editor-url.js';
import { initToolbar } from './editor-toolbar.js';
import {
  initLinkClick,
  initLinkButton,
  initLinkModal,
  openLinkModal,
  openLinkModalForElement,
} from './editor-link-modal.js';
import {
  detectSpaceTrigger,
  decideEnterAction,
  decideBackspaceAction,
} from './editor-block-analyzer.js';
import {
  _isCursorAtListStart,
  _outdentListItem,
  _indentListItems,
  _outdentListItems,
  _selectedListItems,
  _normalizeListNesting,
  _saveSelection,
  _restoreSelection,
  _splitListItemKeepingNested,
  _splitBlockAtCaret,
  _mergeListItemBack,
  _continuableList,
  _getCurrentBlock,
  _clearBlock,
  _restoreCursorTo,
  getCursorOffset,
} from './editor-selection.js';
import {
  findInlinePattern,
  findEscapedMarker,
  MD_LINK_RX,
} from './editor-pattern.js';
import { isClickUpHTML, preprocessClickUp } from './editor-paste-clickup.js';
import {
  normalizePastedHTML,
  restoreCopiedListContext,
} from './editor-paste-normalize.js';
import { insertPastedHTML, blocksToQuoteLines } from './editor-paste-insert.js';
import { initSlashMenu } from './editor-slash-menu.js';
import {
  initDragHandle,
  findDragTarget,
  isQuoteLine,
  selectionGroup,
  dragSiblings,
} from './editor-drag-handle.js';
import {
  foldForFind,
  findMatches,
  buildFindIndex,
  rangeAt,
  matchAtOrAfter,
} from './editor-find.js';
import {
  htmlToMarkdown,
  markdownToHtml,
  looksLikeMarkdown,
} from './editor-markdown.js';
import { looksLikeCode } from './editor-code-detect.js';
import { prepareExportHTML } from './editor-copy-export.js';

// #editor jest zawsze w sidebar.html — rzutujemy z pominięciem null.
const editor = /** @type {HTMLElement} */ (document.getElementById('editor'));
/** @param {Event} e @returns {Element|null} */
const _target = (e) => /** @type {Element|null} */ (e.target);
/**
 * Element dla kontenera kursora: text node → parentElement, inaczej sam węzeł.
 * @param {Node} node @returns {Element|null}
 */
const _elOf = (node) =>
  node.nodeType === Node.TEXT_NODE
    ? node.parentElement
    : /** @type {Element} */ (node);
/** @param {string} id @returns {HTMLElement} */
const _byId = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** @param {string} id @returns {HTMLButtonElement} */
const _byBtn = (id) =>
  /** @type {HTMLButtonElement} */ (document.getElementById(id));

function _initEmptyBlockPlaceholder() {
  document.addEventListener('selectionchange', _updateEmptyBlockPlaceholder);
  editor.addEventListener('input', _updateEmptyBlockPlaceholder);
}

function _updateEmptyBlockPlaceholder() {
  if (document.activeElement?.id !== 'editor') {
    editor
      .querySelectorAll('p.is-empty-focused')
      .forEach((p) => p.classList.remove('is-empty-focused'));
    editor.classList.remove('is-empty-focused');
    return;
  }
  const sel = /** @type {Selection} */ (window.getSelection());
  if (!sel?.rangeCount) return;
  const node = sel.getRangeAt(0).startContainer;
  const el = _elOf(node);
  const block = /** @type {HTMLElement|null} */ (el?.closest('#editor > p') ?? null);

  editor
    .querySelectorAll('p.is-empty-focused')
    .forEach((p) => p.classList.remove('is-empty-focused'));

  const placeholder = t('editor_empty_placeholder');

  if (block && block.innerHTML === '<br>') {
    block.dataset.emptyPlaceholder = placeholder;
    block.classList.add('is-empty-focused');
  } else {
    editor.classList.remove('is-empty-focused');
  }

  if (!block && editor.innerHTML === '') {
    editor.dataset.emptyPlaceholder = placeholder;
    editor.classList.add('is-empty-focused');
  }
}

function _initLinkTooltip() {
  const tooltip = _byId('link-tooltip');
  const urlLabel = _byId('link-tooltip-url');
  const copyBtn = _byId('link-tooltip-copy');
  const editBtn = _byId('link-tooltip-edit');
  const delBtn = _byId('link-tooltip-delete');
  if (!tooltip || !urlLabel || !editBtn || !delBtn) return;

  /** @type {HTMLAnchorElement|null} */
  let _currentLink = null;
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let _hideTimer;
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let _copiedTimer; // feedback "Skopiowano" — patrz copyBtn niżej

  /** @param {HTMLAnchorElement} el */
  function _show(el) {
    clearTimeout(_hideTimer);
    // Anuluj pending przywracanie tekstu po kopiowaniu — _show ustawia
    // świeży URL; stary timer przywróciłby adres poprzedniego linku
    clearTimeout(_copiedTimer);
    _currentLink = el;
    const href = el.getAttribute('href') || '';
    urlLabel.textContent = href.length > 50 ? href.slice(0, 47) + '…' : href;
    const rect = el.getBoundingClientRect();
    const tw   = tooltip.getBoundingClientRect().width || 268;
    const left = Math.min(rect.left, window.innerWidth - tw - 8);
    tooltip.style.left = `${Math.max(8, left)}px`;
    tooltip.style.top  = `${rect.bottom + 4}px`;
    tooltip.hidden = false;
  }

  function _hide() {
    _hideTimer = setTimeout(() => {
      tooltip.hidden = true;
      _currentLink = null;
    }, 120);
  }

  editor.addEventListener('mouseover', (e) => {
    const a = /** @type {HTMLAnchorElement|null} */ (_target(e)?.closest('a') ?? null);
    if (!a) return;
    _show(a);
  });

  editor.addEventListener('mouseout', (e) => {
    const a = _target(e)?.closest('a');
    if (!a) return;
    const rel = /** @type {Element|null} */ (e.relatedTarget);
    if (!rel?.closest?.('#link-tooltip')) _hide();
  });

  tooltip.addEventListener('mouseenter', () => clearTimeout(_hideTimer));
  tooltip.addEventListener('mouseleave', _hide);

  editBtn.addEventListener('click', () => {
    if (!_currentLink) return;
    tooltip.hidden = true;
    openLinkModalForElement(_currentLink);
  });

  // Kopiuj adres do schowka. Otwieranie ma teraz zwykły klik na linku
  // (initLinkClick), więc przycisk "otwórz" byłby redundantny.
  copyBtn?.addEventListener('click', async () => {
    if (!_currentLink) return;
    const href = _currentLink.getAttribute('href');
    if (!href) return;
    try {
      await navigator.clipboard.writeText(href);
    } catch {
      // Fallback: starsze konteksty bez clipboard API
      const ta = document.createElement('textarea');
      ta.value = href;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    // Feedback w miejscu URL — wraca po chwili
    clearTimeout(_copiedTimer);
    const prevText = urlLabel.textContent;
    urlLabel.textContent = t('linkTooltip_copied');
    _copiedTimer = setTimeout(() => {
      urlLabel.textContent = prevText;
    }, 1200);
  });

  delBtn.addEventListener('click', () => {
    if (!_currentLink) return;
    const parent = _currentLink.parentNode;
    if (!parent) return;
    while (_currentLink.firstChild) {
      parent.insertBefore(_currentLink.firstChild, _currentLink);
    }
    parent.removeChild(_currentLink);
    tooltip.hidden = true;
    _currentLink = null;
    undo.checkpoint();
    document.dispatchEvent(new Event('forceSave'));
  });
}

// ── Callout label inline edit ─────────────────────────────────────
editor.addEventListener('dblclick', (e) => {
  const bq = _target(e)?.closest('blockquote[data-callout]');
  if (!bq) return;
  const bqEl = /** @type {HTMLElement} */ (bq);

  const rect = bqEl.getBoundingClientRect();
  if (e.clientY > rect.top + 24) return;
  if (bq.classList.contains('is-editing-label')) return;

  e.preventDefault();

  bq.classList.add('is-editing-label');

  const input = document.createElement('input');
  input.type = 'text';
  input.value = bqEl.dataset.calloutLabel ?? '';
  input.className = 'callout-label-input';
  bq.insertBefore(input, bq.firstChild);
  input.focus();
  input.select();

  function _commit() {
    const val = input.value.trim();
    if (val) bqEl.dataset.calloutLabel = val;
    input.remove();
    bqEl.classList.remove('is-editing-label');
    undo.checkpoint();
    document.dispatchEvent(new Event('forceSave'));
  }

  input.addEventListener('blur', _commit);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      _commit();
    }
    if (ev.key === 'Escape') {
      input.remove();
      bq.classList.remove('is-editing-label');
    }
  });
});

export function initEditor() {
  // Wymuś <p> jako block separator zamiast <div>
  document.execCommand('defaultParagraphSeparator', false, 'p');

  undo.init(editor);
  _initUndoRedoBtns();
  initToolbar();
  _initKeydown();
  _initFind();
  _initInlineExit();
  _initPaste();
  _initCopy();
  _initCopyMarkdown();
  _initCursorResume();
  _initEmptyBlockPlaceholder();
  initLinkClick();
  initLinkButton();
  initLinkModal();
  initSlashMenu();
  _initDragHandle();
  editor.addEventListener('input', debouncedSave);

  // Wyłącz spellcheck w istniejących blokach kodu, i linkach
  editor.querySelectorAll('pre, code, a').forEach((el) => {
    /** @type {HTMLElement} */ (el).spellcheck = false;
  });

  // Wyłącz spellcheck w nowo dodanych blokach kodu
  new MutationObserver((mutations) => {
    mutations.forEach((m) =>
      m.addedNodes.forEach((raw) => {
        if (raw.nodeType !== Node.ELEMENT_NODE) return;
        const node = /** @type {HTMLElement} */ (raw);
        if (node.matches('pre, code, a')) node.spellcheck = false;
        node
          .querySelectorAll?.('pre, code, a')
          .forEach((el) => (/** @type {HTMLElement} */ (el).spellcheck = false));
      }),
    );
  }).observe(editor, { childList: true, subtree: true });
  _initLinkTooltip();
}

/* Uchwyt ⠿ w lewym marginesie — przenoszenie bloków myszą (to samo co
   Alt+↑/↓). Krok cofania przed i po, a zdarzenie input uruchamia zwykły
   zapis i odświeża przyciski Cofnij/Ponów. */
function _initDragHandle() {
  const container = document.getElementById('editor-container');
  if (!container) return;
  initDragHandle(editor, container, {
    title: (kind) =>
      t(
        kind === 'list'
          ? 'editor_dragHandle_list'
          : kind === 'item'
            ? 'editor_dragHandle_item'
            : kind === 'line'
              ? 'editor_dragHandle_line'
              : 'editor_dragHandle_title',
      ),
    toQuoteLines: (blocks) => blocksToQuoteLines(blocks),
    beforeMove: () => undo.checkpoint(),
    afterMove: (
      /** @type {HTMLElement[]} */ items,
      /** @type {Range|null} */ selection,
    ) => {
      undo.checkpoint();
      // Przeniesiona grupa zostaje zaznaczona — można ją przesunąć dalej
      if (selection) {
        editor.focus();
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(selection);
      } else {
        _restoreCursorTo(items[0]);
      }
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    },
  });
}

function _initUndoRedoBtns() {
  const undoBtn = _byBtn('undo-btn');
  const redoBtn = _byBtn('redo-btn');

  function _updateUndoRedoState() {
    if (undoBtn) undoBtn.disabled = !undo.canUndo();
    if (redoBtn) redoBtn.disabled = !undo.canRedo();
  }

  undoBtn?.addEventListener('click', () => {
    undo.undo();
    debouncedSave();
    _updateUndoRedoState();
  });

  redoBtn?.addEventListener('click', () => {
    undo.redo();
    debouncedSave();
    _updateUndoRedoState();
  });

  editor.addEventListener('input', _updateUndoRedoState);
  _updateUndoRedoState();

  // Eksponuj dla _handleCtrl
  _updateUndoRedoStateGlobal = _updateUndoRedoState;
}

// Wypełniane przez _initUndoRedoBtns — wywoływane z _handleCtrl
let _updateUndoRedoStateGlobal = () => {};

/* ── List item helpers → editor-selection.js ─── */

// _getListItem → editor-selection.js

// _isCursorAtListStart → editor-selection.js

// _focusLi → editor-selection.js

// _indentListItem → editor-selection.js

// _outdentListItem → editor-selection.js

// initLinkClick, initLinkButton, link modal → editor-link-modal.js

/* ── Toolbar ──────────────────────────────────── */

// _initToolbar → editor-toolbar.js

// _initCodeBtn → editor-toolbar.js

// _initCodeBlockBtn → editor-toolbar.js

/* ── Checklist ─────────────────────────────────── */

/**
 * Inicjalizuje przycisk checklisty w toolbarze + handler kliknięcia na checkbox.
 *
 * Checklist HTML: <ul data-list="checklist"><li data-checked="false">…</li></ul>
 * Checkbox jest obszarem ::before (pierwsze ~22px od lewej krawędzi li).
 * Kliknięcie w ten obszar toggleuje data-checked bez ruszania kursora.
 */
// _initChecklistBtn → editor-toolbar.js

/**
 * Toggleuje checklistę:
 * - kursor w zwykłym bloku → konwertuje do checklist item
 * - kursor w checklist item → konwertuje cały <ul> z powrotem do paragrafów
 */
// _toggleChecklist → editor-toolbar.js

/* ── Inline markdown ──────────────────────────── */

/**
 * Wykrywa wzorzec inline markdown na końcu textBefore.
 * Trigger następuje na ZAMYKAJĄCYM markerze — analogicznie do Typora/Obsidian.
 *
 *  **bold**   → <strong>  trigger: 2. '*', textBefore kończy się "**treść*"
 *  *italic*   → <em>      trigger: '*',    textBefore kończy się "*treść"
 *  ~~strike~~ → <s>       trigger: 2. '~', textBefore kończy się "~~treść~"
 *  `code`     → <code>    trigger: '`',    textBefore kończy się "`treść"
 *
 * Checklist (-[ ], -[x]) pozostaje blokiem (trigger: spacja) — osobna logika.
 *
 * @param {string} textBefore  tekst w węźle przed kursorem
 * @param {string} key         klawisz który właśnie naciśnięto
 * @returns {{ content, openIdx, markerLen, tag } | null}
 */
/* ── Callout blocks ───────────────────────────── */

/**
 * Typy calloutów — muszą być spójne z CSS (.callout--note itp.),
 * markdown parserem i sanitize.js (ALLOWED_ATTRS BLOCKQUOTE).
 */
const CALLOUT_TYPES = ['note', 'tip', 'important', 'warning', 'caution'];

/**
 * Inicjalizuje split button blockquote/callout.
 *
 * Lewy przycisk (#blockquote-btn):
 *   - Wstawia zwykły blockquote LUB zmienia typ callouta gdy kursor jest
 *     już w blockquote (toggle: plain → plain, callout → plain)
 *
 * Prawy przycisk (#blockquote-arrow):
 *   - Otwiera/zamyka dropdown z typami
 *
 * Dropdown items (data-callout="note|tip|..."|""):
 *   - Wstawia callout danego typu lub zmienia typ istniejącego
 */
// _initCalloutBtn → editor-toolbar.js

// _closeCalloutDropdown → editor-toolbar.js

// _initListBtn → editor-toolbar.js

// _closeListDropdown → editor-toolbar.js

/**
 * Wstawia lub modyfikuje callout block.
 *
 * @param {string} type  'note'|'tip'|'important'|'warning'|'caution'|'' (plain)
 *
 * Przypadki:
 * A) Kursor w istniejącym blockquote:
 *    - type === '' → usuń data-callout (zamień na plain blockquote)
 *    - type === aktualny → usuń blockquote całkowicie (toggle off)
 *    - type !== aktualny → zmień data-callout
 * B) Kursor poza blockquote:
 *    - Wstaw nowy blockquote z execCommand, opcjonalnie dodaj data-callout
 */
// _applyCallout → editor-toolbar.js

// findInlinePattern → editor-pattern.js

/**
 * Próbuje zamienić inline markdown na element HTML.
 * Wywoływane z _initKeydown gdy user wpisuje *, ~ lub `.
 *
 * DOM operation:
 *   [przed...otwierający_marker...treść...już_wpisany_zamkn] ← węzeł tekstu
 *   preventDefault pochłania drugi/jedyny zamykający znak
 *   Wynik: [przed] <tag>treść</tag> [po]
 *
 * @returns {boolean} true gdy konwersja się udała
 */
/** @param {KeyboardEvent} e */
function _tryInlineMarkdown(e) {
  const sel = /** @type {Selection} */ (window.getSelection());
  if (!sel.rangeCount || !sel.getRangeAt(0).collapsed) return false;

  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return false;

  // Nie konwertuj wewnątrz <code>/<pre> — zagnieżdżanie bez sensu
  if (node.parentElement?.closest('code, pre')) return false;

  const offset = range.startOffset;
  const textBefore = (node.textContent ?? "").slice(0, offset);

  // Escape ma pierwszeństwo: `\*` to prośba o literalną gwiazdkę, więc
  // zjadamy backslash i wstawiamy sam znak, zamiast formatować.
  const escaped = findEscapedMarker(textBefore, e.key);
  if (escaped) {
    e.preventDefault();
    undo.checkpoint();
    const full = node.textContent ?? '';
    node.textContent =
      full.slice(0, escaped.backslashIdx) + escaped.literal + full.slice(offset);
    const caret = escaped.backslashIdx + escaped.literal.length;
    const r = document.createRange();
    r.setStart(node, caret);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    return true;
  }

  const pattern = findInlinePattern(textBefore, e.key);
  if (!pattern) return false;

  const { content, openIdx, markerLen, tag } = pattern;

  e.preventDefault();
  undo.checkpoint();

  const fullText = node.textContent ?? "";
  const before = fullText.slice(0, openIdx); // tekst przed otwierającym markerem
  const after = fullText.slice(offset); // tekst za kursorem

  // Stwórz element formatowania z czystą treścią (bez markerów)
  let el;
  if (tag === 'strong-em') {
    el = document.createElement('strong');
    const inner = document.createElement('em');
    inner.textContent = content;
    el.appendChild(inner);
  } else {
    el = document.createElement(tag);
    el.textContent = content;
  }

  // Podmień bieżący węzeł tekstowy:
  //   [przed] [**treść*|po] → [przed] <tag>treść</tag> [po]
  // Modyfikujemy istniejący węzeł (nie usuwamy) — zachowuje referencje
  const parent = node.parentNode;
  if (!parent) return false;
  const nextSib = node.nextSibling;

  node.textContent = before; // "przed"
  parent.insertBefore(el, nextSib); // <tag>
  const afterNode = document.createTextNode(after);
  parent.insertBefore(afterNode, el.nextSibling); // "po"

  // Kursor bezpośrednio za sformatowanym elementem (start węzła "po")
  const r = document.createRange();
  r.setStart(afterNode, 0);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
  // Pusty węzeł tekstowy za elementem nie wystarczy: przeglądarka i tak dokleja
  // pierwszy wpisany znak DO ŚRODKA elementu (`kod` + "dalej" = <code>koddalej
  // </code>) i z klawiatury nie dało się z formatowania wyjść. Przejmujemy
  // więc ten jeden znak — patrz _initInlineExit.
  _pendingInlineExit = { el, afterNode, offset: 0 };

  undo.checkpoint();
  document.dispatchEvent(new Event('forceSave'));
  return true;
}

/* ── Wyjście z właśnie utworzonego formatowania ─────────────────
   Dotyczy tylko PIERWSZEGO znaku po konwersji `kod`, **pogrubienia**, linku
   z [tekst](url) i autolinku. Potem kursor stoi w zwykłym węźle tekstowym
   i nic nie trzeba robić.

   Dwa zachowania przeglądarki, które trzeba wyprzedzić:
   1. pusty węzeł tekstowy za elementem nie trzyma kursora — pierwszy znak
      wpada DO ŚRODKA elementu (`kod` + "dalej" = <code>koddalej</code>),
   2. końcowa spacja za linkiem jest „nieznacząca" i Chromium PODMIENIA ją
      na wpisany znak — po [tekst](url) + spacja + "dalej" wychodziło
      „tekstdalej" bez odstępu.
   W obu wypadkach przejmujemy ten jeden znak i wstawiamy go sami. */

/** @type {{ el: Element, afterNode: Text, offset: number } | null} */
let _pendingInlineExit = null;

/**
 * Czy kursor stoi na samym końcu zawartości elementu.
 * @param {Element} el @param {Range} range
 */
function _caretAtEndOf(el, range) {
  const probe = document.createRange();
  probe.selectNodeContents(el);
  probe.setStart(range.startContainer, range.startOffset);
  return probe.toString() === '';
}

function _initInlineExit() {
  editor.addEventListener('beforeinput', (e) => {
    const pending = _pendingInlineExit;
    if (!pending) {
      _typeOutOfClonedCode(e);
      return;
    }
    _pendingInlineExit = null;

    if (e.inputType !== 'insertText' || typeof e.data !== 'string') return;
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (!range.collapsed) return;
    if (!pending.afterNode.isConnected || !pending.el.isConnected) return;

    // Kursor musi stać tam, gdzie go zostawiliśmy — w węźle "po" albo (gdy
    // przeglądarka wciągnęła go z powrotem) na końcu samego elementu
    const inAfterNode =
      range.startContainer === pending.afterNode &&
      range.startOffset === pending.offset;
    const atElEnd =
      pending.el.contains(range.startContainer) &&
      _caretAtEndOf(pending.el, range);
    if (!inAfterNode && !atElEnd) return;

    e.preventDefault();
    const text = pending.afterNode.textContent ?? '';
    const at = Math.min(pending.offset, text.length);
    pending.afterNode.textContent = text.slice(0, at) + e.data + text.slice(at);
    const r = document.createRange();
    r.setStart(pending.afterNode, at + e.data.length);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    debouncedSave();
  });
}

/**
 * Ten sam pusty klon <code>, ale gdy użytkownik pisze SZYBCIEJ niż zdąży się
 * wykonać sprzątanie z requestAnimationFrame. Znak wstawiamy wtedy sami —
 * obok kodu, nie w nim.
 *
 * @param {InputEvent} e
 */
function _typeOutOfClonedCode(e) {
  if (e.inputType !== 'insertText' || typeof e.data !== 'string') return;
  const sel = window.getSelection();
  if (!sel?.rangeCount || !sel.getRangeAt(0).collapsed) return;

  const code = _elOf(sel.getRangeAt(0).startContainer)?.closest('code');
  if (!code || code.closest('pre')) return;
  if ((code.textContent ?? '').length) return;
  const block = code.parentElement;
  if (!block || block === editor || block.firstElementChild !== code) return;

  e.preventDefault();
  const text = document.createTextNode(e.data);
  code.replaceWith(text);
  const r = document.createRange();
  r.setStart(text, e.data.length);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
  debouncedSave();
}

/**
 * Po Enterze na końcu inline'owego `kodu` przeglądarka zaczyna nowy akapit
 * pustym <code> — i dalej pisze się w kodzie, bez wyjścia z klawiatury
 * (jedyną drogą była mysz albo Ctrl+\\). Pusty klon rozpakowujemy.
 *
 * Tylko PUSTY i tylko na początku bloku: kod z treścią to świadomy wybór
 * użytkownika, a <pre> w ogóle tu nie wchodzi (to osobny blok).
 */
function _dropClonedInlineCode() {
  const sel = window.getSelection();
  if (!sel?.rangeCount) return;
  const block = _getCurrentBlock();
  if (!block || block === editor || block.closest('pre')) return;

  const first = block.firstElementChild;
  if (!first || first.tagName !== 'CODE') return;
  if ((first.textContent ?? '').length) return;

  first.replaceWith(...Array.from(first.childNodes));
  if (!block.firstChild) block.appendChild(document.createElement('br'));

  const r = document.createRange();
  r.setStart(block, 0);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

/* ── Keydown ──────────────────────────────────── */

function _initKeydown() {
  editor.addEventListener('keydown', (e) => {
    // Ctrl+↑/↓ — poprzednia / następna notatka z listy
    if (
      (e.ctrlKey || e.metaKey) &&
      (e.key === 'ArrowUp' || e.key === 'ArrowDown')
    ) {
      e.preventDefault();
      _exitToList(e.key === 'ArrowUp' ? 'prev' : 'next');
      return;
    }

    // Alt+↑/↓ — przesuń blok / element listy w górę lub w dół
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      _handleAltArrow(e);
      return;
    }

    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      undo.checkpoint();
      document.execCommand('insertLineBreak');
      return;
    }
    // Ctrl+Enter należy do globalnego skrótu "ukończ zadanie" (app.js) —
    // bez tego przy okazji rozbijałby akapit w miejscu kursora.
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      return;
    }
    // Esc przy otwartym pasku Znajdź zamyka pasek, nie notatkę — tak jak
    // w przeglądarce. Dopiero drugi Esc wraca na listę (app.js).
    if (e.key === 'Escape' && !_findBar()?.hidden) {
      e.preventDefault();
      e.stopPropagation();
      closeFindBar(true);
      return;
    }

    if (e.key === 'Enter') _handleEnter(e);
    if (e.key === ' ') _handleSpace(e);
    if (e.key === 'Tab') _handleTab(e);
    if (e.key === 'Backspace') _handleBackspace(e);
    if (e.ctrlKey || e.metaKey) _handleCtrl(e);

    // Inline markdown — trigger na zamykającym markerze (* ~ `)
    // Po innych handlerach: Enter/Space/Backspace/Ctrl mają priorytet.
    // Jeśli żaden z nich nie zareagował, próbujemy inline konwersję.
    if (!e.defaultPrevented && !e.ctrlKey && !e.metaKey) {
      if (['*', '_', '~', '`'].includes(e.key)) _tryInlineMarkdown(e);
    }
  });

  // Ctrl+S w całym sidebarze — natychmiastowy save (nie debounced)
  // Zarejestrowany na document, nie editor — żeby działał też z fokusem na tytule
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      const active = document.activeElement;
      if (active?.id !== 'editor' && active?.id !== 'title') return;
      e.preventDefault();
      // wymuś save: debouncedSave czeka 600ms, my chcemy natychmiast
      _flushSave();
    }
  });

  // Toolbar active state — zarejestrowane w initToolbar()
}
/* ── Sąsiednia notatka (Ctrl+↑/↓) ─────────────── */

/** @param {'prev'|'next'} direction */
function _exitToList(direction) {
  // Znajdź obecnie aktywny element listy (is-active) lub pierwszy
  const activeId = state.activeId;
  const list = _byId('notesList');
  if (!list) return;

  let target = null;
  if (activeId) {
    const current = list.querySelector(`.note-item[data-id="${activeId}"]`);
    if (current) {
      let sibling =
        direction === 'prev'
          ? current.previousElementSibling
          : current.nextElementSibling;
      while (sibling && !sibling.classList.contains('note-item')) {
        sibling =
          direction === 'prev'
            ? sibling.previousElementSibling
            : sibling.nextElementSibling;
      }
      target = sibling ?? current;
    }
  }

  // Fallback: gdy nie ma activeId lub activeId nie ma w liście (zafiltrowany)
  // — pierwszy/ostatni element listy
  if (!target) {
    const items = list.querySelectorAll('.note-item');
    if (items.length === 0) return;
    target = direction === 'prev' ? items[items.length - 1] : items[0];
  }

  // Lista jest na ekranie notatki schowana (app.js: "Dwa ekrany") — fokus na
  // niewidocznym wierszu nic by nie dał. app.js otwiera wskazaną notatkę.
  document.dispatchEvent(
    new CustomEvent('openAdjacentNote', {
      detail: { id: /** @type {HTMLElement} */ (target).dataset.id },
    }),
  );
}

/* ── Force save (Ctrl+S) ──────────────────────── */

function _flushSave() {
  // Trigger save bez czekania na debounce.
  // debouncedSave to wrapper na saveActiveNote; potrzebujemy bezpośrednio.
  // Ale nie chcemy importu cyklicznego — używamy CustomEvent.
  document.dispatchEvent(new CustomEvent('forceSave'));
}

/* ── Toolbar active state ─────────────────────── */

// _updateToolbarState → editor-toolbar.js

/**
 * Stawia kursor w styku po scaleniu punktów listy — tam, gdzie kończyła się
 * treść poprzednika, żeby kolejny znak dopisał się w miejsce usuniętej granicy.
 *
 * @param {Element} prev punkt, do którego scalono
 * @param {{ node: Node|null, offset: number }} seam wynik _mergeListItemBack
 * @param {Selection} selection
 */
function _placeCaretAtMergeSeam(prev, seam, selection) {
  const r = document.createRange();
  if (seam.node?.nodeType === Node.TEXT_NODE) r.setStart(seam.node, seam.offset);
  else if (seam.node) r.setStartAfter(seam.node);
  else r.setStart(prev, 0);
  r.collapse(true);
  selection.removeAllRanges();
  selection.addRange(r);
}

/** @param {KeyboardEvent} e */
function _handleEnter(e) {
  const sel = /** @type {Selection} */ (window.getSelection());
  if (!sel.rangeCount) return;

  // Enter na końcu `kodu`: przeglądarka klonuje <code> do nowego akapitu
  // i dalej pisze się w kodzie. Sprzątamy to po podziale — patrz
  // _dropClonedInlineCode.
  requestAnimationFrame(_dropClonedInlineCode);

  // Shift+Enter w liście — soft break wewnątrz <li>
  if (e.shiftKey) {
    const _node = sel.getRangeAt(0).startContainer;
    const _el = _elOf(_node);
    if (!_el) return;
    if (_el.closest('li')) {
      e.preventDefault();
      document.execCommand('insertLineBreak');
      return;
    }
  }

  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  const element = _elOf(node);
  if (!element) return;

  // ── Zbierz kontekst (DOM queries) ────────────────────────────
  const pre = element.closest('pre');
  const heading = element.closest('h1, h2, h3');
  const checklistLi = element.closest('ul[data-list="checklist"] li');
  const li = element.closest('li');
  const summary = element.closest('summary');
  const detailsBlock = !summary
    ? element.closest('details > :not(summary)')
    : null;
  const inDetailsContent = !!detailsBlock;
  const detailsContentEmpty = detailsBlock
    ? detailsBlock.textContent.trim() === ''
    : false;
  const blockquote = element.closest('blockquote');

  const block = _getCurrentBlock();
  const isHrTrigger =
    !li && !blockquote && block && /^---$/.test(block.textContent.trim());

  // Hard line break: dwie spacje na końcu tekstu przed kursorem
  const textBeforeCursor =
    range.startContainer.nodeType === Node.TEXT_NODE
      ? (range.startContainer.textContent ?? "").slice(0, range.startOffset)
      : '';
  const hasTrailingSpaces =
    !pre && !li && !blockquote && / {2,}$/.test(textBeforeCursor);

  // Pre context
  let preIsExiting = false;
  if (pre) {
    const code = pre.querySelector('code') ?? pre;
    preIsExiting = /(<br\s*\/?>){2,}\s*$/.test(code.innerHTML);
  }

  // Heading context — pozycja kursora względem treści nagłówka
  let headingAtStart = false,
    headingHasTextAfter = false;
  if (heading) {
    const probeBefore = document.createRange();
    probeBefore.selectNodeContents(heading);
    probeBefore.setEnd(range.startContainer, range.startOffset);
    headingAtStart = probeBefore.toString().trim() === '';
    const probeAfter = document.createRange();
    probeAfter.selectNodeContents(heading);
    probeAfter.setStart(range.startContainer, range.startOffset);
    headingHasTextAfter = probeAfter.toString().trim() !== '';
  }

  // Checklist context
  const checklistEmpty = checklistLi
    ? checklistLi.textContent.trim() === ''
    : false;
  // Sonda kończy się PRZED podlistą — tekst zagnieżdżonych punktów nie jest
  // "treścią za kursorem" w tym punkcie. Odwrócony zakres DOM zwija do
  // pustego, więc kursor za podlistą po prostu daje false.
  let checklistHasTextAfter = false;
  if (checklistLi) {
    const clNested = checklistLi.querySelector(':scope > ul, :scope > ol');
    const probe = document.createRange();
    probe.setStart(range.startContainer, range.startOffset);
    if (clNested) probe.setEndBefore(clNested);
    else probe.setEnd(checklistLi, checklistLi.childNodes.length);
    checklistHasTextAfter = probe.toString().trim() !== '';
  }

  // Li context
  let liEmpty = false,
    liIsLast = false,
    liIsNested = false,
    liHasNestedList = false;
  if (li) {
    liEmpty = li.textContent.trim() === '';
    liIsLast = li === li.parentElement?.lastElementChild;
    liIsNested = li.parentElement?.parentElement?.tagName === 'LI';
    // :scope — liczy się WŁASNA podlista, nie dowolna w głąb drzewa
    liHasNestedList = !!li.querySelector(':scope > ul, :scope > ol');
  }

  // Blockquote context
  let bqLineEmpty = false,
    bqIsLastBlock = false,
    bqPrevEmpty = false,
    bqHasTextAfter = false;
  if (blockquote) {
    const curBlock =
      block !== editor && block?.parentNode === blockquote ? block : null;
    bqLineEmpty = curBlock
      ? curBlock.textContent.trim() === ''
      : blockquote.textContent.trim() === '';
    bqIsLastBlock = !curBlock || curBlock === blockquote.lastElementChild;
    bqPrevEmpty = curBlock?.previousElementSibling
      ? curBlock.previousElementSibling.textContent.trim() === ''
      : false;
    // Sonda po bieżącej linii; gdy cytat nie ma jeszcze bloków, po całym
    // cytacie — handler owinie treść w <p> przed podziałem.
    const probe = document.createRange();
    probe.selectNodeContents(curBlock ?? blockquote);
    probe.setStart(range.startContainer, range.startOffset);
    bqHasTextAfter = probe.toString().trim() !== '';
  }

  // ── Decyzja (czysta funkcja) ──────────────────────────────────
  const decision = decideEnterAction({
    inSummary: !!summary,
    inDetailsContent,
    detailsContentEmpty,
    inPre: !!pre,
    preIsExiting,
    inHeading: !!heading,
    headingAtStart,
    headingHasTextAfter,
    inChecklistLi: !!checklistLi,
    checklistEmpty,
    checklistHasTextAfter,
    inLi: !!li && !checklistLi,
    liEmpty,
    liIsLast,
    liIsNested,
    liHasNestedList,
    inBlockquote: !!blockquote,
    bqLineEmpty,
    bqIsLastBlock,
    bqHasTextAfter,
    bqPrevEmpty,
    isHrTrigger: !!isHrTrigger,
    hasTrailingSpaces,
  });

  // ── Wykonaj akcję ─────────────────────────────────────────────
  switch (decision.action) {
    case 'pre-exit': {
      if (!pre) break;
      e.preventDefault();
      const code2 = pre.querySelector('code') ?? pre;
      code2.innerHTML = code2.innerHTML.replace(/(<br\s*\/?>){2,}\s*$/, '');
      if (!code2.firstChild) code2.innerHTML = '<br>';
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      pre.after(p);
      const r = document.createRange();
      r.setStart(p, 0);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }

    case 'pre-linebreak': {
      e.preventDefault();
      document.execCommand('insertLineBreak');
      return;
    }

    case 'heading-new-para': {
      if (!heading) break;
      e.preventDefault();
      undo.checkpoint();
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      heading.after(p);
      const r = document.createRange();
      r.setStart(p, 0);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }

    case 'heading-para-before': {
      if (!heading) break;
      // Enter na początku nagłówka — pusty akapit nad nim, kursor zostaje
      e.preventDefault();
      undo.checkpoint();
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      heading.before(p);
      return;
    }

    case 'heading-split': {
      if (!heading) break;
      // Enter w środku nagłówka — tekst za kursorem wędruje do akapitu niżej
      e.preventDefault();
      undo.checkpoint();
      const splitRange = document.createRange();
      splitRange.selectNodeContents(heading);
      splitRange.setStart(range.startContainer, range.startOffset);
      const frag = splitRange.extractContents();
      const p = document.createElement('p');
      p.appendChild(frag);
      if (!p.firstChild) p.innerHTML = '<br>';
      heading.after(p);
      if (!heading.firstChild) heading.innerHTML = '<br>';
      const r = document.createRange();
      r.setStart(p, 0);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }

    case 'checklist-exit': {
      if (!checklistLi) break;
      e.preventDefault();
      undo.checkpoint();
      const ul = checklistLi.closest('ul');
      if (!ul) break;
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      ul.after(p);
      checklistLi.remove();
      if (ul.children.length === 0) ul.remove();
      const r = document.createRange();
      r.setStart(p, 0);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }

    case 'checklist-split': {
      if (!checklistLi) break;
      e.preventDefault();
      undo.checkpoint();
      // Ten sam podział co w zwykłej liście — punkt checklisty to też <li>,
      // który może mieć podlistę. Nowy punkt zawsze niezaznaczony: przenosi
      // ogon zdania, a nie stan wykonania oryginału.
      const splitLi = _splitListItemKeepingNested(checklistLi, range);
      splitLi.setAttribute('data-checked', 'false');
      const r = document.createRange();
      r.setStart(splitLi, 0);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }

    case 'blockquote-split': {
      if (!blockquote) break;
      e.preventDefault();
      undo.checkpoint();
      let curBlockSplit =
        block !== editor && block?.parentNode === blockquote ? block : null;
      if (!curBlockSplit) {
        // Cytat bez bloków — owijamy treść w <p>. Range trzyma się węzłów,
        // więc kursor przeżywa przeniesienie ich do wrappera.
        const wrapper = document.createElement('p');
        while (blockquote.firstChild) wrapper.appendChild(blockquote.firstChild);
        blockquote.appendChild(wrapper);
        curBlockSplit = wrapper;
      }
      const newP = _splitBlockAtCaret(curBlockSplit, range, 'p');
      const r = document.createRange();
      r.setStart(newP, 0);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }

    case 'checklist-new-item': {
      if (!checklistLi) break;
      e.preventDefault();
      undo.checkpoint();
      const newLi = document.createElement('li');
      newLi.setAttribute('data-checked', 'false');
      newLi.innerHTML = '<br>';
      checklistLi.after(newLi);
      const r = document.createRange();
      r.setStart(newLi, 0);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }

    case 'li-outdent': {
      if (!li) break;
      e.preventDefault();
      undo.checkpoint();
      _outdentListItem(li);
      return;
    }

    case 'li-exit': {
      if (!li) break;
      e.preventDefault();
      undo.checkpoint();
      const list = li.parentElement;
      if (!list) break;
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      list.after(p);
      li.remove();
      if (list.children.length === 0) list.remove();
      const r = document.createRange();
      r.setStart(p, 0);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }

    case 'li-split': {
      if (!li) break;
      e.preventDefault();
      undo.checkpoint();
      const newLi = document.createElement('li');
      newLi.appendChild(document.createElement('br'));
      li.after(newLi);
      const r = document.createRange();
      r.setStart(newLi, 0);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }

    case 'li-split-nested': {
      if (!li) break;
      e.preventDefault();
      undo.checkpoint();
      const newLi = _splitListItemKeepingNested(li, range);
      const r = document.createRange();
      r.setStart(newLi, 0);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }

    case 'blockquote-exit': {
      if (!blockquote) break;
      e.preventDefault();
      undo.checkpoint();
      const curBlock2 =
        block !== editor && block?.parentNode === blockquote ? block : null;
      const prevSib = curBlock2?.previousElementSibling ?? null;
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      blockquote.after(p);
      if (curBlock2) curBlock2.remove();
      if (prevSib) prevSib.remove();
      if (!blockquote.children.length || !blockquote.textContent.trim())
        blockquote.remove();
      const r = document.createRange();
      r.setStart(p, 0);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }

    case 'blockquote-new-para': {
      if (!blockquote) break;
      e.preventDefault();
      undo.checkpoint();
      const curBlock3 =
        block !== editor && block?.parentNode === blockquote ? block : null;
      if (!curBlock3) {
        const wrapper = document.createElement('p');
        while (blockquote.firstChild)
          wrapper.appendChild(blockquote.firstChild);
        blockquote.appendChild(wrapper);
      }
      const newP = document.createElement('p');
      newP.innerHTML = '<br>';
      if (curBlock3) {
        curBlock3.after(newP);
      } else {
        blockquote.appendChild(newP);
      }
      const r = document.createRange();
      r.setStart(newP, 0);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }

    case 'summary-to-content': {
      if (!summary) break;
      e.preventDefault();
      const details = summary.closest('details');
      if (!details) break;
      let content = details.querySelector(':scope > :not(summary)');
      if (!content) {
        content = document.createElement('p');
        content.innerHTML = '<br>';
        details.appendChild(content);
      }
      const r = document.createRange();
      r.setStart(content, 0);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }

    case 'details-exit': {
      if (!detailsBlock) break;
      e.preventDefault();
      undo.checkpoint();
      const details = detailsBlock.closest('details');
      if (!details) break;
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      details.after(p);
      detailsBlock.remove();
      const r = document.createRange();
      r.setStart(p, 0);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }

    case 'hr-insert': {
      e.preventDefault();
      _clearBlock(block);
      document.execCommand('insertHorizontalRule');
      setTimeout(() => document.execCommand('insertParagraph'), 0);
      return;
    }

    case 'hard-break': {
      e.preventDefault();
      undo.checkpoint();
      // Usuń trailing spacje z węzła tekstowego
      const tn = range.startContainer;
      if (tn.nodeType === Node.TEXT_NODE) {
        const _t = tn.textContent ?? '';
        tn.textContent =
          _t.slice(0, range.startOffset).trimEnd() + _t.slice(range.startOffset);
      }
      // Wstaw <br> w miejscu kursora
      document.execCommand('insertLineBreak');
      return;
    }

    // default: pozwól przeglądarce
  }
}
/* ── Markdown link konwersja ──────────────────── */

// MD_LINK_RX → editor-pattern.js

/** @param {KeyboardEvent} e */
function _tryConvertMarkdownLink(e) {
  const sel = /** @type {Selection} */ (window.getSelection());
  if (!sel.rangeCount) return false;

  const range = sel.getRangeAt(0);
  if (!range.collapsed) return false; // user ma zaznaczenie — nie ingeruj

  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return false;

  const offset = range.startOffset;
  const textBeforeCursor = (node.textContent ?? "").slice(0, offset);

  const match = textBeforeCursor.match(MD_LINK_RX);
  if (!match) return false;

  const [fullMatch, linkText, linkUrl] = match;

  // Pusty tekst → użyj URL jako displayed text
  const displayText = linkText.trim() || linkUrl;

  // Walidacja URL — bardzo luźna, ale odrzuć oczywiste śmieci
  if (!looksLikeUrl(linkUrl)) return false;

  e.preventDefault();
  undo.checkpoint();

  // Usuń [tekst](url) z text node
  const matchStart = offset - fullMatch.length;
  const before = (node.textContent ?? "").slice(0, matchStart);
  const after = (node.textContent ?? "").slice(offset);

  // Stwórz <a>
  const finalUrl = normalizeUrl(linkUrl);

  const a = document.createElement('a');
  a.href = finalUrl;
  a.textContent = displayText;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.title = t('editor_link_openHint');

  // Spacja po linku (zamiast oryginalnej, którą blokujemy preventDefault)
  const spaceNode = document.createTextNode(' ');

  // Zastąp content text node-a: before + <a> + " " + after
  const parent = node.parentNode;
  if (!parent) return false;
  const beforeNode = document.createTextNode(before);
  const afterNode = document.createTextNode(after);

  parent.insertBefore(beforeNode, node);
  parent.insertBefore(a, node);
  parent.insertBefore(spaceNode, node);
  parent.insertBefore(afterNode, node);
  parent.removeChild(node);

  // Postaw kursor po spacji
  const r = document.createRange();
  r.setStart(spaceNode, 1);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
  // Ta spacja jest na końcu akapitu, więc przeglądarka uważa ją za
  // nieznaczącą i podmieniłaby ją na pierwszy wpisany znak — patrz
  // _initInlineExit
  _pendingInlineExit = { el: a, afterNode: spaceNode, offset: 1 };

  return true;
}

/** @param {KeyboardEvent} e */
function _tryAutolinkWord(e) {
  const sel = /** @type {Selection} */ (window.getSelection());
  if (!sel?.rangeCount || !sel.getRangeAt(0).collapsed) return false;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return false;
  if (node.parentElement?.closest('a, code, pre')) return false;

  const textBefore = (node.textContent ?? "").slice(0, range.startOffset);
  // Ostatnie słowo (bez spacji)
  const wordMatch = textBefore.match(/(\S+)$/);
  if (!wordMatch) return false;
  const word = wordMatch[1];

  // Tylko http://, https://, www. — nie konwertuj każdej domeny przy spacji
  if (!/^https?:\/\//i.test(word) && !/^www\./i.test(word)) return false;
  if (!looksLikeUrl(word)) return false;

  e.preventDefault();
  undo.checkpoint();

  const a = document.createElement('a');
  a.href = normalizeUrl(word);
  a.textContent = word;

  // Podziel węzeł: [before] <a>word</a> [spacja] [after]
  // Tekst za kursorem (after) musi przetrwać — np. spacja wstawiana
  // tuż po URL-u w środku zdania.
  const start = range.startOffset - word.length;
  const after = (node.textContent ?? "").slice(range.startOffset);
  const parent = node.parentNode;
  if (!parent) return false;
  const nextSib = node.nextSibling;

  node.textContent = (node.textContent ?? "").slice(0, start); // "before"
  parent.insertBefore(a, nextSib);
  const space = document.createTextNode(' ');
  parent.insertBefore(space, nextSib);
  if (after) parent.insertBefore(document.createTextNode(after), nextSib);
  if (!node.textContent) /** @type {ChildNode} */ (node).remove();

  // Kursor za wstawioną spacją
  const r = document.createRange();
  r.setStart(space, 1);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
  _pendingInlineExit = { el: a, afterNode: space, offset: 1 };
  document.dispatchEvent(new Event('forceSave'));
  return true;
}
// looksLikeUrl, normalizeUrl → editor-url.js (schematy: ALLOWED_LINK_SCHEMES w sanitize.js)

/**
 * Zdejmuje z bloku znacznik markdown stojący przed kursorem ("-", "1.", "#").
 * Kursor ląduje na początku bloku, tuż przed treścią, która w wierszu została.
 *
 * @param {Element|null} block
 * @returns {boolean} false, gdy wiersz nie ma własnego wrappera (tekst leży
 *   wprost w #editor) — wtedy zostaje stare czyszczenie całego bloku
 */
function _dropTriggerMarker(block) {
  const sel = window.getSelection();
  if (!block || block === editor || !sel?.rangeCount) return false;
  const caret = sel.getRangeAt(0);
  if (!block.contains(caret.startContainer)) return false;

  const marker = document.createRange();
  marker.setStart(block, 0);
  marker.setEnd(caret.startContainer, caret.startOffset);
  marker.deleteContents();

  const r = document.createRange();
  r.setStart(block, 0);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
  return true;
}

/**
 * Wyjmuje z bloku treść, która została po zdjęciu znacznika — to ona wjeżdża
 * do nowego punktu listy / nagłówka. Blok zostaje pusty.
 *
 * @param {Element} block
 * @returns {DocumentFragment}
 */
function _takeBlockRest(block) {
  const r = document.createRange();
  r.selectNodeContents(block);
  return r.extractContents();
}

/**
 * Treść wiersza (bez znacznika) wkładana do nowego punktu listy.
 * @param {Element|null} block @param {HTMLElement} li
 */
function _fillFromBlock(block, li) {
  if (block && block !== editor && _dropTriggerMarker(block)) {
    const rest = _takeBlockRest(block);
    if ((rest.textContent ?? '').trim() || rest.querySelector?.('br, img, a')) {
      li.innerHTML = '';
      li.appendChild(rest);
    }
  }
  if (!li.firstChild) li.innerHTML = '<br>';
}

/** @param {KeyboardEvent} e */
function _handleSpace(e) {
  const block = _getCurrentBlock();
  const blockText = block ? block.textContent : '';

  // Tekst od początku bloku do kursora — na nim stoi cała detekcja znaczników.
  // Liczymy go zakresem, a nie z samego węzła tekstowego: w wierszu z pogrubieniem
  // czy linkiem węzeł przy kursorze nie zaczyna się tam, gdzie wiersz.
  let textBefore = blockText;
  const _sel = window.getSelection();
  if (_sel?.rangeCount) {
    const _range = _sel.getRangeAt(0);
    if (_range.collapsed) {
      if (block && block !== editor) {
        const _before = document.createRange();
        _before.setStart(block, 0);
        _before.setEnd(_range.startContainer, _range.startOffset);
        textBefore = _before.toString();
      } else {
        const _tn = _range.startContainer;
        textBefore =
          _tn.nodeType === Node.TEXT_NODE
            ? (_tn.textContent ?? "").slice(0, _range.startOffset)
            : blockText;
      }
    }
  }

  // ── Markdown trigger detection (czysta funkcja) ───────────────
  const trigger = detectSpaceTrigger(blockText, textBefore);

  /**
   * Wstawia gotowy <li>: dopisuje do listy nad blokiem, jeśli jest
   * bezpośrednio nad nim, a w przeciwnym razie zakłada nową listę.
   * Zwraca true, gdy punkt trafił do istniejącej listy.
   *
   * @param {"ordered"|"bullet"|"checklist"} kind
   * @param {HTMLElement} li
   * @param {HTMLElement} freshList lista używana, gdy nie ma czego kontynuować
   */
  const _placeListItem = (kind, li, freshList) => {
    const inBlock = block && block !== editor;
    const cont = inBlock ? _continuableList(block, kind) : null;

    if (cont) {
      cont.appendChild(li);
      /** @type {Element} */ (block).remove();
    } else {
      freshList.appendChild(li);
      if (inBlock) {
        _clearBlock(block);
        /** @type {Element} */ (block).replaceWith(freshList);
      } else {
        editor.innerHTML = '';
        editor.appendChild(freshList);
      }
    }

    const r = document.createRange();
    r.setStart(li, 0);
    r.collapse(true);
    const s = /** @type {Selection} */ (window.getSelection());
    s.removeAllRanges();
    s.addRange(r);
    return !!cont;
  };

  if (trigger) {
    switch (trigger.trigger) {
      case 'checklist': {
        e.preventDefault();
        undo.checkpoint();
        const ul = document.createElement('ul');
        ul.setAttribute('data-list', 'checklist');
        const li = document.createElement('li');
        li.setAttribute('data-checked', trigger.checked ? 'true' : 'false');
        _fillFromBlock(block, li);
        _placeListItem('checklist', li, ul);
        return;
      }

      case 'heading': {
        e.preventDefault();
        undo.checkpoint();
        // Znacznik znika, reszta wiersza zostaje i staje się treścią nagłówka
        if (!_dropTriggerMarker(block)) _clearBlock(block);
        document.execCommand('formatBlock', false, `h${trigger.level}`);
        return;
      }

      case 'ordered': {
        e.preventDefault();
        undo.checkpoint();
        const startNum = trigger.start ?? 1;
        const ol = document.createElement('ol');
        // start= tylko dla NOWEJ listy. Przy kontynuacji numer wpisany
        // przez użytkownika jest ignorowany — punkt dostaje kolejny numer
        // z listy, do której dołącza. Pozycja wygrywa z liczbą.
        if (startNum !== 1) ol.setAttribute('start', String(startNum));
        const li = document.createElement('li');
        _fillFromBlock(block, li);
        _placeListItem('ordered', li, ol);
        return;
      }

      case 'bullet': {
        e.preventDefault();
        undo.checkpoint();
        const ulb = document.createElement('ul');
        const lib = document.createElement('li');
        _fillFromBlock(block, lib);
        _placeListItem('bullet', lib, ulb);
        return;
      }

      case 'callout': {
        e.preventDefault();
        undo.checkpoint();
        if (!_dropTriggerMarker(block)) _clearBlock(block);
        document.execCommand('formatBlock', false, 'blockquote');
        requestAnimationFrame(() => {
          const s = /** @type {Selection} */ (window.getSelection());
          const n = s?.rangeCount ? s.getRangeAt(0).startContainer : null;
          const bq = /** @type {HTMLElement|null} */ (
            (n ? _elOf(n) : null)?.closest('blockquote') ?? null
          );
          if (bq) {
            bq.dataset.callout = trigger.type;
            /** @type {Record<string, string>} */
            const _defaultLabels = {
              note: 'Note',
              tip: 'Tip',
              important: 'Important',
              warning: 'Warning',
              caution: 'Caution',
            };
            bq.dataset.calloutLabel =
              _defaultLabels[trigger.type ?? ''] ?? trigger.type;
            undo.checkpoint();
            document.dispatchEvent(new Event('forceSave'));
          }
        });
        return;
      }

      case 'code-block': {
        e.preventDefault();
        undo.checkpoint();
        // W bloku kodu liczy się sam tekst — formatowanie i tak tam nie wchodzi
        const restCode =
          block && block !== editor && _dropTriggerMarker(block)
            ? (_takeBlockRest(block).textContent ?? '')
            : (_clearBlock(block), '');
        const pre = document.createElement('pre');
        pre.spellcheck = false;
        const code = document.createElement('code');
        code.spellcheck = false;
        if (restCode.trim()) code.textContent = restCode;
        else code.innerHTML = '<br>';
        if (trigger.language) code.dataset.language = trigger.language;
        pre.appendChild(code);
        const cur = _getCurrentBlock();
        if (cur && cur !== editor) {
          cur.replaceWith(pre);
        } else {
          editor.appendChild(pre);
        }
        const r = document.createRange();
        r.setStart(code, 0);
        r.collapse(true);
        const s = /** @type {Selection} */ (window.getSelection());
        s.removeAllRanges();
        s.addRange(r);
        return;
      }

      case 'blockquote': {
        e.preventDefault();
        undo.checkpoint();
        if (!_dropTriggerMarker(block)) _clearBlock(block);
        document.execCommand('formatBlock', false, 'blockquote');
        return;
      }
      case 'toggle-list': {
        e.preventDefault();
        undo.checkpoint();
        const restSummary =
          block && block !== editor && _dropTriggerMarker(block)
            ? _takeBlockRest(block)
            : (_clearBlock(block), null);
        const details = document.createElement('details');
        details.open = true;
        const summary = document.createElement('summary');
        if (restSummary && (restSummary.textContent ?? '').trim()) {
          summary.appendChild(restSummary);
        } else {
          summary.innerHTML = '<br>';
        }
        summary.dataset.placeholder = t('editor_summary_placeholder');
        const content = document.createElement('p');
        content.innerHTML = '<br>';
        content.dataset.placeholder = t('editor_details_placeholder');
        details.appendChild(summary);
        details.appendChild(content);
        const cur = _getCurrentBlock();
        if (cur && cur !== editor) {
          cur.replaceWith(details);
        } else {
          editor.appendChild(details);
        }
        const r = document.createRange();
        r.setStart(summary, 0);
        r.collapse(true);
        const s = /** @type {Selection} */ (window.getSelection());
        s.removeAllRanges();
        s.addRange(r);
        return;
      }
    }
  }

  // ── Autolink — http://, https://, www. + spacja ───────────────
  if (_tryAutolinkWord(e)) return;

  // ── Markdown link konwersja ───────────────────────────────────
  if (_tryConvertMarkdownLink(e)) return;
}
/* Helper: znajdź najbliższy block-element dla aktualnego kursora.
   Jeśli text siedzi bezpośrednio w #editor (np. pierwsza linia notatki bez
   wrappera w <p>), zwraca samego editora — _clearBlock wtedy zachowuje się
   inaczej (czyści tylko text usera, nie cały editor). */
// _getCurrentBlock → editor-selection.js

/* Helper: wyczyść zawartość block-elementu (przed konwersją na header/list/quote).
   Jeśli block to sam editor — czyścimy CAŁĄ jego zawartość. To OK gdy markdown
   shortcut jest wpisywany w pustym edytorze; gdyby były inne treści, regex
   na textContent i tak by nie pasował (^#{1,3}$). */
// _clearBlock → editor-selection.js

/** @param {KeyboardEvent} e */
function _handleAltArrow(e) {
  const sel = /** @type {Selection} */ (window.getSelection());
  if (!sel.rangeCount) return;

  const node = sel.getRangeAt(0).startContainer;
  const el = _elOf(node);
  const dir = e.key === 'ArrowUp' ? 'up' : 'down';

  // ── Zaznaczenie przez kilka bloków / elementów listy — przesuwa całą
  // grupę, tak jak uchwyt ⠿ (editor-drag-handle.js: selectionGroup).
  // Przestawiamy SĄSIADA na drugą stronę grupy: zaznaczone węzły stoją
  // w miejscu, więc zaznaczenie zostaje i można naciskać dalej.
  const group = selectionGroup(sel.getRangeAt(0), editor);
  if (group) {
    e.preventDefault();
    const first = group[0];
    const last = group[group.length - 1];
    const parent = first.parentElement;
    const siblings = dragSiblings(first);
    const neighbor =
      dir === 'up'
        ? siblings[siblings.indexOf(first) - 1]
        : siblings[siblings.indexOf(last) + 1];
    if (!neighbor || !parent) return;
    undo.checkpoint();
    if (dir === 'up') parent.insertBefore(neighbor, last.nextSibling);
    else parent.insertBefore(neighbor, first);
    undo.checkpoint();
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  // ── Jeden blok albo element listy — te same reguły co uchwyt ⠿
  // (findDragTarget): element listy w swojej liście, jedyny element listy
  // przenosi całą listę, lista w details przenosi całą sekcję.
  const target = findDragTarget(el, editor);
  if (!target) return;
  const parent = target.parentElement;
  const siblings = dragSiblings(target);
  const at = siblings.indexOf(target);
  const neighbor = siblings[dir === 'up' ? at - 1 : at + 1];
  if (!neighbor || !parent) {
    // Na brzegu listy / cytatu nie przepuszczamy skrótu dalej (przeglądarka
    // przesunęłaby kursor) — linia nie wyskakuje z cytatu niechcący
    if (target.tagName === 'LI' || isQuoteLine(target, editor)) e.preventDefault();
    return;
  }

  e.preventDefault();
  // Stan przed i po — inaczej Ctrl+Z cofał też to, co było przed przeniesieniem
  undo.checkpoint();
  if (dir === 'up') {
    parent.insertBefore(target, neighbor);
  } else {
    parent.insertBefore(neighbor, target);
  }
  _restoreCursorTo(target);
  undo.checkpoint();
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}

// _restoreCursorTo → editor-selection.js

/** @param {KeyboardEvent} e */
function _handleTab(e) {
  // ── Tab w details — nawigacja summary ↔ treść ─
  const sel = /** @type {Selection} */ (window.getSelection());
  if (sel?.rangeCount) {
    const node = sel.getRangeAt(0).startContainer;
    const el = _elOf(node);
    const summary = el?.closest('summary');
    const details = el?.closest('details');

    if (summary && !e.shiftKey) {
      // Tab w summary → przejdź do pierwszego bloku treści
      e.preventDefault();
      let content = summary.nextElementSibling;
      if (!content) {
        content = document.createElement('p');
        content.innerHTML = '<br>';
        summary.parentElement?.appendChild(content);
      }
      const r = document.createRange();
      r.setStart(content, 0);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }

    if (details && !summary && e.shiftKey) {
      // Shift+Tab w treści details → wróć do summary
      e.preventDefault();
      const sum = details.querySelector('summary');
      if (sum) {
        const r = document.createRange();
        r.setStart(sum, sum.childNodes.length || 0);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
      }
      return;
    }
  }

  // ── Tab w liście — indent/outdent ─────────────
  if (!sel?.rangeCount) return;
  // Listy wklejone jako <ul><li/><ul>…</ul></ul> najpierw naprawiamy —
  // inaczej punkty w takiej podliście nie mają "rodzica" i Tab nic nie robi.
  const saved = _saveSelection();
  if (_normalizeListNesting(editor)) _restoreSelection(saved);

  const items = _selectedListItems(sel.getRangeAt(0));
  if (!items.length) return;
  e.preventDefault();
  undo.checkpoint();
  const changed = e.shiftKey
    ? _outdentListItems(items)
    : _indentListItems(items);
  if (changed) {
    undo.checkpoint();
    // Przeniesienie węzłów nie wywołuje 'input' — bez tego wcięcie
    // zapisywało się dopiero przy następnym naciśnięciu klawisza.
    document.dispatchEvent(new Event('forceSave'));
  }
}

/**
 * Linki są jednostkami atomowymi: Backspace nie usuwa pojedynczych znaków
 * z tekstu linku, tylko cały element <a>. Zwraca link do usunięcia albo
 * null, gdy Backspace ma się zachować standardowo.
 *
 * Przypadki:
 * - kursor wewnątrz linku (ale nie na samym jego początku) → ten link
 * - kursor bezpośrednio za linkiem → ten link
 * - kursor na samym początku linku → null (znak przed kursorem leży
 *   POZA linkiem — standardowy Backspace)
 */
/** @param {Range} range @returns {Element|null} */
function _linkToDeleteOnBackspace(range) {
  const node = range.startContainer;
  const offset = range.startOffset;
  const el = _elOf(node);

  const inside = el?.closest('a');
  if (inside && editor.contains(inside)) {
    // Probe: tekst między początkiem linku a kursorem. Pusty = kursor na
    // samym początku linku → nie ruszamy (Backspace kasuje znak przed <a>).
    const probe = document.createRange();
    probe.setStart(inside, 0);
    probe.setEnd(node, offset);
    return probe.toString() !== '' ? inside : null;
  }

  // Kursor bezpośrednio za linkiem (poprzedni węzeł-sąsiad to <a>)?
  let prev = null;
  if (node.nodeType === Node.TEXT_NODE) {
    if (offset > 0) return null; // jest znak przed kursorem w tym text node
    prev = node.previousSibling;
  } else {
    prev = offset > 0 ? node.childNodes[offset - 1] : null;
  }
  // Pomiń puste text nody między linkiem a kursorem
  while (prev && prev.nodeType === Node.TEXT_NODE && !prev.textContent) {
    prev = prev.previousSibling;
  }
  const prevEl = prev && prev.nodeType === Node.ELEMENT_NODE
    ? /** @type {Element} */ (prev)
    : null;
  return prevEl && prevEl.tagName === 'A' ? prevEl : null;
}

/** @param {KeyboardEvent} e */
function _handleBackspace(e) {
  const bkSel = /** @type {Selection} */ (window.getSelection());
  if (!bkSel.rangeCount) return;

  const bkRange = bkSel.getRangeAt(0);
  const bkNode = bkRange.startContainer;
  const bkEl = _elOf(bkNode);
  if (!bkEl) return;

  // ── Link jako jednostka atomowa — usuń cały <a> ───────────────
  // Tylko przy zwiniętej selekcji; zaznaczenie kasuje się standardowo.
  if (bkRange.collapsed) {
    const link = _linkToDeleteOnBackspace(bkRange);
    if (link) {
      e.preventDefault();
      undo.checkpoint(); // stan sprzed usunięcia
      const parent = link.parentNode;
      const r = document.createRange();
      r.setStartBefore(link);
      r.collapse(true);
      link.remove();
      // Pusty blok po usunięciu linku — dołóż <br>, żeby pozostał edytowalny
      if (parent instanceof Element && parent !== editor && !parent.firstChild) {
        parent.appendChild(document.createElement('br'));
        r.setStart(parent, 0);
        r.collapse(true);
      }
      bkSel.removeAllRanges();
      bkSel.addRange(r);
      undo.checkpoint(); // stan po — Ctrl+Z przywraca link w całości
      document.dispatchEvent(new Event('forceSave'));
      return;
    }
  }

  // ── Zbierz kontekst ───────────────────────────────────────────
  const summary = bkEl.closest('summary');
  const checklistLi = bkEl.closest('ul[data-list="checklist"] li');
  const blockquote = bkEl.closest('blockquote');
  const li = checklistLi ? null : bkEl.closest('li');

  const checklistAtStart = checklistLi
    ? _isCursorAtListStart(checklistLi)
    : false;
  const checklistHasPrev = !!checklistLi?.previousElementSibling;

  const bqAtStart = blockquote
    ? (() => {
        const curBlock = _getCurrentBlock();
        const isFirst =
          curBlock === blockquote.firstElementChild ||
          (!blockquote.firstElementChild && curBlock === blockquote);
        return isFirst && bkRange.startOffset === 0;
      })()
    : false;

  const liAtStart = li ? _isCursorAtListStart(li) : false;
  const liHasPrev = !!li?.previousElementSibling;
  const liIsNested = li
    ? li.parentElement?.parentElement?.tagName === 'LI'
    : false;

  // ── Decyzja (czysta funkcja) ──────────────────────────────────
  const decision = decideBackspaceAction({
    inSummary: !!summary,
    summaryEmpty: summary ? summary.textContent.trim() === '' : false,
    summaryAtStart: summary ? _isCursorAtListStart(summary) : false,
    inChecklistLi: !!checklistLi,
    checklistAtStart,
    checklistHasPrev,
    inBlockquote: !!blockquote,
    bqAtStart,
    inLi: !!li,
    liAtStart,
    liHasPrev,
    liIsNested,
  });

  if (!decision) return; // brak interceptu

  e.preventDefault();
  undo.checkpoint();

  // ── Wykonaj akcję ─────────────────────────────────────────────
  switch (decision.action) {
    case 'checklist-merge': {
      if (!checklistLi) break;
      const prev = checklistLi.previousElementSibling;
      if (!prev) break;
      _placeCaretAtMergeSeam(prev, _mergeListItemBack(checklistLi, prev), bkSel);
      return;
    }

    case 'checklist-exit-to-p': {
      if (!checklistLi) break;
      const ul = checklistLi.closest('ul');
      if (!ul) break;
      const p = document.createElement('p');
      while (checklistLi.firstChild) p.appendChild(checklistLi.firstChild);
      if (!p.firstChild) p.innerHTML = '<br>';
      if (checklistLi === ul.lastElementChild) {
        ul.replaceWith(p);
      } else {
        ul.before(p);
        checklistLi.remove();
      }
      const r = document.createRange();
      r.setStart(p, 0);
      r.collapse(true);
      bkSel.removeAllRanges();
      bkSel.addRange(r);
      return;
    }

    case 'blockquote-unwrap': {
      if (!blockquote) break;
      const children = [...blockquote.childNodes];
      const frag = document.createDocumentFragment();
      /** @type {HTMLParagraphElement|null} */
      let firstP = null;
      if (!children.length) {
        const p = document.createElement('p');
        p.innerHTML = '<br>';
        frag.appendChild(p);
        firstP = p;
      } else {
        children.forEach((child) => {
          const childEl = /** @type {HTMLParagraphElement} */ (child);
          if (child.nodeType === Node.ELEMENT_NODE && childEl.tagName === 'P') {
            if (!childEl.firstChild) childEl.innerHTML = '<br>';
            frag.appendChild(childEl);
            if (!firstP) firstP = childEl;
          } else {
            const p = document.createElement('p');
            p.appendChild(child.cloneNode(true));
            frag.appendChild(p);
            if (!firstP) firstP = p;
          }
        });
      }
      blockquote.replaceWith(frag);
      if (!firstP) return;
      const r = document.createRange();
      r.setStart(firstP, 0);
      r.collapse(true);
      bkSel.removeAllRanges();
      bkSel.addRange(r);
      return;
    }

    case 'li-merge': {
      if (!li) break;
      const prev = li.previousElementSibling;
      if (!prev) break;
      _placeCaretAtMergeSeam(prev, _mergeListItemBack(li, prev), bkSel);
      return;
    }

    case 'li-outdent': {
      if (!li) break;
      _outdentListItem(li);
      return;
    }

    case 'li-exit-to-p': {
      if (!li) break;
      const list = li.parentElement;
      if (!list) break;
      const isOnly = li === list.lastElementChild;
      const p = document.createElement('p');
      while (li.firstChild) p.appendChild(li.firstChild);
      if (!p.firstChild) p.innerHTML = '<br>';
      if (isOnly) {
        list.replaceWith(p);
      } else {
        list.before(p);
        li.remove();
      }
      const r = document.createRange();
      r.setStart(p, 0);
      r.collapse(true);
      bkSel.removeAllRanges();
      bkSel.addRange(r);
      return;
    }
    case 'summary-unwrap': {
      if (!summary) break;
      const details = summary.closest('details');
      if (!details) break;
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      details.replaceWith(p);
      const r = document.createRange();
      r.setStart(p, 0);
      r.collapse(true);
      bkSel.removeAllRanges();
      bkSel.addRange(r);
      return;
    }
  }
}
/** @param {KeyboardEvent} e */
function _handleCtrl(e) {
  // Normalizacja klawisza: Shift i CapsLock dają wielkie litery ('Z', 'B'),
  // przez co switch na małych literach by ich nie trafił — Ctrl+Shift+Z
  // (redo) i wszystkie skróty z włączonym CapsLockiem przestawały działać.
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  switch (key) {
    case 'b':
      e.preventDefault();
      document.execCommand('bold');
      break;
    case 'i':
      e.preventDefault();
      document.execCommand('italic');
      break;
    case 'u':
      e.preventDefault();
      document.execCommand('underline');
      break;
    case '`':
      e.preventDefault();
      _byBtn('code-btn').click();
      break;
    case 'x':
      if (e.shiftKey) {
        e.preventDefault();
        document.execCommand('strikeThrough');
      }
      break;
    case 'z':
      e.preventDefault();
      if (e.shiftKey) {
        undo.redo();
      } else {
        undo.undo();
      }
      debouncedSave();
      _updateUndoRedoStateGlobal();
      break;
    case 'y':
      e.preventDefault();
      undo.redo();
      debouncedSave();
      _updateUndoRedoStateGlobal();
      break;
    case 'f':
      // Ctrl+F przeglądarki szuka w stronie pod panelem, nie w notatce —
      // przejmujemy go, żeby w ogóle dało się znaleźć zdanie w długim tekście
      if (!e.shiftKey && !e.altKey) {
        e.preventDefault();
        openFindBar();
      }
      break;
    case 'k':
      e.preventDefault();
      openLinkModal();
      break;
    // Ctrl+Shift+V — wklej jako czysty tekst. Zdarzenie paste nie niesie
    // informacji o Shifcie, więc zapamiętujemy zamiar tutaj; handler paste
    // zdejmuje flagę. Timeout na wypadek, gdyby wklejenie nie doszło
    // (np. pusty schowek) — inaczej następne zwykłe Ctrl+V byłoby czyste.
    case 'v':
      if (e.shiftKey) {
        _plainPasteArmed = true;
        clearTimeout(_plainPasteTimer);
        _plainPasteTimer = setTimeout(() => {
          _plainPasteArmed = false;
        }, 1000);
      }
      break;
    // Ctrl+\ — wyczyść formatowanie (jak w Google Docs / Notion). Przycisk
    // Tx jest w podstawowym toolbarze schowany, więc skrót jest główną drogą.
    case '\\':
      e.preventDefault();
      undo.checkpoint();
      document.execCommand('removeFormat');
      debouncedSave();
      break;
  }
}

/* ── Znajdź w notatce (Ctrl+F) ─────────────────
   Ctrl+F przeglądarki działa na dokumencie STRONY, nie na panelu bocznym,
   a wyszukiwarka nad listą (Alt+S) wybiera notatkę, zamiast pokazać miejsce
   w jej treści. Stąd własny pasek: liczy trafienia, skacze między nimi
   (Enter / F3 / strzałki), podświetla je i nie rusza treści notatki —
   podświetlenie idzie przez CSS Custom Highlight API, a tam gdzie go nie ma
   (starszy Firefox), trafienie jest po prostu zaznaczane.

   Pasek NIE zapisuje nic do notatki: żadnych <mark>, żadnych atrybutów. */

/** @type {{ start: number, end: number }[]} */
let _findMatches = [];
let _findCurrent = -1;
/** @type {ReturnType<typeof setTimeout>|undefined} */
let _findTimer;
/** @type {import('./editor-find.js').FindIndex|null} */
let _findIndex = null;

const _findBar = () => _byId('find-bar');
const _findInput = () => /** @type {HTMLInputElement} */ (_byId('find-input'));

/** Czy przeglądarka umie podświetlać bez dotykania treści. */
const _hasHighlightApi = () =>
  typeof CSS !== 'undefined' && !!(/** @type {any} */ (CSS).highlights);

function _initFind() {
  const bar = _findBar();
  const input = _findInput();
  if (!bar || !input) return;

  input.addEventListener('input', () => {
    clearTimeout(_findTimer);
    _findTimer = setTimeout(() => _runFind(true), 120);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      _stepFind(e.shiftKey ? -1 : 1);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeFindBar(true);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      _stepFind(e.key === 'ArrowDown' ? 1 : -1);
    }
  });

  _byBtn('find-next')?.addEventListener('click', () => _stepFind(1));
  _byBtn('find-prev')?.addEventListener('click', () => _stepFind(-1));
  _byBtn('find-close')?.addEventListener('click', () => closeFindBar(true));

  // F3 działa też z fokusem w edytorze — tak jak w przeglądarce
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'F3' || _findBar()?.hidden) return;
    e.preventDefault();
    _stepFind(e.shiftKey ? -1 : 1);
  });

  // Zmiana treści unieważnia pozycje trafień
  editor.addEventListener('input', () => {
    if (_findBar()?.hidden) return;
    clearTimeout(_findTimer);
    _findTimer = setTimeout(() => _runFind(false), 200);
  });
}

/**
 * Otwiera pasek. Zaznaczony fragment notatki wchodzi do pola jako zapytanie —
 * tak działa Ctrl+F wszędzie indziej.
 */
export function openFindBar() {
  const bar = _findBar();
  const input = _findInput();
  if (!bar || !input) return;

  const sel = window.getSelection();
  const picked = sel && !sel.isCollapsed ? sel.toString().trim() : '';
  if (picked && picked.length <= 100 && !picked.includes('\n')) {
    input.value = picked;
  }

  bar.hidden = false;
  input.focus();
  input.select();
  _runFind(true);
}

/**
 * Wkłada frazę do pola szukania, nie otwierając paska. Używane przy otwarciu
 * notatki z listy filtrowanej wyszukiwarką (Alt+S): Ctrl+F ma wtedy od razu
 * to, czego użytkownik szukał przed chwilą — bez przepisywania.
 *
 * @param {string} query
 */
export function prefillFind(query) {
  const input = _findInput();
  if (!input) return;
  const clean = String(query ?? '').trim();
  if (clean) input.value = clean;
}

/**
 * @param {boolean} [focusEditor=false] oddaj fokus treści na bieżącym trafieniu
 */
export function closeFindBar(focusEditor = false) {
  const bar = _findBar();
  if (!bar || bar.hidden) return;
  bar.hidden = true;
  _clearFindHighlights();
  _findMatches = [];
  _findCurrent = -1;
  _findIndex = null;
  if (focusEditor) editor.focus();
}

/**
 * Przelicza trafienia i (opcjonalnie) skacze do pierwszego od kursora.
 * @param {boolean} jump
 */
function _runFind(jump) {
  const input = _findInput();
  const query = foldForFind(input.value.trim());
  _findIndex = buildFindIndex(editor);
  _findMatches = query ? findMatches(_findIndex.text, query) : [];

  if (!_findMatches.length) {
    _findCurrent = -1;
    _clearFindHighlights();
    _renderFindCount();
    input.classList.toggle('is-empty', !!input.value.trim());
    return;
  }
  input.classList.remove('is-empty');

  if (jump || _findCurrent < 0 || _findCurrent >= _findMatches.length) {
    _findCurrent = matchAtOrAfter(_findMatches, _caretPosInFindIndex());
  }
  _showFindMatch(false);
}

/** Pozycja kursora w indeksie — żeby „następne" liczyło się od kursora. */
function _caretPosInFindIndex() {
  const sel = window.getSelection();
  if (!sel?.rangeCount || !_findIndex) return -1;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.startContainer)) return -1;
  const at = _findIndex.nodes.indexOf(
    /** @type {Text} */ (range.startContainer),
  );
  if (at === -1) return -1;
  return _findIndex.starts[at] + range.startOffset;
}

/** @param {number} step */
function _stepFind(step) {
  if (!_findMatches.length) {
    _runFind(true);
    if (!_findMatches.length) return;
  }
  _findCurrent =
    (_findCurrent + step + _findMatches.length) % _findMatches.length;
  _showFindMatch(true);
}

/** @param {boolean} scroll */
function _showFindMatch(scroll) {
  if (!_findIndex || _findCurrent < 0) return;
  const current = rangeAt(_findIndex, _findMatches[_findCurrent]);
  if (!current) return;

  if (_hasHighlightApi()) {
    const all = /** @type {Range[]} */ (
      _findMatches
        .map((m) => rangeAt(/** @type {any} */ (_findIndex), m))
        .filter(Boolean)
    );
    const api = /** @type {any} */ (window);
    /** @type {any} */ (CSS).highlights.set('find-match', new api.Highlight(...all));
    /** @type {any} */ (CSS).highlights.set('find-current', new api.Highlight(current));
  } else {
    // Starszy Firefox: zaznaczenie zamiast podświetlenia — widać gdzie jest
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(current.cloneRange());
  }

  // Zawsze dociągamy widok: także przy przeliczeniu po wpisaniu znaku
  // (scroll mówi tylko, czy to skok użytkownika)
  void scroll;
  current.startContainer.parentElement?.scrollIntoView({ block: 'nearest' });
  _renderFindCount();
}

function _renderFindCount() {
  const count = _byId('find-count');
  if (!count) return;
  const input = _findInput();
  // Strzałki przygaszone, gdy nie ma do czego skakać — widać to bez licznika
  for (const id of ['find-prev', 'find-next']) {
    const btn = _byBtn(id);
    if (btn) btn.disabled = !_findMatches.length;
  }
  if (!input.value.trim()) {
    count.textContent = '';
    return;
  }
  count.textContent = _findMatches.length
    ? `${_findCurrent + 1}/${_findMatches.length}`
    : t('find_noMatch');
}

function _clearFindHighlights() {
  if (!_hasHighlightApi()) return;
  /** @type {any} */ (CSS).highlights.delete('find-match');
  /** @type {any} */ (CSS).highlights.delete('find-current');
}

/* ── Paste ────────────────────────────────────── */

/** Ctrl+Shift+V — najbliższe wklejenie idzie jako czysty tekst. */
let _plainPasteArmed = false;
/** @type {ReturnType<typeof setTimeout>|undefined} */
let _plainPasteTimer;

function _initPaste() {
  editor.addEventListener('paste', (e) => {
    e.preventDefault();
    undo.checkpoint();

    const MAX_PASTE = MAX_PASTE_LEN; // jedno źródło limitu → sanitize.js
    const cd = e.clipboardData;
    if (!cd) return;
    const html = cd.getData('text/html');
    const plain = cd.getData('text/plain');

    // Ctrl+Shift+V — pomijamy całą ścieżkę HTML i markdown: użytkownik
    // poprosił o goły tekst, nie o „inteligentne" rozpoznanie formatu
    const plainOnly = _plainPasteArmed;
    _plainPasteArmed = false;
    clearTimeout(_plainPasteTimer);
    if (plainOnly) {
      document.execCommand(
        'insertText',
        false,
        plain.length > MAX_PASTE ? plain.slice(0, MAX_PASTE) : plain,
      );
      return;
    }

    // W bloku kodu wklejamy zawsze czysty tekst — formatowanie nie ma tam sensu
    if (html && !_caretInCodeBlock()) {
      const processed = isClickUpHTML(html) ? preprocessClickUp(html) : html;
      // Przycinaj PRZED sanityzacją — DOMParser w sanitizeHTML domknie
      // ucięte w połowie tagi; slice po sanityzacji zostawiał zepsuty HTML
      const raw = processed ?? html;
      const clipped = raw.length > MAX_PASTE ? raw.slice(0, MAX_PASTE) : raw;
      // normalizePastedHTML: listy Outlooka, style → <strong>/<em>, tabele,
      // opakowania stron — póki widać jeszcze style="", które sanityzacja wytnie
      // Sanityzowane DRZEWO, nie string: węzły przenosimy prosto do
      // edytora, bez ponownego parsowania (patrz editor-paste-insert.js)
      const body = sanitizeHTMLToBody(normalizePastedHTML(clipped));
      // Limit węzłów DOM — zapobiega paste bomb z zagnieżdżonych tagów
      if (body && body.childNodes.length) {
        if (_exceedsNodeBudget(body)) {
          document.execCommand(
            'insertText',
            false,
            (body.textContent ?? '').slice(0, MAX_PASTE),
          );
          return;
        }
        if (_insertRichContent(body)) return;
      }
    }

    // Fallback: plain text (np. z terminala, edytora kodu)
    const text = plain.length > MAX_PASTE ? plain.slice(0, MAX_PASTE) : plain;

    // Kod lub konfiguracja (CSP, .env, JSON) → blok kodu, zanim markdown
    // zrobi z "# komentarza" nagłówek. Bez tego linie szły jako akapity,
    // a adresy w nich stawały się linkami. Płotki ``` obsługuje markdown.
    if (!_caretInCodeBlock() && !/^\s*```/m.test(text) && looksLikeCode(text)) {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
      pre.appendChild(code);
      const body = sanitizeHTMLToBody(pre.outerHTML);
      if (body && _insertRichContent(body)) return;
    }

    // Markdown → tekst formatowany. Tylko gdy tekst NAPRAWDĘ wygląda na
    // markdown (looksLikeMarkdown wymaga sygnału blokowego) i gdy nie
    // wklejamy do bloku kodu — tam składnia ma zostać dosłowna.
    // Wynik i tak przechodzi przez sanitizeHTML; markdownToHtml escapuje
    // tekst u siebie, więc wklejony `<script>` nie stanie się znacznikiem.
    if (!_caretInCodeBlock() && looksLikeMarkdown(text)) {
      // Przez normalizePastedHTML jak każdy HTML: ☐/☑ z tekstu ClickUp tworzą
      // checklistę, a pusta linia na końcu bloku kodu znika
      const md = sanitizeHTMLToBody(normalizePastedHTML(markdownToHtml(text)));
      // Ten sam limit co gałąź HTML. Markdown potrafi rozdmuchać wejście:
      // 200 KB linii "> a" daje ~80 000 węzłów. Bez tej zapory gałąź MD
      // była obejściem ochrony, którą gałąź HTML miała od początku.
      if (md && !_exceedsNodeBudget(md) && _insertRichContent(md)) return;
    }

    document.execCommand('insertText', false, text);
  });
}

/**
 * Górny limit elementów we wklejanej treści — zapora na paste bomb.
 * Dotyczy KAŻDEJ ścieżki produkującej HTML z wklejki (HTML i Markdown).
 */
const MAX_PASTE_NODES = 5000;

/**
 * Czy sanityzowane drzewo przekracza budżet węzłów. Drzewo leży w
 * odłączonym dokumencie DOMParsera, więc nic nie trafia do edytora,
 * jeśli odpowiedź brzmi "tak".
 * @param {Element} root
 * @returns {boolean}
 */
function _exceedsNodeBudget(root) {
  return root.querySelectorAll('*').length > MAX_PASTE_NODES;
}

/**
 * Czy kursor stoi w bloku kodu — tam markdown ma zostać dosłowny.
 * @returns {boolean}
 */
function _caretInCodeBlock() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return false;
  return !!_elOf(sel.getRangeAt(0).startContainer)?.closest('pre, code');
}

/**
 * Wstawia sanityzowane drzewo w miejsce kursora (logika → editor-paste-insert.js).
 * @param {Element} body wynik sanitizeHTMLToBody — węzły są przenoszone
 * @returns {boolean} true gdy wstawiono
 */
function _insertRichContent(body) {
  if (!insertPastedHTML(editor, body)) return false;
  editor.focus();
  undo.checkpoint(); // stan po wklejeniu — Ctrl+Z cofa całą wklejkę naraz
  debouncedSave();
  return true;
}

/* ── Copy / Cut ────────────────────────────────── */

function _initCopy() {
  editor.addEventListener('copy', (e) => _handleCopy(e, false));
  editor.addEventListener('cut', (e) => _handleCopy(e, true));
}

/** @param {ClipboardEvent} e @param {boolean} isCut */
function _handleCopy(e, isCut) {
  const sel = /** @type {Selection} */ (window.getSelection());
  if (!sel.rangeCount || sel.isCollapsed) return;

  const range = sel.getRangeAt(0);
  const fragment = range.cloneContents();
  const wrap = document.createElement('div');
  wrap.appendChild(fragment);

  // Usuń klasy edytora — inne aplikacje ich nie rozumieją
  wrap.querySelectorAll('[class]').forEach((el) => el.removeAttribute('class'));
  wrap.normalize();
  // Zaznaczenie w liście daje same <li> — bez <ul>/<ol> nad nimi.
  // Oddajemy im listę, z której pochodzą (rodzaj + numer pierwszego punktu).
  const _startEl =
    range.startContainer.nodeType === Node.ELEMENT_NODE
      ? /** @type {Element} */ (range.startContainer)
      : range.startContainer.parentElement;
  restoreCopiedListContext(wrap, _startEl?.closest('li') ?? null);

  const cd = e.clipboardData;
  if (!cd) return;
  // text/plain jako Markdown — textContent skleja akapity w jedną linię
  // i gubi punktory list; markdown zachowuje strukturę w czystym tekście.
  // Liczony PRZED prepareExportHTML, żeby ☐/☑ i etykiety nie weszły do tekstu.
  const markdown = htmlToMarkdown(wrap) || (wrap.textContent ?? '');
  // HTML w formie, którą czytają ClickUp i Outlook (editor-copy-export.js);
  // wklejony z powrotem do notatki wraca do oryginału
  cd.setData('text/html', prepareExportHTML(wrap, (type) => t(`callout_${type}`)));
  cd.setData('text/plain', markdown);
  e.preventDefault();

  if (isCut) {
    undo.checkpoint();
    range.deleteContents();
    if (!editor.firstChild) {
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      editor.appendChild(p);
    }
    debouncedSave();
  }
}

/* ── Kopiuj jako Markdown (menu notatki + Alt+K) ── */

function _initCopyMarkdown() {
  const btn = _byBtn('copy-md-btn');
  const menuBtn = _byBtn('note-menu-btn');
  const pinBtn = _byBtn('pin-copy');
  if (!btn || !menuBtn || !pinBtn) return;

  const resetFeedback = () => {
    menuBtn.classList.remove('icon--check', 'is-copied');
    menuBtn.classList.add('icon--dots-vertical');
    pinBtn.classList.remove('icon--check', 'is-copied');
    pinBtn.classList.add('icon--copy');
  };

  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let _feedbackTimer;

  btn.addEventListener('click', async () => {
    const md = htmlToMarkdown(editor);
    if (!md) return;

    try {
      await navigator.clipboard.writeText(md);
    } catch {
      // Fallback: starsze konteksty bez clipboard API
      const ta = document.createElement('textarea');
      ta.value = md;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }

    // Feedback na tym, co widać: ikonie, gdy kopiowanie jest przypięte do
    // nagłówka, inaczej na przycisku menu, bo sama pozycja jest już schowana.
    // Ikona zmienia się na ✓ i wraca.
    clearTimeout(_feedbackTimer);
    resetFeedback();
    const pinned = !pinBtn.hidden;
    const target = pinned ? pinBtn : menuBtn;
    target.classList.remove(pinned ? 'icon--copy' : 'icon--dots-vertical');
    target.classList.add('icon--check', 'is-copied');
    _feedbackTimer = setTimeout(resetFeedback, 1200);
  });
}

/* ── Context Resume — zapamiętaj/przywróć pozycję kursora ── */

// getCursorOffset / setCursorOffset → editor-selection.js
// (przeniesione, żeby notes.js nie importował z editor.js — cykl)

/* Dwa stopnie, żeby nie zapisywać storage przy każdym ruchu karetki:
   1. odczyt pozycji (300 ms po ostatnim selectionchange) trafia do pamięci,
   2. do storage idzie dopiero po 3 s spokoju, przy przełączeniu notatki
      albo przy zamknięciu panelu — i tylko gdy pozycja faktycznie się zmieniła.
   Wcześniej każde zatrzymanie kursora na 800 ms czytało i nadpisywało całe
   uiSettings (saveUiSettings to read-merge-write).

   Odczyt pozycji bierze activeId z chwili ODCZYTU, nie z chwili zdarzenia —
   dawniej debounce odpalał po przełączeniu notatki z id poprzedniej
   i offsetem kursora z treści nowej. */

/** @type {{ id: string, offset: number } | null} */
let _pendingCursor = null;
/** @type {Map<string, number>} */
const _savedCursor = new Map();

function _flushCursor() {
  _flushCursorDebounced.cancel();
  const pending = _pendingCursor;
  _pendingCursor = null;
  if (!pending || _savedCursor.get(pending.id) === pending.offset) return;
  _savedCursor.set(pending.id, pending.offset);
  saveUiSettings({ [`cursor_${pending.id}`]: pending.offset }).catch(() => {
    // best-effort: przy błędzie spróbujemy przy kolejnym ruchu kursora
    _savedCursor.delete(pending.id);
  });
}

const _flushCursorDebounced = debounce(_flushCursor, 3000);

const _captureCursorDebounced = debounce(() => {
  const id = state.activeId;
  if (!id || document.activeElement !== editor) return;
  const offset = getCursorOffset(editor);
  if (offset == null) return;
  _pendingCursor = { id, offset };
  _flushCursorDebounced();
}, 300);

function _initCursorResume() {
  document.addEventListener('selectionchange', () => {
    if (document.activeElement?.id !== 'editor') return;
    _captureCursorDebounced();
  });
  // Przełączenie notatki: zapisz pozycję poprzedniej, zanim ktoś do niej
  // wróci (selectNote czyta cursor_<id> przy otwarciu). Oczekujący odczyt
  // anulujemy — edytor ma już treść nowej notatki.
  document.addEventListener('noteSelected', () => {
    _captureCursorDebounced.cancel();
    _flushCursor();
  });
  const flushAll = () => {
    _captureCursorDebounced.flush();
    _flushCursor();
  };
  window.addEventListener('pagehide', flushAll);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll();
  });
}

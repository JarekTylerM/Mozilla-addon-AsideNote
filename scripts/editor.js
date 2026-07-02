/* ══════════════════════════════════════════════════════════════
   editor.js — toolbar + skróty + markdown + paste + listy
   ══════════════════════════════════════════════════════════════ */
import { saveUiSettings } from './storage.js';
import { debouncedSave, state } from './notes.js';
import { debounce } from './utils.js';
import * as undo from './undo.js';
import { t } from './i18n.js';
import { sanitizeHTML } from './sanitize.js';
import { looksLikeUrl, normalizeUrl, BLOCKED_SCHEMES } from './editor-url.js';
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
  _getListItem,
  _isCursorAtListStart,
  _focusLi,
  _indentListItem,
  _outdentListItem,
  _getCurrentBlock,
  _clearBlock,
  _restoreCursorTo,
  getCursorOffset,
} from './editor-selection.js';
import { findInlinePattern, MD_LINK_RX } from './editor-pattern.js';
import { isClickUpHTML, preprocessClickUp } from './editor-paste-clickup.js';
import { initSlashMenu } from './editor-slash-menu.js';

const editor = document.getElementById('editor');

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
  const sel = window.getSelection();
  if (!sel?.rangeCount) return;
  const node = sel.getRangeAt(0).startContainer;
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  const block = el.closest('#editor > p');

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
  const tooltip = document.getElementById('link-tooltip');
  const urlLabel = document.getElementById('link-tooltip-url');
  const copyBtn = document.getElementById('link-tooltip-copy');
  const editBtn = document.getElementById('link-tooltip-edit');
  const delBtn = document.getElementById('link-tooltip-delete');
  if (!tooltip || !urlLabel || !editBtn || !delBtn) return;

  let _currentLink = null;
  let _hideTimer = null;
  let _copiedTimer = null; // feedback "Skopiowano" — patrz copyBtn niżej

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
    const a = e.target.closest('a');
    if (!a) return;
    _show(a);
  });

  editor.addEventListener('mouseout', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    if (!e.relatedTarget?.closest?.('#link-tooltip')) _hide();
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
  const bq = e.target.closest('blockquote[data-callout]');
  if (!bq) return;

  const rect = bq.getBoundingClientRect();
  if (e.clientY > rect.top + 24) return;
  if (bq.classList.contains('is-editing-label')) return;

  e.preventDefault();

  bq.classList.add('is-editing-label');

  const input = document.createElement('input');
  input.type = 'text';
  input.value = bq.dataset.calloutLabel ?? '';
  input.className = 'callout-label-input';
  bq.insertBefore(input, bq.firstChild);
  input.focus();
  input.select();

  function _commit() {
    const val = input.value.trim();
    if (val) bq.dataset.calloutLabel = val;
    input.remove();
    bq.classList.remove('is-editing-label');
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
  _initPaste();
  _initCopy();
  _initCursorResume();
  _initEmptyBlockPlaceholder();
  initLinkClick();
  initLinkButton();
  initLinkModal();
  initSlashMenu();
  editor.addEventListener('input', debouncedSave);

  // Wyłącz spellcheck w istniejących blokach kodu, i linkach
  editor.querySelectorAll('pre, code, a').forEach((el) => {
    el.spellcheck = false;
  });

  // Wyłącz spellcheck w nowo dodanych blokach kodu
  new MutationObserver((mutations) => {
    mutations.forEach((m) =>
      m.addedNodes.forEach((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        if (node.matches('pre, code, a')) node.spellcheck = false;
        node
          .querySelectorAll?.('pre, code, a')
          .forEach((el) => (el.spellcheck = false));
      }),
    );
  }).observe(editor, { childList: true, subtree: true });
  _initLinkTooltip();
}

function _initUndoRedoBtns() {
  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-btn');

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
function _tryInlineMarkdown(e) {
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.getRangeAt(0).collapsed) return false;

  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return false;

  // Nie konwertuj wewnątrz <code>/<pre> — zagnieżdżanie bez sensu
  if (node.parentElement?.closest('code, pre')) return false;

  const offset = range.startOffset;
  const textBefore = node.textContent.slice(0, offset);

  const pattern = findInlinePattern(textBefore, e.key);
  if (!pattern) return false;

  const { content, openIdx, markerLen, tag } = pattern;

  e.preventDefault();
  undo.checkpoint();

  const fullText = node.textContent;
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

  undo.checkpoint();
  document.dispatchEvent(new Event('forceSave'));
  return true;
}

/* ── Keydown ──────────────────────────────────── */

function _initKeydown() {
  editor.addEventListener('keydown', (e) => {
    // Ctrl+↑/↓ — wyjście z edytora na sąsiedni element listy
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
    if (e.key === 'Enter') _handleEnter(e);
    if (e.key === ' ') _handleSpace(e);
    if (e.key === 'Tab') _handleTab(e);
    if (e.key === 'Backspace') _handleBackspace(e);
    if (e.ctrlKey || e.metaKey) _handleCtrl(e);

    // Inline markdown — trigger na zamykającym markerze (* ~ `)
    // Po innych handlerach: Enter/Space/Backspace/Ctrl mają priorytet.
    // Jeśli żaden z nich nie zareagował, próbujemy inline konwersję.
    if (!e.defaultPrevented && !e.ctrlKey && !e.metaKey) {
      if (['*', '_', '~', '~~', '`'].includes(e.key)) _tryInlineMarkdown(e);
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
/* ── Exit to list (Ctrl+↑/↓) ──────────────────── */

function _exitToList(direction) {
  // Znajdź obecnie aktywny element listy (active-note) lub pierwszy
  const activeId = state.activeId;
  const list = document.getElementById('notesList');
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

  target.focus();
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

function _handleEnter(e) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;

  // Shift+Enter w liście — soft break wewnątrz <li>
  if (e.shiftKey) {
    const _node = sel.getRangeAt(0).startContainer;
    const _el = _node.nodeType === Node.TEXT_NODE ? _node.parentElement : _node;
    if (_el.closest('li')) {
      e.preventDefault();
      document.execCommand('insertLineBreak');
      return;
    }
  }

  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;

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
      ? range.startContainer.textContent.slice(0, range.startOffset)
      : '';
  const hasTrailingSpaces =
    !pre && !li && !blockquote && / {2,}$/.test(textBeforeCursor);

  // Pre context
  let preIsExiting = false;
  if (pre) {
    const code = pre.querySelector('code') ?? pre;
    preIsExiting = /(<br\s*\/?>){2,}\s*$/.test(code.innerHTML);
  }

  // Checklist context
  const checklistEmpty = checklistLi
    ? checklistLi.textContent.trim() === ''
    : false;

  // Li context
  let liEmpty = false,
    liIsLast = false,
    liIsNested = false;
  if (li) {
    liEmpty = li.textContent.trim() === '';
    liIsLast = li === li.parentElement.lastElementChild;
    liIsNested = li.parentElement?.parentElement?.tagName === 'LI';
  }

  // Blockquote context
  let bqLineEmpty = false,
    bqIsLastBlock = false,
    bqPrevEmpty = false;
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
  }

  // ── Decyzja (czysta funkcja) ──────────────────────────────────
  const decision = decideEnterAction({
    inSummary: !!summary,
    inDetailsContent,
    detailsContentEmpty,
    inPre: !!pre,
    preIsExiting,
    inHeading: !!heading,
    inChecklistLi: !!checklistLi,
    checklistEmpty,
    inLi: !!li && !checklistLi,
    liEmpty,
    liIsLast,
    liIsNested,
    inBlockquote: !!blockquote,
    bqLineEmpty,
    bqIsLastBlock,
    bqPrevEmpty,
    isHrTrigger,
    hasTrailingSpaces,
  });

  // ── Wykonaj akcję ─────────────────────────────────────────────
  switch (decision.action) {
    case 'pre-exit': {
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

    case 'checklist-exit': {
      e.preventDefault();
      undo.checkpoint();
      const ul = checklistLi.closest('ul');
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

    case 'checklist-new-item': {
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
      e.preventDefault();
      undo.checkpoint();
      _outdentListItem(li);
      return;
    }

    case 'li-exit': {
      e.preventDefault();
      undo.checkpoint();
      const list = li.parentElement;
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

    case 'blockquote-exit': {
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
      e.preventDefault();
      const details = summary.closest('details');
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
      e.preventDefault();
      undo.checkpoint();
      const details = detailsBlock.closest('details');
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
        tn.textContent =
          tn.textContent.slice(0, range.startOffset).trimEnd() +
          tn.textContent.slice(range.startOffset);
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

function _tryConvertMarkdownLink(e) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return false;

  const range = sel.getRangeAt(0);
  if (!range.collapsed) return false; // user ma zaznaczenie — nie ingeruj

  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return false;

  const offset = range.startOffset;
  const textBeforeCursor = node.textContent.slice(0, offset);

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
  const before = node.textContent.slice(0, matchStart);
  const after = node.textContent.slice(offset);

  // Stwórz <a>
  const finalUrl = normalizeUrl(linkUrl);

  const a = document.createElement('a');
  a.href = finalUrl;
  a.textContent = displayText;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.title = t('editor_link_ctrlClickHint');

  // Spacja po linku (zamiast oryginalnej, którą blokujemy preventDefault)
  const spaceNode = document.createTextNode(' ');

  // Zastąp content text node-a: before + <a> + " " + after
  const parent = node.parentNode;
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

  return true;
}

function _tryAutolinkWord(e) {
  const sel = window.getSelection();
  if (!sel?.rangeCount || !sel.getRangeAt(0).collapsed) return false;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return false;
  if (node.parentElement?.closest('a, code, pre')) return false;

  const textBefore = node.textContent.slice(0, range.startOffset);
  // Ostatnie słowo (bez spacji)
  const wordMatch = textBefore.match(/(\S+)$/);
  if (!wordMatch) return false;
  const word = wordMatch[1];

  // Tylko http://, https://, www. — nie konwertuj każdej domeny przy spacji
  if (!/^https?:\/\//i.test(word) && !/^www\./i.test(word)) return false;
  if (!looksLikeUrl(word)) return false;

  e.preventDefault();
  undo.checkpoint();

  const href = normalizeUrl(word);
  const a = document.createElement('a');
  a.href = href;
  a.textContent = word;

  const start = range.startOffset - word.length;
  node.textContent =
    node.textContent.slice(0, start) +
    node.textContent.slice(range.startOffset);

  const parent = node.parentNode;
  const nextSib = node.nextSibling;

  if (start === 0 && node.textContent === '') {
    parent.insertBefore(a, nextSib ?? null);
    parent.removeChild(node);
  } else {
    node.textContent = node.textContent.slice(0, start);
    parent.insertBefore(a, nextSib ?? null);
    const space = document.createTextNode(' ');
    parent.insertBefore(space, a.nextSibling);
    const r = document.createRange();
    r.setStart(space, 1);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    document.dispatchEvent(new Event('forceSave'));
    return true;
  }

  // Kursor za linkiem + spacja
  const space = document.createTextNode(' ');
  parent.insertBefore(space, a.nextSibling);
  const r = document.createRange();
  r.setStart(space, 1);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
  document.dispatchEvent(new Event('forceSave'));
  return true;
}
// BLOCKED_SCHEMES, looksLikeUrl → editor-url.js

function _handleSpace(e) {
  const block = _getCurrentBlock();
  const blockText = block ? block.textContent : '';

  // Zbierz textBefore (dla callout trigger — dokładniejszy niż blockText)
  let textBefore = blockText;
  const _sel = window.getSelection();
  if (_sel?.rangeCount) {
    const _range = _sel.getRangeAt(0);
    if (_range.collapsed) {
      const _tn = _range.startContainer;
      textBefore =
        _tn.nodeType === Node.TEXT_NODE
          ? _tn.textContent.slice(0, _range.startOffset)
          : blockText;
    }
  }

  // ── Markdown trigger detection (czysta funkcja) ───────────────
  const trigger = detectSpaceTrigger(blockText, textBefore);

  if (trigger) {
    switch (trigger.trigger) {
      case 'checklist': {
        e.preventDefault();
        undo.checkpoint();
        const ul = document.createElement('ul');
        ul.setAttribute('data-list', 'checklist');
        const li = document.createElement('li');
        li.setAttribute('data-checked', trigger.checked ? 'true' : 'false');
        li.innerHTML = '<br>';
        ul.appendChild(li);
        if (block && block !== editor) {
          _clearBlock(block);
          block.replaceWith(ul);
        } else {
          editor.innerHTML = '';
          editor.appendChild(ul);
        }
        const r = document.createRange();
        r.setStart(li, 0);
        r.collapse(true);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
        return;
      }

      case 'heading': {
        e.preventDefault();
        undo.checkpoint();
        _clearBlock(block);
        document.execCommand('formatBlock', false, `h${trigger.level}`);
        return;
      }

      case 'ordered': {
        e.preventDefault();
        undo.checkpoint();
        const startNum = trigger.start ?? 1;
        const ol = document.createElement('ol');
        if (startNum !== 1) ol.setAttribute('start', String(startNum));
        const li = document.createElement('li');
        li.innerHTML = '<br>';
        ol.appendChild(li);
        if (block && block !== editor) {
          _clearBlock(block);
          block.replaceWith(ol);
        } else {
          editor.innerHTML = '';
          editor.appendChild(ol);
        }
        const r = document.createRange();
        r.setStart(li, 0);
        r.collapse(true);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
        return;
      }

      case 'bullet': {
        e.preventDefault();
        undo.checkpoint();
        const ulb = document.createElement('ul');
        const lib = document.createElement('li');
        lib.innerHTML = '<br>';
        ulb.appendChild(lib);
        if (block && block !== editor) {
          _clearBlock(block);
          block.replaceWith(ulb);
        } else {
          editor.innerHTML = '';
          editor.appendChild(ulb);
        }
        const rb = document.createRange();
        rb.setStart(lib, 0);
        rb.collapse(true);
        const sb = window.getSelection();
        sb.removeAllRanges();
        sb.addRange(rb);
        return;
      }

      case 'callout': {
        e.preventDefault();
        undo.checkpoint();
        _clearBlock(block);
        document.execCommand('formatBlock', false, 'blockquote');
        requestAnimationFrame(() => {
          const s = window.getSelection();
          const n = s?.rangeCount ? s.getRangeAt(0).startContainer : null;
          const bq = n
            ? (n.nodeType === Node.TEXT_NODE ? n.parentElement : n).closest(
                'blockquote',
              )
            : null;
          if (bq) {
            bq.dataset.callout = trigger.type;
            const _defaultLabels = {
              note: 'Note',
              tip: 'Tip',
              important: 'Important',
              warning: 'Warning',
              caution: 'Caution',
            };
            bq.dataset.calloutLabel =
              _defaultLabels[trigger.type] ?? trigger.type;
            undo.checkpoint();
            document.dispatchEvent(new Event('forceSave'));
          }
        });
        return;
      }

      case 'code-block': {
        e.preventDefault();
        undo.checkpoint();
        _clearBlock(block);
        const pre = document.createElement('pre');
        pre.spellcheck = false;
        const code = document.createElement('code');
        code.spellcheck = false;
        code.innerHTML = '<br>';
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
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
        return;
      }

      case 'blockquote': {
        e.preventDefault();
        undo.checkpoint();
        _clearBlock(block);
        document.execCommand('formatBlock', false, 'blockquote');
        return;
      }
      case 'toggle-list': {
        e.preventDefault();
        undo.checkpoint();
        _clearBlock(block);
        const details = document.createElement('details');
        details.open = true;
        const summary = document.createElement('summary');
        summary.innerHTML = '<br>';
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
        const s = window.getSelection();
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

function _handleAltArrow(e) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;

  const node = sel.getRangeAt(0).startContainer;
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  const dir = e.key === 'ArrowUp' ? 'up' : 'down';

  // ── Element listy — ale nie gdy jesteśmy wewnątrz details
  // (Alt+↑/↓ w details przesuwa cały blok, nie element listy wewnątrz)
  const li = el.closest('li');
  const inDetails = !!el.closest('details');
  if (li && !inDetails) {
    e.preventDefault();
    const sibling =
      dir === 'up' ? li.previousElementSibling : li.nextElementSibling;
    if (!sibling) return;
    undo.checkpoint();
    if (dir === 'up') {
      li.parentNode.insertBefore(li, sibling);
    } else {
      li.parentNode.insertBefore(sibling, li);
    }
    _restoreCursorTo(li);
    return;
  }

  // ── Blok najwyższego poziomu w edytorze ───────────
  // Znajdź bezpośrednie dziecko editora
  let block = el;
  while (block && block.parentElement !== editor) {
    block = block.parentElement;
  }
  if (!block || block === editor) return;

  const sibling =
    dir === 'up' ? block.previousElementSibling : block.nextElementSibling;
  if (!sibling) return;

  e.preventDefault();
  undo.checkpoint();
  if (dir === 'up') {
    editor.insertBefore(block, sibling);
  } else {
    editor.insertBefore(sibling, block);
  }
  _restoreCursorTo(block);
}

// _restoreCursorTo → editor-selection.js

function _handleTab(e) {
  // ── Tab w details — nawigacja summary ↔ treść ─
  const sel = window.getSelection();
  if (sel?.rangeCount) {
    const node = sel.getRangeAt(0).startContainer;
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    const summary = el.closest('summary');
    const details = el.closest('details');

    if (summary && !e.shiftKey) {
      // Tab w summary → przejdź do pierwszego bloku treści
      e.preventDefault();
      let content = summary.nextElementSibling;
      if (!content) {
        content = document.createElement('p');
        content.innerHTML = '<br>';
        summary.parentElement.appendChild(content);
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
  const li = _getListItem();
  if (!li) return;
  e.preventDefault();
  e.shiftKey ? _outdentListItem(li) : _indentListItem(li);
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
function _linkToDeleteOnBackspace(range) {
  const node = range.startContainer;
  const offset = range.startOffset;
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;

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
  return prev?.nodeType === Node.ELEMENT_NODE && prev.tagName === 'A'
    ? prev
    : null;
}

function _handleBackspace(e) {
  const bkSel = window.getSelection();
  if (!bkSel.rangeCount) return;

  const bkRange = bkSel.getRangeAt(0);
  const bkNode = bkRange.startContainer;
  const bkEl =
    bkNode.nodeType === Node.TEXT_NODE ? bkNode.parentElement : bkNode;

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
      const prev = checklistLi.previousElementSibling;
      while (prev.lastChild?.nodeName === 'BR') prev.lastChild.remove();
      const cursorTarget = prev.lastChild;
      const cursorOffset =
        cursorTarget?.nodeType === Node.TEXT_NODE
          ? cursorTarget.textContent.length
          : prev.childNodes.length;
      while (checklistLi.firstChild) prev.appendChild(checklistLi.firstChild);
      if (!prev.firstChild) prev.appendChild(document.createElement('br'));
      checklistLi.remove();
      const r = document.createRange();
      if (cursorTarget?.nodeType === Node.TEXT_NODE)
        r.setStart(cursorTarget, cursorOffset);
      else if (cursorTarget) r.setStartAfter(cursorTarget);
      else r.setStart(prev, 0);
      r.collapse(true);
      bkSel.removeAllRanges();
      bkSel.addRange(r);
      return;
    }

    case 'checklist-exit-to-p': {
      const ul = checklistLi.closest('ul');
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
      const children = [...blockquote.childNodes];
      const frag = document.createDocumentFragment();
      let firstP = null;
      if (!children.length) {
        const p = document.createElement('p');
        p.innerHTML = '<br>';
        frag.appendChild(p);
        firstP = p;
      } else {
        children.forEach((child) => {
          if (child.nodeType === Node.ELEMENT_NODE && child.tagName === 'P') {
            if (!child.firstChild) child.innerHTML = '<br>';
            frag.appendChild(child);
            if (!firstP) firstP = child;
          } else {
            const p = document.createElement('p');
            p.appendChild(child.cloneNode(true));
            frag.appendChild(p);
            if (!firstP) firstP = p;
          }
        });
      }
      blockquote.replaceWith(frag);
      const r = document.createRange();
      r.setStart(firstP, 0);
      r.collapse(true);
      bkSel.removeAllRanges();
      bkSel.addRange(r);
      return;
    }

    case 'li-merge': {
      const prev = li.previousElementSibling;
      while (prev.lastChild?.nodeName === 'BR') prev.lastChild.remove();
      const cursorTarget = prev.lastChild;
      const cursorOffset =
        cursorTarget?.nodeType === Node.TEXT_NODE
          ? cursorTarget.textContent.length
          : prev.childNodes.length;
      while (li.firstChild) prev.appendChild(li.firstChild);
      if (!prev.firstChild) prev.appendChild(document.createElement('br'));
      li.remove();
      const r = document.createRange();
      if (cursorTarget?.nodeType === Node.TEXT_NODE)
        r.setStart(cursorTarget, cursorOffset);
      else if (cursorTarget) r.setStartAfter(cursorTarget);
      else r.setStart(prev, 0);
      r.collapse(true);
      bkSel.removeAllRanges();
      bkSel.addRange(r);
      return;
    }

    case 'li-outdent': {
      _outdentListItem(li);
      return;
    }

    case 'li-exit-to-p': {
      const list = li.parentElement;
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
      const details = summary.closest('details');
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
function _handleCtrl(e) {
  switch (e.key) {
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
      document.getElementById('code-btn').click();
      break;
    case 'X':
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
    case 'k':
      e.preventDefault();
      openLinkModal();
      break;
  }
}

/* ── Paste ────────────────────────────────────── */

function _initPaste() {
  editor.addEventListener('paste', (e) => {
    e.preventDefault();
    undo.checkpoint();

    const MAX_PASTE = 200_000;
    const html = e.clipboardData.getData('text/html');
    const plain = e.clipboardData.getData('text/plain');

    if (html) {
      const processed = isClickUpHTML(html) ? preprocessClickUp(html) : html;
      const safe = sanitizeHTML(processed ?? html);
      const trimmed = safe.length > MAX_PASTE ? safe.slice(0, MAX_PASTE) : safe;
      // Limit węzłów DOM — zapobiega paste bomb z zagnieżdżonych tagów
      if (trimmed) {
        const tmp = document.createElement('div');
        tmp.innerHTML = trimmed;
        if (tmp.querySelectorAll('*').length > 5000) {
          document.execCommand(
            'insertText',
            false,
            tmp.textContent.slice(0, MAX_PASTE),
          );
          return;
        }
        if (_insertRichContent(trimmed)) return;
      }
    }

    // Fallback: plain text (np. z terminala, edytora kodu)
    const text = plain.length > MAX_PASTE ? plain.slice(0, MAX_PASTE) : plain;
    document.execCommand('insertText', false, text);
  });
}

/**
 * Wstawia sanityzowany HTML w miejsce kursora przez Range API.
 * Bloki (ul/ol/p/h1-h3/blockquote/pre) wstawiane ZA bieżącym blokiem,
 * żeby uniknąć wstawiania bloków wewnątrz <p> (Firefox to odrzuca).
 * @returns {boolean} true gdy wstawiono
 */
function _insertRichContent(html) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return false;

  // Strip clipboard metadata comments (<!--StartFragment--> etc.)
  const stripped = html.replace(/<!--[\s\S]*?-->/g, '').trim();
  if (!stripped) return false;

  const tmp = document.createElement('div');
  tmp.innerHTML = stripped;
  if (!tmp.childNodes.length) return false;

  const range = sel.getRangeAt(0);
  range.deleteContents();

  const BLOCK = new Set([
    'UL',
    'OL',
    'P',
    'H1',
    'H2',
    'H3',
    'BLOCKQUOTE',
    'PRE',
    'DIV',
    'HR',
  ]);
  const hasBlock = Array.from(tmp.childNodes).some(
    (n) => n.nodeType === Node.ELEMENT_NODE && BLOCK.has(n.tagName),
  );

  if (hasBlock) {
    // Znajdź bezpośrednie dziecko editora gdzie jest kursor
    let anchor = range.startContainer;
    while (anchor && anchor.parentNode !== editor) anchor = anchor.parentNode;

    const nodes = Array.from(tmp.childNodes)
      .filter((n) => n.nodeType === Node.ELEMENT_NODE || n.textContent.trim())
      .map((n) => n.cloneNode(true));

    if (anchor && anchor !== editor) {
      let ref = anchor;
      nodes.forEach((node) => {
        ref.after(node);
        ref = node;
      });

      // Usuń pusty blok-kontener jeśli cursor był w pustym <p>
      if (!anchor.textContent.trim() && anchor.tagName === 'P') anchor.remove();

      const r = document.createRange();
      r.setStartAfter(ref);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    } else {
      nodes.forEach((n) => editor.appendChild(n));
      const last = nodes[nodes.length - 1];
      const r = document.createRange();
      r.setStartAfter(last);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  } else {
    // Inline (bold, italic, link, code) — wstaw w miejscu kursora
    const frag = document.createDocumentFragment();
    Array.from(tmp.childNodes).forEach((n) =>
      frag.appendChild(n.cloneNode(true)),
    );
    const last = frag.lastChild;
    range.insertNode(frag);
    if (last) {
      const r = document.createRange();
      r.setStartAfter(last);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  }

  editor.focus();
  debouncedSave();
  return true;
}

/* ── Copy / Cut ────────────────────────────────── */

function _initCopy() {
  editor.addEventListener('copy', (e) => _handleCopy(e, false));
  editor.addEventListener('cut', (e) => _handleCopy(e, true));
}

function _handleCopy(e, isCut) {
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return;

  const range = sel.getRangeAt(0);
  const fragment = range.cloneContents();
  const wrap = document.createElement('div');
  wrap.appendChild(fragment);

  // Usuń klasy edytora — inne aplikacje ich nie rozumieją
  wrap.querySelectorAll('[class]').forEach((el) => el.removeAttribute('class'));
  wrap.normalize();

  e.clipboardData.setData('text/html', wrap.innerHTML);
  e.clipboardData.setData('text/plain', wrap.textContent);
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

/* ── Context Resume — zapamiętaj/przywróć pozycję kursora ── */

// getCursorOffset / setCursorOffset → editor-selection.js
// (przeniesione, żeby notes.js nie importował z editor.js — cykl)

const _saveCursorDebounced = debounce((activeId) => {
  if (!activeId) return;
  const offset = getCursorOffset(editor);
  if (offset == null) return;
  saveUiSettings({ [`cursor_${activeId}`]: offset });
}, 800);

function _initCursorResume() {
  document.addEventListener('selectionchange', () => {
    if (document.activeElement?.id !== 'editor') return;
    // Pobierz activeId z state — importowane z notes.js
    _saveCursorDebounced(state.activeId);
  });
}

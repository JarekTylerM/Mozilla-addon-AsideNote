// @ts-check
/**
 * editor-toolbar.js — inicjalizacja toolbara i synchronizacja stanów
 *
 * Odpowiedzialność:
 *   - Podpięcie handlerów do przycisków toolbara
 *   - Obsługa dropdown callout i dropdown list
 *   - Toggle checklist
 *   - Synchronizacja active state (selectionchange)
 *
 * Publiczne API:
 *   initToolbar()  — wywołaj raz z initEditor()
 */

import { t } from './i18n.js';
import * as undo from './undo.js';
import { debouncedSave } from './notes.js';
import {
  _getCurrentBlock,
  _clearBlock,
  _outdentListItem,
} from './editor-selection.js';

const editor = /** @type {HTMLElement} */ (document.getElementById('editor'));

/** @param {Range} r — ustaw zaznaczenie na zwinięty/rozwinięty range */
function _selectRange(r) {
  const s = window.getSelection();
  if (!s) return;
  s.removeAllRanges();
  s.addRange(r);
}

// Zapamiętaj ostatni fokus spoza toolbara — guard dla przycisków wstawiania
/** @type {Element | null} */
let _lastFocusBeforeToolbar = null;
document.addEventListener('focusin', (e) => {
  const target = /** @type {Element|null} */ (e.target);
  if (target && !target.closest('.toolbar')) {
    _lastFocusBeforeToolbar = target;
  }
});

function _initToolbar() {
  document.querySelectorAll('#toolbar button').forEach((el) => {
    const btn = /** @type {HTMLButtonElement} */ (el);
    if (btn.id === 'code-btn') return;
    if (btn.id === 'link-btn') return;
    if (btn.id === 'undo-btn') return;
    if (btn.id === 'redo-btn') return;
    if (btn.id === 'copy-md-btn') return;
    if (btn.id === 'checklist-btn') return;
    if (btn.id === 'blockquote-btn') return;
    if (btn.id === 'blockquote-arrow') return;
    if (btn.id === 'format-block-main') return;
    if (btn.id === 'format-block-arrow') return;
    if (btn.closest('#format-block-dropdown')) return;
    if (btn.closest('.callout-dropdown')) return;
    btn.onclick = () => {
      undo.checkpoint();
      document.execCommand(btn.dataset.cmd ?? '', false, btn.dataset.value ?? undefined);
      editor.focus();
    };
  });
}

function _initFormatBlockBtn() {
  const mainBtn = document.getElementById('format-block-main');
  const arrowBtn = document.getElementById('format-block-arrow');
  const dropdown = document.getElementById('format-block-dropdown');
  if (!mainBtn || !arrowBtn || !dropdown) return;

  const FORMATS = {
    p: 'icon--paragraph',
    h1: 'icon--h1',
    h2: 'icon--h2',
    h3: 'icon--h3',
  };

  // Główny przycisk — zastosuj aktualny format (toggle p/h1)
  mainBtn.onclick = () => {
    undo.checkpoint();
    document.execCommand('formatBlock', false, 'p');
    editor.focus();
  };

  mainBtn.addEventListener('mouseenter', () => {
    mainBtn.classList.remove(
      'icon--h1',
      'icon--h2',
      'icon--h3',
      'icon--paragraph',
    );
    mainBtn.classList.add('icon--paragraph');
  });

  mainBtn.addEventListener('mouseleave', () => {
    const cur = mainBtn.dataset.current || 'p';
    mainBtn.classList.remove(
      'icon--h1',
      'icon--h2',
      'icon--h3',
      'icon--paragraph',
    );
    mainBtn.classList.add(
      cur === 'h1'
        ? 'icon--h1'
        : cur === 'h2'
          ? 'icon--h2'
          : cur === 'h3'
            ? 'icon--h3'
            : 'icon--paragraph',
    );
  });

  // Strzałka — toggle dropdown
  arrowBtn.onclick = (e) => {
    e.stopPropagation();
    const open = dropdown.classList.contains('is-open');
    _closeFormatBlockDropdown();
    if (!open) {
      const rect = arrowBtn.getBoundingClientRect();
      const dropW = 200;
      const left = Math.max(4, rect.right - dropW);
      dropdown.style.top = `${rect.bottom + 4}px`;
      dropdown.style.left = `${left}px`;
      dropdown.classList.add('is-open');
      arrowBtn.setAttribute('aria-expanded', 'true');
      /** @type {HTMLElement|null} */ (dropdown.querySelector('.callout-dropdown__item'))?.focus();
    }
  };

  // Kliknięcie na item
  dropdown.addEventListener('click', (e) => {
    const item = /** @type {HTMLElement|null} */ (
      (/** @type {Element|null} */ (e.target))?.closest('.callout-dropdown__item') ?? null
    );
    if (!item) return;
    _closeFormatBlockDropdown();
    const fmt = item.dataset.format;
    undo.checkpoint();
    document.execCommand('formatBlock', false, fmt);
    editor.focus();
  });

  // Klawiatura
  dropdown.addEventListener('keydown', (e) => {
    const items = /** @type {HTMLElement[]} */ ([...dropdown.querySelectorAll('.callout-dropdown__item')]);
    const idx = items.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(idx + 1) % items.length]?.focus();
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length]?.focus();
    }
    if (e.key === 'Escape') {
      _closeFormatBlockDropdown();
      arrowBtn.focus();
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      /** @type {HTMLElement|null} */ (document.activeElement)?.click();
    }
  });

  document.addEventListener('click', (e) => {
    const target = /** @type {Element|null} */ (e.target);
    if (
      target &&
      !target.closest('#format-block-split') &&
      !target.closest('#format-block-dropdown')
    )
      _closeFormatBlockDropdown();
  });
}

function _closeFormatBlockDropdown() {
  const dropdown = document.getElementById('format-block-dropdown');
  const arrowBtn = document.getElementById('format-block-arrow');
  if (dropdown) dropdown.classList.remove('is-open');
  if (arrowBtn) arrowBtn.setAttribute('aria-expanded', 'false');
}

function _initCodeBtn() {
  /** @type {HTMLElement} */ (document.getElementById('code-btn')).onclick = () => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;

    undo.checkpoint();

    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    const element =
      node.nodeType === Node.TEXT_NODE
        ? node.parentElement
        : /** @type {Element} */ (node);
    const existingCode = element?.closest('code');

    // Toggle off — kursor jest w <code>, rozwijamy
    if (existingCode) {
      const text = existingCode.textContent ?? '';
      const textNode = document.createTextNode(text);
      existingCode.replaceWith(textNode);

      // Postaw kursor na końcu rozwiniętego tekstu
      const r = document.createRange();
      r.setStart(textNode, text.length);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      editor.focus();
      return;
    }

    // Toggle on — owijamy selekcję (lub wstawiamy "code" jako placeholder)
    const codeEl = document.createElement('code');
    codeEl.textContent = sel.toString() || 'code';

    if (sel.toString()) range.deleteContents();
    range.insertNode(codeEl);
    range.setStartAfter(codeEl);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    editor.focus();
  };
}

function _initCodeBlockBtn() {
  document.getElementById('codeblock-btn')?.addEventListener('click', () => {
    // Detekcja <pre> bezpośrednio z selekcji — _getCurrentBlock() nie zna
    // tagu PRE (nie ma go w blockTags) i dla kursora w bloku kodu zwraca
    // sam #editor, przez co toggle-off nigdy nie odpalał, a toggle-on
    // czyścił CAŁĄ notatkę przez _clearBlock(editor).
    const sel = window.getSelection();
    const selNode = sel?.rangeCount ? sel.getRangeAt(0).startContainer : null;
    const selEl =
      selNode == null
        ? null
        : selNode.nodeType === Node.TEXT_NODE
          ? selNode.parentElement
          : /** @type {Element} */ (selNode);
    const pre = selEl?.closest('pre') ?? null;
    const block = _getCurrentBlock();
    undo.checkpoint();
    if (pre) {
      // Toggle off — konwertuj pre z powrotem do paragrafów
      const fragment = document.createDocumentFragment();
      const lines = (pre.textContent ?? '').split('\n');
      /** @type {HTMLElement|null} */
      let firstP = null;
      lines.forEach((line) => {
        const p = document.createElement('p');
        p.textContent = line || '';
        if (!p.firstChild) p.innerHTML = '<br>';
        if (!firstP) firstP = p;
        fragment.appendChild(p);
      });
      pre.replaceWith(fragment);
      // Kursor na początek pierwszego akapitu — replaceWith unieważnia selekcję
      if (firstP) {
        const r = document.createRange();
        r.setStart(firstP, 0);
        r.collapse(true);
        _selectRange(r);
      }
    } else {
      // Toggle on
      _clearBlock(block);
      const preEl = document.createElement('pre');
      preEl.spellcheck = false;
      const codeEl = document.createElement('code');
      codeEl.spellcheck = false;
      codeEl.innerHTML = '<br>';
      preEl.appendChild(codeEl);
      const curBlock = _getCurrentBlock();
      if (curBlock && curBlock !== editor) {
        curBlock.replaceWith(preEl);
      } else {
        editor.appendChild(preEl);
      }
      const r = document.createRange();
      r.setStart(codeEl, 0);
      r.collapse(true);
      _selectRange(r);
    }
    editor.focus();
  });
}

function _initChecklistBtn() {
  // onclick obsługiwany przez _initListBtn dropdown handler — tylko mousedown checkbox toggle
  // document.getElementById("checklist-btn").onclick = () => {
  //   _toggleChecklist();
  //   editor.focus();
  // };

  // Toggle checkbox po kliknięciu w obszar ::before (lewe ~22 px elementu)
  editor.addEventListener('mousedown', (e) => {
    const li = /** @type {Element|null} */ (e.target)?.closest('ul[data-list="checklist"] li');
    if (!li) return;
    const rect = li.getBoundingClientRect();
    if (e.clientX - rect.left < 22 && e.clientY - rect.top < 20) {
      e.preventDefault(); // nie przesuwaj kursora
      undo.checkpoint();
      li.setAttribute(
        'data-checked',
        li.getAttribute('data-checked') === 'true' ? 'false' : 'true',
      );
      document.dispatchEvent(new Event('forceSave'));
    }
  });
}

function _toggleChecklist() {
  undo.checkpoint();
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;

  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  const el =
    node.nodeType === Node.TEXT_NODE
      ? node.parentElement
      : /** @type {Element} */ (node);

  // Toggle off — jesteśmy w checkliście
  const existingUl = el?.closest('ul[data-list="checklist"]');
  if (existingUl) {
    const fragment = document.createDocumentFragment();
    Array.from(existingUl.children).forEach((li) => {
      const p = document.createElement('p');
      p.innerHTML = li.innerHTML || '<br>';
      fragment.appendChild(p);
    });
    existingUl.replaceWith(fragment);
    undo.checkpoint();
    document.dispatchEvent(new Event('forceSave'));
    return;
  }

  // Toggle on — konwertuj bieżący blok
  const block = _getCurrentBlock();
  const ul = document.createElement('ul');
  ul.setAttribute('data-list', 'checklist');
  const li = document.createElement('li');
  li.setAttribute('data-checked', 'false');

  if (block && block !== editor) {
    li.innerHTML = block.innerHTML || '<br>';
    ul.appendChild(li);
    block.replaceWith(ul);
  } else {
    // Kursor bezpośrednio w edytorze (brak block-wrappera) — wstaw nowy
    li.innerHTML = '<br>';
    ul.appendChild(li);
    range.deleteContents();
    range.insertNode(ul);
  }

  // Ustaw kursor w pierwszym li
  const r = document.createRange();
  r.setStart(li, 0);
  r.collapse(true);
  _selectRange(r);

  undo.checkpoint();
  document.dispatchEvent(new Event('forceSave'));
}

function _createToggleList() {
  const editorEl = /** @type {HTMLElement} */ (document.getElementById('editor'));
  undo.checkpoint();
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
  const block = _getCurrentBlock();
  if (block && block !== editorEl) {
    block.after(details);
    if (!(block.textContent ?? '').trim()) block.remove();
  } else {
    editorEl.appendChild(details);
  }
  const r = document.createRange();
  r.setStart(summary, 0);
  r.collapse(true);
  _selectRange(r);
  editorEl.focus();
  debouncedSave();
}

function _initToggleListBtn() {
  const btn = document.getElementById('toggle-list-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const last = _lastFocusBeforeToolbar;
    if (!last || last.id === 'title' || last.id === 'quick-capture') return;
    if (!last.closest('#editor') && last.id !== 'editor') return;
    _createToggleList();
  });
}

function _initCalloutBtn() {
  const mainBtn = document.getElementById('blockquote-btn');
  const arrowBtn = document.getElementById('blockquote-arrow');
  const dropdown = document.getElementById('callout-dropdown');
  if (!mainBtn || !arrowBtn || !dropdown) return;

  // Lewy przycisk — plain blockquote lub toggle off
  mainBtn.onclick = () => {
    _applyCallout('');
    editor.focus();
  };

  // Prawy przycisk — toggle dropdown
  arrowBtn.onclick = (e) => {
    e.stopPropagation();
    const open = dropdown.classList.contains('is-open');
    _closeCalloutDropdown();
    if (!open) {
      // Pozycjonowanie: fixed relatywne do arrowBtn (omija overflow:hidden parentów)
      const rect = arrowBtn.getBoundingClientRect();
      const dropW = 220;
      const left = Math.max(4, rect.right - dropW);
      dropdown.style.top = `${rect.bottom + 4}px`;
      dropdown.style.left = `${left}px`;
      dropdown.classList.add('is-open');
      arrowBtn.setAttribute('aria-expanded', 'true');
      /** @type {HTMLElement|null} */ (dropdown.querySelector('.callout-dropdown__item'))?.focus();
    }
  };

  // Kliknięcie na item dropdownu
  dropdown.addEventListener('click', (e) => {
    const item = /** @type {HTMLElement|null} */ (
      (/** @type {Element|null} */ (e.target))?.closest('.callout-dropdown__item') ?? null
    );
    if (!item) return;
    _closeCalloutDropdown();
    _applyCallout(item.dataset.callout ?? '');
    editor.focus();
  });

  // Klawiatura w dropdownie — strzałki + Escape
  dropdown.addEventListener('keydown', (e) => {
    const items = /** @type {HTMLElement[]} */ ([...dropdown.querySelectorAll('.callout-dropdown__item')]);
    const idx = items.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(idx + 1) % items.length]?.focus();
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length]?.focus();
    }
    if (e.key === 'Escape') {
      _closeCalloutDropdown();
      arrowBtn.focus();
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      /** @type {HTMLElement|null} */ (document.activeElement)?.click();
    }
  });

  // Kliknięcie poza — zamknij dropdown
  document.addEventListener('click', (e) => {
    const target = /** @type {Element|null} */ (e.target);
    if (
      target &&
      !target.closest('#blockquote-split') &&
      !target.closest('#callout-dropdown')
    ) {
      _closeCalloutDropdown();
    }
  });
}

function _closeCalloutDropdown() {
  const dropdown = document.getElementById('callout-dropdown');
  const arrowBtn = document.getElementById('blockquote-arrow');
  if (dropdown) dropdown.classList.remove('is-open');
  if (arrowBtn) arrowBtn.setAttribute('aria-expanded', 'false');
}

function _initListBtn() {
  const mainBtn = document.getElementById('list-main-btn');
  const arrowBtn = document.getElementById('list-arrow');
  const dropdown = document.getElementById('list-dropdown');
  if (!mainBtn || !arrowBtn || !dropdown) return;

  mainBtn.onclick = () => {
    undo.checkpoint();
    document.execCommand('insertUnorderedList');
    editor.focus();
  };

  mainBtn.addEventListener('mouseenter', () => {
    mainBtn.classList.remove(
      'icon--list-bullet',
      'icon--list-number',
      'icon--checklist',
      'icon--toggle-list',
    );
    mainBtn.classList.add('icon--list-bullet');
  });

  mainBtn.addEventListener('mouseleave', () => {
    const cur = mainBtn.dataset.current || 'bullet';
    mainBtn.classList.remove(
      'icon--list-bullet',
      'icon--list-number',
      'icon--checklist',
      'icon--toggle-list',
    );
    mainBtn.classList.add(
      cur === 'ordered'
        ? 'icon--list-number'
        : cur === 'checklist'
          ? 'icon--checklist'
          : cur === 'toggle'
            ? 'icon--toggle-list'
            : 'icon--list-bullet',
    );
  });

  arrowBtn.onclick = (e) => {
    e.stopPropagation();
    const open = dropdown.classList.contains('is-open');
    _closeListDropdown();
    if (!open) {
      const rect = arrowBtn.getBoundingClientRect();
      const dropW = 220;
      const left = Math.max(4, rect.right - dropW);
      dropdown.style.top = `${rect.bottom + 4}px`;
      dropdown.style.left = `${left}px`;
      dropdown.classList.add('is-open');
      arrowBtn.setAttribute('aria-expanded', 'true');
      /** @type {HTMLElement|null} */ (dropdown.querySelector('.callout-dropdown__item'))?.focus();
    }
  };

  dropdown.addEventListener('click', (e) => {
    const item = /** @type {HTMLElement|null} */ (
      (/** @type {Element|null} */ (e.target))?.closest('.callout-dropdown__item') ?? null
    );
    if (!item) return;
    _closeListDropdown();
    const type = item.dataset.listType;
    undo.checkpoint();
    if (type === 'bullet') {
      document.execCommand('insertUnorderedList');
    } else if (type === 'ordered') {
      document.execCommand('insertOrderedList');
    } else if (type === 'checklist') {
      _toggleChecklist();
    } else if (type === 'toggle') {
      _createToggleList();
      return;
    }
    editor.focus();
  });

  dropdown.addEventListener('keydown', (e) => {
    const items = /** @type {HTMLElement[]} */ ([...dropdown.querySelectorAll('.callout-dropdown__item')]);
    const idx = items.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(idx + 1) % items.length]?.focus();
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length]?.focus();
    }
    if (e.key === 'Escape') {
      _closeListDropdown();
      arrowBtn.focus();
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      /** @type {HTMLElement|null} */ (document.activeElement)?.click();
    }
  });

  document.addEventListener('click', (e) => {
    const target = /** @type {Element|null} */ (e.target);
    if (target && !target.closest('#list-split') && !target.closest('#list-dropdown'))
      _closeListDropdown();
  });
}

function _closeListDropdown() {
  const dropdown = document.getElementById('list-dropdown');
  const arrowBtn = document.getElementById('list-arrow');
  if (dropdown) dropdown.classList.remove('is-open');
  if (arrowBtn) arrowBtn.setAttribute('aria-expanded', 'false');
}

/** @param {string} type */
function _applyCallout(type) {
  undo.checkpoint();

  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  /** @type {Node|undefined} */
  let node;
  try {
    node = sel.getRangeAt(0).startContainer;
  } catch {
    return;
  }
  if (!node) return;
  const el =
    node.nodeType === Node.TEXT_NODE
      ? node.parentElement
      : /** @type {Element} */ (node);
  const existing = /** @type {HTMLElement|null} */ (el?.closest('blockquote') ?? null);

  if (existing) {
    const current = existing.dataset.callout ?? '';

    if (type === '') {
      // Plain — usuń callout type ale zostaw blockquote
      delete existing.dataset.callout;
    } else if (type === current) {
      // Ten sam typ — toggle off (usuń blockquote)
      const frag = document.createDocumentFragment();
      Array.from(existing.childNodes).forEach((n) =>
        frag.appendChild(n.cloneNode(true)),
      );
      existing.replaceWith(frag);
    } else {
      // Zmień typ
      existing.dataset.callout = type;
    }
    undo.checkpoint();
    document.dispatchEvent(new Event('forceSave'));
    return;
  }

  // Brak blockquote — wstaw nowy
  document.execCommand('formatBlock', false, 'blockquote');

  // Po execCommand szukamy świeżo wstawionego blockquote
  if (type) {
    requestAnimationFrame(() => {
      const s = window.getSelection();
      const n = s?.rangeCount ? s.getRangeAt(0).startContainer : null;
      const bqEl = n
        ? n.nodeType === Node.TEXT_NODE
          ? n.parentElement
          : /** @type {Element} */ (n)
        : null;
      const bq = bqEl?.closest('blockquote') ?? null;
      if (bq) {
        /** @type {HTMLElement} */ (bq).dataset.callout = type;
        undo.checkpoint();
        document.dispatchEvent(new Event('forceSave'));
      }
    });
  } else {
    undo.checkpoint();
    document.dispatchEvent(new Event('forceSave'));
  }
}

/** @type {number|null} */
let _toolbarStateRaf = null;
function _updateToolbarState() {
  // Throttle przez requestAnimationFrame — selectionchange leci 60×/s
  if (_toolbarStateRaf) return;
  _toolbarStateRaf = requestAnimationFrame(() => {
    _toolbarStateRaf = null;

    // Tylko gdy fokus jest w edytorze
    if (document.activeElement?.id !== 'editor') return;

    // Toggle buttons (bold/italic/underline/strikethrough)
    const commands = {
      bold: 'bold',
      italic: 'italic',
      underline: 'underline',
      strikeThrough: 'strikeThrough',
    };

    Object.entries(commands).forEach(([cmd, queryCmd]) => {
      const btn = document.querySelector(`#toolbar button[data-cmd="${cmd}"]`);
      if (!btn) return;
      try {
        const isActive = document.queryCommandState(queryCmd);
        btn.classList.toggle('is-active', isActive);
      } catch {
        // queryCommandState rzuca w niektórych edge casach
      }
    });

    // Listy — uwzględnij checklist, który też jest <ul> ale nie bullet list
    const sel = window.getSelection();
    const node = sel?.rangeCount ? sel.getRangeAt(0).startContainer : null;
    const el = node
      ? node.nodeType === Node.TEXT_NODE
        ? node.parentElement
        : /** @type {Element} */ (node)
      : null;

    // Sprawdź czy kursor jest w checkliście (ul[data-list="checklist"])
    const inChecklist = !!el?.closest('ul[data-list="checklist"]');

    // Bullet list: queryCommandState zwraca true dla KAŻDEGO <ul>,
    // więc musimy wykluczyć checklist
    const checklistBtn = document.getElementById('checklist-btn');
    const bulletBtn = document.querySelector(
      '#toolbar button[data-cmd="insertUnorderedList"]',
    );
    const orderedBtn = document.querySelector(
      '#toolbar button[data-cmd="insertOrderedList"]',
    );

    if (checklistBtn) checklistBtn.classList.toggle('is-active', inChecklist);

    if (bulletBtn) {
      try {
        const inAnyUl = document.queryCommandState('insertUnorderedList');
        bulletBtn.classList.toggle('is-active', inAnyUl && !inChecklist);
      } catch {
        /* ignore */
      }
    }

    if (orderedBtn) {
      try {
        orderedBtn.classList.toggle(
          'is-active',
          document.queryCommandState('insertOrderedList'),
        );
      } catch {
        /* ignore */
      }
    }

    // formatBlock <select> sync — pokazuj aktualny block-element kursora
    const mainBtn = document.getElementById('format-block-main');
    if (mainBtn) {
      const block = _getCurrentBlock();
      let fmt = 'p';
      if (block && block !== editor) {
        const tag = block.tagName.toLowerCase();
        if (['h1', 'h2', 'h3', 'p'].includes(tag)) fmt = tag;
      }
      /** @type {Record<string, string>} */
      const ICONS = {
        p: 'icon--paragraph',
        h1: 'icon--h1',
        h2: 'icon--h2',
        h3: 'icon--h3',
      };
      if (mainBtn.dataset.current !== fmt) {
        mainBtn.dataset.current = fmt;
        mainBtn.className = `panel-icon ${ICONS[fmt]} toolbar-split__main`;
      }
    }
    // List main btn — śledź aktywny typ listy + aktualizuj ikonę
    const listMainBtn = document.getElementById('list-main-btn');
    if (listMainBtn) {
      const inToggle = !!el?.closest('details');
      const inChecklist2 = !!el?.closest('ul[data-list="checklist"]');
      let listType = 'bullet';
      if (inToggle) listType = 'toggle';
      else if (inChecklist2) listType = 'checklist';
      else {
        try {
          if (document.queryCommandState('insertOrderedList'))
            listType = 'ordered';
        } catch {
          /* ignore */
        }
      }
      if (listMainBtn.dataset.current !== listType) {
        listMainBtn.dataset.current = listType;
        if (!listMainBtn.matches(':hover')) {
          /** @type {Record<string, string>} */
          const LIST_ICONS = {
            bullet: 'icon--list-bullet',
            ordered: 'icon--list-number',
            checklist: 'icon--checklist',
            toggle: 'icon--toggle-list',
          };
          listMainBtn.className = `panel-icon ${LIST_ICONS[listType]} toolbar-split__main`;
        }
      }
    }

    // Toggle list (details/summary) active state
    const toggleListBtn = document.getElementById('toggle-list-btn');
    if (toggleListBtn) {
      const inDetails = !!el?.closest('details');
      toggleListBtn.classList.toggle('is-active', inDetails);
    }
    // Blockquote / callout active state
    const bqBtn = document.getElementById('blockquote-btn');
    if (bqBtn) {
      const bq = /** @type {HTMLElement|null} */ (el?.closest('blockquote') ?? null);
      bqBtn.classList.toggle('is-active', !!bq);
      const calloutType = bq?.dataset.callout ?? '';
      bqBtn.dataset.activeCallout = calloutType;
    }

    // Link active state
    const linkBtn = document.getElementById('link-btn');
    if (linkBtn) {
      linkBtn.classList.toggle('is-active', !!el?.closest('a'));
    }
  });
}

/* ── Inicjalizacja wszystkich komponentów toolbara ── */

export function initToolbar() {
  _initToolbar();
  _initCodeBtn();
  _initCodeBlockBtn();
  _initToggleListBtn();
  _initChecklistBtn();
  _initCalloutBtn();
  _initListBtn();
  _initFormatBlockBtn();
  // Sync active state przy każdej zmianie zaznaczenia
  document.addEventListener('selectionchange', _updateToolbarState);
}

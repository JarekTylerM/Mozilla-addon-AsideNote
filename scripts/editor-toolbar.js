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
  _saveSelection,
  _restoreSelection,
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

/**
 * Zachowanie rozwijanej listy przy split buttonie: otwieranie pod strzałką,
 * strzałki w górę i w dół, Escape, zamykanie kliknięciem poza nią.
 *
 * @param {object} opts
 * @param {string} opts.splitId kontener split buttona
 * @param {string} opts.arrowId przycisk ze strzałką
 * @param {string} opts.dropdownId lista
 * @param {number} opts.width szerokość listy do wyliczenia pozycji
 * @param {(item: HTMLElement) => void} opts.onSelect wybór pozycji
 */
function _bindDropdown({ splitId, arrowId, dropdownId, width, onSelect }) {
  const split = document.getElementById(splitId);
  const arrow = document.getElementById(arrowId);
  const dropdown = document.getElementById(dropdownId);
  if (!split || !arrow || !dropdown) return;

  const close = () => {
    dropdown.classList.remove('is-open');
    arrow.setAttribute('aria-expanded', 'false');
  };

  arrow.onclick = (e) => {
    e.stopPropagation();
    const open = dropdown.classList.contains('is-open');
    close();
    if (open) return;
    // Pozycjonowanie: fixed relatywne do strzałki (omija overflow:hidden parentów)
    const rect = arrow.getBoundingClientRect();
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.left = `${Math.max(4, rect.right - width)}px`;
    dropdown.classList.add('is-open');
    arrow.setAttribute('aria-expanded', 'true');
    /** @type {HTMLElement|null} */ (dropdown.querySelector('.callout-dropdown__item'))?.focus();
  };

  dropdown.addEventListener('click', (e) => {
    const item = /** @type {HTMLElement|null} */ (
      (/** @type {Element|null} */ (e.target))?.closest('.callout-dropdown__item') ?? null
    );
    if (!item) return;
    close();
    onSelect(item);
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
      // Bez stopPropagation globalny skrót Esc zamknąłby całą notatkę
      e.preventDefault();
      e.stopPropagation();
      close();
      arrow.focus();
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      /** @type {HTMLElement|null} */ (document.activeElement)?.click();
    }
  });

  document.addEventListener('click', (e) => {
    const target = /** @type {Node|null} */ (e.target);
    if (target && !split.contains(target)) close();
  });
}

/** Style tekstu: komenda execCommand → ikona. Kolejność to priorytet ikony grupy. */
const TEXT_STYLES = [
  { cmd: 'bold', icon: 'icon--bold' },
  { cmd: 'italic', icon: 'icon--italic' },
  { cmd: 'underline', icon: 'icon--underline' },
  { cmd: 'strikeThrough', icon: 'icon--strikethrough' },
];

/**
 * Grupa stylów tekstu. Przy szerokim pasku split button jest niewidoczny,
 * a cztery przyciski stoją wprost w pasku. Przy wąskim wysuwają się spod
 * strzałki (editor.css). To te same przyciski, więc skróty, stan i obsługa
 * nie zależą od szerokości panelu.
 *
 * Panel zostaje otwarty po kliknięciu, żeby dało się łączyć style.
 */
function _initTextStyleGroup() {
  const split = document.getElementById('text-style-split');
  const main = document.getElementById('text-style-main');
  const arrow = document.getElementById('text-style-arrow');
  const group = document.getElementById('text-style-group');
  if (!split || !main || !arrow || !group) return;

  const close = () => {
    group.classList.remove('is-open');
    arrow.setAttribute('aria-expanded', 'false');
  };

  // Fokus i zaznaczenie zostają w edytorze: bez tego stan stylów przestawałby
  // się aktualizować (_updateToolbarState działa tylko przy fokusie w edytorze)
  split.addEventListener('mousedown', (e) => e.preventDefault());

  main.onclick = () => {
    undo.checkpoint();
    document.execCommand(main.dataset.cmd ?? 'bold');
    editor.focus();
    _updateToolbarState();
  };

  arrow.onclick = (e) => {
    e.stopPropagation();
    if (group.classList.contains('is-open')) {
      close();
      return;
    }
    group.classList.add('is-open');
    arrow.setAttribute('aria-expanded', 'true');
    const rect = arrow.getBoundingClientRect();
    const left = Math.min(
      rect.left,
      window.innerWidth - group.offsetWidth - 4,
    );
    group.style.top = `${rect.bottom + 4}px`;
    group.style.left = `${Math.max(4, left)}px`;
  };

  document.addEventListener('click', (e) => {
    const target = /** @type {Node|null} */ (e.target);
    if (target && !split.contains(target)) close();
  });

  // W fazie przechwytywania: fokus jest w edytorze, a tam Escape zamyka notatkę
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || !group.classList.contains('is-open')) return;
      e.preventDefault();
      e.stopPropagation();
      close();
    },
    true,
  );

  window.addEventListener('resize', close);
}

function _initToolbar() {
  document.querySelectorAll('#toolbar button').forEach((el) => {
    const btn = /** @type {HTMLButtonElement} */ (el);
    if (btn.id === 'text-style-main') return;
    if (btn.id === 'text-style-arrow') return;
    if (btn.id === 'code-btn') return;
    if (btn.id === 'link-btn') return;
    if (btn.id === 'undo-btn') return;
    if (btn.id === 'redo-btn') return;
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
      // Przy samym kursorze zaznaczenie się nie zmienia, więc selectionchange
      // nie odświeżyłby stanu przycisku
      _updateToolbarState();
    };
  });
}

function _initFormatBlockBtn() {
  const mainBtn = document.getElementById('format-block-main');
  if (!mainBtn) return;

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

  _bindDropdown({
    splitId: 'format-block-split',
    arrowId: 'format-block-arrow',
    dropdownId: 'format-block-dropdown',
    width: 200,
    onSelect: (item) => {
      undo.checkpoint();
      document.execCommand('formatBlock', false, item.dataset.format);
      editor.focus();
    },
  });
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

  // Toggle off — jesteśmy w checkliście. Bierzemy najbardziej zewnętrzną:
  // wyłączenie ma objąć całą checklistę, nie tylko podlistę z kursorem.
  let existingUl = el?.closest('ul[data-list="checklist"]') ?? null;
  for (
    let up = existingUl?.parentElement?.closest('ul[data-list="checklist"]');
    up;
    up = up.parentElement?.closest('ul[data-list="checklist"]')
  ) {
    existingUl = up;
  }
  if (existingUl) {
    // Każdy punkt — także wcięty — staje się osobnym akapitem, w kolejności.
    // Wcześniej p.innerHTML = li.innerHTML wkładało podlistę DO akapitu
    // (<p>tekst<ul>…</ul></p>), co parser HTML rozbijał przy następnym
    // wczytaniu notatki. Węzły przenosimy (nie kopiujemy), więc kursor
    // zostaje w swoim tekście.
    const saved = _saveSelection();
    const fragment = document.createDocumentFragment();
    /** @param {Element} list */
    const flatten = (list) => {
      for (const li of Array.from(list.children)) {
        if (li.tagName === 'UL' || li.tagName === 'OL') {
          flatten(li);
          continue;
        }
        const p = document.createElement('p');
        /** @type {Element[]} */
        const subs = [];
        for (const n of Array.from(li.childNodes)) {
          if (n.nodeName === 'UL' || n.nodeName === 'OL') subs.push(/** @type {Element} */ (n));
          else p.appendChild(n);
        }
        if (!(p.textContent ?? '').trim() && !p.querySelector('br')) {
          p.appendChild(document.createElement('br'));
        }
        fragment.appendChild(p);
        subs.forEach(flatten);
      }
    };
    flatten(existingUl);
    existingUl.replaceWith(fragment);
    _restoreSelection(saved);
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
  if (!mainBtn) return;

  // Lewy przycisk — plain blockquote lub toggle off
  mainBtn.onclick = () => {
    _applyCallout('');
    editor.focus();
  };

  _bindDropdown({
    splitId: 'blockquote-split',
    arrowId: 'blockquote-arrow',
    dropdownId: 'callout-dropdown',
    width: 220,
    onSelect: (item) => {
      _applyCallout(item.dataset.callout ?? '');
      editor.focus();
    },
  });
}

function _initListBtn() {
  const mainBtn = document.getElementById('list-main-btn');
  if (!mainBtn) return;

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

  _bindDropdown({
    splitId: 'list-split',
    arrowId: 'list-arrow',
    dropdownId: 'list-dropdown',
    width: 220,
    onSelect: (item) => {
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
    },
  });
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

    _syncTextStyles();

    const sel = window.getSelection();
    const node = sel?.rangeCount ? sel.getRangeAt(0).startContainer : null;
    const el = node
      ? node.nodeType === Node.TEXT_NODE
        ? node.parentElement
        : /** @type {Element} */ (node)
      : null;

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
      mainBtn.classList.toggle('is-active', fmt !== 'p');
      _markDropdownItems('format-block-dropdown', 'format', fmt);
    }
    // List main btn — śledź aktywny typ listy + aktualizuj ikonę
    const listMainBtn = document.getElementById('list-main-btn');
    if (listMainBtn) {
      // Najbliższa lista decyduje: kursor bywa w liście zagnieżdżonej w innej
      const list = el?.closest('ul, ol') ?? null;
      /** @type {string|null} */
      let listType = null;
      if (el?.closest('details')) listType = 'toggle';
      else if (list?.tagName === 'OL') listType = 'ordered';
      else if (list?.getAttribute('data-list') === 'checklist') listType = 'checklist';
      else if (list) listType = 'bullet';

      const shown = listType ?? 'bullet';
      if (listMainBtn.dataset.current !== shown) {
        listMainBtn.dataset.current = shown;
        if (!listMainBtn.matches(':hover')) {
          /** @type {Record<string, string>} */
          const LIST_ICONS = {
            bullet: 'icon--list-bullet',
            ordered: 'icon--list-number',
            checklist: 'icon--checklist',
            toggle: 'icon--toggle-list',
          };
          listMainBtn.className = `panel-icon ${LIST_ICONS[shown]} toolbar-split__main`;
        }
      }
      listMainBtn.classList.toggle('is-active', listType !== null);
      _markDropdownItems('list-dropdown', 'listType', listType);
    }

    // Blockquote / callout active state
    const bqBtn = document.getElementById('blockquote-btn');
    if (bqBtn) {
      const bq = /** @type {HTMLElement|null} */ (el?.closest('blockquote') ?? null);
      bqBtn.classList.toggle('is-active', !!bq);
      _markDropdownItems('callout-dropdown', 'callout', bq ? (bq.dataset.callout ?? '') : null);
    }

    // Link, kod i blok kodu
    const inPre = !!el?.closest('pre');
    document.getElementById('link-btn')?.classList.toggle('is-active', !!el?.closest('a'));
    document.getElementById('code-btn')?.classList.toggle('is-active', !inPre && !!el?.closest('code'));
    document.getElementById('codeblock-btn')?.classList.toggle('is-active', inPre);
  });
}

/**
 * Stan czterech stylów i przycisku, który je zastępuje przy wąskim pasku:
 * pokazuje pierwszy aktywny styl, a gdy aktywnych jest więcej, strzałka dostaje
 * kropkę. Klik przełącza to, co widać.
 */
function _syncTextStyles() {
  /** @type {{ cmd: string, icon: string, btn: HTMLElement }[]} */
  const active = [];
  /** @type {HTMLElement|null} */
  let firstBtn = null;
  for (const { cmd, icon } of TEXT_STYLES) {
    const btn = /** @type {HTMLElement|null} */ (
      document.querySelector(`#text-style-group [data-cmd="${cmd}"]`)
    );
    if (!btn) continue;
    firstBtn ??= btn;
    let isActive = false;
    try {
      isActive = document.queryCommandState(cmd);
    } catch {
      // queryCommandState rzuca w niektórych edge casach
    }
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
    if (isActive) active.push({ cmd, icon, btn });
  }

  const main = document.getElementById('text-style-main');
  if (!main || !firstBtn) return;
  const shown = active[0] ?? {
    ...TEXT_STYLES[0],
    btn: firstBtn,
  };
  TEXT_STYLES.forEach(({ icon }) => main.classList.toggle(icon, icon === shown.icon));
  main.dataset.cmd = shown.cmd;
  main.classList.toggle('is-active', active.length > 0);
  main.setAttribute('aria-pressed', String(active.length > 0));
  main.setAttribute('aria-label', shown.btn.getAttribute('aria-label') ?? '');
  main.dataset.tooltipContent = shown.btn.dataset.tooltipContent ?? '';
  document
    .getElementById('text-style-split')
    ?.classList.toggle('has-multiple', active.length > 1);
}

/**
 * Oznacza pozycję listy odpowiadającą stanowi kursora.
 * @param {string} dropdownId
 * @param {string} attr nazwa w dataset
 * @param {string|null} value aktywna wartość, null = żadna
 */
function _markDropdownItems(dropdownId, attr, value) {
  document
    .getElementById(dropdownId)
    ?.querySelectorAll('.callout-dropdown__item')
    .forEach((el) => {
      const item = /** @type {HTMLElement} */ (el);
      item.classList.toggle('is-active', value !== null && item.dataset[attr] === value);
    });
}

/* ── Inicjalizacja wszystkich komponentów toolbara ── */

export function initToolbar() {
  _initToolbar();
  _initTextStyleGroup();
  _initCodeBtn();
  _initCodeBlockBtn();
  _initToggleListBtn();
  _initChecklistBtn();
  _initCalloutBtn();
  _initListBtn();
  _initFormatBlockBtn();
  // Sync active state przy każdej zmianie zaznaczenia. keyup dla skrótów:
  // Ctrl+B przy samym kursorze nie zmienia zaznaczenia.
  document.addEventListener('selectionchange', _updateToolbarState);
  editor.addEventListener('keyup', _updateToolbarState);
}

/**
 * editor-link-modal.js — modal wstawiania i edycji linków
 *
 * Odpowiedzialność:
 *   - Stan: _editingLink, _savedRange
 *   - Ctrl+klik → otwórz link w nowej karcie
 *   - Przycisk link w toolbarze → _openLinkModal
 *   - Modal: walidacja, zapis, usunięcie, zamknięcie
 *
 * Publiczne API:
 *   initLinkCtrlClick()  — wywołaj z initEditor()
 *   initLinkButton()     — wywołaj z initEditor()
 *   initLinkModal()      — wywołaj z initEditor()
 *   openLinkModal()      — wywołaj z _initKeydown (Ctrl+K)
 */

import { t } from './i18n.js';
import * as undo from './undo.js';
import { looksLikeUrl, normalizeUrl } from './editor-url.js';
import { debouncedSave } from './notes.js';

const editor = document.getElementById('editor');

/* ── Ctrl+klik na linku → otwórz w nowej karcie ─ */

export function initLinkCtrlClick() {
  editor.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!link) return;

    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const href = link.getAttribute('href');
      if (href) window.open(href, '_blank', 'noopener,noreferrer');
    }
    // Bez Ctrl — pozwól na normalne zachowanie contenteditable (kursor w link)
  });
}

export function initLinkButton() {
  document.getElementById('link-btn').onclick = () => {
    openLinkModal();
  };
}

// Cache: który <a> aktualnie edytujemy (null = wstawiamy nowy link)
let _editingLink = null;
// Cache: zaznaczenie sprzed otwarcia modala (range traci się gdy modal dostaje fokus)
let _savedRange = null;

/**
 * Otwiera modal edycji dla konkretnego elementu <a>.
 * Wywoływane z link tooltip.
 */
export function openLinkModalForElement(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  openLinkModal();
}

export function openLinkModal() {
  const sel = window.getSelection();
  if (!sel.rangeCount) {
    // Brak kursora w edytorze — open empty modal, link wstawi się gdzieś (na końcu?)
    // Nie wspierane — bez fokusu w edytorze nie wiadomo gdzie wstawiać
    editor.focus();
    return;
  }

  const range = sel.getRangeAt(0);
  _savedRange = range.cloneRange();

  // Detekcja: czy kursor/selekcja jest w istniejącym <a>?
  const node = range.startContainer;
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  const existingLink = element.closest('a');

  const urlInput = document.getElementById('link-modal-url');
  const textInput = document.getElementById('link-modal-text');
  const removeBtn = document.getElementById('link-modal-remove');
  const errorEl = document.getElementById('link-modal-error');

  if (errorEl) errorEl.hidden = true;

  const modalTitle = document.getElementById('link-modal-title');

  if (existingLink) {
    // Edycja
    _editingLink = existingLink;
    urlInput.value = existingLink.getAttribute('href') || '';
    textInput.value = existingLink.textContent;
    removeBtn.hidden = false;
    if (modalTitle) modalTitle.textContent = t('linkModal_title_edit');
  } else {
    // Wstawianie nowego
    _editingLink = null;
    const selectedText = range.collapsed ? '' : sel.toString();
    urlInput.value = '';
    textInput.value = selectedText;
    removeBtn.hidden = true;
    if (modalTitle) modalTitle.textContent = t('linkModal_title_new');
  }

  document.getElementById('link-modal').hidden = false;

  // Focus na URL input zawsze — to najczęstszy obszar do uzupełnienia
  setTimeout(() => urlInput.focus(), 0);
}

function _closeLinkModal() {
  document.getElementById('link-modal').hidden = true;
  _editingLink = null;
  _savedRange = null;
  editor.focus();
}

export function initLinkModal() {
  const modal = document.getElementById('link-modal');
  const urlInput = document.getElementById('link-modal-url');
  const textInput = document.getElementById('link-modal-text');
  const errorEl = document.getElementById('link-modal-error');

  document.getElementById('link-modal-close').onclick = _closeLinkModal;
  document.getElementById('link-modal-cancel').onclick = _closeLinkModal;

  // Klik na backdrop (tło) zamyka modal
  modal.querySelector('.link-modal__backdrop').onclick = _closeLinkModal;

  // Esc zamyka modal (gdy modal otwarty)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) {
      e.preventDefault();
      e.stopPropagation();
      _closeLinkModal();
    }
  });

  // Enter w polach modala = save
  [urlInput, textInput].forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        _saveLinkModal();
      }
    });
  });

  document.getElementById('link-modal-save').onclick = _saveLinkModal;
  document.getElementById('link-modal-remove').onclick = _removeLinkModal;
}

function _saveLinkModal() {
  const urlInput = document.getElementById('link-modal-url');
  const textInput = document.getElementById('link-modal-text');
  const errorEl = document.getElementById('link-modal-error');

  const rawUrl = urlInput.value.trim();
  const text = textInput.value.trim();

  if (!rawUrl) {
    if (errorEl) {
      errorEl.textContent = t('linkModal_error_emptyUrl');
      errorEl.hidden = false;
    }
    return;
  }

  if (!looksLikeUrl(rawUrl)) {
    if (errorEl) {
      errorEl.textContent = t('linkModal_error_invalidUrl');
      errorEl.hidden = false;
    }
    return;
  }

  const finalUrl = normalizeUrl(rawUrl);

  undo.checkpoint();

  // Tekst = URL gdy puste pole tekstu
  const finalText = text || rawUrl;

  if (_editingLink) {
    // Edycja istniejącego linka
    _editingLink.href = finalUrl;
    _editingLink.textContent = finalText;
  } else {
    // Wstawianie nowego — przywróć zaznaczenie sprzed modala
    if (!_savedRange) {
      _closeLinkModal();
      return;
    }

    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(_savedRange);

    const a = document.createElement('a');
    a.href = finalUrl;
    a.textContent = finalText;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = t('editor_link_ctrlClickHint');

    // Jeśli była selekcja — zastąp ją linkiem
    if (!_savedRange.collapsed) {
      _savedRange.deleteContents();
    }
    _savedRange.insertNode(a);

    // Postaw kursor po linku
    const r = document.createRange();
    r.setStartAfter(a);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  debouncedSave();
  _closeLinkModal();
}

function _removeLinkModal() {
  if (!_editingLink) {
    _closeLinkModal();
    return;
  }

  undo.checkpoint();

  // Zastąp <a> tekstem
  const text = document.createTextNode(_editingLink.textContent);
  _editingLink.replaceWith(text);

  // Postaw kursor na końcu odzyskanego tekstu
  const r = document.createRange();
  r.setStart(text, text.textContent.length);
  r.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);

  debouncedSave();
  _closeLinkModal();
}

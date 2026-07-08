/**
 * editor-link-modal.js — modal wstawiania i edycji linków
 *
 * Odpowiedzialność:
 *   - Stan: _editingLink, _savedRange
 *   - Klik → otwórz link w nowej karcie (link jest jednostką atomową)
 *   - Przycisk link w toolbarze → _openLinkModal
 *   - Modal: walidacja, zapis, usunięcie, zamknięcie
 *
 * Publiczne API:
 *   initLinkClick()   — wywołaj z initEditor()
 *   initLinkButton()  — wywołaj z initEditor()
 *   initLinkModal()   — wywołaj z initEditor()
 *   openLinkModal()   — wywołaj z _initKeydown (Ctrl+K)
 */

// @ts-check
import { t } from './i18n.js';
import * as undo from './undo.js';
import { looksLikeUrl, normalizeUrl } from './editor-url.js';
import { debouncedSave } from './notes.js';

// Elementy modala/edytora są zawsze w DOM — rzutujemy z pominięciem null.
const editor = /** @type {HTMLElement} */ (document.getElementById('editor'));
/** @param {string} id @returns {HTMLElement} */
const _byId = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** @param {string} id @returns {HTMLInputElement} */
const _byInput = (id) =>
  /** @type {HTMLInputElement} */ (document.getElementById(id));

/* ── Klik na linku → otwórz w nowej karcie ────── */

export function initLinkClick() {
  editor.addEventListener('click', (e) => {
    const link = /** @type {Element|null} */ (e.target)?.closest('a');
    if (!link) return;

    // Lewy klik (także z Ctrl/Cmd) otwiera link — link jest jednostką
    // atomową, nie miejscem do stawiania kursora. Edycja: hover tooltip
    // (Edytuj) albo Ctrl+K; kursor można wprowadzić strzałkami.
    e.preventDefault();
    const href = link.getAttribute('href');
    if (href) window.open(href, '_blank', 'noopener,noreferrer');
  });
}

export function initLinkButton() {
  _byId('link-btn').onclick = () => {
    openLinkModal();
  };
}

// Cache: który <a> aktualnie edytujemy (null = wstawiamy nowy link)
/** @type {HTMLAnchorElement | null} */
let _editingLink = null;
// Cache: zaznaczenie sprzed otwarcia modala (range traci się gdy modal dostaje fokus)
/** @type {Range | null} */
let _savedRange = null;

/**
 * Otwiera modal edycji dla konkretnego elementu <a>.
 * Wywoływane z link tooltip.
 * @param {Element} el
 */
export function openLinkModalForElement(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(range);
  }
  openLinkModal();
}

export function openLinkModal() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) {
    // Brak kursora w edytorze — open empty modal, link wstawi się gdzieś (na końcu?)
    // Nie wspierane — bez fokusu w edytorze nie wiadomo gdzie wstawiać
    editor.focus();
    return;
  }

  const range = sel.getRangeAt(0);
  _savedRange = range.cloneRange();

  // Detekcja: czy kursor/selekcja jest w istniejącym <a>?
  const node = range.startContainer;
  const element =
    node.nodeType === Node.TEXT_NODE
      ? node.parentElement
      : /** @type {Element} */ (node);
  const existingLink = /** @type {HTMLAnchorElement|null} */ (
    element?.closest('a') ?? null
  );

  const urlInput = _byInput('link-modal-url');
  const textInput = _byInput('link-modal-text');
  const removeBtn = _byId('link-modal-remove');
  const errorEl = _byId('link-modal-error');

  if (errorEl) errorEl.hidden = true;

  const modalTitle = _byId('link-modal-title');

  if (existingLink) {
    // Edycja
    _editingLink = existingLink;
    urlInput.value = existingLink.getAttribute('href') || '';
    textInput.value = existingLink.textContent ?? '';
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

  _byId('link-modal').hidden = false;

  // Focus na URL input zawsze — to najczęstszy obszar do uzupełnienia
  setTimeout(() => urlInput.focus(), 0);
}

function _closeLinkModal() {
  _byId('link-modal').hidden = true;
  _editingLink = null;
  _savedRange = null;
  editor.focus();
}

export function initLinkModal() {
  const modal = _byId('link-modal');
  const urlInput = _byInput('link-modal-url');
  const textInput = _byInput('link-modal-text');

  _byId('link-modal-close').onclick = _closeLinkModal;
  _byId('link-modal-cancel').onclick = _closeLinkModal;

  // Klik na backdrop (tło) zamyka modal
  const backdrop = /** @type {HTMLElement|null} */ (
    modal.querySelector('.link-modal__backdrop')
  );
  if (backdrop) backdrop.onclick = _closeLinkModal;

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

  _byId('link-modal-save').onclick = _saveLinkModal;
  _byId('link-modal-remove').onclick = _removeLinkModal;
}

function _saveLinkModal() {
  const urlInput = _byInput('link-modal-url');
  const textInput = _byInput('link-modal-text');
  const errorEl = _byId('link-modal-error');

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
    if (!sel) {
      _closeLinkModal();
      return;
    }
    sel.removeAllRanges();
    sel.addRange(_savedRange);

    const a = document.createElement('a');
    a.href = finalUrl;
    a.textContent = finalText;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = t('editor_link_openHint');

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
  const text = document.createTextNode(_editingLink.textContent ?? '');
  _editingLink.replaceWith(text);

  // Postaw kursor na końcu odzyskanego tekstu
  const r = document.createRange();
  r.setStart(text, (text.textContent ?? '').length);
  r.collapse(true);
  const sel = window.getSelection();
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(r);
  }

  debouncedSave();
  _closeLinkModal();
}

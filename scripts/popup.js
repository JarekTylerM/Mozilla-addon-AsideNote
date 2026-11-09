// @ts-check
/* ══════════════════════════════════════════════════════════════
   popup.js — logika mikro-okna quick capture
   ══════════════════════════════════════════════════════════════ */

import { buildItemFromCapture, wantsFocusSeed } from './quick-capture-core.js';
import { scheduleAlarm, isAlarmable } from './alarms.js';
import { describeCapture } from './quick-capture-preview.js';
import { renderQuickCaptureHelp } from './quick-capture-help.js';
import {
  loadNotes,
  saveNotes,
  loadFocusId,
  saveFocusId,
  loadUiSettings,
  loadTags,
  saveTags,
} from './storage.js';
import { tagState, resolveTagNames } from './tags.js';
import { applyBuildFlavor } from './build-flavor.js';

applyBuildFlavor();

// Elementy popupu są zawsze w popup.html — rzutujemy z pominięciem null.
const input       = /** @type {HTMLInputElement} */ (document.getElementById('popup-input'));
const capture     = /** @type {HTMLElement} */ (document.getElementById('popup-capture'));
const feedback    = /** @type {HTMLElement} */ (document.getElementById('popup-feedback'));
const titleEl     = /** @type {HTMLElement} */ (document.getElementById('popup-title'));
const hint        = /** @type {HTMLElement} */ (document.getElementById('popup-hint'));
const helpBtn     = /** @type {HTMLElement} */ (document.getElementById('popup-help-btn'));
const helpPanel   = /** @type {HTMLElement} */ (document.getElementById('popup-help-panel'));
const syntaxBody  = /** @type {HTMLElement} */ (document.getElementById('popup-help-syntax'));
const escHint     = /** @type {HTMLElement} */ (document.getElementById('popup-esc-hint'));
const preview     = /** @type {HTMLElement} */ (document.getElementById('popup-preview'));
// ── i18n ────────────────────────────────────────

/** @param {string} key @param {string|string[]} [subs] */
function t(key, subs) {
  return browser.i18n.getMessage(key, subs) || key;
}

// ── Safe rich-text helper ────────────────────────
//
// Zamiast innerHTML = t(key), który przyjmuje surowy HTML z pliku locale
// (zewnętrzne źródło danych), używamy DOMParser + whitelist.
// Dozwolone tagi: kbd, code, strong, em, br, span — wystarczające do
// formatowania podpowiedzi. Wszystko inne sprowadzane do textContent.
// Atrybuty: żadne (popup nie potrzebuje href ani class z tłumaczeń).
//
// Wektor: plik _locales/*/messages.json jest bundlowany w XPI, ale po
// instalacji leży na dysku profilu użytkownika i jest odczytywalny.
// Podmianka pliku locale przez złośliwe oprogramowanie + innerHTML
// = potencjalny XSS. _setRichText eliminuje tę powierzchnię ataku.

const HINT_ALLOWED_TAGS = new Set(['KBD', 'CODE', 'STRONG', 'EM', 'BR', 'SPAN', 'DIV', 'LI', 'UL', 'P']);

/** @param {HTMLElement} el @param {string} html */
function _setRichText(el, html) {
  if (!html || typeof html !== 'string') { el.textContent = ''; return; }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  el.textContent = '';
  _copyNodes(doc.body, el);
}

/** @param {Node} src @param {Node} dst */
function _copyNodes(src, dst) {
  for (const child of src.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      dst.appendChild(document.createTextNode(child.textContent ?? ''));
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const childEl = /** @type {Element} */ (child);
      if (HINT_ALLOWED_TAGS.has(childEl.tagName)) {
        const clone = document.createElement(childEl.tagName.toLowerCase());
        // Brak kopiowania atrybutów — popup nie potrzebuje href/class z locale
        _copyNodes(childEl, clone);
        dst.appendChild(clone);
      } else {
        // Niedozwolony tag — zachowaj tylko tekst
        dst.appendChild(document.createTextNode(childEl.textContent ?? ''));
      }
    }
  }
}

// ── Color scheme — zastosuj przed renderem ───────
// Odczyt synchroniczny nie istnieje w WebExtensions —
// stosujemy data-theme zanim DOM zostanie wyrenderowany
// przez ukrycie body do czasu załadowania schematu.

loadUiSettings().then((settings) => {
  const scheme = settings.colorScheme ?? 'auto';
  if (scheme === 'auto') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.dataset.theme = scheme;
  }
  // Krój pisma — ten sam wybór co w panelu bocznym. Popup dzieli tokens.css,
  // więc wystarczy atrybut; bez tego przełącznik działałby tylko w połowie UI.
  if (settings.fontFamily === 'lexend') {
    document.documentElement.dataset.font = 'lexend';
  }
}).catch(() => {
  // Brak danych — zostaje auto (system preference)
});

// ── Autofocus fallback ──────────────────────────
//
// Firefox nie zawsze przekazuje fokus dokumentowi popupu otwartemu
// skrótem klawiszowym (_execute_browser_action) — atrybut autofocus
// wtedy przepada (Bugzilla #1324255) i kursor nie trafia do inputa.
// Ponawiamy focus() aż input faktycznie go dostanie (maks. ~1 s).
//
// Mechanizm jest JEDNORAZOWY i rozbraja się po pierwszym udanym
// fokusie (lub po deadline). Trwały nasłuch fokusa okna kradł fokus
// z powrotem w trakcie window.close() po Shift+Enter i popup nie
// zamykał się po dodaniu wpisu — dlatego nic nie może zostać
// uzbrojone dłużej niż to konieczne.

(function _ensureInputFocus() {
  const deadline = Date.now() + 1000;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;

  const tryFocus = () => {
    const active = document.activeElement;
    const userMovedFocus =
      active && active !== input &&
      active !== document.body && active !== document.documentElement;
    if (userMovedFocus) return true; // użytkownik przejął fokus — nie walcz
    input.focus();
    return document.hasFocus() && document.activeElement === input;
  };

  const disarm = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    window.removeEventListener('focus', onWindowFocus);
  };

  const tick = () => {
    timer = null;
    if (tryFocus() || Date.now() >= deadline) { disarm(); return; }
    timer = setTimeout(tick, 50);
  };

  const onWindowFocus = () => {
    // { once: true } — pierwszy fokus okna to moment otwarcia popupu;
    // późniejsze zdarzenia fokusa nie mogą już niczego przechwycić.
    if (tryFocus()) disarm();
  };

  window.addEventListener('focus', onWindowFocus, { once: true });
  tick();
})();

// ── Init ────────────────────────────────────────

titleEl.textContent = t('popup_title');
input.placeholder = t('popup_placeholder');
_setRichText(hint, t('popup_hint_main'));
helpBtn.title = t('popup_help_title');
_setRichText(escHint, t('popup_esc_hint'));
// Składnia idzie z quick-capture-help.js, nie z HTML-a w locale — panel
// pomocy nie jest już powierzchnią, przez którą podmieniony messages.json
// mógłby coś wstrzyknąć. Enter/Shift+Enter zostają w popup_hint_main:
// w popupie Shift+Enter otwiera panel boczny, w sidebarze edytor.
renderQuickCaptureHelp(syntaxBody, t);

input.addEventListener('input', () => {
  _updateTypeIndicator();
  _updatePreview();
});
_updateTypeIndicator();
_updatePreview();

// Tagi do podglądu: bez nich każdy #tag wyglądałby na nowy. Przy zapisie i tak
// czytamy je od nowa, bo panel boczny mógł je w tym czasie zmienić.
loadTags()
  .then((tags) => {
    tagState.tags = tags;
    _updatePreview();
  })
  .catch(() => {});

// ── Help panel toggle ──────────────────────────

helpBtn.addEventListener('click', () => {
  const wasOpen = helpBtn.getAttribute('aria-expanded') === 'true';
  helpBtn.setAttribute('aria-expanded', String(!wasOpen));
  helpPanel.hidden = wasOpen;
});

// ── Preview ─────────────────────────────────────

function _updatePreview() {
  if (!preview) return;

  const description = describeCapture(input.value, {
    t,
    locale: browser.i18n.getUILanguage(),
    tags: tagState.tags,
  });

  if (!description) {
    _hidePreview();
    return;
  }

  preview.textContent = description.text;
  preview.hidden = false;
  preview.dataset.type = description.type;
}

// Tekst czyszczony razem z ukryciem — kontener jest aria-live i sam
// atrybut hidden nie chroni przed odczytaniem nieaktualnej treści.
function _hidePreview() {
  if (!preview) return;
  preview.hidden = true;
  preview.textContent = '';
}

// ── Type indicator (ikona w inpucie) ───────────

function _updateTypeIndicator() {
  const isTask = input.value.startsWith('!');
  capture.classList.toggle('popup-capture--task', isTask);
}

// ── Keyboard handler ────────────────────────────

input.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape') {
    window.close();
    return;
  }

  if (e.key !== 'Enter') return;
  e.preventDefault();
  _hidePreview();

  const raw = input.value.trim();
  if (!raw) return;

  const item = /** @type {Note | null} */ (buildItemFromCapture(raw));
  if (!item) return;

  // Flaga focus z parsera to jednorazowy seed — źródłem prawdy stanu
  // "w trakcie" jest tablica focusId w storage, nie pole na notatce.
  const wantsFocus = wantsFocusSeed(item);
  delete item.focus;

  // sidebarAction.open() musi zostać wywołane synchronicznie w handlerze
  // zdarzenia — po pierwszym await Firefox odrzuca je z "may only be
  // called from a user input handler". Promise domykamy przed
  // window.close(), żeby zamknięcie popupu nie ubiło wywołania w locie.
  const sidebarOpening = e.shiftKey
    ? browser.sidebarAction.open().catch(() => {})
    : null;

  try {
    // Persystencja WYŁĄCZNIE przez storage.js — ten sam chokepoint co sidebar.
    // Bezpośredni browser.storage.local.set omijał _set(): brak kolejki
    // ponowień, znaczników self-write i sygnalizacji błędu zapisu. loadNotes()
    // dokłada normalizację/migrację, więc popup nie zapisuje z powrotem
    // niezmigrowanych ani zatrutych danych. saveNotes() rzuca przy błędzie →
    // catch niżej pokazuje komunikat i NIE zamyka popupu (tekst zostaje w polu).

    // Tagi przed notatką, żeby wpis nigdy nie wskazywał na tag, którego nie ma.
    // createTag zapisuje bez czekania, a window.close() mógłby ten zapis urwać,
    // dlatego czekamy na własny saveTags.
    const tagNames = /** @type {any} */ (item).tagNames;
    delete (/** @type {any} */ (item).tagNames);
    if (tagNames.length) {
      tagState.tags = await loadTags();
      item.tags = resolveTagNames(tagNames);
      await saveTags(tagState.tags);
    }

    const notes = await loadNotes();
    notes.unshift(item);
    await saveNotes(notes);

    if (wantsFocus) {
      const focusIds = await loadFocusId();
      if (!focusIds.includes(item.id)) {
        focusIds.push(item.id);
        await saveFocusId(focusIds);
      }
    }

    if (isAlarmable(item)) {
      scheduleAlarm(item);
    }

    // Sidebar odświeża się sam przez storage.onChanged (zapisy powyżej
    // pochodzą z innego kontekstu niż sidebar) — osobny komunikat zbędny.

    // Enter: dodaj i zamknij popup. Shift+Enter: dodatkowo otwórz
    // sidebar (już otwierany powyżej) z zaznaczonym wpisem.
    // await na sendMessage — komunikat musi dotrzeć do background
    // zanim window.close() zniszczy kontekst popupu.
    if (sidebarOpening) {
      await browser.runtime
        .sendMessage({ action: 'openAndSelect', noteId: item.id })
        .catch(() => {});
      await sidebarOpening;
    }
    window.close();
  } catch (err) {
    _showFeedback(t('popup_error'), 'error');
  }
});

// ── Feedback ────────────────────────────────────

/** @param {string} text @param {string} variant */
function _showFeedback(text, variant) {
  feedback.textContent = text;
  feedback.className = 'popup-feedback popup-feedback--visible popup-feedback--' + variant;
  setTimeout(() => {
    feedback.className = 'popup-feedback popup-feedback--' + variant;
  }, 1500);
}
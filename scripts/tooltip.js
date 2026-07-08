// @ts-check
/* ══════════════════════════════════════════════════════════════
   tooltip.js — globalny manager custom tooltipów
   ──────────────────────────────────────────────────────────────
   Zastępuje natywne title-tooltips własnym elementem #app-tooltip.

   Architektura:
   - Event delegation z capture phase — jeden listener na document
     zamiast per-element, obsługuje elementy dynamiczne (lista notatek,
     przyciski zmieniające title w czasie).
   - Odczyt title w momencie hover — dynamiczne elementy (focus-btn,
     important-btn, convert-type) zmieniają .title w runtime; zawsze
     pokazujemy aktualny tekst.
   - Statyczne elementy (toolbar) mają title ustawione przez i18n;
     po initTooltips() title jest usuwany z DOM żeby przeglądarka nie
     pokazała natywnego tooltipa, ale backup w data-tooltip-content
     pozwala odczytać go ponownie.
   - Format "Label · Skrót" jest dzielony na dwie części:
     label (normalny) + hint (monospace, przygaszony).
   - Pozycjonowanie smart: pokazuje tooltip pod lub nad elementem
     zależnie od dostępnego miejsca. Strzałka kierowana odpowiednio.
   - Wyłączenie przez document.documentElement.dataset.tooltipsOff = "1"
     (panel personalizacji toggle).
   ══════════════════════════════════════════════════════════════ */

// Elementy które dostają tooltip — tylko interaktywne z title lub data-tooltip-content
const TOOLTIP_SELECTOR = 'button[title], a[title], select[title], input[title], [data-tooltip-content]';

const SHOW_DELAY = 380; // ms — eliminuje flash przy szybkim przejeździe
const HIDE_DELAY = 80;

/** @type {HTMLElement | null} */
let _el        = null; // #app-tooltip element
/** @type {HTMLElement | null} */
let _labelEl   = null;
/** @type {HTMLElement | null} */
let _hintEl    = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let _showTimer = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let _hideTimer = null;
/** @type {HTMLElement | null} */
let _anchor    = null; // aktualnie hoverowany element

/* ── Init ──────────────────────────────────────── */

/**
 * Inicjalizuje globalny tooltip manager.
 * Wywołać po applyStaticTranslations() — żeby statyczne title były już ustawione.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.enabled=true]
 */
export function initTooltips({ enabled = true } = {}) {
  _el = document.getElementById('app-tooltip');
  if (!_el) {
    console.warn('[tooltip] Brak elementu #app-tooltip w DOM');
    return;
  }
  _labelEl = /** @type {HTMLElement|null} */ (_el.querySelector('.app-tooltip__label'));
  _hintEl  = /** @type {HTMLElement|null} */ (_el.querySelector('.app-tooltip__hint'));

  // Statyczne elementy (data-i18n-attr z title:klucz) — przenieś title →
  // data-tooltip-content i WYCZYŚĆ title (pusty string, nie remove).
  // removeAttribute triggerowałby observer, który przy title=null kasuje
  // data-tooltip-content. Pusty title="" blokuje natywny tooltip przeglądarki
  // i nie wchodzi w gałąź else-if obserwatora (która czeka na null, nie "").
  document.querySelectorAll('[data-i18n-attr*="title:"]').forEach(el => {
    const he = /** @type {HTMLElement} */ (el);
    const t = he.getAttribute('title');
    if (t) {
      he.dataset.tooltipContent = t;
      he.setAttribute('title', ''); // "" blokuje natywny tooltip
    }
  });

  // MutationObserver — dwa tryby jednocześnie:
  //
  // 1. attributes (title) — przechwytuje .title = "..." na elementach
  //    które są już w DOM (np. notes.js: focusBtn, importantBtn, convertBtn).
  //
  // 2. childList — przechwytuje elementy dodawane do DOM z title już ustawionym
  //    (np. panel.js: addBtn.title i pill.title są ustawiane PRZED appendChild,
  //    więc atrybutowy observer ich nie widzi — dopiero insert do DOM je odkrywa).
  //
  // Pętla self-triggering wyeliminowana: ustawiamy title="" zamiast removeAttribute,
  // więc kolejny callback widzi title==="" → żadna gałąź nie odpala.

  /** @param {Element} root */
  function _stripTitles(root) {
    // Przetwarza element i całe jego potomstwo — używane przy insert do DOM
    /** @type {Element[]} */
    const candidates = root.hasAttribute?.('title') ? [root] : [];
    root.querySelectorAll?.('[title]').forEach(el => candidates.push(el));
    candidates.forEach(el => {
      const he = /** @type {HTMLElement} */ (el);
      const t = he.getAttribute('title');
      if (t) {
        he.dataset.tooltipContent = t;
        he.setAttribute('title', ''); // "" = brak natywnego tooltipa, nie triggeruje else-if
      }
    });
  }

  const _titleObserver = new MutationObserver(mutations => {
    for (const m of mutations) {
      if (m.type === 'childList') {
        // Nowe węzły w DOM — sprawdź czy mają title ustawiony przed insertem
        for (const node of m.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE)
            _stripTitles(/** @type {Element} */ (node));
        }
      } else {
        // m.type === 'attributes' — title zmieniony na istniejącym elemencie
        const el = /** @type {HTMLElement} */ (m.target);
        const title = el.getAttribute('title');
        if (title) {
          el.dataset.tooltipContent = title;
          el.setAttribute('title', '');
        } else if (title === null && m.oldValue) {
          // title jawnie usunięty przez zewnętrzny kod → wyczyść backup
          delete el.dataset.tooltipContent;
        }
        // title === '' → nasze własne wyczyszczenie, ignoruj
      }
    }
  });

  _titleObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ['title'],
    attributeOldValue: true,
    childList: true,   // potrzebne dla elementów tworzonych z title przed insertem
    subtree: true,
  });

  // Event delegation — capture phase żeby złapać przed stopPropagation
  document.addEventListener('mouseenter', _onEnter, true);
  document.addEventListener('mouseleave', _onLeave, true);
  document.addEventListener('focus',      _onFocus, true);
  document.addEventListener('blur',       _onBlur,  true);
  document.addEventListener('click',      _onHide,  true);
  document.addEventListener('keydown',    _onHide,  false);

  setTooltipsEnabled(enabled);
}

/**
 * Włącza/wyłącza tooltips globalnie.
 * @param {boolean} enabled
 */
export function setTooltipsEnabled(enabled) {
  document.documentElement.dataset.tooltipsOff = enabled ? '' : '1';
}

/* ── Event handlers ────────────────────────────── */

/** @param {Event} e */
function _onEnter(e) {
  const src = /** @type {Element|null} */ (e.target);
  if (!src?.closest) return; // focus/mouseenter może odpalić na document/window
  const target = /** @type {HTMLElement|null} */ (src.closest(TOOLTIP_SELECTOR));
  if (!target || target === _anchor) return;

  _anchor = target;
  _cancelHide();

  _showTimer = setTimeout(() => {
    const text = _getText(target);
    if (text) _show(target, text);
  }, SHOW_DELAY);
}

/** @param {MouseEvent} e */
function _onLeave(e) {
  // Sprawdź czy mysz nie przechodzi na sam tooltip
  const to = e.relatedTarget;
  if (to && _el?.contains(/** @type {Node} */ (to))) return;

  _cancelShow();
  _anchor = null;
  _hideTimer = setTimeout(_hide, HIDE_DELAY);
}

/** @param {Event} e */
function _onFocus(e) {
  const src = /** @type {Element|null} */ (e.target);
  if (!src?.closest) return; // focus może odpalić na document/window/text node
  const target = /** @type {HTMLElement|null} */ (src.closest(TOOLTIP_SELECTOR));
  if (!target) return;
  _anchor = target;
  _cancelHide();
  // Fokus klawiaturowy — pokaż od razu, bez delay
  const text = _getText(target);
  if (text) _show(target, text);
}

function _onBlur() {
  _cancelShow();
  _anchor = null;
  _hideTimer = setTimeout(_hide, HIDE_DELAY);
}

function _onHide() {
  _cancelShow();
  _hide();
  _anchor = null;
}

/* ── Logika show/hide ──────────────────────────── */

/** @param {HTMLElement} el @returns {string|null} */
function _getText(el) {
  if (document.documentElement.dataset.tooltipsOff === '1') return null;
  if (/** @type {HTMLButtonElement} */ (el).disabled) return null;
  return el.dataset.tooltipContent || el.getAttribute('title') || null;
}

/** @param {Element} anchor @param {string} text */
function _show(anchor, text) {
  if (!_el || !_labelEl || !_hintEl) return;

  // Podziel "Label · Skrót" na dwie części
  const sep = ' · ';
  const idx  = text.indexOf(sep);
  if (idx !== -1) {
    _labelEl.textContent = text.slice(0, idx);
    _hintEl.textContent  = text.slice(idx + sep.length);
    _hintEl.hidden       = false;
  } else {
    _labelEl.textContent = text;
    _hintEl.hidden       = true;
  }

  // Wstępne pozycjonowanie (bez wymiarów — nie są znane przed reveal)
  _el.classList.remove('visible', 'arrow-down');
  _el.style.left = '-9999px';
  _el.style.top  = '-9999px';
  _el.setAttribute('aria-hidden', 'false');

  // Reveal po microtasku — teraz znamy offsetWidth/offsetHeight
  requestAnimationFrame(() => {
    if (!_el) return;
    _position(anchor);
    _el.classList.add('visible');
  });
}

function _hide() {
  if (!_el) return;
  _el.classList.remove('visible');
  _el.setAttribute('aria-hidden', 'true');
}

function _cancelShow() {
  clearTimeout(_showTimer ?? undefined);
  _showTimer = null;
}

function _cancelHide() {
  clearTimeout(_hideTimer ?? undefined);
  _hideTimer = null;
}

/* ── Pozycjonowanie ────────────────────────────── */

/** @param {Element} anchor */
function _position(anchor) {
  if (!_el) return;
  const rect = anchor.getBoundingClientRect();
  const tw   = _el.offsetWidth;
  const th   = _el.offsetHeight;
  const gap  = 7;

  // Smart: pokaż poniżej jeśli jest miejsce, w przeciwnym razie powyżej
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;
  const showBelow  = spaceBelow >= th + gap + 4 || spaceBelow >= spaceAbove;

  let top;
  if (showBelow) {
    top = rect.bottom + gap;
    _el.classList.remove('arrow-down');   // strzałka w górę (tooltip poniżej)
  } else {
    top = rect.top - th - gap;
    _el.classList.add('arrow-down');      // strzałka w dół (tooltip powyżej)
  }

  // Środek poziomy anchora z clampem żeby nie wychodzić za panel
  const mid    = rect.left + rect.width / 2;
  const left   = Math.max(tw / 2 + 4, Math.min(mid, window.innerWidth - tw / 2 - 4));

  _el.style.left = `${left}px`;
  _el.style.top  = `${top}px`;

  // Przesuń strzałkę jeśli tooltip był clampowany
  const offset = mid - left;
  _el.style.setProperty('--arrow-offset', `${50 + (offset / (tw / 2)) * 50}%`);
}
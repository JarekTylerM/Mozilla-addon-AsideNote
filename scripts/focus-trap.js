// @ts-check
/* ══════════════════════════════════════════════════════════════
   focus-trap.js — pułapka fokusu dla modali (role="dialog")
   ──────────────────────────────────────────────────────────────
   Tab / Shift+Tab cyklują TYLKO wśród elementów fokusowalnych
   wewnątrz kontenera — fokus nie ucieka do treści pod modalem.
   Na zwolnieniu przywraca fokus tam, gdzie był przed otwarciem.

   UWAGA a11y: pułapka BEZ wyjścia klawiaturą to keyboard trap
   (WCAG 2.1.2). Każdy modal używający tego modułu MUSI mieć Escape
   (albo inny sposób zamknięcia z klawiatury) — trap tego nie dodaje.

   Model ukrywania w tym projekcie to atrybut `hidden` (nie CSS
   display), więc getFocusable filtruje po `hidden`, nie po layoucie —
   dzięki temu działa tak samo w przeglądarce i w jsdom (bez layoutu).
   ══════════════════════════════════════════════════════════════ */

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "textarea",
  "select",
  "[tabindex]",
].join(",");

/**
 * Czy element jest widoczny w obrębie kontenera (żaden przodek do
 * kontenera włącznie nie ma atrybutu `hidden`).
 * @param {Element} el
 * @param {Element} container
 */
function _isVisibleWithin(el, container) {
  /** @type {Element | null} */
  let cur = el;
  while (cur && cur !== container) {
    if (/** @type {HTMLElement} */ (cur).hidden) return false;
    cur = cur.parentElement;
  }
  return true;
}

/**
 * Fokusowalne elementy kontenera w kolejności DOM (pomija disabled,
 * hidden, tabindex="-1" oraz input[type=hidden]).
 * @param {HTMLElement} container
 * @returns {HTMLElement[]}
 */
export function getFocusable(container) {
  const nodes = /** @type {HTMLElement[]} */ ([
    ...container.querySelectorAll(FOCUSABLE_SELECTOR),
  ]);
  return nodes.filter((el) => {
    if (/** @type {HTMLButtonElement} */ (el).disabled) return false;
    if (el.getAttribute("tabindex") === "-1") return false;
    if (/** @type {HTMLInputElement} */ (el).type === "hidden") return false;
    return _isVisibleWithin(el, container);
  });
}

/**
 * Tworzy pułapkę fokusu dla kontenera modala.
 * @param {HTMLElement} container - element role="dialog" (lub jego korzeń)
 */
export function createFocusTrap(container) {
  /** @type {Element | null} */
  let _prev = null;
  let _listening = false;

  /** @param {KeyboardEvent} e */
  const _onKey = (e) => {
    if (e.key !== "Tab") return;
    const f = getFocusable(container);
    if (f.length === 0) {
      // Brak celu — nie pozwól Tabowi wyjść z modala
      e.preventDefault();
      return;
    }
    const first = f[0];
    const last = f[f.length - 1];
    const active = /** @type {Element | null} */ (document.activeElement);
    if (e.shiftKey) {
      if (active === first || !container.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (active === last || !container.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return {
    /**
     * Włącza pułapkę. Domyślnie zapamiętuje bieżący fokus, by przywrócić
     * go przy release(). Nie zmienia fokusu, o ile nie podano initialFocus —
     * caller, który sam ustawia fokus początkowy, przekazuje go tutaj lub
     * pomija (i fokusuje samodzielnie).
     * @param {{ initialFocus?: HTMLElement|null, restoreFocus?: boolean }} [opts]
     */
    activate({ initialFocus = null, restoreFocus = true } = {}) {
      if (_listening) return;
      _prev = restoreFocus ? document.activeElement : null;
      // Nasłuch na document (nie na kontenerze): łapie Tab także gdy fokus
      // zdołał uciec poza modal — wtedy _onKey ściąga go z powrotem. Listener
      // żyje tylko między activate a release, więc jeden modal naraz.
      document.addEventListener("keydown", _onKey);
      _listening = true;
      if (initialFocus) initialFocus.focus();
    },

    /** Wyłącza pułapkę i (jeśli restoreFocus) przywraca poprzedni fokus. */
    release() {
      if (!_listening) return;
      document.removeEventListener("keydown", _onKey);
      _listening = false;
      const prev = /** @type {HTMLElement | null} */ (_prev);
      if (prev && typeof prev.focus === "function") prev.focus();
      _prev = null;
    },
  };
}

// @ts-check
/* ══════════════════════════════════════════════════════════════
   note-menu.js — menu trzech kropek w nagłówku notatki
   ──────────────────────────────────────────────────────────────
   Dwie rzeczy, obie bez zależności od `browser` (testowalne w jsdom):
   - noteHeaderState: co nagłówek ma pokazać dla danego stanu notatki,
   - initNoteMenu: otwieranie, pozycjonowanie, klawiatura, zamykanie.

   Czego tu NIE ma: samych akcji pozycji menu (ważne, w trakcie, typ,
   kopiowanie, kosz). Podpinają je app.js i editor.js po id przycisków —
   ten moduł odpowiada wyłącznie za zachowanie menu.
   ══════════════════════════════════════════════════════════════ */

/**
 * Działania, które użytkownik może wyjąć z menu ⋮ i przypiąć do nagłówka
 * (Ustawienia → Menu trzech kropek). Kolejność to też kolejność ikon.
 */
export const NOTE_ACTIONS = /** @type {const} */ ([
  'important',
  'focus',
  'convert',
  'copy',
  'delete',
]);

/**
 * Wartość z uiSettings → poprawna lista przypiętych działań. Ustawienia mogły
 * zapisać starsza wersja albo ręczna edycja, więc nieznane nazwy i duplikaty
 * nie mogą dojść do renderu.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export function normalizePinnedActions(value) {
  if (!Array.isArray(value)) return [];
  return NOTE_ACTIONS.filter((action) => value.includes(action));
}

/**
 * @typedef {object} HeaderStateInput
 * @property {{ type?: string, completed?: boolean, important?: boolean }|null} note
 * @property {string|null} activeId
 * @property {string|null} [pendingType] typ elementu, który dopiero powstanie
 * @property {string[]} focusIds
 * @property {string[]} [pinnedActions] działania przypięte do nagłówka
 */

/**
 * Stan nagłówka notatki — jedna definicja dla checkboxa, symboli przy
 * tytule, ikon i pozycji menu, żeby nie mogły sobie przeczyć.
 *
 * Elementu jeszcze nie ma w storage (activeId === null), gdy użytkownik
 * dopiero zaczyna pisać: da się wtedy tylko wybrać typ. Checkbox zadania
 * jest widoczny, ale nieaktywny, bo nie ma czego ukończyć.
 *
 * Symbol przy tytule znika, gdy to samo działanie jest przypięte: ikona sama
 * pokazuje wtedy stan, a dwa złote symbole obok siebie mówiłyby to samo.
 *
 * @param {HeaderStateInput} input
 */
export function noteHeaderState({
  note,
  activeId,
  pendingType,
  focusIds,
  pinnedActions = [],
}) {
  const type = activeId ? (note?.type ?? 'note') : (pendingType ?? 'note');
  const isTask = type === 'task';
  const hasNote = !!note;
  const completed = isTask && !!note?.completed;
  const canFocus = !!activeId && !completed;
  const important = !!note?.important;
  const inFocus = canFocus && focusIds.includes(activeId ?? '');

  const available = {
    important: !!activeId,
    focus: canFocus,
    convert: true,
    copy: true,
    delete: hasNote,
  };
  const isPinned = (/** @type {string} */ action) => pinnedActions.includes(action);
  const inMenu = NOTE_ACTIONS.filter((a) => available[a] && !isPinned(a));

  return {
    type,
    isTask,
    hasNote,
    completed,
    canComplete: isTask && hasNote,
    important,
    inFocus,
    available,
    isPinned,
    showImportantSymbol: important && !isPinned('important'),
    showFocusSymbol: inFocus && !isPinned('focus'),
    menuEmpty: inMenu.length === 0,
    // Kreska oddziela kosz od reszty, więc sama w menu nie ma czego oddzielać
    showMenuSeparator: inMenu.includes('delete') && inMenu.length > 1,
  };
}

/**
 * Margines menu od krawędzi okna. Sidebar bywa wąski, więc menu musi się
 * zmieścić także wtedy, gdy przycisk stoi przy samej krawędzi.
 */
const VIEWPORT_MARGIN = 4;

/**
 * Podpina zachowanie menu pod przycisk.
 *
 * Fokus trafia do pierwszej dostępnej pozycji, a Escape i wybór pozycji
 * oddają go przyciskowi. Handler Escape zatrzymuje propagację: globalny
 * skrót w app.js zamknąłby inaczej cały ekran notatki zamiast samego menu.
 *
 * @param {HTMLElement} trigger
 * @param {HTMLElement} menu
 * @returns {{ open: (focusLast?: boolean) => void, close: (restoreFocus?: boolean) => void, isOpen: () => boolean }}
 */
export function initNoteMenu(trigger, menu) {
  const isOpen = () => menu.classList.contains('is-open');

  const items = () =>
    /** @type {HTMLButtonElement[]} */ (
      [...menu.querySelectorAll('[role^="menuitem"]')]
    ).filter(
      (el) => !el.hidden && !el.disabled && !el.classList.contains('is-pinned'),
    );

  function position() {
    const anchor = trigger.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = menu;
    const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
    const left = Math.max(VIEWPORT_MARGIN, Math.min(anchor.right - width, maxLeft));
    const below = anchor.bottom + VIEWPORT_MARGIN;
    const fitsBelow = below + height <= window.innerHeight - VIEWPORT_MARGIN;
    const top = fitsBelow
      ? below
      : Math.max(VIEWPORT_MARGIN, anchor.top - height - VIEWPORT_MARGIN);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function open(focusLast = false) {
    menu.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    position();
    const list = items();
    list[focusLast ? list.length - 1 : 0]?.focus();
  }

  function close(restoreFocus = false) {
    if (!isOpen()) return;
    menu.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
  }

  trigger.addEventListener('click', () => {
    if (isOpen()) close(true);
    else open();
  });

  trigger.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    if (!isOpen()) open(e.key === 'ArrowUp');
  });

  menu.addEventListener('keydown', (e) => {
    const list = items();
    const idx = list.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement));
    /** @type {HTMLElement|undefined} */
    let next;

    switch (e.key) {
      case 'ArrowDown':
        next = list[(idx + 1) % list.length];
        break;
      case 'ArrowUp':
        next = list[(idx - 1 + list.length) % list.length];
        break;
      case 'Home':
        next = list[0];
        break;
      case 'End':
        next = list[list.length - 1];
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        close(true);
        return;
      case 'Tab':
        // Bez preventDefault: fokus wraca na przycisk, a domyślne działanie
        // Tab przenosi go na następny element za menu.
        close(true);
        return;
      default:
        return;
    }

    e.preventDefault();
    next?.focus();
  });

  // Listenery pozycji (onclick z app.js) odpalają się przed tym, bo stoją
  // bliżej celu. Po kosza nagłówek bywa już schowany — focus() jest wtedy
  // bezczynny i nie zabiera fokusu z listy.
  menu.addEventListener('click', (e) => {
    const target = /** @type {Element|null} */ (e.target);
    if (target?.closest('[role^="menuitem"]')) close(true);
  });

  // Fokus wyszedł poza menu, np. przez Alt+C. Bez tego menu zostałoby
  // otwarte za schowanym ekranem notatki i wróciło przy następnej notatce.
  menu.addEventListener('focusout', (e) => {
    const to = /** @type {Node|null} */ (e.relatedTarget);
    if (to && !menu.contains(to) && !trigger.contains(to)) close();
  });

  document.addEventListener(
    'mousedown',
    (e) => {
      const target = /** @type {Node|null} */ (e.target);
      if (!target || menu.contains(target) || trigger.contains(target)) return;
      close();
    },
    true,
  );

  window.addEventListener('resize', () => close());

  return { open, close, isOpen };
}

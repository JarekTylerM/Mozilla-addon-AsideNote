// @ts-check
/* ══════════════════════════════════════════════════════════════
   list-focus.js — gdzie ma stanąć fokus po przebudowie listy
   ──────────────────────────────────────────────────────────────
   Czysta logika bez DOM i `browser` (testowalna w Node). renderList()
   buduje listę od zera, więc element z fokusem przestaje istnieć i fokus
   spada na <body> — przy pracy z klawiatury trzeba było po każdej akcji
   (odhaczenie Spacją, przełożenie, zwinięcie sekcji) wracać na listę
   skrótem Alt+L. notes.js zapamiętuje fokus przed renderem i pyta ten
   moduł, który wiersz ma go dostać po nim.
   ══════════════════════════════════════════════════════════════ */

/**
 * Wiersz, który ma dostać fokus po przebudowie listy.
 *
 * - Wiersz nadal jest na liście → zostaje przy nim (fokus "idzie za wpisem"),
 *   chyba że `moveOff`: akcja przeniosła wpis gdzie indziej (odhaczenie,
 *   przełożenie na jutro), a użytkownik pracuje w tym samym miejscu listy.
 *   Bez tego druga Spacja trafiałaby w to samo zadanie, już w "Zakończonych",
 *   i cofała odhaczenie.
 * - Wiersza nie ma (usunięty, zwinięta sekcja, odfiltrowany) albo `moveOff` →
 *   najbliższy następny z dawnej kolejności, który nadal istnieje; gdy za nim
 *   nic nie zostało, najbliższy poprzedni.
 *
 * @param {string[]} beforeIds identyfikatory wierszy przed przebudową, w kolejności listy
 * @param {string|null|undefined} focusedId wiersz, który miał fokus
 * @param {string[]} afterIds identyfikatory wierszy po przebudowie
 * @param {{ moveOff?: boolean }} [opts]
 * @returns {string|null} identyfikator wiersza albo null, gdy nie ma dokąd pójść
 */
export function nextFocusId(beforeIds, focusedId, afterIds, { moveOff = false } = {}) {
  if (!focusedId) return null;
  const after = new Set(afterIds);
  if (!moveOff && after.has(focusedId)) return focusedId;

  const idx = beforeIds.indexOf(focusedId);
  if (idx === -1) return null;

  for (let i = idx + 1; i < beforeIds.length; i++) {
    if (beforeIds[i] !== focusedId && after.has(beforeIds[i])) return beforeIds[i];
  }
  for (let i = idx - 1; i >= 0; i--) {
    if (beforeIds[i] !== focusedId && after.has(beforeIds[i])) return beforeIds[i];
  }
  return null;
}

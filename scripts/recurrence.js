// @ts-check
/* ══════════════════════════════════════════════════════════════
   recurrence.js — następna instancja zadania cyklicznego
   ──────────────────────────────────────────────────────────────
   Czysta logika bez DOM i `browser` (testowalna w Node). Używa jej
   notes.js::toggleCompleted przy odhaczeniu zadania cyklicznego.
   ══════════════════════════════════════════════════════════════ */

/** Bezpiecznik pętli — więcej kroków niż dni w ~11 latach przy "daily" */
const MAX_STEPS = 4000;

/**
 * Przesuwa datę o jeden okres cyklu. Miesiąc i rok przycinane do ostatniego
 * dnia miesiąca: 31.01 + miesiąc = 28/29.02, nie 3.03 (przepełnienie Date).
 * @param {Date} d — modyfikowana w miejscu
 * @param {string} recurrence
 * @param {number[]} days — dni tygodnia dla "custom"
 * @param {number} anchorDay — dzień miesiąca z pierwotnego terminu
 */
function _step(d, recurrence, days, anchorDay) {
  switch (recurrence) {
    case 'daily':
      d.setDate(d.getDate() + 1);
      break;
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'monthly':
    case 'yearly': {
      const months = recurrence === 'monthly' ? 1 : 12;
      const y = d.getFullYear();
      const m = d.getMonth() + months;
      const lastDay = new Date(y, m + 1, 0).getDate();
      d.setFullYear(y, m, Math.min(anchorDay, lastDay));
      break;
    }
    case 'custom':
      // Najbliższy dzień z listy, zaczynając od jutra
      for (let i = 1; i <= 7; i++) {
        d.setDate(d.getDate() + 1);
        if (days.includes(d.getDay())) break;
      }
      break;
    default:
      // Nieznany cykl — dzień później, żeby pętla w nextDueDate się kończyła
      d.setDate(d.getDate() + 1);
  }
}

/**
 * Termin następnej instancji: pierwszy termin cyklu PO `due`, który nie jest
 * w przeszłości. Liczenie tylko od `due` dawało przy zaległym zadaniu kolejną
 * zaległą instancję — codzienne zadanie zaległe od poniedziałku, odhaczone
 * w czwartek, wracało z terminem na wtorek i trzeba je było odhaczać do skutku.
 *
 * @param {number} due — termin bieżącej instancji (początek dnia)
 * @param {string} recurrence — daily | weekly | monthly | yearly | custom
 * @param {number[]|null} [recurrenceDays] dni tygodnia (0 = niedziela) dla "custom"
 * @param {number} [now]
 * @returns {number} początek dnia następnego terminu
 */
export function nextDueDate(due, recurrence, recurrenceDays = null, now = Date.now()) {
  const days =
    recurrenceDays && recurrenceDays.length > 0 ? recurrenceDays : [1, 2, 3, 4, 5];
  const d = new Date(due);
  d.setHours(0, 0, 0, 0);
  const anchorDay = d.getDate();

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayStart = today.getTime();

  _step(d, recurrence, days, anchorDay);
  for (let i = 0; d.getTime() < todayStart && i < MAX_STEPS; i++) {
    _step(d, recurrence, days, anchorDay);
  }
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Treść dla następnej instancji: ta sama, z odznaczonymi pozycjami checklisty.
 * Cotygodniowe zadanie z listą kroków nie może zgubić tej listy (dawniej
 * nowa instancja dostawała pustą treść), ale kroki zaczyna od nowa.
 * Treść pochodzi ze storage, więc jest już po sanitizeHTML — atrybut ma
 * zawsze postać data-checked="true".
 * @param {string} html
 * @returns {string}
 */
export function contentForNextInstance(html) {
  if (typeof html !== 'string') return '';
  return html.replace(/data-checked="true"/g, 'data-checked="false"');
}

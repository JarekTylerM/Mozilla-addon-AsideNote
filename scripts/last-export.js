// @ts-check
/* ══════════════════════════════════════════════════════════════
   last-export.js — wiek ostatniej kopii zapasowej
   ──────────────────────────────────────────────────────────────
   Czysta logika bez DOM i `browser` (testowalna w Node). Notatki istnieją
   tylko w storage.local tego profilu, a odinstalowanie dodatku je kasuje.
   Sekcja "Dane" w ustawieniach pokazuje więc, kiedy ostatnio kliknięto
   eksport. To czas kliknięcia przycisku, nie dowód, że plik gdzieś leży —
   Firefox nie mówi rozszerzeniu, czy zapis się udał.
   ══════════════════════════════════════════════════════════════ */

/**
 * @typedef {object} LastExportInfo
 * @property {'never'|'today'|'yesterday'|'daysAgo'} kind
 * @property {number} days pełne dni kalendarzowe od eksportu (0 dla 'never')
 */

/**
 * Dni liczone kalendarzowo (północ do północy), nie przez dzielenie przez
 * 24 h: eksport z wczoraj 23:50 jest "wczoraj" już dziś o 0:10, a doba przy
 * zmianie czasu ma 23 albo 25 godzin.
 *
 * @param {unknown} lastExportAt znacznik czasu z uiSettings (brak = nigdy)
 * @param {number} [now]
 * @returns {LastExportInfo}
 */
export function lastExportInfo(lastExportAt, now = Date.now()) {
  if (
    typeof lastExportAt !== 'number' ||
    !Number.isFinite(lastExportAt) ||
    lastExportAt <= 0
  ) {
    return { kind: 'never', days: 0 };
  }

  const then = new Date(lastExportAt);
  const today = new Date(now);
  const startThen = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // Math.round wyrównuje dobę 23/25 h; znacznik z przyszłości (przestawiony
  // zegar) traktujemy jak dzisiejszy zamiast pokazywać ujemną liczbę dni
  const days = Math.max(
    0,
    Math.round((startToday.getTime() - startThen.getTime()) / 86400000),
  );

  if (days === 0) return { kind: 'today', days };
  if (days === 1) return { kind: 'yesterday', days };
  return { kind: 'daysAgo', days };
}

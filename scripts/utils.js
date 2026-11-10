// @ts-check
/* ══════════════════════════════════════════════════════════════
   utils.js — czyste funkcje pomocnicze
   ══════════════════════════════════════════════════════════════ */

/**
 * @param {(...args: any[]) => void} fn
 * @param {number} [delay]
 */
export function debounce(fn, delay = 600) {
  /** @type {ReturnType<typeof setTimeout> | null} */
  let t = null;
  /** @type {any[]} */
  let lastArgs = [];
  /** @type {{ (...args: any[]): void, cancel: () => void, flush: () => void }} */
  const debounced = (...args) => {
    lastArgs = args;
    clearTimeout(t ?? undefined);
    t = setTimeout(() => {
      t = null;
      fn(...lastArgs);
    }, delay);
  };
  debounced.cancel = () => {
    clearTimeout(t ?? undefined);
    t = null;
  };
  /* Wykonuje oczekujące wywołanie natychmiast (z ostatnimi argumentami).
     No-op gdy nic nie czeka — bezpieczny w pagehide/visibilitychange. */
  debounced.flush = () => {
    if (t === null) return;
    debounced.cancel();
    fn(...lastArgs);
  };
  return debounced;
}

/* ── Wyszukiwanie: dopasowanie odporne na polskie znaki ──────────
   Szybkie pisanie bez AltGr ("cisnienie", "lodz") ma znajdować to samo,
   co pisownia z ogonkami. NFD rozkłada ą/ę/ś/ć/ń/ó/ź/ż na literę + znak
   łączący, który usuwamy. "ł" NIE rozkłada się w Unicode — mapujemy ręcznie. */

/**
 * Normalizuje tekst do porównań: małe litery, bez znaków diakrytycznych.
 * @param {string} text
 * @returns {string}
 */
export function foldText(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l");
}

/**
 * Dzieli zapytanie na znormalizowane słowa (puste → []).
 * @param {string} query
 * @returns {string[]}
 */
export function queryTerms(query) {
  return foldText(query).split(/\s+/).filter(Boolean);
}

/**
 * Czy KAŻDE słowo zapytania występuje w tekście (w dowolnej kolejności).
 * `haystack` musi być już przepuszczony przez foldText.
 * @param {string} foldedHaystack
 * @param {string[]} terms - wynik queryTerms()
 * @returns {boolean}
 */
export function matchesTerms(foldedHaystack, terms) {
  return terms.every((term) => foldedHaystack.includes(term));
}

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

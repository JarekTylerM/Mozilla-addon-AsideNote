/* ══════════════════════════════════════════════════════════════
   utils.js — czyste funkcje pomocnicze
   ══════════════════════════════════════════════════════════════ */

export function debounce(fn, delay = 600) {
  let t = null;
  let lastArgs = [];
  const debounced = (...args) => {
    lastArgs = args;
    clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn(...lastArgs);
    }, delay);
  };
  debounced.cancel = () => {
    clearTimeout(t);
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

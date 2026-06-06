/* ══════════════════════════════════════════════════════════════
   utils.js — czyste funkcje pomocnicze
   ══════════════════════════════════════════════════════════════ */

export function debounce(fn, delay = 600) {
  let t;
  const debounced = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
  debounced.cancel = () => clearTimeout(t);
  return debounced;
}

// @ts-check
/* ══════════════════════════════════════════════════════════════
   build-flavor.js — rozpoznanie wersji testowej
   ──────────────────────────────────────────────────────────────
   Wersja testowa (node build.mjs --dev) ma własny identyfikator, a więc
   osobne dane. Tu jest tylko jej rozpoznanie i znacznik na <html>, po którym
   tokens.css rysuje pomarańczowy pasek z napisem DEV w panelu i popupie.
   ══════════════════════════════════════════════════════════════ */

/**
 * @param {unknown} addonId identyfikator dodatku
 * @returns {boolean}
 */
export function isDevBuild(addonId) {
  return /-dev@/.test(String(addonId ?? ''));
}

/** Oznacza dokument, gdy to wersja testowa. Wołaj jak najwcześniej. */
export function applyBuildFlavor() {
  if (isDevBuild(browser.runtime.id)) {
    document.documentElement.dataset.build = 'dev';
  }
}

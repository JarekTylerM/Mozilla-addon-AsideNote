// @ts-check
/* ══════════════════════════════════════════════════════════════
   platform/chromium/manifest.mjs — manifest dla Chrome i Edge
   ──────────────────────────────────────────────────────────────
   Źródłem prawdy pozostaje manifest.json z korzenia (Firefox, MV2).
   Tu jest tylko PRZEKSZTAŁCENIE do Manifest V3 w wariancie Chromium,
   więc wersja, nazwa, ikony, uprawnienia i skróty nie rozjeżdżają się
   między przeglądarkami — zmieniasz je w jednym miejscu.

   Różnice Firefox → Chromium:
   - manifest_version 2 → 3 (Chrome Web Store i Edge Add-ons przyjmują
     wyłącznie MV3),
   - browser_action → action (bez theme_icons — Chromium ich nie zna),
   - sidebar_action → side_panel + uprawnienie "sidePanel",
   - background.scripts → background.service_worker (background-sw.js
     ładuje shim browser→chrome, potem wspólny background.js),
   - content_security_policy: string → { extension_pages },
   - _execute_browser_action → _execute_action,
   - znikają klucze tylko-Firefoksowe: browser_specific_settings,
     developer, author (Chrome w MV3 chce tam obiektu z e-mailem).
   ══════════════════════════════════════════════════════════════ */

/** Najniższa wersja z chrome.sidePanel.open() (Chrome/Edge 116). */
export const MIN_CHROME_VERSION = '116';

/** Komendy, które Chromium nazywa inaczej niż Firefox. */
export const COMMAND_RENAMES = /** @type {Record<string, string>} */ ({
  _execute_browser_action: '_execute_action',
});

/**
 * Skróty wersji DEV w Chromium, nadpisujące DEV_SHORTCUTS z Firefoksa.
 * Edge rezerwuje dla siebie Alt+Shift+A, B, C, P, R, W, X, Z (sprawdzone
 * na Edge, listopad 2026) i po cichu ich nie przydziela rozszerzeniom.
 * Q, S, D, K przechodzą.
 */
export const CHROMIUM_DEV_SHORTCUT_OVERRIDES = /** @type {Record<string, string>} */ ({
  _execute_browser_action: 'Alt+Shift+K',
});

/**
 * @param {any} ff manifest.json z korzenia (Firefox MV2)
 * @returns {any} manifest MV3 dla Chrome/Edge
 */
export function toChromiumManifest(ff) {
  const m = structuredClone(ff);

  m.manifest_version = 3;
  delete m.browser_specific_settings;
  delete m.developer;
  delete m.author;

  if (typeof m.content_security_policy === 'string') {
    m.content_security_policy = { extension_pages: m.content_security_policy };
  }

  if (m.browser_action) {
    const { theme_icons: _ignored, ...action } = m.browser_action;
    m.action = action;
    delete m.browser_action;
  }

  if (m.sidebar_action) {
    m.side_panel = { default_path: m.sidebar_action.default_panel };
    delete m.sidebar_action;
  }

  m.background = { service_worker: 'background-sw.js' };

  if (m.commands) {
    /** @type {Record<string, any>} */
    const commands = {};
    for (const [name, def] of Object.entries(m.commands)) {
      const renamed = COMMAND_RENAMES[name] ?? name;
      const copy = { ...def };
      // Chrome odrzuca własne komendy bez opisu (pokazuje go w
      // chrome://extensions/shortcuts). Komendy _execute_* go nie wymagają.
      if (!renamed.startsWith('_execute_') && !copy.description) {
        copy.description = '__MSG_sidebar_title__';
      }
      commands[renamed] = copy;
    }
    m.commands = commands;
  }

  m.permissions = [...new Set([...(m.permissions ?? []), 'sidePanel'])];
  m.minimum_chrome_version = MIN_CHROME_VERSION;

  // Chrome pokazuje ikony 16/32 m.in. na liście rozszerzeń
  m.icons = {
    16: 'assets/icons/mdi--notebook-edit-outline-16.png',
    32: 'assets/icons/mdi--notebook-edit-outline-32.png',
    ...m.icons,
  };

  return m;
}

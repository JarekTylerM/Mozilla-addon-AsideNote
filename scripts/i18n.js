// @ts-check
// scripts/i18n.js
// Cienki wrapper na browser.i18n.getMessage + Intl.DateTimeFormat.
// Filozofia: zero magii. Brak klucza = log + fallback do klucza, nie crash.

const MISSING_KEYS = new Set();

/**
 * Pobiera przetłumaczony string.
 * @param {string} key - klucz z _locales/{lang}/messages.json
 * @param {string|string[]} [substitutions] - dla $1, $2 w message
 * @returns {string}
 */
export function t(key, substitutions) {
  const msg = browser.i18n.getMessage(key, substitutions);
  if (!msg) {
    if (!MISSING_KEYS.has(key)) {
      MISSING_KEYS.add(key);
      console.warn(`[i18n] Brak klucza: "${key}"`);
    }
    return key; // fallback widoczny — łatwo wyłapać w UI
  }
  return msg;
}

/**
 * Aktualny UI locale, np. "en", "pl", "en-US".
 * Używaj do Intl.*, nie do logiki ("czy PL?" — rób getUILocale().startsWith("pl")).
 */
export function getUILocale() {
  return browser.i18n.getUILanguage();
}

/**
 * Względne nazwy ("dziś", "jutro", "wczoraj") — używane w sekcjach listy.
 * Daty spoza zakresu zwracają null — caller sam decyduje co wtedy.
 * @param {number} timestamp
 */
export function relativeDayLabel(timestamp) {
  const now = new Date();
  const target = new Date(timestamp);
  const startOfDay = (/** @type {Date} */ d) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round(
    (startOfDay(target) - startOfDay(now)) / 86400000,
  );

  if (diffDays === 0) return t('common_today');
  if (diffDays === 1) return t('common_tomorrow');
  if (diffDays === -1) return t('common_yesterday');
  return null;
}

/**
 * Podstawia tłumaczenia w DOM.
 * - data-i18n="key"               → element.textContent = t(key)
 * - data-i18n-attr="attr:key;..."  → element.setAttribute(attr, t(key))
 *
 * Wywoływane raz na boot (po DOMContentLoaded). Idempotentne — można uruchomić
 * ponownie po dynamicznej zmianie locale, jeśli kiedyś dojdzie taka opcja.
 *
 * @param {ParentNode} [root=document] - scope; przydatne gdy wstrzykujesz fragment
 */
export function applyStaticTranslations(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(/** @type {HTMLElement} */ (el).dataset.i18n ?? '');
  }

  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    // format: "attr:key;attr:key" — jeden atrybut per para
    const spec = /** @type {HTMLElement} */ (el).dataset.i18nAttr ?? '';
    for (const pair of spec.split(';')) {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  }
}

// scripts/i18n.js — dolej na końcu

/** @type {string[] | null} */
let _shortWeekdaysCache = null;
/** @type {string | null} */
let _shortWeekdaysLocaleCache = null;

/**
 * Zwraca tablicę skróconych nazw dni tygodnia [Sun, Mon, ..., Sat]
 * w aktualnym UI locale. Cache'owane — Intl.DateTimeFormat jest drogie.
 *
 * Index 0 = Sunday (zgodnie z Date.getDay()), żeby caller mógł użyć
 * arr[date.getDay()] bez konwersji.
 */
export function getShortWeekdays() {
  const locale = getUILocale();
  if (_shortWeekdaysCache && _shortWeekdaysLocaleCache === locale) {
    return _shortWeekdaysCache;
  }
  const fmt = new Intl.DateTimeFormat(locale, { weekday: "short" });
  // 2024-01-07 to niedziela; budujemy 7 kolejnych dni
  const base = new Date(2024, 0, 7);
  const arr = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    arr.push(fmt.format(d));
  }
  _shortWeekdaysCache = arr;
  _shortWeekdaysLocaleCache = locale;
  return arr;
}

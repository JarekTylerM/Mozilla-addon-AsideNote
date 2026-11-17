// @ts-check
/**
 * editor-url.js — walidacja URL dla edytora
 *
 * Czyste funkcje — zero DOM, zero side effects, testowalane w Node.js.
 * Używane przez: _tryConvertMarkdownLink, _tryAutolinkWord, _saveLinkModal
 *
 * Dozwolone schematy pochodzą z JEDNEGO miejsca — ALLOWED_LINK_SCHEMES
 * w sanitize.js — a ostateczne słowo ma safeHref(). Wcześniej obie strony
 * trzymały własną blocklistę, która przepuszczała każdy nieznany schemat
 * (search-ms:, ms-msdt:, intent:…).
 */

import { ALLOWED_LINK_SCHEMES, safeHref } from './sanitize.js';

export { ALLOWED_LINK_SCHEMES };

/**
 * Jawny schemat ("https:", "mailto:"). Dwukropek z cyfrą za nim to port
 * ("localhost:3000", "example.org:8080"), nie schemat.
 */
const EXPLICIT_SCHEME_RX = /^([a-z][a-z0-9+.-]*):(?!\d)/i;

/**
 * Czy podany string wygląda jak URL nadający się do wstawienia jako link.
 * Zwraca false dla schematów spoza ALLOWED_LINK_SCHEMES i oczywistego nie-URL.
 *
 * @param {string} s
 * @returns {boolean}
 */
export function looksLikeUrl(s) {
  if (typeof s !== 'string') return false;
  const str = s.trim();
  if (!str || /\s/.test(str)) return false;

  const m = EXPLICIT_SCHEME_RX.exec(str);
  if (m) {
    const scheme = m[1].toLowerCase();
    if (!ALLOWED_LINK_SCHEMES.has(scheme)) return false;
    // http/https bez "//" ("https:foo") to raczej literówka niż adres
    if ((scheme === 'http' || scheme === 'https') && !/^[a-z]+:\/\/[^/]/i.test(str))
      return false;
    if (str.length <= m[0].length) return false; // samo "mailto:"
    return safeHref(str) !== null;
  }

  // Bez schematu: //host albo domena (google.com, example.org:8080/x).
  // normalizeUrl dołoży https://, a wynik i tak sprawdza safeHref.
  if (str.startsWith('//')) return safeHref(normalizeUrl(str)) !== null;
  if (/^[^\s/]+\.[^\s/]+/.test(str)) return safeHref(normalizeUrl(str)) !== null;
  return false;
}

/**
 * Auto-prepend https:// gdy brak schematu.
 * Chroni przed relative path (google.com → moz-extension://.../google.com).
 * "//host" też dostaje https: — w stronie rozszerzenia przejąłby jej schemat.
 *
 * @param {string} url
 * @returns {string}
 */
export function normalizeUrl(url) {
  if (url.startsWith('//')) return `https:${url}`;
  return EXPLICIT_SCHEME_RX.test(url) ? url : `https://${url}`;
}

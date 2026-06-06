/**
 * editor-url.js — walidacja URL dla edytora
 *
 * Czyste funkcje — zero DOM, zero side effects, testowalane w Node.js.
 * Używane przez: _tryConvertMarkdownLink, _saveLinkModal
 *
 * Uwaga: zestaw BLOCKED_SCHEMES musi być spójny z safeHref() w sanitize.js
 */

export const BLOCKED_SCHEMES = new Set([
  "javascript",
  "data",
  "vbscript",
  "file",
  "blob",
  "about",
  "resource",
]);

/**
 * Czy podany string wygląda jak URL nadający się do wstawienia jako link.
 * Zwraca false dla niebezpiecznych schematów i oczywistego nie-URL.
 *
 * @param {string} s
 * @returns {boolean}
 */
export function looksLikeUrl(s) {
  // Normalizacja przez URL API — odporna na encoding i whitespace bypassy
  try {
    const url = new URL(s, "https://x.invalid");
    const scheme = url.protocol.slice(0, -1).toLowerCase();
    if (BLOCKED_SCHEMES.has(scheme) || scheme.endsWith("-extension"))
      return false;
  } catch {
    // Nie da się sparsować jako absolutny URL — sprawdź ręcznie
    if (
      /^[\s\0]*(?:javascript|data|vbscript|file|blob|about|resource)[\s\0]*:/i.test(
        s,
      )
    )
      return false;
  }

  // Akceptuj: protokół (http://, https://, ftp://) albo // albo mailto: albo domena
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return true;
  if (s.startsWith("//")) return true;
  if (s.startsWith("mailto:")) return true;
  // Domena: cokolwiek.cokolwiek (np. google.com, example.org:8080)
  if (/^[^\s/]+\.[^\s/]+/.test(s)) return true;
  return false;
}

/**
 * Auto-prepend https:// gdy brak protokołu.
 * Chroni przed relative path (google.com → moz-extension://.../google.com).
 *
 * @param {string} url
 * @returns {string}
 */
export function normalizeUrl(url) {
  const hasProtocol =
    /^[a-z][a-z0-9+.-]*:(\/\/|\w)/i.test(url) || url.startsWith("//");
  return hasProtocol ? url : `https://${url}`;
}

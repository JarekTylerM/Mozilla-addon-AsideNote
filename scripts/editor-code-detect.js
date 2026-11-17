// @ts-check
/* ══════════════════════════════════════════════════════════════
   editor-code-detect.js — czy wklejany tekst to kod lub konfiguracja
   ──────────────────────────────────────────────────────────────
   Używane przez:
   - editor.js (wklejanie czystego tekstu: z terminala, z czatu, z pliku)
   - editor-paste-normalize.js (bezpiecznik dla wklejki w całości w kroju kodu)

   Po co: CSP rozbite na dyrektywy, plik .env czy kawałek JSON-a wklejone
   jako zwykły tekst dawały osobne akapity, a adresy w środku stawały się
   linkami. Blok kodu trzyma linie, wcięcia i stałą szerokość, nie robi
   linków i kopiuje się z powrotem dosłownie.

   Ostrożnie: polskie wyliczenia często kończą punkty średnikiem
   ("zakup biletów;"). Sam średnik niczego nie przesądza — linia musi mieć
   też coś, czego zwykłe zdanie nie ma (cudzysłów w środku, =, nawias,
   nazwa-z-myślnikami). Tekst musi mieć co najmniej dwie takie linie, a
   większość linii musi wyglądać na kod.

   Czysta funkcja — zero DOM.
   ══════════════════════════════════════════════════════════════ */

/** Znaki i formy, których zwykłe zdanie raczej nie ma. */
const CODE_TOKEN_RX = /['"`=(){}[\]<>\/\\]|[a-z0-9]+-[a-z0-9]+-?|[a-z]+_[a-z]+|[a-z][A-Z]/;

/** Linie, które same w sobie wyglądają na kod. */
const STRONG_LINE_RX = [
  // klamry i nawiasy na brzegach: { … }, ];
  /[{}]\s*[,;]?\s*$/,
  /^\s*[}\])]/,
  // dyrektywa: nazwa-z-myślnikami + wartość w cudzysłowie, schemat albo * (CSP, nginx)
  /^\s*[a-z][a-z0-9]*(?:-[a-z0-9]+)+\s+(?:'[^']*'|"[^"]*"|[a-z][a-z0-9+.-]*:|\*)/i,
  // komentarz, shebang, znacznik HTML/XML
  /^\s*(?:\/\/|\/\*|\*\/|#!|<\/?[a-z][\w:-]*(?:\s|>|\/>))/i,
  // JSON: "klucz":
  /^\s*"[^"]+"\s*:/,
  // .env / ini: KLUCZ=wartość (bez spacji w kluczu)
  /^\s*[A-Za-z_][\w.-]*=\S/,
  // SQL i słowa kluczowe języków, z typowym znakiem obok
  /^\s*(?:const|let|var|function|def|class|import|export|return|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER)\b.*[({;=:,*]/,
  // dalsze klauzule SQL — wielkimi literami, tak zdanie się nie zaczyna
  /^\s*(?:FROM|WHERE|ORDER BY|GROUP BY|HAVING|(?:LEFT |RIGHT |INNER )?JOIN|VALUES|SET|LIMIT)\b/,
];

/** @param {string} line */
function _isStrong(line) {
  if (STRONG_LINE_RX.some((rx) => rx.test(line))) return true;
  // Średnik na końcu + token "kodowy" w treści: "img-src 'self';", "a = 1;"
  return /;\s*$/.test(line) && CODE_TOKEN_RX.test(line.replace(/;\s*$/, ''));
}

/**
 * Czy wielolinijkowy tekst wygląda na kod lub konfigurację.
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeCode(text) {
  if (!text || typeof text !== 'string') return false;
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return false;

  const strong = lines.filter(_isStrong).length;
  if (strong < 2) return false;
  // Wcięta linia przy kodzie to zwykle ciąg dalszy bloku (wnętrze klamry)
  const indented = lines.filter((l) => !_isStrong(l) && /^(?:\t| {2,})\S/.test(l)).length;
  return (strong + indented) / lines.length >= 0.6;
}

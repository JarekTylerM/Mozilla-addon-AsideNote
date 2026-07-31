// @ts-check
/**
 * editor-pattern.js — detekcja wzorców inline markdown
 *
 * Czyste funkcje — zero DOM, zero side effects, testowalne w Node.js.
 * Używane przez: _tryInlineMarkdown w editor.js
 */

/** Regex dla markdown linka: [tekst](url) na końcu pre-cursor text */
export const MD_LINK_RX = /\[([^\[\]]*)\]\(([^()\[\]\s]+)\)$/;

/**
 * Czy znak na pozycji idx jest zaescapowany backslashem.
 *
 * Liczymy backslashe wstecz: nieparzysta liczba escapuje znak, parzysta
 * escapuje same backslashe i znak zostaje normalny (`\\*` to literalny
 * backslash + działający marker).
 *
 * @param {string} text
 * @param {number} idx pozycja znaku, o który pytamy
 * @returns {boolean}
 */
function _isEscapedAt(text, idx) {
  let n = 0;
  for (let i = idx - 1; i >= 0 && text[i] === '\\'; i--) n++;
  return n % 2 === 1;
}

/**
 * Wykrywa zaescapowany marker — użytkownik napisał `\*`, żeby dostać
 * literalną gwiazdkę zamiast kursywy.
 *
 * Caller ma wtedy usunąć backslash i wstawić sam znak. Bez tego backslash
 * zostawał w tekście, a formatowanie i tak się odpalało — czyli dokładnie
 * odwrotnie, niż prosił użytkownik.
 *
 * @param {string} textBefore tekst w węźle przed kursorem
 * @param {string} key znak, który właśnie naciśnięto
 * @returns {{ backslashIdx: number, literal: string } | null}
 */
export function findEscapedMarker(textBefore, key) {
  if (!['*', '_', '~', '~~', '`'].includes(key)) return null;
  // Backslash tuż przed kursorem, sam niezaescapowany
  if (!textBefore.endsWith('\\')) return null;
  if (_isEscapedAt(textBefore, textBefore.length - 1)) return null;
  return { backslashIdx: textBefore.length - 1, literal: key };
}

/**
 * Wykrywa wzorzec inline markdown na końcu textBefore.
 * Trigger następuje na ZAMYKAJĄCYM markerze.
 *
*  ***bold italic*** → <strong><em>  trigger: 3. '*'
 *  **bold**          → <strong>      trigger: 2. '*'
 *  *italic*          → <em>          trigger: 1. '*'
 *  ___bold italic___ → <strong><em>  trigger: 3. '_'
 *  __bold__          → <strong>      trigger: 2. '_'
 *  _italic_          → <em>          trigger: 1. '_'
 *  ~~strike~~        → <s>           trigger: 2. '~'
 *  `code`            → <code>        trigger: '`'
 *
 * Marker otwierający poprzedzony backslashem (`\*kursywa*`) nie liczy się —
 * użytkownik prosił o literalny znak. Marker zamykający obsługuje
 * findEscapedMarker, zanim ta funkcja w ogóle zostanie zawołana.
 *
 * @param {string} textBefore  tekst w węźle przed kursorem
 * @param {string} key         klawisz który właśnie naciśnięto
 * @returns {{ content: string, openIdx: number, markerLen: number, tag: string } | null}
 */
export function findInlinePattern(textBefore, key) {
  const hit = _findInlinePatternRaw(textBefore, key);
  if (!hit) return null;
  return _isEscapedAt(textBefore, hit.openIdx) ? null : hit;
}

/** @param {string} textBefore @param {string} key */
function _findInlinePatternRaw(textBefore, key) {
  let m;
  if (key === '*') {
    // ***bold italic*** — trigger: 3. '*', textBefore = "***treść**"
    m = textBefore.match(/\*\*\*([^*\n]{1,300})\*\*$/);
    if (m && textBefore[(m.index ?? 0) - 1] !== '*') {
      return { content: m[1], openIdx: m.index ?? 0, markerLen: 3, tag: 'strong-em' };
    }
    // **bold** — trigger: 2. '*', textBefore = "**treść*"
    // Otwierający ** nie może być poprzedzony przez * (unikamy ***)
    m = textBefore.match(/\*\*([^*\n]{1,300})\*$/);
    if (m && textBefore[(m.index ?? 0) - 1] !== '*') {
      return { content: m[1], openIdx: m.index ?? 0, markerLen: 2, tag: 'strong' };
    }
    // *italic* — trigger: '*', textBefore = "*treść" (brak ** w treści)
    m = textBefore.match(/(?:^|[^*])\*([^*\n]{1,300})$/);
    if (m) {
      const openIdx = (m.index ?? 0) + m[0].length - m[1].length - 1;
      return { content: m[1], openIdx, markerLen: 1, tag: 'em' };
    }
  }

  if (key === '_') {
    // ___bold italic___ — trigger: 3. '_', textBefore = "___treść__"
    m = textBefore.match(/___([^_\n]{1,300})__$/);
    if (m && textBefore[(m.index ?? 0) - 1] !== '_') {
      return { content: m[1], openIdx: m.index ?? 0, markerLen: 3, tag: 'strong-em' };
    }
    // __bold__ — trigger: 2. '_', textBefore = "__treść_"
    m = textBefore.match(/__([^_\n]{1,300})_$/);
    if (m && textBefore[(m.index ?? 0) - 1] !== '_') {
      return { content: m[1], openIdx: m.index ?? 0, markerLen: 2, tag: 'strong' };
    }
    // _italic_ — trigger: '_', textBefore = "_treść"
    // Nie triggeruj wewnątrz słowa (my_var, snake_case)
    m = textBefore.match(/(?:^|[^_\w])_([^_\n]{1,300})$/);
    if (m) {
      const openIdx = (m.index ?? 0) + m[0].length - m[1].length - 1;
      return { content: m[1], openIdx, markerLen: 1, tag: 'em' };
    }
  }

if (key === '~' || key === '~~') {
    if (key === '~~') {
      // Polska klawiatura: dead key wstawia ~~ naraz
      // textBefore = "~~treść" (bez trailing ~, bo obydwa ~ wstawiane razem)
      m = textBefore.match(/~~([^~\n]{1,300})$/);
    } else {
      // Standard: textBefore = "~~treść~"
      m = textBefore.match(/~~([^~\n]{1,300})~$/);
    }
    if (m) {
      return { content: m[1], openIdx: m.index ?? 0, markerLen: 2, tag: 's' };
    }
  }

  if (key === '`') {
    // `code` — trigger: '`', textBefore = "`treść"
    m = textBefore.match(/`([^`\n]{1,300})$/);
    if (m) {
      return { content: m[1], openIdx: m.index ?? 0, markerLen: 1, tag: 'code' };
    }
  }

  return null;
}

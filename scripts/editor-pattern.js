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
 * @param {string} textBefore  tekst w węźle przed kursorem
 * @param {string} key         klawisz który właśnie naciśnięto
 * @returns {{ content: string, openIdx: number, markerLen: number, tag: string } | null}
 */
export function findInlinePattern(textBefore, key) {
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

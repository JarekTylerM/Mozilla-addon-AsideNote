// @ts-check
/* ══════════════════════════════════════════════════════════════
   editor-find.js — szukanie w otwartej notatce (logika)
   ──────────────────────────────────────────────────────────────
   Ctrl+F przeglądarki szuka w DOKUMENCIE strony, nie w panelu bocznym —
   w długiej notatce nie było więc czym znaleźć zdania. Wyszukiwarka nad
   listą (Alt+S) też nie pomaga: ona wybiera notatkę, nie pokazuje miejsca.

   Ten moduł jest czysty na tyle, na ile się da:
   - foldChar/foldForFind — składanie znaków 1:1, żeby indeks w tekście
     złożonym pasował do indeksu w oryginale (NFD zmienia długość, więc
     foldText z utils.js tu NIE wystarcza),
   - findMatches — pozycje trafień w złożonym tekście,
   - collectTextNodes/buildFindIndex/rangeAt — mapowanie pozycji na Range
     (potrzebują DOM, ale dostają root jako argument → testowalne w jsdom).

   Podświetlanie i pasek UI siedzą w editor.js — tam, gdzie reszta edytora.
   ══════════════════════════════════════════════════════════════ */

/** Elementy, których treści nie szukamy — nie są tekstem notatki. */
const SKIPPED = 'summary';

/**
 * Składa znak do porównań ZACHOWUJĄC długość: jeden znak wejścia = jeden
 * znak wyjścia. Dzięki temu pozycja trafienia w tekście złożonym jest tą
 * samą pozycją w tekście oryginalnym.
 *
 * @param {string} ch pojedynczy znak
 * @returns {string}
 */
export function foldChar(ch) {
  const lower = ch.toLowerCase();
  // "ł" nie rozkłada się w NFD — mapujemy ręcznie (jak foldText w utils.js)
  if (lower === 'ł') return 'l';
  const stripped = lower.normalize('NFD').replace(/[̀-ͯ]/g, '');
  // İ → "i" + znak łączący; po usunięciu zostaje "i". Pusty wynik (sam znak
  // łączący) zostawiamy jak był, żeby długość się zgadzała.
  return stripped.length ? stripped[0] : lower;
}

/**
 * Składa cały tekst znak po znaku — długość wyniku = długość wejścia.
 * @param {string} text
 * @returns {string}
 */
export function foldForFind(text) {
  let out = '';
  for (const ch of String(text ?? '')) out += foldChar(ch);
  return out;
}

/**
 * Pozycje wszystkich trafień zapytania w złożonym tekście.
 * Szukamy frazy dosłownie (nie słowo po słowie jak lista) — w notatce
 * chodzi o konkretne miejsce, nie o to, czy notatka pasuje.
 *
 * @param {string} foldedText tekst po foldForFind
 * @param {string} foldedQuery zapytanie po foldForFind
 * @returns {{ start: number, end: number }[]}
 */
export function findMatches(foldedText, foldedQuery) {
  if (!foldedQuery) return [];
  /** @type {{ start: number, end: number }[]} */
  const hits = [];
  let from = 0;
  for (;;) {
    const at = foldedText.indexOf(foldedQuery, from);
    if (at === -1) break;
    hits.push({ start: at, end: at + foldedQuery.length });
    // Trafienia nie zachodzą na siebie — "aa" w "aaaa" to dwa, nie trzy
    from = at + foldedQuery.length;
  }
  return hits;
}

/**
 * Węzły tekstowe notatki w kolejności czytania.
 * @param {Element} root
 * @returns {Text[]}
 */
export function collectTextNodes(root) {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */, {
    acceptNode(node) {
      const parent = /** @type {Text} */ (node).parentElement;
      if (!parent) return 2; // REJECT
      if (parent.closest(SKIPPED)) return 2;
      return (node.textContent ?? '').length ? 1 /* ACCEPT */ : 2;
    },
  });
  /** @type {Text[]} */
  const nodes = [];
  while (walker.nextNode()) nodes.push(/** @type {Text} */ (walker.currentNode));
  return nodes;
}

/**
 * @typedef {object} FindIndex
 * @property {string} text   cała treść notatki, złożona (foldForFind)
 * @property {Text[]} nodes  węzły tekstowe w kolejności
 * @property {number[]} starts pozycja startowa każdego węzła w `text`
 */

/**
 * Buduje indeks „pozycja w tekście → węzeł + offset".
 * @param {Element} root
 * @returns {FindIndex}
 */
export function buildFindIndex(root) {
  const nodes = collectTextNodes(root);
  /** @type {number[]} */
  const starts = [];
  let text = '';
  for (const node of nodes) {
    starts.push(text.length);
    text += foldForFind(node.textContent ?? '');
  }
  return { text, nodes, starts };
}

/**
 * Zamienia zakres pozycji w tekście na Range w DOM.
 * @param {FindIndex} index
 * @param {{ start: number, end: number }} match
 * @returns {Range|null}
 */
export function rangeAt(index, match) {
  const from = _locate(index, match.start);
  const to = _locate(index, match.end);
  if (!from || !to) return null;
  const doc = from.node.ownerDocument;
  if (!doc) return null;
  const range = doc.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}

/**
 * Węzeł i offset dla pozycji w złożonym tekście.
 * @param {FindIndex} index @param {number} pos
 * @returns {{ node: Text, offset: number } | null}
 */
function _locate(index, pos) {
  const { nodes, starts } = index;
  if (!nodes.length) return null;

  // Binarne szukanie węzła, w którym leży pozycja
  let lo = 0;
  let hi = nodes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  const node = nodes[lo];
  const len = (node.textContent ?? '').length;
  const offset = Math.min(Math.max(pos - starts[lo], 0), len);
  return { node, offset };
}

/**
 * Indeks trafienia, w którym (lub za którym) stoi kursor — stąd „następny"
 * liczy się od miejsca, w którym użytkownik jest, a nie od początku notatki.
 *
 * @param {{ start: number, end: number }[]} matches
 * @param {number} caretPos pozycja kursora w złożonym tekście (-1 = brak)
 * @returns {number} indeks trafienia (0 gdy brak sensownego kandydata)
 */
export function matchAtOrAfter(matches, caretPos) {
  if (!matches.length) return -1;
  if (caretPos < 0) return 0;
  const found = matches.findIndex((m) => m.start >= caretPos);
  return found === -1 ? 0 : found;
}

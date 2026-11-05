// @ts-check
/**
 * editor-paste-insert.js — wstawia (już sanityzowany) HTML w miejscu kursora
 *
 * Wcześniej bloki z wklejki lądowały ZA całym blokiem najwyższego poziomu:
 * wklejenie dwóch akapitów w środek zdania zostawiało zdanie w całości nad
 * wklejką, a lista wklejona w punkt listy tworzyła drugą, osobną listę.
 * Teraz:
 *  - w akapicie/nagłówku: blok jest rozcinany w miejscu kursora, pierwszy
 *    wklejony akapit dokleja się do tekstu przed kursorem, ostatni — do
 *    tekstu za kursorem (jak w Google Docs / Wordzie),
 *  - w punkcie listy: wklejone punkty (i akapity) stają się kolejnymi
 *    punktami TEJ listy, na tym samym poziomie,
 *  - pojedynczy akapit wklejamy jak tekst — w zdanie, bez nowej linii.
 *
 * Moduł bez zależności od storage/notes — testowalny w jsdom.
 */

import {
  _splitBlockAtCaret,
  _splitListItemKeepingNested,
} from './editor-selection.js';

/** Bloki najwyższego poziomu, które może zawierać wklejka. */
const BLOCK = new Set([
  'UL', 'OL', 'P', 'H1', 'H2', 'H3', 'BLOCKQUOTE', 'PRE', 'DIV', 'HR', 'DETAILS',
]);
/** Wklejka złożona tylko z tych bloków może dołączyć do listy jako punkty. */
const LIST_MERGEABLE = new Set(['UL', 'OL', 'P', 'H1', 'H2', 'H3']);
/** Bloki tekstowe, które rozcinamy w miejscu kursora. */
const SPLITTABLE = new Set(['P', 'H1', 'H2', 'H3', 'DIV']);
/** Konteksty, w których nie rozcinamy (wklejka idzie za blok najwyższego poziomu). */
const NO_SPLIT = /^(LI|PRE|SUMMARY|BLOCKQUOTE|DETAILS)$/;

/** @param {Node} n @returns {n is Element} */
const _isEl = (n) => n.nodeType === 1;
/** @param {Node} n */
const _isBlock = (n) => _isEl(n) && BLOCK.has(n.tagName);
/** @param {Node} n @returns {Element|null} */
const _elOf = (n) => (_isEl(n) ? n : n.parentElement);

/**
 * @param {HTMLElement} editor
 * @param {string} html sanityzowany HTML
 * @returns {boolean} true, gdy coś wstawiono
 */
export function insertPastedHTML(editor, html) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return false;

  // Metadane schowka (<!--StartFragment--> itp.)
  const stripped = html.replace(/<!--[\s\S]*?-->/g, '').trim();
  if (!stripped) return false;
  const tmp = document.createElement('div');
  tmp.innerHTML = stripped;
  if (!tmp.childNodes.length) return false;

  const range = sel.getRangeAt(0);
  range.deleteContents();

  /** @type {Node[]} */
  let nodes = Array.from(tmp.childNodes);
  let hasBlock = nodes.some(_isBlock);
  if (hasBlock) {
    // Białe znaki między blokami (formatowanie źródła) — nie są treścią
    nodes = nodes.filter((n) => _isEl(n) || (n.textContent ?? '').trim());
    // Pojedynczy akapit to w praktyce fragment tekstu — w zdanie, nie pod nie
    const only = nodes[0];
    if (nodes.length === 1 && _isEl(only) && only.tagName === 'P') {
      nodes = Array.from(only.childNodes);
      hasBlock = false;
    }
  }

  if (!hasBlock) {
    _insertInline(editor, range, nodes, sel);
    return true;
  }

  const blocks = /** @type {Element[]} */ (nodes.filter(_isEl));
  const startEl = _elOf(range.startContainer);
  const li = startEl?.closest('li') ?? null;

  if (li && editor.contains(li)) {
    if (blocks.every((n) => LIST_MERGEABLE.has(n.tagName))) {
      _insertIntoList(li, range, blocks, sel);
    } else {
      _insertAfterTopLevel(editor, range, blocks, sel);
    }
    return true;
  }

  const block = _splittableBlock(startEl, editor);
  // Wewnątrz cytatu/toggle'a rozcinamy tylko dla samych akapitów — lista
  // czy nagłówek w <blockquote> rozjechałyby logikę Entera w cytacie
  if (block && (block.parentNode === editor || blocks.every((n) => n.tagName === 'P'))) {
    _insertSplitting(block, range, blocks, sel);
  } else {
    _insertAfterTopLevel(editor, range, blocks, sel);
  }
  return true;
}

/* ── Warianty wstawiania ──────────────────────────────────────── */

/**
 * Sam inline (fragment zdania) — w miejscu kursora.
 * @param {HTMLElement} editor @param {Range} range @param {Node[]} nodes @param {Selection} sel
 */
function _insertInline(editor, range, nodes, sel) {
  const frag = document.createDocumentFragment();
  nodes.forEach((n) => frag.appendChild(n));
  const last = frag.lastChild;
  if (!last) return;

  // Pusty blok trzyma <br> tylko po to, żeby był edytowalny. Po wklejeniu
  // tekstu ten <br> zostałby PRZED nim jako pusta linia (kursor za
  // placeholderem) — usuwamy go.
  const host = _elOf(range.startContainer);
  if (host && host !== editor && editor.contains(host) && _isEmptyBlock(host) && host.querySelector('br')) {
    host.replaceChildren();
    range.setStart(host, 0);
    range.collapse(true);
  }

  // Kursor wprost w edytorze (pusta notatka) — tekst dostaje akapit,
  // zamiast wisieć luzem między blokami
  if (range.startContainer === editor) {
    const p = document.createElement('p');
    p.appendChild(frag);
    range.insertNode(p);
  } else {
    range.insertNode(frag);
  }
  const r = document.createRange();
  r.setStartAfter(last);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

/**
 * Rozcina blok w miejscu kursora i wstawia bloki pomiędzy. Brzegowe
 * akapity wklejki doklejają się do tekstu przed/za kursorem.
 *
 * @param {Element} block @param {Range} range @param {Element[]} nodes @param {Selection} sel
 */
function _insertSplitting(block, range, nodes, sel) {
  const tail = _splitBlockAtCaret(block, range, block.tagName.toLowerCase());
  const headEmpty = _isEmptyBlock(block);
  const tailEmpty = _isEmptyBlock(tail);

  /** @type {Element} */
  let ref = block;
  for (const n of nodes) {
    ref.after(n);
    ref = n;
  }

  const queue = [...nodes];
  const first = queue[0];
  if (!headEmpty && first?.tagName === 'P') {
    _dropTrailingBr(block);
    while (first.firstChild) block.appendChild(first.firstChild);
    first.remove();
    queue.shift();
  }

  /** @type {Node|null} */
  let seam = null;
  const last = queue[queue.length - 1];
  if (!tailEmpty && last?.tagName === 'P') {
    const moved = Array.from(last.childNodes);
    tail.prepend(...moved);
    last.remove();
    queue.pop();
    seam = moved[moved.length - 1] ?? null;
  }

  if (headEmpty) block.remove();
  if (tailEmpty) tail.remove();

  if (seam) {
    _caretAfter(seam, sel);
  } else {
    const end = queue[queue.length - 1] ?? (tailEmpty ? null : tail) ?? block;
    if (end.isConnected) _caretAtEnd(end, sel);
  }
}

/**
 * Wklejka do punktu listy: punkty i akapity stają się punktami tej listy.
 *
 * @param {Element} li punkt z kursorem
 * @param {Range} range
 * @param {Element[]} nodes
 * @param {Selection} sel
 */
function _insertIntoList(li, range, nodes, sel) {
  const inChecklist = !!li.closest('ul[data-list="checklist"]');

  /** @type {Element[]} */
  const items = [];
  for (const n of nodes) {
    if (n.tagName === 'UL' || n.tagName === 'OL') {
      items.push(...Array.from(n.children).filter((c) => c.tagName === 'LI'));
    } else {
      const it = document.createElement('li');
      while (n.firstChild) it.appendChild(n.firstChild);
      if (!it.firstChild) it.appendChild(document.createElement('br'));
      items.push(it);
    }
  }
  if (!items.length) return;

  // Punkty przejmują rodzaj listy docelowej (jak w Google Docs): w checkliście
  // dostają checkbox, poza nią gubią stan zaznaczenia
  for (const it of items) {
    if (!inChecklist) it.removeAttribute('data-checked');
    else if (!it.hasAttribute('data-checked')) it.setAttribute('data-checked', 'false');
  }

  const nested = li.querySelector(':scope > ul, :scope > ol');
  if (!nested && !_ownText(li).trim()) {
    // Pusty punkt (np. świeżo po Enterze) — wklejka go zastępuje
    li.before(...items);
    li.remove();
  } else if (_hasOwnTextAfter(li, range, nested)) {
    const tail = _splitListItemKeepingNested(li, range);
    if (inChecklist) tail.setAttribute('data-checked', 'false');
    tail.before(...items);
  } else {
    li.after(...items);
  }

  _caretAtEnd(items[items.length - 1], sel);
}

/**
 * Wariant awaryjny: bloki za blokiem najwyższego poziomu (cytat, kod,
 * toggle — tam rozcinanie nie ma sensu).
 *
 * @param {HTMLElement} editor @param {Range} range @param {Element[]} nodes @param {Selection} sel
 */
function _insertAfterTopLevel(editor, range, nodes, sel) {
  /** @type {Node|null} */
  let anchor = range.startContainer;
  if (anchor === editor) {
    const ref = editor.childNodes[range.startOffset] ?? null;
    nodes.forEach((n) => editor.insertBefore(n, ref));
  } else {
    while (anchor && anchor.parentNode !== editor) anchor = anchor.parentNode;
    if (!anchor) {
      editor.append(...nodes);
    } else {
      /** @type {ChildNode} */
      let ref = /** @type {ChildNode} */ (anchor);
      for (const n of nodes) {
        ref.after(n);
        ref = n;
      }
      // Kursor stał w pustym akapicie — zastępujemy go wklejką
      if (_isEl(anchor) && anchor.tagName === 'P' && _isEmptyBlock(anchor)) anchor.remove();
    }
  }
  _caretAtEnd(nodes[nodes.length - 1], sel);
}

/* ── Helpery ──────────────────────────────────────────────────── */

/**
 * Najbliższy blok tekstowy do rozcięcia; null, gdy po drodze jest kontekst,
 * w którym nie rozcinamy (punkt listy, kod, summary, cytat bez akapitów).
 * @param {Element|null} startEl @param {HTMLElement} editor
 */
function _splittableBlock(startEl, editor) {
  for (let el = startEl; el && el !== editor; el = el.parentElement) {
    if (SPLITTABLE.has(el.tagName)) return el;
    if (NO_SPLIT.test(el.tagName)) return null;
  }
  return null;
}

/** Brak tekstu i elementów innych niż <br>. @param {Element} el */
function _isEmptyBlock(el) {
  return !(el.textContent ?? '').trim() && !el.querySelector(':not(br)');
}

/** @param {Element} el */
function _dropTrailingBr(el) {
  while (el.lastChild?.nodeName === 'BR') el.lastChild.remove();
}

/** Tekst punktu bez podlist. @param {Element} li */
function _ownText(li) {
  return Array.from(li.childNodes)
    .filter((n) => !(_isEl(n) && /^(UL|OL)$/.test(n.tagName)))
    .map((n) => n.textContent ?? '')
    .join('');
}

/**
 * Czy za kursorem jest jeszcze własna treść punktu (przed podlistą).
 * @param {Element} li @param {Range} range @param {Element|null} nested
 */
function _hasOwnTextAfter(li, range, nested) {
  const probe = document.createRange();
  probe.setStart(range.startContainer, range.startOffset);
  if (nested) probe.setEndBefore(nested);
  else probe.setEnd(li, li.childNodes.length);
  return probe.toString().trim() !== '';
}

/** @param {Node} node @param {Selection} sel */
function _caretAfter(node, sel) {
  const r = document.createRange();
  if (node.nodeType === 3) r.setStart(node, (node.textContent ?? '').length);
  else r.setStartAfter(node);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

/**
 * Kursor na końcu wizualnie ostatniej linii bloku — w głąb list, cytatów
 * i bloku kodu, przed domykającym <br>.
 * @param {Element} el @param {Selection} sel
 */
function _caretAtEnd(el, sel) {
  let t = el;
  for (;;) {
    const last = t.lastElementChild;
    if (!last) break;
    if (/^(UL|OL|BLOCKQUOTE|DETAILS)$/.test(t.tagName)) t = last;
    else if (t.tagName === 'LI' && /^(UL|OL)$/.test(last.tagName)) t = last;
    else if (t.tagName === 'PRE' && last.tagName === 'CODE') t = last;
    else break;
  }
  const r = document.createRange();
  if (t.tagName === 'HR') r.setStartAfter(t);
  else if (t.lastChild?.nodeName === 'BR') r.setStartBefore(t.lastChild);
  else {
    r.selectNodeContents(t);
    r.collapse(false);
  }
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

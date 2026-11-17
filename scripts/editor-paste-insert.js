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
 *  - pojedynczy akapit wklejamy jak tekst — w zdanie, bez nowej linii,
 *  - w cytacie: wklejka zostaje W cytacie. Cytat składa się tylko z akapitów
 *    (tak działa Enter w cytacie), więc nagłówki, listy i kod zamieniają się
 *    na akapity — punkt listy to linia „• …”, linia kodu to linia kodu.
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

/** Białe znaki HTML (bez &nbsp; — ten jest treścią). */
const WS_START = /^[\t\n\f\r ]+/;
const WS_END = /[\t\n\f\r ]+$/;

/**
 * Wyjmuje węzły do wstawienia i przenosi je do dokumentu edytora.
 *
 * Wklejka przychodzi jako DRZEWO (body z sanitizeHTMLToBody) i jest
 * przenoszona węzeł po węźle. Wcześniej szła jako string, z którego regex
 * wycinał komentarze, a wynik trafiał do innerHTML — w starszych
 * przeglądarkach to sklejało href="<!---->javascript:…" w działający link.
 * String nadal jest przyjmowany (testy, wywołania pomocnicze): parsujemy go
 * w bezwładnym <template>, a komentarze usuwamy w DOM, nie regexem.
 *
 * @param {string|Element|DocumentFragment} content
 * @returns {Node[]}
 */
function _takeNodes(content) {
  /** @type {Node} */
  let root;
  if (typeof content === 'string') {
    const tpl = document.createElement('template');
    tpl.innerHTML = content;
    root = tpl.content;
  } else {
    root = content;
  }
  _dropNonContent(root);

  const nodes = Array.from(root.childNodes);
  // Odpowiednik dawnego .trim() na stringu — formatowanie źródła na brzegach
  const first = nodes[0];
  if (first?.nodeType === 3) {
    first.textContent = (first.textContent ?? '').replace(WS_START, '');
  }
  const last = nodes[nodes.length - 1];
  if (last?.nodeType === 3) {
    last.textContent = (last.textContent ?? '').replace(WS_END, '');
  }
  return nodes
    .filter((n) => n.nodeType !== 3 || n.textContent)
    .map((n) => document.adoptNode(n));
}

/**
 * Usuwa wszystko, co nie jest elementem ani tekstem (komentarze
 * <!--StartFragment-->, processing instructions).
 * @param {Node} node
 */
function _dropNonContent(node) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 1) _dropNonContent(child);
    else if (child.nodeType !== 3) node.removeChild(child);
  }
}

/**
 * @param {HTMLElement} editor
 * @param {string|Element|DocumentFragment} content sanityzowana treść —
 *   najlepiej drzewo z sanitizeHTMLToBody (węzły są PRZENOSZONE, nie kopiowane)
 * @returns {boolean} true, gdy coś wstawiono
 */
export function insertPastedHTML(editor, content) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return false;

  /** @type {Node[]} */
  let nodes = _takeNodes(content);
  if (!nodes.length) return false;

  const range = sel.getRangeAt(0);
  range.deleteContents();

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
    if (!blocks.every((n) => LIST_MERGEABLE.has(n.tagName))) {
      _insertAfterTopLevel(editor, range, blocks, sel);
    } else if (_pastesForeignList(li, blocks)) {
      // Inny rodzaj listy niż docelowa — wstawiamy ją obok, nie wtapiamy
      _insertListBeside(li, range, blocks, sel);
    } else {
      _insertIntoList(li, range, blocks, sel);
    }
    return true;
  }

  // Cytat (także callout) — wklejka zostaje w środku, nie ląduje za nim
  const quote = startEl?.closest('blockquote') ?? null;
  if (quote && editor.contains(quote) && !startEl?.closest('pre, summary')) {
    _insertIntoQuote(quote, range, blocks, sel);
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
function _insertSplitting(
  block,
  range,
  nodes,
  sel,
  mergeable = (/** @type {Element} */ n) => n.tagName === 'P',
) {
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
  if (!headEmpty && first && mergeable(first)) {
    _dropTrailingBr(block);
    while (first.firstChild) block.appendChild(first.firstChild);
    first.remove();
    queue.shift();
  }

  /** @type {Node|null} */
  let seam = null;
  const last = queue[queue.length - 1];
  if (!tailEmpty && last && mergeable(last)) {
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
 * Wklejka do cytatu: bloki zamienione na akapity cytatu, wstawione w miejscu
 * kursora. Brzegowe akapity (z akapitu albo nagłówka) doklejają się do tekstu
 * przed/za kursorem, jak w zwykłym akapicie; linie z listy czy kodu zostają
 * osobnymi liniami — „cytat• punkt” w jednej linii nie miałby sensu.
 *
 * @param {Element} quote @param {Range} range @param {Element[]} blocks @param {Selection} sel
 */
function _insertIntoQuote(quote, range, blocks, sel) {
  /** @type {Set<Element>} */
  const separate = new Set();
  const lines = _quoteLines(blocks, separate);
  if (!lines.length) return;

  const sc = range.startContainer;
  const so = range.startOffset;

  /** Akapit cytatu z kursorem. @type {Element|null} */
  let block = null;
  if (sc === quote) {
    // Kursor między dziećmi cytatu (np. na samym końcu) — bierzemy akapit
    // obok i stawiamy kursor na jego początku albo końcu
    const after = quote.childNodes[so];
    const before = quote.childNodes[so - 1];
    if (after && _isEl(after) && SPLITTABLE.has(after.tagName)) {
      block = after;
      range.setStart(after, 0);
    } else if (before && _isEl(before) && SPLITTABLE.has(before.tagName)) {
      block = before;
      range.setStart(before, before.childNodes.length);
    }
    range.collapse(true);
  } else {
    for (let el = _elOf(sc); el && el !== quote; el = el.parentElement) {
      if (el.parentElement === quote) block = el;
    }
    if (block && !SPLITTABLE.has(block.tagName)) block = null;
  }

  if (!block) {
    // Cytat bez akapitów (sama treść) — owijamy w <p>, tak jak robi Enter
    // w cytacie. Przeniesienie węzłów resetuje żywy Range, więc kursor
    // odtwarzamy z zapamiętanego punktu.
    const wrapper = document.createElement('p');
    while (quote.firstChild) wrapper.appendChild(quote.firstChild);
    quote.appendChild(wrapper);
    if (sc === quote) range.setStart(wrapper, Math.min(so, wrapper.childNodes.length));
    else if (wrapper.contains(sc)) range.setStart(sc, so);
    else range.setStart(wrapper, wrapper.childNodes.length);
    range.collapse(true);
    block = wrapper;
  }

  _insertSplitting(block, range, lines, sel, (n) => !separate.has(n));
}

/**
 * Bloki wklejki → akapity, które może zawierać cytat.
 * @param {Element[]} blocks
 * @param {Set<Element>} separate akapity, które mają zostać osobną linią
 * @param {string} [indent] wcięcie podlisty
 * @returns {Element[]}
 */
function _quoteLines(blocks, separate, indent = '') {
  /** @type {Element[]} */
  const out = [];
  /** @param {Node[]} children @param {boolean} [own] */
  const para = (children, own = false) => {
    const p = document.createElement('p');
    p.append(...children);
    _dropTrailingBr(p);
    if (!(p.textContent ?? '').trim() && !p.querySelector('img')) return;
    if (own) separate.add(p);
    out.push(p);
  };

  for (const b of blocks) {
    const tag = b.tagName;
    if (tag === 'HR') continue;
    if (tag === 'UL' || tag === 'OL') {
      const checklist = b.getAttribute('data-list') === 'checklist';
      let n = 0;
      for (const li of Array.from(b.children)) {
        if (li.tagName !== 'LI') continue;
        n++;
        const marker = checklist
          ? li.getAttribute('data-checked') === 'true'
            ? '☑ '
            : '☐ '
          : tag === 'OL'
            ? `${n}. `
            : '• ';
        const nested = Array.from(li.children).filter((c) => /^(UL|OL)$/.test(c.tagName));
        nested.forEach((c) => c.remove());
        para([document.createTextNode(indent + marker), ...Array.from(li.childNodes)], true);
        out.push(..._quoteLines(nested, separate, indent + '  '));
      }
    } else if (tag === 'PRE') {
      for (const line of (b.textContent ?? '').replace(/\n$/, '').split('\n')) {
        if (!line.trim()) continue;
        const code = document.createElement('code');
        code.textContent = line;
        para([code], true);
      }
    } else if (tag === 'BLOCKQUOTE' || tag === 'DETAILS') {
      // Cytat w cytacie / sekcja rozwijana — ich linie stają się liniami cytatu
      const inner = Array.from(b.childNodes);
      const innerBlocks = /** @type {Element[]} */ (
        inner.filter((c) => _isEl(c) && (BLOCK.has(c.tagName) || c.tagName === 'SUMMARY'))
      ).map((c) => (c.tagName === 'SUMMARY' ? _asP(c) : c));
      if (innerBlocks.length) out.push(..._quoteLines(innerBlocks, separate, indent));
      else para(inner);
    } else {
      // P, DIV, H1–H3 i inne — treść w akapit (nagłówek w cytacie to akapit).
      // Nagłówek zostaje osobną linią, jak przy wklejce w zwykły akapit —
      // tam też nie skleja się z tekstem przed kursorem.
      para(Array.from(b.childNodes), /^H[1-6]$/.test(tag));
    }
  }
  return out;
}

/**
 * Bloki → linie cytatu (akapity). Te same reguły co przy wklejaniu do
 * cytatu — używa ich też przeciąganie bloku do cytatu (editor-drag-handle).
 * @param {Element[]} blocks
 * @returns {Element[]}
 */
export function blocksToQuoteLines(blocks) {
  return _quoteLines(blocks, new Set());
}

/** @param {Element} el @returns {Element} */
function _asP(el) {
  const p = document.createElement('p');
  p.append(...Array.from(el.childNodes));
  return p;
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
 * Czy wklejka niesie listę o innej NUMERACJI niż ta, w której stoi kursor?
 *
 * Punkty z wklejki domyślnie przejmują rodzaj listy docelowej (Google Docs
 * robi tak samo): akapity stają się punktami, a checklista i lista punktowana
 * wymieniają się checkboxami. Przy numeracji ta zamiana gubi jednak treść —
 * wklejone "1. 2. 3." wracało jako punktory i numerów nie dało się odtworzyć.
 * Listę o innej numeracji wstawiamy więc obok, z zachowaniem jej rodzaju.
 *
 * Listy zagnieżdżone zostawiamy staremu wtapianiu: rozcinanie podlisty
 * rozjechałoby strukturę punktu nadrzędnego.
 *
 * @param {Element} li punkt z kursorem @param {Element[]} blocks
 */
function _pastesForeignList(li, blocks) {
  const list = li.parentElement;
  if (!list || list.parentElement?.tagName === 'LI') return false;
  const targetOrdered = list.tagName === 'OL';
  return blocks.some(
    (b) => /^(UL|OL)$/.test(b.tagName) && (b.tagName === 'OL') !== targetOrdered,
  );
}

/**
 * Wklejona lista ląduje jako osobna lista: dzielimy listę docelową w miejscu
 * kursora i wkładamy wklejkę między obie połówki. Druga połówka listy
 * numerowanej dostaje start= tak, żeby numeracja szła dalej.
 *
 * @param {Element} li @param {Range} range @param {Element[]} blocks @param {Selection} sel
 */
function _insertListBeside(li, range, blocks, sel) {
  const list = /** @type {Element} */ (li.parentElement);
  const nested = li.querySelector(':scope > ul, :scope > ol');
  const liEmpty = !nested && !_ownText(li).trim();

  /** @type {Element|null} */
  let tailStart = null;
  if (!liEmpty && _hasOwnTextAfter(li, range, nested)) {
    tailStart = _splitListItemKeepingNested(li, range);
  } else {
    tailStart = li.nextElementSibling;
  }
  if (liEmpty) li.remove();

  if (tailStart) {
    const rest = document.createElement(list.tagName);
    const kind = list.getAttribute('data-list');
    if (kind) rest.setAttribute('data-list', kind);
    if (list.tagName === 'OL') {
      const start = parseInt(list.getAttribute('start') ?? '1', 10) || 1;
      const before = Array.from(list.children).indexOf(tailStart);
      const next = start + (before < 0 ? 0 : before);
      if (next > 1) rest.setAttribute('start', String(next));
    }
    /** @type {Element|null} */
    let move = tailStart;
    while (move) {
      /** @type {Element|null} */
      const after = move.nextElementSibling;
      rest.appendChild(move);
      move = after;
    }
    list.after(rest);
    rest.before(...blocks);
  } else {
    list.after(...blocks);
  }

  if (!list.children.length) list.remove();
  _caretAtEnd(blocks[blocks.length - 1], sel);
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

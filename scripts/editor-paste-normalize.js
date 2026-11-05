// @ts-check
/**
 * editor-paste-normalize.js — porządkuje HTML ze schowka PRZED sanitizeHTML
 *
 * sanitizeHTML pilnuje bezpieczeństwa (whitelist tagów i atrybutów), ale nie
 * rozumie struktury. Ten moduł tłumaczy to, co produkują inne aplikacje, na
 * prosty HTML edytora — póki jeszcze widać atrybuty style, które sanityzacja
 * i tak by wycięła:
 *
 *  - Outlook desktop / Word: listy to akapity z `mso-list:l0 level2`, a znak
 *    punktora (·, o, §, "1.") siedzi w treści. Robimy z nich <ul>/<ol>
 *    z zagnieżdżeniem według poziomu.
 *  - Outlook Web, Google Docs: pogrubienie/kursywa/podkreślenie zapisane
 *    w style="font-weight:700" → <strong>/<em>/<u>/<s>. Google Docs owija
 *    całość w <b style="font-weight:normal"> — bez zdjęcia tej otoczki cała
 *    wklejka byłaby pogrubiona.
 *  - Strony WWW: <article>, <section>, <div>… → akapity; h4–h6 → h3;
 *    tabele → wiersz jako akapit "komórka | komórka".
 *  - Listy: <ul><li/><ul>…</ul></ul> → podlista w punkcie; bloki w <li>
 *    (<li><p>…</p></li>) → treść inline, bo edytor zakłada li = tekst + podlista.
 *
 * Czysta funkcja na stringach: parsuje w odłączonym dokumencie (DOMParser),
 * nie dotyka strony. Wynik ZAWSZE przechodzi potem przez sanitizeHTML.
 */

import { DROPPED_TAGS } from './sanitize.js';
import { _normalizeListNesting } from './editor-selection.js';

const ELEMENT = 1;
const TEXT = 3;
const SHOW_TEXT = 0x4;
const SHOW_COMMENT = 0x80;

/** Elementy blokowe — granice akapitów przy porządkowaniu struktury. */
const BLOCK_TAGS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI',
  'BLOCKQUOTE', 'PRE', 'HR', 'DETAILS', 'SUMMARY', 'TABLE', 'THEAD', 'TBODY',
  'TFOOT', 'TR', 'TD', 'TH', 'CAPTION', 'SECTION', 'ARTICLE', 'HEADER',
  'FOOTER', 'MAIN', 'NAV', 'ASIDE', 'FIGURE', 'FIGCAPTION', 'ADDRESS', 'DL',
  'DT', 'DD', 'CENTER', 'FORM', 'FIELDSET', 'LEGEND', 'HGROUP',
]);

/**
 * Opakowania bez własnego znaczenia. Z blokami w środku — rozpakowujemy;
 * z samym tekstem — stają się akapitem (dwa sąsiednie <section>Tekst</section>
 * po zwykłym rozpakowaniu skleiłyby się w jedną linię).
 */
const WRAPPER_TAGS = new Set([
  'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'NAV', 'ASIDE',
  'FIGURE', 'CENTER', 'FORM', 'FIELDSET', 'DL', 'HGROUP',
]);

/** Bloki tekstowe, które w edytorze są po prostu akapitem. */
const PARA_TAGS = new Set(['DT', 'DD', 'FIGCAPTION', 'CAPTION', 'LEGEND', 'ADDRESS']);

/** Inline bez odpowiednika w edytorze — zamiana na najbliższy dozwolony tag. */
/** @type {Record<string, string>} */
const INLINE_RENAME = {
  DEL: 's',
  INS: 'u',
  TT: 'code',
  KBD: 'code',
  SAMP: 'code',
  CITE: 'em',
  DFN: 'em',
  VAR: 'em',
};

/** Akapit z Worda/Outlooka będący punktem listy: `mso-list:l0 level2 lfo1`. */
const MSO_LIST_RX = /mso-list\s*:\s*(l\d+)\s+level(\d+)/i;
const MSO_IGNORE_RX = /mso-list\s*:\s*ignore/i;
/** Znacznik numerowany: "1.", "a)", "(iv)", "IV." — "o" bez kropki to punktor. */
const ORDERED_MARKER_RX = /^\(?(\d+|[a-z]{1,4})[.)]/i;
/**
 * Znacznik wpisany jako zwykły tekst (Outlook bez spanu mso-list:Ignore).
 * Bez litery "o" — to też polski przyimek na początku zdania.
 */
const TEXT_MARKER_RX =
  /^[\s ]*([·•▪●◦–§-]|\(?\d{1,3}[.)])[\s ]+/;

/**
 * @param {string} html surowy text/html ze schowka
 * @returns {string} uporządkowany HTML (jeszcze NIE sanityzowany)
 */
export function normalizePastedHTML(html) {
  if (!html || typeof html !== 'string') return '';

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.body;

  _removeJunk(root);
  _convertWordLists(root, doc);
  _applyInlineStyles(root, doc);
  _simplifyInline(root, doc);
  _convertTables(root, doc);
  _blockify(root, doc);
  _normalizeListNesting(root);
  root.querySelectorAll('ul, ol').forEach((l) => _normalizeList(l, doc));
  _tidyEmptyParagraphs(root, doc);
  _normalizeWhitespace(root, doc);

  return root.innerHTML;
}

/* ── Śmieci: komentarze, skrypty, style ───────────────────────── */

/** @param {Element} root */
function _removeJunk(root) {
  const doc = root.ownerDocument;
  // Komentarze — także warunkowe z Worda (<![if !supportLists]>). Treść
  // MIĘDZY nimi zostaje: tam siedzi znak punktora, który zdejmuje
  // _takeWordMarker.
  const walker = doc.createTreeWalker(root, SHOW_COMMENT);
  /** @type {Node[]} */
  const comments = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  comments.forEach((c) => c.parentNode?.removeChild(c));

  // <style> w treści maila wkleiłby arkusz CSS jako tekst notatki
  root.querySelectorAll('*').forEach((el) => {
    if (DROPPED_TAGS.has(el.tagName.toUpperCase()) || el.tagName === 'IMG') {
      el.remove();
    }
  });
}

/* ── Listy z Worda / Outlooka ─────────────────────────────────── */

/** @param {Element} root @param {Document} doc */
function _convertWordLists(root, doc) {
  const marked = Array.from(root.querySelectorAll('[style]')).filter(
    (el) =>
      /^(P|DIV|H[1-6])$/.test(el.tagName) &&
      !el.closest('li') &&
      MSO_LIST_RX.test(el.getAttribute('style') ?? ''),
  );

  // Numerowane nagłówki Worda ("1. Wstęp") zostają nagłówkami — numer
  // przenosimy do tekstu, bo lista zrobiłaby z nich zwykłe punkty.
  for (const h of marked.filter((el) => /^H/.test(el.tagName))) {
    const marker = _takeWordMarker(h);
    if (ORDERED_MARKER_RX.test(marker)) h.prepend(doc.createTextNode(`${marker} `));
  }

  const items = marked.filter((el) => !/^H/.test(el.tagName));
  if (!items.length) return;

  const itemSet = new Set(items);
  const done = new Set();
  for (const first of items) {
    if (done.has(first)) continue;
    // Ciąg sąsiednich punktów; dowolny inny element przerywa listę
    const run = [first];
    for (let n = first.nextSibling; n; n = n.nextSibling) {
      if (n.nodeType === TEXT && !(n.textContent ?? '').trim()) continue;
      if (n.nodeType === ELEMENT && itemSet.has(/** @type {Element} */ (n))) {
        run.push(/** @type {Element} */ (n));
        continue;
      }
      break;
    }
    run.forEach((el) => done.add(el));
    _buildWordList(run, doc);
  }
}

/**
 * Składa ciąg akapitów-punktów w zagnieżdżone listy. Stos list według
 * poziomu; skok o kilka poziomów naraz (level1 → level3) przycinamy do
 * jednego, żeby nie tworzyć pustych punktów-pośredników.
 *
 * @param {Element[]} run
 * @param {Document} doc
 */
function _buildWordList(run, doc) {
  /** @type {{ list: Element, ordered: boolean, id: string }[]} */
  const stack = [];

  for (const el of run) {
    const m = MSO_LIST_RX.exec(el.getAttribute('style') ?? '');
    if (!m) continue;
    const id = m[1].toLowerCase();
    const marker = _takeWordMarker(el);
    const ordered = ORDERED_MARKER_RX.test(marker);
    const start = ordered ? parseInt(marker.replace(/^\(/, ''), 10) : NaN;

    const level = Math.min(Math.max(parseInt(m[2], 10) || 1, 1), stack.length + 1);
    while (stack.length > level) stack.pop();
    if (stack.length === level) {
      const top = stack[level - 1];
      // Inny rodzaj listy na tym samym poziomie albo nowa lista Worda
      // (inne lN) na najwyższym poziomie → zaczynamy nową listę
      if (top.ordered !== ordered || (level === 1 && top.id !== id)) stack.pop();
    }
    if (stack.length < level) {
      const list = doc.createElement(ordered ? 'ol' : 'ul');
      if (ordered && start > 1) list.setAttribute('start', String(start));
      if (stack.length === 0) el.before(list);
      else stack[stack.length - 1].list.lastElementChild?.appendChild(list);
      stack.push({ list, ordered, id });
    }

    const li = doc.createElement('li');
    while (el.firstChild) li.appendChild(el.firstChild);
    stack[stack.length - 1].list.appendChild(li);
    el.remove();
  }
}

/**
 * Zdejmuje z punktu znak punktora/numer i zwraca jego tekst.
 * Outlook wstawia go w <span style="mso-list:Ignore">·&nbsp;&nbsp;…</span>.
 *
 * @param {Element} el
 * @returns {string}
 */
function _takeWordMarker(el) {
  const ignored = Array.from(el.querySelectorAll('[style]')).filter((s) =>
    MSO_IGNORE_RX.test(s.getAttribute('style') ?? ''),
  );
  if (ignored.length) {
    const text = ignored.map((s) => s.textContent ?? '').join('');
    ignored.forEach((s) => s.remove());
    return text.replace(/[\s ]+/g, ' ').trim();
  }

  // Fallback: znacznik jako zwykły tekst na początku akapitu
  const walker = el.ownerDocument.createTreeWalker(el, SHOW_TEXT);
  /** @type {Node|null} */
  let first = walker.nextNode();
  while (first && !(first.textContent ?? '').trim()) first = walker.nextNode();
  if (!first) return '';
  const m = TEXT_MARKER_RX.exec(first.textContent ?? '');
  if (!m) return '';
  first.textContent = (first.textContent ?? '').slice(m[0].length);
  return m[1];
}

/* ── Formatowanie zapisane w style="" ─────────────────────────── */

/**
 * Wartość właściwości CSS z atrybutu style (małymi literami, bez !important).
 * @param {string} style
 * @param {string} prop
 */
function _css(style, prop) {
  for (const decl of style.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    if (decl.slice(0, i).trim().toLowerCase() === prop) {
      return decl.slice(i + 1).replace(/!important/i, '').trim().toLowerCase();
    }
  }
  return '';
}

/** @param {Element} root @param {Document} doc */
function _applyInlineStyles(root, doc) {
  for (const el of Array.from(root.querySelectorAll('[style]'))) {
    if (!el.isConnected) continue;
    const style = el.getAttribute('style') ?? '';
    const tag = el.tagName;

    const weight = _css(style, 'font-weight');
    const num = parseInt(weight, 10);
    const bold = weight === 'bold' || weight === 'bolder' || num >= 600;
    const notBold = weight === 'normal' || weight === 'lighter' || (num > 0 && num < 600);
    const fontStyle = _css(style, 'font-style');
    const deco = `${_css(style, 'text-decoration')} ${_css(style, 'text-decoration-line')}`;

    // Google Docs: <b style="font-weight:normal"> wokół CAŁEJ wklejki
    if ((tag === 'B' || tag === 'STRONG') && notBold) {
      _unwrap(el);
      continue;
    }
    if ((tag === 'I' || tag === 'EM') && fontStyle === 'normal') {
      _unwrap(el);
      continue;
    }
    // Nagłówki i tak są pogrubione; bloków nie da się owinąć w inline
    if (/^(H[1-6]|TH|TABLE|UL|OL)$/.test(tag) || _hasBlockDescendant(el)) continue;

    /** @type {string[]} */
    const wraps = [];
    if (bold && !el.closest('b, strong, h1, h2, h3, h4, h5, h6, th')) wraps.push('strong');
    if (/^(italic|oblique)/.test(fontStyle) && !el.closest('i, em')) wraps.push('em');
    // Linki są podkreślone z natury — nie dokładamy <u>
    if (/underline/.test(deco) && !el.closest('u, a')) wraps.push('u');
    if (/line-through/.test(deco) && !el.closest('s, strike, del')) wraps.push('s');

    for (const t of wraps.reverse()) {
      const w = doc.createElement(t);
      while (el.firstChild) w.appendChild(el.firstChild);
      el.appendChild(w);
    }
  }
}

/** Rozpakowuje span/font i tagi z przestrzeni nazw Office (o:p), mapuje del/kbd…
 * @param {Element} root @param {Document} doc */
function _simplifyInline(root, doc) {
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const tag = el.tagName;
    if (tag === 'SPAN' || tag === 'FONT' || tag.includes(':')) {
      _unwrap(el);
    } else if (INLINE_RENAME[tag]) {
      _rename(el, INLINE_RENAME[tag], doc);
    }
  }
}

/* ── Tabele ───────────────────────────────────────────────────── */

/**
 * Tabela → akapity. Wiersz z prostych komórek to jeden akapit
 * "komórka | komórka" (nagłówki pogrubione). Komórki z większą treścią
 * (tabele układu w mailach, stopki) dostają własne bloki.
 * Od najgłębszych — zagnieżdżona tabela musi być już blokami, zanim
 * oceniamy komórkę, w której siedzi.
 *
 * @param {Element} root @param {Document} doc
 */
function _convertTables(root, doc) {
  const tables = Array.from(root.querySelectorAll('table'));
  tables.sort((a, b) => _depth(b) - _depth(a));

  for (const table of tables) {
    /** @type {Node[]} */
    const out = [];
    const caption = Array.from(table.children).find((c) => c.tagName === 'CAPTION');
    if (caption && (caption.textContent ?? '').trim()) {
      out.push(_rename(caption, 'p', doc));
    }

    const rows = Array.from(table.querySelectorAll('tr')).filter(
      (tr) => tr.closest('table') === table,
    );
    for (const tr of rows) {
      const cells = Array.from(tr.children).filter(
        (c) => c.tagName === 'TD' || c.tagName === 'TH',
      );
      const simple = cells.every(_isSimpleCell);
      if (simple) {
        const filled = cells.filter((c) => (c.textContent ?? '').replace(/[\s ]+/g, ''));
        if (!filled.length) continue;
        const p = doc.createElement('p');
        filled.forEach((cell, i) => {
          if (i) p.appendChild(doc.createTextNode(' | '));
          /** @type {Element} */
          let target = p;
          if (cell.tagName === 'TH') {
            target = doc.createElement('strong');
            p.appendChild(target);
          }
          _moveSimpleCellContent(cell, target);
        });
        out.push(p);
      } else {
        // Każda komórka osobno — DIV rozstrzygnie _blockify (akapit albo bloki)
        for (const cell of cells) {
          const box = doc.createElement('div');
          while (cell.firstChild) box.appendChild(cell.firstChild);
          out.push(box);
        }
      }
    }
    table.replaceWith(...out);
  }
}

/**
 * Komórka "prosta": sam tekst/inline albo dokładnie jeden akapit (Word owija
 * treść każdej komórki w <p class=MsoNormal>).
 * @param {Element} cell
 */
function _isSimpleCell(cell) {
  const blocks = Array.from(cell.children).filter(_isBlock);
  if (!blocks.length) return true;
  if (blocks.length > 1) return false;
  const only = blocks[0];
  if (!/^(P|DIV)$/.test(only.tagName) || _hasBlockDescendant(only)) return false;
  // Poza tym jednym akapitem tylko białe znaki
  return Array.from(cell.childNodes).every(
    (n) => n === only || (n.nodeType === TEXT && !(n.textContent ?? '').trim()),
  );
}

/** @param {Element} cell @param {Element} target */
function _moveSimpleCellContent(cell, target) {
  const only = Array.from(cell.children).find(_isBlock);
  const src = only ?? cell;
  while (src.firstChild) target.appendChild(src.firstChild);
}

/* ── Struktura bloków ─────────────────────────────────────────── */

/**
 * Doprowadza kontener do postaci, którą rozumie edytor: same bloki
 * (p, h1–h3, listy, cytat, kod, hr, toggle) albo — gdy w środku nie ma
 * żadnego bloku — sam inline (wklejenie fragmentu zdania).
 *
 * @param {Element} container @param {Document} doc
 */
function _blockify(container, doc) {
  for (const child of Array.from(container.childNodes)) {
    if (child.nodeType !== ELEMENT) continue;
    let el = /** @type {Element} */ (child);
    const tag = el.tagName;

    if (tag === 'PRE') {
      _normalizePre(el, doc);
      continue;
    }
    if (tag === 'DETAILS' || tag === 'HR' || tag === 'UL' || tag === 'OL') continue;
    if (/^H[4-6]$/.test(tag)) {
      el = _rename(el, 'h3', doc);
    } else if (PARA_TAGS.has(tag)) {
      el = _rename(el, 'p', doc);
    }

    if (/^(P|H[1-3])$/.test(el.tagName)) {
      // Blok w akapicie (np. po rozpakowaniu) — wyciągamy na zewnątrz
      if (_hasBlockChild(el)) _hoist(el, doc);
      continue;
    }
    if (el.tagName === 'BLOCKQUOTE') {
      _blockify(el, doc);
      continue;
    }
    if (WRAPPER_TAGS.has(el.tagName) || el.tagName === 'LI') {
      // LI poza listą (zgubiony rodzic) traktujemy jak opakowanie
      if (_hasBlockChild(el)) {
        _hoist(el, doc);
      } else if (_isBlank(el)) {
        el.remove();
      } else {
        _rename(el, 'p', doc);
      }
      continue;
    }
    // Inline z blokami w środku (<a><div>…</div></a>, <b><p>…</p></b>):
    // zachowanie bloków jest ważniejsze niż formatowanie otoczki
    if (_hasBlockDescendant(el)) _hoist(el, doc);
  }
  _wrapInlineRuns(container, doc);
}

/**
 * Porządkuje wnętrze elementu i zastępuje go jego dziećmi.
 * @param {Element} el @param {Document} doc
 */
function _hoist(el, doc) {
  _blockify(el, doc);
  el.replaceWith(...Array.from(el.childNodes));
}

/**
 * Gdy w kontenerze są bloki, luźny tekst/inline między nimi trafia do
 * własnego <p>. Same białe znaki (wcięcia z kodu źródłowego) znikają.
 * @param {Element} container @param {Document} doc
 */
function _wrapInlineRuns(container, doc) {
  if (!_hasBlockChild(container)) return;
  /** @type {Node[]} */
  let run = [];
  /** @param {Node|null} before */
  const flush = (before) => {
    const meaningful = run.some(
      (n) => n.nodeType === ELEMENT || /[^\s ]/.test(n.textContent ?? ''),
    );
    if (meaningful) {
      const p = doc.createElement('p');
      run.forEach((n) => p.appendChild(n));
      container.insertBefore(p, before);
    } else {
      run.forEach((n) => n.parentNode?.removeChild(n));
    }
    run = [];
  };
  for (const n of Array.from(container.childNodes)) {
    if (n.nodeType === ELEMENT && _isBlock(/** @type {Element} */ (n))) {
      if (run.length) flush(n);
    } else if (n.nodeType === ELEMENT || n.nodeType === TEXT) {
      run.push(n);
    }
  }
  if (run.length) flush(null);
}

/**
 * <pre> ze strony: bez <code> w środku → owijamy (edytor tworzy pre>code),
 * klasa language-js → data-language (używane przy eksporcie do Markdown).
 * @param {Element} pre @param {Document} doc
 */
function _normalizePre(pre, doc) {
  let code = pre.querySelector(':scope > code');
  if (!code) {
    code = doc.createElement('code');
    while (pre.firstChild) code.appendChild(pre.firstChild);
    pre.appendChild(code);
  }
  const lang = /(?:^|\s)(?:lang|language)-([\w+#-]+)/.exec(
    `${code.className} ${pre.className}`,
  );
  if (lang && !code.hasAttribute('data-language')) {
    code.setAttribute('data-language', lang[1]);
  }
}

/* ── Listy ────────────────────────────────────────────────────── */

/**
 * Lista zawiera wyłącznie <li>; <li> zawiera tekst/inline i podlisty.
 * Bloki wewnątrz punktu (<li><p>A</p><p>B</p></li>, <li><div>…</div></li>
 * z Outlook Web) zamieniamy na treść inline rozdzieloną <br> — Enter,
 * Backspace i eksport do Markdown zakładają właśnie taki kształt.
 *
 * @param {Element} list @param {Document} doc
 */
function _normalizeList(list, doc) {
  for (const child of Array.from(list.childNodes)) {
    if (child.nodeType === TEXT) {
      if (!(child.textContent ?? '').trim()) child.remove();
      else _wrapIn(child, 'li', doc);
      continue;
    }
    if (child.nodeType !== ELEMENT) {
      child.remove();
      continue;
    }
    const el = /** @type {Element} */ (child);
    if (el.tagName === 'LI') _flattenLi(el, doc);
    else if (el.tagName !== 'UL' && el.tagName !== 'OL') _flattenLi(_wrapIn(el, 'li', doc), doc);
  }
}

/** @param {Element} li @param {Document} doc */
function _flattenLi(li, doc) {
  const KEEP = /^(UL|OL|PRE|BLOCKQUOTE|DETAILS)$/;
  let changed = true;
  while (changed) {
    changed = false;
    for (const child of Array.from(li.childNodes)) {
      if (child.nodeType !== ELEMENT) continue;
      const el = /** @type {Element} */ (child);
      if (!_isBlock(el) || KEEP.test(el.tagName)) continue;
      if (_inlineBefore(el)) el.before(doc.createElement('br'));
      el.replaceWith(...Array.from(el.childNodes));
      changed = true;
    }
  }
  // Białe znaki na brzegach (wcięcia ze źródła HTML)
  while (li.firstChild?.nodeType === TEXT && !(li.firstChild.textContent ?? '').trim()) {
    li.firstChild.remove();
  }
  // Punkt bez własnej treści jest nieedytowalny — patrz _splitBlockAtCaret
  const own = Array.from(li.childNodes).filter(
    (n) => !(n.nodeType === ELEMENT && /^(UL|OL)$/.test(/** @type {Element} */ (n).tagName)),
  );
  const hasOwn = own.some(
    (n) => n.nodeType === ELEMENT || /[^\s]/.test(n.textContent ?? ''),
  );
  if (!hasOwn) li.insertBefore(doc.createElement('br'), li.firstChild);
}

/**
 * Czy przed elementem (w obrębie rodzica) stoi treść inline, którą trzeba
 * oddzielić <br>, żeby nie skleiła się z treścią rozpakowanego bloku.
 * @param {Element} el
 */
function _inlineBefore(el) {
  for (let n = el.previousSibling; n; n = n.previousSibling) {
    if (n.nodeType === TEXT) {
      if ((n.textContent ?? '').trim()) return true;
      continue;
    }
    if (n.nodeType !== ELEMENT) continue;
    const prev = /** @type {Element} */ (n);
    if (prev.tagName === 'BR') return false;
    return !_isBlock(prev);
  }
  return false;
}

/* ── Puste akapity i białe znaki ──────────────────────────────── */

/**
 * Outlook rozdziela akapity <p>&nbsp;</p>. Zostawiamy je (to zamierzone
 * puste linie), ale w formie, którą tworzy sam edytor — <p><br></p> —
 * i bez pustych linii na początku i końcu wklejki.
 *
 * @param {Element} root @param {Document} doc
 */
function _tidyEmptyParagraphs(root, doc) {
  /** @param {Element} p */
  const blank = (p) => !(p.textContent ?? '').replace(/[\s ]+/g, '');
  for (const p of Array.from(root.querySelectorAll('p'))) {
    if (blank(p)) p.replaceChildren(doc.createElement('br'));
  }
  const trim = (/** @type {'firstElementChild'|'lastElementChild'} */ side) => {
    let el = root[side];
    while (el && el.tagName === 'P' && blank(el)) {
      el.remove();
      el = root[side];
    }
  };
  trim('firstElementChild');
  trim('lastElementChild');
}

/**
 * Word i Outlook zawijają kod źródłowy HTML co ~76 znaków — złamania linii
 * lądują w środku tekstu akapitu. W widoku znikają, ale "Kopiuj jako
 * Markdown" przenosiłby je dosłownie. Poza <pre> zamieniamy je na spację.
 *
 * @param {Element} root @param {Document} doc
 */
function _normalizeWhitespace(root, doc) {
  const walker = doc.createTreeWalker(root, SHOW_TEXT);
  /** @type {Node[]} */
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);
  for (const t of texts) {
    if (t.parentElement?.closest('pre')) continue;
    let v = t.textContent ?? '';
    if (!/[\r\n]/.test(v)) continue;
    v = v.replace(/[ \t]*[\r\n]+[ \t]*/g, ' ');
    // Przy <br> spacja z dawnego złamania linii byłaby wiszącym wcięciem
    if (t.previousSibling?.nodeName === 'BR') v = v.trimStart();
    if (t.nextSibling?.nodeName === 'BR') v = v.trimEnd();
    t.textContent = v;
  }
}

/* ── Drobne helpery DOM ───────────────────────────────────────── */

/** @param {Element} el */
function _isBlock(el) {
  return BLOCK_TAGS.has(el.tagName);
}

/** @param {Element} el */
function _hasBlockChild(el) {
  return Array.from(el.children).some(_isBlock);
}

/** @param {Element} el */
function _hasBlockDescendant(el) {
  return Array.from(el.querySelectorAll('*')).some(_isBlock);
}

/** Ani tekstu (poza białymi znakami), ani <br>. @param {Element} el */
function _isBlank(el) {
  return !(el.textContent ?? '').trim() && !el.querySelector('br');
}

/** @param {Element} el */
function _unwrap(el) {
  el.replaceWith(...Array.from(el.childNodes));
}

/**
 * Zmienia tag elementu, przenosząc dzieci. Atrybuty przepadają celowo —
 * i tak nie przeszłyby sanityzacji.
 * @param {Element} el @param {string} tag @param {Document} doc
 * @returns {Element} nowy element
 */
function _rename(el, tag, doc) {
  const next = doc.createElement(tag);
  while (el.firstChild) next.appendChild(el.firstChild);
  el.replaceWith(next);
  return next;
}

/**
 * @param {Node} node @param {string} tag @param {Document} doc
 * @returns {Element}
 */
function _wrapIn(node, tag, doc) {
  const w = doc.createElement(tag);
  node.parentNode?.insertBefore(w, node);
  w.appendChild(node);
  return w;
}

/** @param {Element} el */
function _depth(el) {
  let d = 0;
  for (let p = el.parentElement; p; p = p.parentElement) d++;
  return d;
}

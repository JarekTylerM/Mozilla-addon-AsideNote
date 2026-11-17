// @ts-check
/* ══════════════════════════════════════════════════════════════
   editor-copy-export.js — HTML do schowka, który rozumieją inne narzędzia
   ──────────────────────────────────────────────────────────────
   Używane przez:
   - editor.js::_handleCopy        (prepareExportHTML — przy kopiowaniu)
   - editor-paste-normalize.js     (restoreExportMarkers — przy wklejaniu)

   Skąd to się wzięło: eksperyment AsideNote → ClickUp / Outlook
   (tests/fixtures/clipboard). Z czystego HTML-a notatki:
     - ClickUp gubił pogrubienie, przekreślenie i nagłówki, a blok kodu
       zlewał w jedną linię (łamania są tam jako <br>),
     - Outlook gubił przekreślenie,
     - oba wycinały rozwijany blok RAZEM z treścią i gubiły stan checklisty
       oraz rodzaj calloutu.

   Dlatego HTML do schowka dostaje formy, które obce edytory czytają:
   styl inline obok znacznika, \n zamiast <br> w kodzie, ☐/☑ przed punktem
   checklisty, etykietę calloutu i rozwijany blok jako zwykłe akapity.

   Z powrotem w AsideNote (kopiuj-wklej w obrębie notatek) oryginał wraca:
   wszystko, co dołożone, jest oznaczone atrybutem data-an i usuwane przy
   wklejaniu (restoreExportMarkers), zanim zadziała sanityzacja. Obce
   narzędzia atrybuty gubią, ale zostaje tekst — ☐/☑ zamieniają się wtedy
   z powrotem w checklistę.
   ══════════════════════════════════════════════════════════════ */

/** Style inline dublujące znaczniki — dla edytorów czytających tylko CSS. */
const INLINE_STYLES = {
  STRONG: 'font-weight:bold',
  B: 'font-weight:bold',
  EM: 'font-style:italic',
  I: 'font-style:italic',
  U: 'text-decoration:underline',
  S: 'text-decoration:line-through',
  STRIKE: 'text-decoration:line-through',
  H1: 'font-size:2em;font-weight:bold',
  H2: 'font-size:1.5em;font-weight:bold',
  H3: 'font-size:1.17em;font-weight:bold',
};

const CHECKED = '☑';
const UNCHECKED = '☐';
/** Znak stanu na początku punktu: ze schowka obcego narzędzia albo wpisany ręcznie. */
const CHECK_GLYPH_RX = /^[\s ]*([☐☑☒✅✔✓])[\s ]+/;

/**
 * HTML skopiowanego fragmentu notatki w formie dla innych narzędzi.
 *
 * Pracuje na kopii w osobnym, pustym dokumencie: CSP rozszerzenia
 * (style-src 'self') zgłasza naruszenie przy każdym atrybucie style
 * ustawionym w dokumencie strony — tutaj style są tylko tekstem do schowka.
 * Oryginalny `wrap` zostaje nietknięty.
 *
 * @param {Element} wrap kontener ze sklonowanym zaznaczeniem
 * @param {(type: string) => string} labelFor domyślna etykieta calloutu ("note" → "Notatka")
 * @returns {string} HTML do text/html
 */
export function prepareExportHTML(wrap, labelFor) {
  const doc = /** @type {Document} */ (wrap.ownerDocument).implementation.createHTMLDocument('');
  wrap = /** @type {Element} */ (doc.importNode(wrap, true));
  _exportInPlace(wrap, doc, labelFor);
  return wrap.innerHTML;
}

/**
 * @param {Element} wrap @param {Document} doc
 * @param {(type: string) => string} labelFor
 */
function _exportInPlace(wrap, doc, labelFor) {

  for (const el of Array.from(wrap.querySelectorAll('*'))) {
    const style = INLINE_STYLES[/** @type {keyof typeof INLINE_STYLES} */ (el.tagName)];
    if (style && !el.hasAttribute('style')) el.setAttribute('style', style);
  }

  // Kod: łamania jako \n — ClickUp czyta z <pre> sam tekst i <br> ginął
  for (const code of Array.from(wrap.querySelectorAll('pre code, pre'))) {
    if (code.tagName === 'PRE' && code.querySelector('code')) continue;
    if (!code.querySelector('br')) continue;
    code.textContent = _textWithBreaks(code);
    code.setAttribute('data-an', 'code-nl');
  }

  for (const li of Array.from(wrap.querySelectorAll('li[data-checked]'))) {
    const mark = doc.createElement('span');
    mark.setAttribute('data-an', 'check');
    mark.textContent = `${li.getAttribute('data-checked') === 'true' ? CHECKED : UNCHECKED} `;
    li.prepend(mark);
  }

  for (const bq of Array.from(wrap.querySelectorAll('blockquote[data-callout]'))) {
    const type = bq.getAttribute('data-callout') ?? '';
    const label = bq.getAttribute('data-callout-label') || labelFor(type);
    if (!label) continue;
    const mark = doc.createElement('strong');
    mark.setAttribute('data-an', 'mark');
    mark.setAttribute('style', INLINE_STYLES.STRONG);
    mark.textContent = `${label}: `;
    (bq.querySelector(':scope > p') ?? bq).prepend(mark);
  }

  // Od najgłębszych — zagnieżdżony rozwijany blok zamienia się pierwszy
  for (const details of Array.from(wrap.querySelectorAll('details')).reverse()) {
    const box = doc.createElement('div');
    box.setAttribute('data-an', 'details');
    if (details.hasAttribute('open')) box.setAttribute('data-an-open', '');

    const head = doc.createElement('p');
    head.setAttribute('data-an', 'summary');
    const arrow = doc.createElement('span');
    arrow.setAttribute('data-an', 'mark');
    arrow.textContent = '▸ ';
    const title = doc.createElement('strong');
    title.setAttribute('data-an', 'summary-text');
    title.setAttribute('style', INLINE_STYLES.STRONG);
    const summary = details.querySelector(':scope > summary');
    if (summary) title.append(...Array.from(summary.childNodes));
    head.append(arrow, title);

    box.append(head, ...Array.from(details.childNodes).filter((n) => n !== summary));
    details.replaceWith(box);
  }
}

/**
 * Cofa prepareExportHTML przy wklejaniu i rozpoznaje ☐/☑ z obcych narzędzi.
 * Wołane w normalizePastedHTML przed resztą porządków.
 * @param {Element} root
 * @param {Document} doc
 */
export function restoreExportMarkers(root, doc) {
  for (const box of Array.from(root.querySelectorAll('div[data-an="details"]')).reverse()) {
    const details = doc.createElement('details');
    if (box.hasAttribute('data-an-open')) details.setAttribute('open', '');
    const summary = doc.createElement('summary');
    const head = box.querySelector(':scope > p[data-an="summary"]');
    if (head) {
      head.querySelectorAll('[data-an="mark"]').forEach((m) => m.remove());
      const title = head.querySelector('[data-an="summary-text"]') ?? head;
      summary.append(...Array.from(title.childNodes));
      head.remove();
    }
    details.append(summary, ...Array.from(box.childNodes));
    box.replaceWith(details);
  }
  root.querySelectorAll('[data-an="mark"], [data-an="check"]').forEach((m) => m.remove());

  // Kod z notatki: \n wraca do <br>, czyli formatu, w którym edytor łamie linie
  for (const code of Array.from(root.querySelectorAll('[data-an="code-nl"]'))) {
    const lines = (code.textContent ?? '').split('\n');
    code.textContent = '';
    lines.forEach((line, i) => {
      if (i) code.appendChild(doc.createElement('br'));
      if (line) code.appendChild(doc.createTextNode(line));
    });
    code.removeAttribute('data-an');
  }

  // Cytat zaczęty pogrubioną etykietą calloutu ("Notatka: …") — tak callout
  // wraca z ClickUp i Outlooka po eksporcie. Etykieta własna (data-callout-label)
  // nie ma odpowiednika, więc zostaje tekstem.
  for (const bq of Array.from(root.querySelectorAll('blockquote:not([data-callout])'))) {
    const first = bq.firstElementChild;
    const block = first && /^(P|DIV)$/.test(first.tagName) ? first : bq;
    const label = _leadingBold(block);
    const type = label ? CALLOUT_BY_LABEL.get(_labelKey(label.textContent ?? '')) : undefined;
    if (!label || !type) continue;
    bq.setAttribute('data-callout', type);
    const next = label.nextSibling;
    label.remove();
    if (next?.nodeType === 3) next.textContent = (next.textContent ?? '').replace(/^\s+/, '');
  }

  // ☐/☑ na początku punktu (Outlook, ClickUp, tekst wpisany ręcznie) → checklista
  for (const li of Array.from(root.querySelectorAll('li'))) {
    const first = _firstText(li);
    const m = first ? CHECK_GLYPH_RX.exec(first.textContent ?? '') : null;
    if (!first || !m) continue;
    li.setAttribute('data-checked', m[1] === UNCHECKED ? 'false' : 'true');
    first.textContent = (first.textContent ?? '').slice(m[0].length);
  }
  // Tylko lista najwyższego poziomu — podlista checklisty nie ma własnego
  // znacznika. Outlook stawia podlistę OBOK punktu (ul > ul), więc samo
  // closest('li') nie wystarcza.
  for (const list of Array.from(root.querySelectorAll('ul'))) {
    if (list.parentElement?.closest('ul, ol')) continue;
    if (list.querySelector(':scope > li[data-checked]')) list.setAttribute('data-list', 'checklist');
  }
}

/**
 * Etykiety calloutów w obu językach interfejsu (_locales: callout_*) → typ.
 * Klucz bez dwukropka i wielkości liter.
 */
const CALLOUT_BY_LABEL = new Map([
  ['notatka', 'note'], ['note', 'note'],
  ['wskazówka', 'tip'], ['tip', 'tip'],
  ['ważne', 'important'], ['important', 'important'],
  ['ostrzeżenie', 'warning'], ['warning', 'warning'],
  ['uwaga', 'caution'], ['caution', 'caution'],
]);

/** "Notatka: " → "notatka"; bez dwukropka na końcu → "" (to nie etykieta). @param {string} text */
function _labelKey(text) {
  const m = /^\s*(.+?)\s*:\s*$/.exec(text);
  return m ? m[1].toLowerCase() : '';
}

/**
 * Pogrubienie stojące na samym początku bloku (przed nim tylko białe znaki).
 * @param {Element} block
 * @returns {Element|null}
 */
function _leadingBold(block) {
  for (const node of Array.from(block.childNodes)) {
    if (node.nodeType === 3) {
      if ((node.textContent ?? '').trim()) return null;
      continue;
    }
    const el = /** @type {Element} */ (node);
    return /^(STRONG|B)$/.test(el.tagName) ? el : null;
  }
  return null;
}

/** @param {Element} el */
function _firstText(el) {
  const walker = /** @type {Document} */ (el.ownerDocument).createTreeWalker(el, 4 /* SHOW_TEXT */);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if ((node.textContent ?? '').trim()) return node;
  }
  return null;
}

/** @param {Element} el */
function _textWithBreaks(el) {
  let out = '';
  /** @param {Node} node */
  const walk = (node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) out += child.textContent ?? '';
      else if (/** @type {Element} */ (child).tagName === 'BR') out += '\n';
      else walk(child);
    }
  };
  walk(el);
  return out;
}

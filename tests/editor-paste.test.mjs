/**
 * editor-paste.test.mjs — wklejanie: normalizacja HTML ze schowka
 * (Outlook, Google Docs, strony WWW) + wstawianie w miejscu kursora.
 *
 * Próbki HTML odwzorowują to, co te aplikacje kładą do schowka:
 *  - Outlook desktop / Word: akapity MsoListParagraph z `mso-list:l0 level2`
 *    i znakiem punktora w <span style="mso-list:Ignore">,
 *  - Outlook Web: <li><div role="presentation">, style w spanach,
 *  - Google Docs: otoczka <b style="font-weight:normal">, <ul> wprost w <ul>.
 *
 * Uruchomienie: node tests/editor-paste.test.mjs
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const _dom = new JSDOM(
  '<!DOCTYPE html><body><div id="editor" contenteditable="true"></div></body>',
  { pretendToBeVisual: true },
);
global.window = _dom.window;
global.document = _dom.window.document;
global.Node = _dom.window.Node;
global.NodeFilter = _dom.window.NodeFilter;
global.DOMParser = _dom.window.DOMParser;

import { readFileSync } from 'fs';
import { test, expect, results } from './_runner.mjs';
import {
  normalizePastedHTML,
  restoreCopiedListContext,
} from '../scripts/editor-paste-normalize.js';
import { insertPastedHTML } from '../scripts/editor-paste-insert.js';
import { sanitizeHTML, sanitizeHTMLToBody } from '../scripts/sanitize.js';
import { preprocessClickUp } from '../scripts/editor-paste-clickup.js';

/** Pełna ścieżka wklejki HTML: normalizacja → sanityzacja. */
const clean = (html) => sanitizeHTML(normalizePastedHTML(html));

const editor = () => document.getElementById('editor');

/**
 * Ustawia treść edytora, stawia kursor i wkleja HTML.
 * caret: [selektor, offset w pierwszym węźle tekstowym] albo 'end' (koniec ostatniego bloku).
 */
function paste(setup, html, caret = 'end') {
  const ed = editor();
  ed.innerHTML = setup;
  const sel = window.getSelection();
  const r = document.createRange();
  if (caret === 'end') {
    const last = ed.lastElementChild ?? ed;
    r.selectNodeContents(last);
    r.collapse(false);
  } else {
    const [selector, offset] = caret;
    const el = ed.querySelector(selector);
    const walker = document.createTreeWalker(el, 4);
    const text = walker.nextNode();
    if (text) r.setStart(text, offset);
    else r.setStart(el, 0);
    r.collapse(true);
  }
  sel.removeAllRanges();
  sel.addRange(r);
  insertPastedHTML(ed, clean(html));
  return ed.innerHTML;
}

/* ── Strony WWW ───────────────────────────────────────────────── */

console.log('\n1. Strony WWW');

test('<article>/<section> nie spłaszczają treści do jednej linii', () => {
  const out = clean(
    '<article><h2>Instrukcja</h2><section><p>Wstęp z <strong>pogrubieniem</strong> i <a href="https://example.com">linkiem</a>.</p>' +
      '<ul><li>Punkt 1<ul><li>Podpunkt 1.1</li></ul></li><li>Punkt 2</li></ul></section></article>',
  );
  expect(out).toContain('<h2>Instrukcja</h2>');
  expect(out).toContain('<strong>pogrubieniem</strong>');
  expect(out).toContain('href="https://example.com"');
  expect(out).toContain('<ul><li>Punkt 1<ul><li>Podpunkt 1.1</li></ul></li><li>Punkt 2</li></ul>');
});

test('sąsiednie opakowania z samym tekstem → osobne akapity, nie sklejone', () => {
  expect(clean('<section>Pierwszy</section><section>Drugi</section><p>Trzeci</p>')).toBe(
    '<p>Pierwszy</p><p>Drugi</p><p>Trzeci</p>',
  );
});

test('h4–h6 → h3; dt/dd → akapity', () => {
  expect(clean('<h4>Mały</h4><dl><dt>Termin</dt><dd>Definicja</dd></dl>')).toBe(
    '<h3>Mały</h3><p>Termin</p><p>Definicja</p>',
  );
});

test('prosta tabela → wiersz jako "komórka | komórka", nagłówki pogrubione', () => {
  const out = clean(
    '<table><thead><tr><th>Parametr</th><th>Wartość</th></tr></thead>' +
      '<tbody><tr><td>Ciśnienie</td><td><b>6 bar</b></td></tr></tbody></table>',
  );
  expect(out).toBe(
    '<p><strong>Parametr</strong> | <strong>Wartość</strong></p><p>Ciśnienie | <b>6 bar</b></p>',
  );
});

test('komórki Worda (jeden <p> w komórce) nadal tworzą wiersz', () => {
  const out = clean(
    '<table><tr><td><p class=MsoNormal>Temp.<o:p></o:p></p></td><td><p class=MsoNormal>80°C<o:p></o:p></p></td></tr></table>',
  );
  expect(out).toBe('<p>Temp. | 80°C</p>');
});

test('stopka w tabeli (kilka akapitów w komórce) → osobne linie', () => {
  const out = clean(
    '<table><tr><td><p><b>Jan Kowalski</b></p><p>Kierownik</p></td></tr></table>',
  );
  expect(out).toBe('<p><b>Jan Kowalski</b></p><p>Kierownik</p>');
});

test('zagnieżdżone tabele układu (newslettery) → bloki, bez sklejania', () => {
  const out = clean(
    '<table><tr><td><table><tr><td><h2>Nagłówek</h2><p>Treść</p></td></tr></table></td></tr></table>',
  );
  expect(out).toBe('<h2>Nagłówek</h2><p>Treść</p>');
});

test('<style> w treści maila nie trafia do notatki', () => {
  const out = clean('<div><style>.x{color:red}</style><p class="x">Treść maila</p></div>');
  expect(out).toBe('<p>Treść maila</p>');
});

test('<pre> bez <code> → pre>code, klasa language-* → data-language', () => {
  expect(clean('<pre class="language-js"><span>const</span> x = 1;</pre>')).toBe(
    '<pre><code data-language="js">const x = 1;</code></pre>',
  );
});

test('złamania linii ze źródła HTML → spacja (poza <pre>)', () => {
  expect(clean('<p>Ustalenia ze\r\nspotkania</p><pre><code>a\nb</code></pre>')).toBe(
    '<p>Ustalenia ze spotkania</p><pre><code>a\nb</code></pre>',
  );
});

test('fragment zdania (sam inline) zostaje inline', () => {
  expect(clean('tekst <b>pogrubiony</b>')).toBe('tekst <b>pogrubiony</b>');
});

/* ── Outlook desktop / Word ───────────────────────────────────── */

console.log('\n2. Outlook desktop / Word');

const bullet = (level, glyph, text, list = 'l0') =>
  `<p class=MsoListParagraph style='margin-left:${level * 36}pt;text-indent:-18.0pt;mso-list:${list} level${level} lfo1'>` +
  `<![if !supportLists]><span style='font-family:Symbol'><span style='mso-list:Ignore'>${glyph}` +
  `<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>${text}<o:p></o:p></p>\r\n`;

const OUTLOOK =
  `<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><style><!-- p.MsoNormal{margin:0cm} --></style></head><body lang=PL>` +
  `<!--StartFragment--><p class=MsoNormal>Ustalenia <b>(pilne)</b>:<o:p></o:p></p>\r\n` +
  bullet(1, '·', 'Pierwszy punkt') +
  bullet(2, 'o', 'Podpunkt <i>A</i>') +
  bullet(3, '§', 'Pod-podpunkt') +
  bullet(1, '·', 'Drugi punkt') +
  `<p class=MsoNormal><o:p>&nbsp;</o:p></p>\r\n` +
  bullet(1, '1.', 'Krok pierwszy', 'l1') +
  bullet(1, '2.', 'Krok drugi', 'l1') +
  `<!--EndFragment--></body></html>`;

test('punkty Outlooka → prawdziwa lista z zagnieżdżeniem wg poziomu', () => {
  const out = clean(OUTLOOK);
  expect(out).toContain(
    '<ul><li>Pierwszy punkt<ul><li>Podpunkt <i>A</i><ul><li>Pod-podpunkt</li></ul></li></ul></li><li>Drugi punkt</li></ul>',
  );
});

test('znaki punktorów (·, o, §) i twarde spacje znikają z treści', () => {
  const out = clean(OUTLOOK);
  expect(out.includes('·')).toBe(false);
  expect(out.includes('§')).toBe(false);
  expect(out.includes('&nbsp;&nbsp;')).toBe(false);
});

test('numerowana lista Outlooka → <ol>, oddzielona od punktowanej', () => {
  const out = clean(OUTLOOK);
  expect(out).toContain('<ol><li>Krok pierwszy</li><li>Krok drugi</li></ol>');
  expect(out).toContain('</ul><p><br></p><ol>');
});

test('akapit przed listą zachowuje pogrubienie', () => {
  expect(clean(OUTLOOK).startsWith('<p>Ustalenia <b>(pilne)</b>:</p>')).toBe(true);
});

test('lista numerowana od 3 → <ol start="3">', () => {
  const out = clean(bullet(1, '3.', 'Trzeci') + bullet(1, '4.', 'Czwarty'));
  expect(out).toBe('<ol start="3"><li>Trzeci</li><li>Czwarty</li></ol>');
});

test('skok poziomu 1 → 3 nie tworzy pustych punktów', () => {
  const out = clean(bullet(1, '·', 'A') + bullet(3, '§', 'B'));
  expect(out).toBe('<ul><li>A<ul><li>B</li></ul></li></ul>');
});

test('numerowany nagłówek Worda zostaje nagłówkiem z numerem', () => {
  const out = clean(
    `<h1 style='mso-list:l2 level1 lfo3'><![if !supportLists]><span style='mso-list:Ignore'>1.<span>&nbsp;&nbsp; </span></span><![endif]>Wstęp</h1>`,
  );
  expect(out).toBe('<h1>1. Wstęp</h1>');
});

test('puste akapity &nbsp; na brzegach wklejki znikają', () => {
  expect(clean('<p class=MsoNormal><o:p>&nbsp;</o:p></p><p>Treść</p><p>&nbsp;</p>')).toBe(
    '<p>Treść</p>',
  );
});

/* ── Outlook Web / Google Docs ────────────────────────────────── */

console.log('\n3. Outlook Web / Google Docs');

test('style w spanach → <strong>/<em>/<u>/<s>', () => {
  const out = clean(
    '<p><span style="font-weight:700">B</span> <span style="font-style:italic">I</span> ' +
      '<span style="text-decoration:underline">U</span> <span style="text-decoration-line:line-through">S</span></p>',
  );
  expect(out).toBe('<p><strong>B</strong> <em>I</em> <u>U</u> <s>S</s></p>');
});

test('Google Docs: otoczka <b style="font-weight:normal"> nie pogrubia całości', () => {
  const out = clean(
    '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-abc">' +
      '<p dir="ltr"><span style="font-weight:400">Zwykły </span><span style="font-weight:700">gruby</span></p></b>',
  );
  expect(out).toBe('<p>Zwykły <strong>gruby</strong></p>');
});

test('Google Docs: <ul> wprost w <ul> → podlista poprzedniego punktu, <li><p> → tekst', () => {
  const out = clean(
    '<ul><li aria-level="1"><p role="presentation"><span>Poziom 1</span></p></li>' +
      '<ul><li aria-level="2"><p role="presentation"><span>Poziom 2</span></p></li></ul>' +
      '<li><p><span>Znów 1</span></p></li></ul>',
  );
  expect(out).toBe('<ul><li>Poziom 1<ul><li>Poziom 2</li></ul></li><li>Znów 1</li></ul>');
});

test('Outlook Web: <li><div> → tekst punktu, styl pogrubienia zachowany', () => {
  const out = clean(
    '<div style="font-family:Aptos"><div class="elementToProof">Lista:</div><ul>' +
      '<li><div role="presentation">Jeden <span style="font-weight:700">ważne</span></div></li>' +
      '<li><div role="presentation">Dwa</div></li></ul></div>',
  );
  expect(out).toBe('<p>Lista:</p><ul><li>Jeden <strong>ważne</strong></li><li>Dwa</li></ul>');
});

test('dwa akapity w jednym punkcie → rozdzielone <br>', () => {
  expect(clean('<ul><li><p>A</p><p>B</p></li></ul>')).toBe('<ul><li>A<br>B</li></ul>');
});

test('link podkreślony stylem nie dostaje dodatkowego <u>', () => {
  const out = clean('<p><a href="https://x.pl" style="text-decoration:underline">x</a></p>');
  expect(out.includes('<u>')).toBe(false);
});

/* ── Własna treść edytora (kopiuj/wklej w AsideNote) ──────────── */

console.log('\n4. Kopiuj/wklej w obrębie edytora');

test('checklista, callout, kod i toggle przechodzą bez zmian', () => {
  const own =
    '<ul data-list="checklist"><li data-checked="true">zrobione<ul><li data-checked="false">pod</li></ul></li></ul>' +
    '<blockquote data-callout="warning" data-callout-label="Uwaga"><p>x</p></blockquote>' +
    '<pre><code data-language="js">a<br>b</code></pre>' +
    '<details open=""><summary>S</summary><p>t</p></details>';
  expect(clean(own)).toBe(own);
});

/* Zaznaczenie punktów listy daje w schowku same <li> — bez <ul>/<ol> nad nimi.
   Taki schowek musi wrócić jako lista TEGO SAMEGO rodzaju. */

/** Kopiuje zaznaczenie z edytora tak, jak robi to _handleCopy w editor.js. */
function copySelection(setup, selector, fromIdx, toIdx) {
  const ed = editor();
  ed.innerHTML = setup;
  const items = ed.querySelectorAll(selector);
  const range = document.createRange();
  range.setStartBefore(items[fromIdx]);
  range.setEndAfter(items[toIdx]);
  const wrap = document.createElement('div');
  wrap.appendChild(range.cloneContents());
  const startEl =
    range.startContainer.nodeType === 1
      ? range.startContainer
      : range.startContainer.parentElement;
  restoreCopiedListContext(wrap, startEl?.closest('li') ?? items[fromIdx]);
  return wrap.innerHTML;
}

test('kopiowanie punktów listy numerowanej → schowek niesie <ol>', () => {
  const html = copySelection('<ol><li>a</li><li>b</li><li>c</li></ol>', 'li', 0, 1);
  expect(html).toBe('<ol><li>a</li><li>b</li></ol>');
});

test('kopiowanie od drugiego punktu → <ol start="2">', () => {
  const html = copySelection('<ol><li>a</li><li>b</li><li>c</li></ol>', 'li', 1, 2);
  expect(html).toBe('<ol start="2"><li>b</li><li>c</li></ol>');
});

test('kopiowanie punktów checklisty → schowek niesie checklistę', () => {
  const html = copySelection(
    '<ul data-list="checklist"><li data-checked="true">a</li><li data-checked="false">b</li></ul>',
    'li',
    0,
    1,
  );
  expect(html).toBe(
    '<ul data-list="checklist"><li data-checked="true">a</li><li data-checked="false">b</li></ul>',
  );
});

test('gołe <li> ze schowka wracają jako lista, nie akapity', () => {
  expect(clean('<li>a</li><li>b</li>')).toBe('<ul><li>a</li><li>b</li></ul>');
});

test('gołe <li> z numeracją wracają jako <ol> z numerem startowym', () => {
  expect(
    clean('<li data-list-type="ordered" value="3">a</li><li data-list-type="ordered" value="4">b</li>'),
  ).toBe('<ol start="3"><li>a</li><li>b</li></ol>');
});

test('wklejona numerowana lista nie zamienia się w punktowaną', () => {
  const out = paste('<ul><li>A</li></ul>', '<ol><li>1</li><li>2</li></ol>', ['li', 1]);
  expect(out).toBe('<ul><li>A</li></ul><ol><li>1</li><li>2</li></ol>');
});

test('numerowana lista wklejona w środek punktowanej rozcina ją', () => {
  const out = paste(
    '<ul><li>A</li><li>B</li></ul>',
    '<ol><li>1</li></ol>',
    ['li', 1],
  );
  expect(out).toBe('<ul><li>A</li></ul><ol><li>1</li></ol><ul><li>B</li></ul>');
});

test('punktowana wklejona w środek numerowanej → druga połowa liczy dalej', () => {
  const out = paste(
    '<ol><li>A</li><li>B</li></ol>',
    '<ul><li>x</li></ul>',
    ['li', 1],
  );
  expect(out).toBe('<ol><li>A</li></ol><ul><li>x</li></ul><ol start="2"><li>B</li></ol>');
});

/* ── sanitizeHTML: rozpakowanie zamiast spłaszczenia ──────────── */

console.log('\n5. sanitizeHTML');

test('nieznany tag jest rozpakowany — formatowanie w środku zostaje', () => {
  expect(sanitizeHTML('<p><font color="red"><b>ważne</b></font></p>')).toBe('<p><b>ważne</b></p>');
});

test('<script>/<style> znikają razem z treścią', () => {
  expect(sanitizeHTML('<p>a<script>alert(1)</script><style>p{}</style>b</p>')).toBe('<p>ab</p>');
});

test('link z niebezpiecznym href → sama treść z formatowaniem', () => {
  expect(sanitizeHTML('<p><a href="javascript:alert(1)"><b>klik</b></a></p>')).toBe(
    '<p><b>klik</b></p>',
  );
});

test('handlery on* w rozpakowanym tagu nie przechodzą', () => {
  const out = sanitizeHTML('<section onclick="x()"><p onmouseover="y()">t</p></section>');
  expect(out).toBe('<p>t</p>');
});

/* ── Wstawianie w miejscu kursora ─────────────────────────────── */

console.log('\n6. Wstawianie w miejscu kursora');

test('dwa akapity w środek zdania → zdanie rozcięte, brzegi doklejone', () => {
  // Kursor za "Początek " — spacja zostaje przed wklejką
  const out = paste('<p>Początek koniec</p>', '<p>X</p><p>Y</p>', ['p', 9]);
  expect(out).toBe('<p>Początek X</p><p>Ykoniec</p>');
});

test('lista w środek akapitu → akapit rozcięty, lista pomiędzy', () => {
  const out = paste('<p>Przed po</p>', '<ul><li>a</li><li>b</li></ul>', ['p', 6]);
  expect(out).toBe('<p>Przed </p><ul><li>a</li><li>b</li></ul><p>po</p>');
});

test('pojedynczy akapit wkleja się w zdanie, bez nowej linii', () => {
  expect(paste('<p>Ala kota</p>', '<p>ma</p>', ['p', 4])).toBe('<p>Ala makota</p>');
});

test('tekst wklejony w pusty akapit nie zostawia placeholdera <br> przed sobą', () => {
  expect(paste('<p><br></p>', '<p>Treść</p>')).toBe('<p>Treść</p>');
  expect(paste('<ul><li><br></li></ul>', 'słowo', ['li', 0])).toBe('<ul><li>słowo</li></ul>');
});

test('wklejka w pusty akapit go zastępuje', () => {
  expect(paste('<p><br></p>', '<h2>T</h2><p>a</p>')).toBe('<h2>T</h2><p>a</p>');
});

test('lista wklejona na końcu punktu → kolejne punkty TEJ listy', () => {
  const out = paste(
    '<ul><li>A</li><li>B</li></ul>',
    '<ul><li>Nowy 1</li><li>Nowy 2</li></ul>',
    ['li', 1],
  );
  expect(out).toBe('<ul><li>A</li><li>Nowy 1</li><li>Nowy 2</li><li>B</li></ul>');
});

test('lista wklejona w pusty punkt → zastępuje go, zagnieżdżenie zostaje', () => {
  const out = paste(
    '<ul><li>A</li><li><br></li></ul>',
    '<ul><li>X<ul><li>X.1</li></ul></li></ul>',
    ['li:last-child', 0],
  );
  expect(out).toBe('<ul><li>A</li><li>X<ul><li>X.1</li></ul></li></ul>');
});

test('lista w środek punktu → punkt rozcięty, nowe punkty pomiędzy', () => {
  const out = paste('<ul><li>Ala kota</li></ul>', '<ul><li>a</li><li>b</li></ul>', ['li', 4]);
  expect(out).toBe('<ul><li>Ala </li><li>a</li><li>b</li><li>kota</li></ul>');
});

test('akapity wklejone do listy stają się punktami', () => {
  const out = paste('<ol><li>A</li></ol>', '<p>p1</p><p>p2</p>', ['li', 1]);
  expect(out).toBe('<ol><li>A</li><li>p1</li><li>p2</li></ol>');
});

test('wklejka do checklisty → punkty dostają niezaznaczony checkbox', () => {
  const out = paste(
    '<ul data-list="checklist"><li data-checked="true">A</li></ul>',
    '<ul><li>B</li></ul>',
    ['li', 1],
  );
  expect(out).toBe(
    '<ul data-list="checklist"><li data-checked="true">A</li><li data-checked="false">B</li></ul>',
  );
});

test('checklista wklejona do zwykłej listy gubi stan checkboxa', () => {
  const out = paste(
    '<ul><li>A</li></ul>',
    '<ul data-list="checklist"><li data-checked="true">B</li></ul>',
    ['li', 1],
  );
  expect(out).toBe('<ul><li>A</li><li>B</li></ul>');
});

/* Cytat składa się tylko z akapitów (tak działa w nim Enter), więc wklejka
   zostaje W cytacie jako akapity — wcześniej lądowała za nim. */

test('lista w cytat → linie „• …” w cytacie, nie lista za cytatem', () => {
  const out = paste('<blockquote><p>cytat</p></blockquote>', '<ul><li>a</li><li>b</li></ul>', ['p', 5]);
  expect(out).toBe('<blockquote><p>cytat</p><p>• a</p><p>• b</p></blockquote>');
});

test('dwa akapity w środek zdania cytatu → rozcięcie w cytacie', () => {
  const out = paste('<blockquote><p>Ala kota</p></blockquote>', '<p>ma</p><p>i psa</p>', ['p', 4]);
  expect(out).toBe('<blockquote><p>Ala ma</p><p>i psakota</p></blockquote>');
});

test('nagłówek w cytacie staje się osobnym akapitem cytatu (nie skleja się)', () => {
  const out = paste('<blockquote><p>x</p></blockquote>', '<h2>Tytuł</h2><p>tekst</p>', 'end');
  expect(out).toBe('<blockquote><p>x</p><p>Tytuł</p><p>tekst</p></blockquote>');
});

test('cytat bez akapitów (sama treść) → wklejka nadal w cytacie', () => {
  const out = paste('<blockquote>cytat</blockquote>', '<p>A</p><p>B</p>', ['blockquote', 5]);
  expect(out).toBe('<blockquote><p>cytatA</p><p>B</p></blockquote>');
});

test('lista numerowana i podlista → numery i wcięcie w liniach cytatu', () => {
  const out = paste(
    '<blockquote><p><br></p></blockquote>',
    '<ol><li>raz<ul><li>pod</li></ul></li><li>dwa</li></ol>',
    ['p', 0],
  );
  expect(out).toBe(
    '<blockquote><p>1. raz</p><p>&nbsp;&nbsp;• pod</p><p>2. dwa</p></blockquote>',
  );
});

test('blok kodu w cytacie → każda linia kodu osobno', () => {
  const out = paste('<blockquote><p><br></p></blockquote>', '<pre><code>a = 1\nb = 2</code></pre>', ['p', 0]);
  expect(out).toBe('<blockquote><p><code>a = 1</code></p><p><code>b = 2</code></p></blockquote>');
});

test('callout też trzyma wklejkę w środku', () => {
  const out = paste(
    '<blockquote data-callout="tip"><p>rada</p></blockquote>',
    '<ul><li>a</li></ul>',
    ['p', 4],
  );
  expect(out).toBe('<blockquote data-callout="tip"><p>rada</p><p>• a</p></blockquote>');
});

test('kursor po wklejce stoi na końcu wklejonej treści', () => {
  paste('<p>Początek koniec</p>', '<p>X</p><p>Y</p>', ['p', 9]);
  const sel = window.getSelection();
  expect(sel.anchorNode.textContent).toBe('Y');
  expect(sel.anchorOffset).toBe(1);
});

/* ── Bezpieczeństwo wklejki ───────────────────────────────────── */

console.log('\nBezpieczeństwo wklejki');

/** Kursor na końcu pustego akapitu edytora. */
function caretInEmpty() {
  const ed = editor();
  ed.innerHTML = '<p>start </p>';
  const r = document.createRange();
  r.selectNodeContents(ed.firstChild);
  r.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  return ed;
}

const PAYLOAD = '<a href="<!---->javascript:alert(1)">klik</a>';

test('regresja mXSS: drzewo z sanitizeHTMLToBody nie daje linku javascript:', () => {
  const ed = caretInEmpty();
  insertPastedHTML(ed, sanitizeHTMLToBody(PAYLOAD));
  expect(ed.innerHTML.includes('javascript')).toBe(false);
  expect(ed.querySelector('a')).toBeNull();
  expect(ed.textContent).toContain('klik');
});

test('regresja mXSS: string z nieescapowanym "<" w atrybucie nie zostaje sklejony', () => {
  // Tak serializowały atrybut Firefox <140 / Chrome <138. Dawny regex na
  // komentarzach zamieniał to w href="javascript:alert(1)".
  const ed = caretInEmpty();
  insertPastedHTML(ed, '<a href="<!---->javascript:alert(1)">klik</a><!--x-->');
  for (const a of ed.querySelectorAll('a')) {
    expect(/^\s*javascript:/i.test(a.getAttribute('href') ?? '')).toBe(false);
  }
  // Węzły komentarzy usunięte w DOM (tekst "<!---->" w atrybucie zostaje
  // tekstem — jsdom, jak stare przeglądarki, nie escapuje "<" w atrybutach)
  const walker = document.createTreeWalker(ed, 128 /* SHOW_COMMENT */);
  expect(walker.nextNode()).toBeNull();
});

test('komentarze schowka (<!--StartFragment-->) nie trafiają do edytora', () => {
  const ed = caretInEmpty();
  insertPastedHTML(
    ed,
    sanitizeHTMLToBody('<!--StartFragment--><b>tekst</b><!--EndFragment-->'),
  );
  expect(ed.innerHTML).toBe('<p>start <b>tekst</b></p>');
});

test('link search-ms: z wklejki → sam tekst', () => {
  const ed = caretInEmpty();
  insertPastedHTML(ed, sanitizeHTMLToBody('<a href="search-ms:query=x.exe">plik</a>'));
  expect(ed.querySelector('a')).toBeNull();
  expect(ed.textContent).toContain('plik');
});

test('pusta wklejka (same komentarze) → nic nie wstawia', () => {
  const ed = caretInEmpty();
  expect(insertPastedHTML(ed, sanitizeHTMLToBody('<!--a--> <!--b-->'))).toBe(false);
  expect(ed.innerHTML).toBe('<p>start </p>');
});

test('ClickUp: wynik budowany poza dokumentem strony, struktura zachowana', () => {
  const before = document.body.innerHTML;
  const out = preprocessClickUp(
    '<div class="ql-editor"><div class="ql-block"> Akapit <b>gruby</b> </div>' +
      '<ol><li data-list="unchecked"><span class="ql-ui"></span>zadanie</li>' +
      '<li data-list="checked">zrobione<img src="x" onerror="alert(1)"></li></ol></div>',
  );
  expect(document.body.innerHTML).toBe(before);
  expect(out).toContain('<p>Akapit <b>gruby</b></p>');
  expect(out).toContain('<ul data-list="checklist">');
  expect(out).toContain('<li data-checked="false">zadanie</li>');
  expect(out).toContain('data-checked="true"');
  const clean = sanitizeHTML(out);
  expect(clean.includes('onerror')).toBe(false);
  expect(clean.includes('<img')).toBe(false);
});

/* ── Kod: ClickUp, Outlook, VS Code ───────────────────────────── */

console.log('\n9. Bloki kodu z innych narzędzi');

/** Pełna ścieżka jak w editor.js: ClickUp → normalizacja → sanityzacja. */
const fromClickUp = (html) => clean(preprocessClickUp(html) ?? html);

test('ClickUp: blok kodu → pre>code, link w środku jako tekst', () => {
  const out = fromClickUp(
    '<div class="ql-block">CSP:</div><div class="ql-code-block-container" spellcheck="false">' +
      '<div class="ql-code-block" data-language="plain">default-src \'none\';</div>' +
      '<div class="ql-code-block" data-language="plain">img-src \'self\' <a href="https://cdn.example.com">https://cdn.example.com</a>;</div></div>' +
      '<div class="ql-block">Koniec</div>',
  );
  expect(out).toBe(
    "<p>CSP:</p><pre><code>default-src 'none';\nimg-src 'self' https://cdn.example.com;</code></pre><p>Koniec</p>",
  );
});

test('ClickUp: sam blok kodu (bez akapitów) też zostaje blokiem', () => {
  expect(clean('<div class="ql-code-block-container"><div class="ql-code-block" data-language="javascript">a();</div></div>')).toBe(
    '<pre><code data-language="javascript">a();</code></pre>',
  );
});

test('Quill 1: pre.ql-syntax bez pustej linii na końcu', () => {
  expect(clean('<pre class="ql-syntax">a;\nb;\n</pre>')).toBe('<pre><code>a;\nb;</code></pre>');
});

test('ClickUp/Quill 2: punktory w <ol data-list="bullet"> zostają punktorami', () => {
  const out = fromClickUp(
    '<div class="ql-block">Lista:</div><ol><li data-list="bullet" class="ql-list-item"><span class="ql-ui"></span>A</li>' +
      '<li data-list="bullet" class="ql-list-item"><span class="ql-ui"></span>B</li></ol>' +
      '<ol><li data-list="ordered" class="ql-list-item"><span class="ql-ui"></span>krok</li></ol>',
  );
  expect(out).toBe('<p>Lista:</p><ul><li>A</li><li>B</li></ul><ol><li>krok</li></ol>');
});

test('ClickUp/Quill 2: ql-indent-N → podlista', () => {
  const out = fromClickUp(
    '<div class="ql-block">x</div><ol><li data-list="bullet" class="ql-list-item">A</li>' +
      '<li data-list="bullet" class="ql-list-item ql-indent-1">A.1</li>' +
      '<li data-list="bullet" class="ql-list-item ql-indent-2">A.1.a</li>' +
      '<li data-list="bullet" class="ql-list-item">B</li></ol>',
  );
  expect(out).toBe('<p>x</p><ul><li>A<ul><li>A.1<ul><li>A.1.a</li></ul></li></ul></li><li>B</li></ul>');
});

test('Outlook: akapity w Consolas → jeden blok kodu, pusta linia w środku zostaje', () => {
  const out = clean(
    "<p class=MsoNormal>Ustawienia:</p>" +
      "<p class=MsoNormal><span style='font-family:Consolas'>a = 1;<o:p></o:p></span></p>" +
      "<p class=MsoNormal><span style='font-family:Consolas'><o:p>&nbsp;</o:p></span></p>" +
      "<p class=MsoNormal><span style='font-family:\"Courier New\"'>b = 2;<o:p></o:p></span></p>" +
      '<p class=MsoNormal>Pozdrawiam</p>',
  );
  expect(out).toBe('<p>Ustawienia:</p><pre><code>a = 1;\n\nb = 2;</code></pre><p>Pozdrawiam</p>');
});

test('VS Code: linie w kontenerze z monospace, wcięcia z &nbsp; zostają', () => {
  const out = clean(
    '<div style="font-family: Consolas, \'Courier New\', monospace;white-space: pre;">' +
      '<div><span style="color:#569cd6;">if</span> (a) {</div><div>&nbsp; &nbsp; go();</div><div>}</div></div>',
  );
  expect(out).toBe('<pre><code>if (a) {\n    go();\n}</code></pre>');
});

test('kod w linii (<code> w zdaniu) zostaje w zdaniu', () => {
  expect(clean('<p>Uruchom <code>npm test</code> i gotowe.</p>')).toBe('<p>Uruchom <code>npm test</code> i gotowe.</p>');
});

test('mail w całości pisany Courierem zostaje akapitami', () => {
  const line = (t) => `<div style="font-family:'Courier New'">${t}</div>`;
  const out = clean(line('Cześć,') + line('w piątek koncert.') + line('Bilety mam ja.') + line('Do zobaczenia!'));
  expect(out).toBe('<p>Cześć,</p><p>w piątek koncert.</p><p>Bilety mam ja.</p><p>Do zobaczenia!</p>');
});

test('<pre> ze strony: link i pogrubienie w środku → sam tekst', () => {
  expect(clean('<pre><code>curl <a href="https://x.pl">https://x.pl</a> <b>-v</b></code></pre>')).toBe(
    '<pre><code>curl https://x.pl -v</code></pre>',
  );
});

test('próbka formatowania (tests/fixtures) przechodzi wklejanie bez strat', () => {
  const sample = readFileSync(new URL('./fixtures/format-sample.html', import.meta.url), 'utf8').trim();
  const strip = (h) => h.replace(/ (?:target|rel)="[^"]*"/g, '');
  expect(strip(clean(sample))).toBe(sample);
});

test('Outlook w przeglądarce (prawdziwy DOM): linie kodu, listy i checklista wracają', () => {
  const owa = readFileSync(new URL('./fixtures/clipboard/outlook-web-dom.html', import.meta.url), 'utf8');
  const out = clean(owa);
  expect(out).toContain(
    "<pre><code>default-src 'none';\nscript-src 'self';\nimg-src 'self' data: https://cdn.example.com;</code></pre>",
  );
  expect(out).toContain('<ul><li>spacer<ul><li>park<ul><li>ławka przy stawie</li></ul></li><li>las</li></ul></li><li>kawa ze znajomą</li></ul>');
  expect(out).toContain('<ul data-list="checklist"><li data-checked="false">kupić kwiaty<ul><li data-checked="false">wybrać kwiaciarnię</li>');
  expect(out).toContain('<ol start="5"><li>piąty punkt</li>');
});

await results();

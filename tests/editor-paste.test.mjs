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

import { test, expect, results } from './_runner.mjs';
import { normalizePastedHTML } from '../scripts/editor-paste-normalize.js';
import { insertPastedHTML } from '../scripts/editor-paste-insert.js';
import { sanitizeHTML } from '../scripts/sanitize.js';

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

test('lista w akapit cytatu → za cytatem (nie rozbija logiki cytatu)', () => {
  const out = paste('<blockquote><p>cytat</p></blockquote>', '<ul><li>a</li></ul>', ['p', 5]);
  expect(out).toBe('<blockquote><p>cytat</p></blockquote><ul><li>a</li></ul>');
});

test('kursor po wklejce stoi na końcu wklejonej treści', () => {
  paste('<p>Początek koniec</p>', '<p>X</p><p>Y</p>', ['p', 9]);
  const sel = window.getSelection();
  expect(sel.anchorNode.textContent).toBe('Y');
  expect(sel.anchorOffset).toBe(1);
});

await results();

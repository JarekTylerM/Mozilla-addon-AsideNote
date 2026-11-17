/**
 * editor-copy-export.test.mjs — HTML do schowka dla ClickUp/Outlook i powrót
 *
 * Źródło wymagań: eksperyment z tests/fixtures/clipboard (prawdziwe DOM-y
 * ClickUp i Outlooka po wklejeniu próbki). Dwie rzeczy naraz:
 *   1. HTML wychodzący ma formy, które obce edytory czytają,
 *   2. ten sam HTML wklejony do notatki daje DOKŁADNIE oryginał.
 */

import { createRequire } from 'module';
import { readFileSync } from 'fs';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const _dom = new JSDOM('<!DOCTYPE html><body></body>');
global.window = _dom.window;
global.document = _dom.window.document;
global.Node = _dom.window.Node;
global.NodeFilter = _dom.window.NodeFilter;
global.DOMParser = _dom.window.DOMParser;

import { test, expect, results } from './_runner.mjs';
import { prepareExportHTML } from '../scripts/editor-copy-export.js';
import { normalizePastedHTML } from '../scripts/editor-paste-normalize.js';
import { sanitizeHTML } from '../scripts/sanitize.js';
import { preprocessClickUp } from '../scripts/editor-paste-clickup.js';
import { markdownToHtml } from '../scripts/editor-markdown.js';

const LABELS = { note: 'Notatka', tip: 'Wskazówka', important: 'Ważne', warning: 'Ostrzeżenie', caution: 'Uwaga' };
const sample = readFileSync(new URL('./fixtures/format-sample.html', import.meta.url), 'utf8').trim();

/** Kopia z notatki: to, co _handleCopy wkłada do text/html. */
function exported(html) {
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  const before = wrap.innerHTML;
  const out = prepareExportHTML(wrap, (type) => LABELS[type] ?? '');
  // Kopiowany fragment notatki zostaje nietknięty (eksport pracuje na kopii)
  if (wrap.innerHTML !== before) throw new Error('prepareExportHTML zmienił oryginał');
  return out;
}
/** Wklejenie do notatki (ścieżka HTML z editor.js). */
const pasted = (html) =>
  sanitizeHTML(normalizePastedHTML(preprocessClickUp(html) ?? html)).replace(/ (?:target|rel)="[^"]*"/g, '');

console.log('\n1. Co dostaje ClickUp / Outlook');

const out = exported(sample);
test('pogrubienie, przekreślenie, nagłówki mają też styl inline', () => {
  expect(out).toContain('<strong style="font-weight:bold">pogrubienie</strong>');
  expect(out).toContain('<s style="text-decoration:line-through">przekreślenie</s>');
  expect(out).toContain('<h1 style="font-size:2em;font-weight:bold">');
});
test('kod: linie przez \\n, nie <br> (ClickUp zlewał linie)', () => {
  expect(out).toContain("default-src 'none';\nscript-src 'self';");
  expect(out.includes("'none';<br>")).toBe(false);
});
test('checklista: ☐/☑ przed punktem', () => {
  expect(out).toContain('<li data-checked="false"><span data-an="check">☐ </span>kupić kwiaty');
  expect(out).toContain('<span data-an="check">☑ </span>wybrać kwiaciarnię');
});
test('callout: etykieta przed treścią', () => {
  expect(out).toContain('<p><strong data-an="mark" style="font-weight:bold">Notatka: </strong>zabrać parasol.</p>');
});
test('rozwijany blok → akapity (ClickUp i Outlook wycinały <details> z treścią)', () => {
  expect(out.includes('<details')).toBe(false);
  expect(out).toContain('▸ ');
  expect(out).toContain('Szczegóły wycieczki');
  expect(out).toContain('<p>Zbiórka o 9:00 przy dworcu.</p>');
});

console.log('\n2. Kopiuj-wklej w obrębie AsideNote');

test('próbka po eksporcie i wklejeniu = oryginał (wszystkie 17 sekcji)', () => {
  expect(pasted(out)).toBe(sample);
});

console.log('\n3. Powrót z obcych narzędzi');

test('☐/☑ w punktach (bez atrybutów, jak po Outlooku) → checklista ze stanem', () => {
  expect(pasted('<ul><li>☐ kwiaty<ul><li>☑ kwiaciarnia</li></ul></li><li>☑ stolik</li></ul>')).toBe(
    '<ul data-list="checklist"><li data-checked="false">kwiaty<ul><li data-checked="true">kwiaciarnia</li></ul></li><li data-checked="true">stolik</li></ul>',
  );
});
test('ClickUp: punkt z ☐ w płaskiej liście → checklista', () => {
  expect(
    pasted('<ol><li data-list="bullet" class="ql-list-item"><span class="ql-ui"></span>☐ kwiaty</li><li data-list="bullet" class="ql-list-item"><span class="ql-ui"></span>☑ stolik</li></ol>'),
  ).toBe('<ul data-list="checklist"><li data-checked="false">kwiaty</li><li data-checked="true">stolik</li></ul>');
});
test('zwykła lista bez ☐/☑ zostaje zwykłą listą', () => {
  expect(pasted('<ul><li>kwiaty</li><li>stolik</li></ul>')).toBe('<ul><li>kwiaty</li><li>stolik</li></ul>');
});
test('ClickUp: rozwijane bloki (prawdziwy DOM) → <details>, pusty też', () => {
  const html = readFileSync(new URL('./fixtures/clipboard/clickup-toggle-dom.html', import.meta.url), 'utf8');
  expect(pasted(html)).toBe(
    '<details open=""><summary>rozwiń mnie</summary><p>treść rozwinięcia</p></details><details open=""><summary><br></summary></details>',
  );
});
test('ClickUp (prawdziwy DOM po wklejeniu próbki): podpunkty i kod wracają', () => {
  const html = readFileSync(new URL('./fixtures/clipboard/clickup-dom.html', import.meta.url), 'utf8');
  const back = pasted(html);
  expect(back).toContain('<ul><li>spacer<ul><li>park<ul><li>ławka przy stawie</li></ul></li><li>las</li></ul></li><li>kawa ze znajomą</li></ul>');
  expect(back).toContain('<ol><li>bilety na koncert<ol><li>wybrać miejsca<ol><li>balkon</li></ol></li></ol></li><li>koncert</li></ol>');
  expect(back).toContain('<ul><li>weekend<ol><li>śniadanie</li><li>rower</li></ol></li></ul><ol><li>wycieczka<ul><li>mapa</li><li>przekąski</li></ul></li></ol>');
  expect(back).toContain('<pre><code data-language="javascript">');
  expect(back).toContain('<p>12. Cytat:</p><blockquote><p>Najlepszy czas na spacer jest teraz.</p></blockquote><p>13.');
  expect(back.includes('<p><br></p>')).toBe(false);
});

console.log('\n4. ClickUp, runda 2 (prawdziwy DOM po wklejeniu eksportu)');

test('ClickUp v2 → AsideNote: nagłówki bez podwójnego pogrubienia, checklista, callouty, kod', () => {
  const html = readFileSync(new URL('./fixtures/clipboard/clickup-dom-v2.html', import.meta.url), 'utf8');
  const back = pasted(html);
  expect(back).toContain('<h1>1. Nagłówek H1</h1><h2>2. Nagłówek H2</h2><h3>3. Nagłówek H3</h3>');
  expect(back).toContain('<a href="tel:+48123456789">telefon</a>');
  expect(back).toContain('<ul data-list="checklist"><li data-checked="false">kupić kwiaty<ul><li data-checked="true">wybrać kwiaciarnię</li><li data-checked="false">tulipany</li></ul></li><li data-checked="true">zarezerwować stolik</li></ul>');
  expect(back).toContain('<blockquote data-callout="note"><p>zabrać parasol.</p></blockquote><blockquote data-callout="tip"><p>w czwartki kawa jest tańsza.</p></blockquote><blockquote data-callout="important"><p>bilety odebrać do piątku.</p></blockquote><blockquote data-callout="warning"><p>ścieżka bywa błotnista.</p></blockquote><blockquote data-callout="caution"><p>most zamknięty po 20:00.</p></blockquote>');
  expect(back).toContain(
    "<pre><code data-language=\"cs\">default-src 'none';\nscript-src 'self';\nimg-src 'self' data: https://cdn.example.com;</code></pre>",
  );
  expect(back).toContain('<blockquote><p>Najlepszy czas na spacer jest teraz.</p></blockquote>');
});
test('cytat z pogrubieniem, które nie jest etykietą, zostaje cytatem', () => {
  expect(pasted('<blockquote><p><strong>Ważne</strong> spotkanie jutro</p></blockquote>')).toBe('<blockquote><p><strong>Ważne</strong> spotkanie jutro</p></blockquote>');
  expect(pasted('<blockquote><p><strong>Przypomnienie:</strong> kawa</p></blockquote>')).toBe('<blockquote><p><strong>Przypomnienie:</strong> kawa</p></blockquote>');
});
test('ClickUp: prawdziwy rozwijany blok z pogrubionym tytułem → <details>', () => {
  const html =
    '<div class="ql-editor"><ol><li class="ql-list-item" data-list="toggled"><span class="ql-ui" contenteditable="false"><span class="ql-ui-toggle-icon"><svg><path d="M8Z"></path></svg></span></span>' +
    '<span class="ql-togglelist-placeholder" contenteditable="false">Empty. Click or drag text/images inside</span><strong>Szczegóły wycieczki</strong></li>' +
    '<li class="ql-list-item ql-indent-1 ql-toggle-child" data-list="none"><span class="ql-ui"></span>Zbiórka o 9:00 przy dworcu.</li></ol></div>';
  expect(pasted(html)).toBe(
    '<details open=""><summary><strong>Szczegóły wycieczki</strong></summary><p>Zbiórka o 9:00 przy dworcu.</p></details>',
  );
});
test('tekst z ClickUp (Markdown, sam text/plain): ☐/☑ → checklista, kod bez pustej linii', () => {
  const md = '* ☐ kupić kwiaty\n   * ☑ wybrać kwiaciarnię\n* ☑ stolik\n\n```\na;\nb;\n\n```';
  expect(pasted(markdownToHtml(md))).toBe(
    '<ul data-list="checklist"><li data-checked="false">kupić kwiaty<ul><li data-checked="true">wybrać kwiaciarnię</li></ul></li><li data-checked="true">stolik</li></ul><pre><code>a;\nb;</code></pre>',
  );
});
test('Outlook v2 (prawdziwy DOM po wklejeniu eksportu): checklista, callouty, kod wracają', () => {
  const html = readFileSync(new URL('./fixtures/clipboard/outlook-web-dom-v2.html', import.meta.url), 'utf8');
  const back = pasted(html);
  expect(back).toContain(
    '<ul data-list="checklist"><li data-checked="false">kupić kwiaty<ul><li data-checked="true">wybrać kwiaciarnię</li><li data-checked="false">tulipany</li></ul></li><li data-checked="true">zarezerwować stolik</li></ul>',
  );
  expect(back).toContain('<blockquote data-callout="note"><p>zabrać parasol.</p></blockquote>');
  expect(back).toContain('<blockquote data-callout="caution"><p>most zamknięty po 20:00.</p></blockquote>');
  expect(back).toContain(
    "<pre><code>default-src 'none';\nscript-src 'self';\nimg-src 'self' data: https://cdn.example.com;</code></pre>",
  );
  expect(back).toContain('<ul><li>spacer<ul><li>park<ul><li>ławka przy stawie</li></ul></li><li>las</li></ul></li><li>kawa ze znajomą</li></ul>');
});
test('Outlook: <blockquote><div><b>Uwaga: </b>…</div> → callout caution', () => {
  expect(pasted('<blockquote><div style="font-family:Calibri"><b>Uwaga: </b>most zamknięty.</div></blockquote>')).toBe('<blockquote data-callout="caution"><p>most zamknięty.</p></blockquote>');
});

await results();

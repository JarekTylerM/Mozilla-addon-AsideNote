/**
 * editor-handlers.test.mjs — testy DOM dla handlerów edytora
 * Wymaga: jsdom (node_modules/jsdom)
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

// ── Bootstrap DOM PRZED importem modułów używających document ────
const _dom = new JSDOM('<!DOCTYPE html><body><div id="editor" contenteditable="true"><p>init</p></div></body></html>', {
  pretendToBeVisual: true,
});
global.window   = _dom.window;
global.document = _dom.window.document;
global.Node     = _dom.window.Node;

// ── Teraz bezpieczne importy ──────────────────────────────────────
import { test, expect, results } from './_runner.mjs';
import { decideEnterAction, decideBackspaceAction, detectSpaceTrigger }
  from './editor-block-analyzer.mjs';
import { _getCurrentBlock, _clearBlock, _isCursorAtListStart }
  from './editor-selection.mjs';

// ── DOM helpers ───────────────────────────────────────────────────

function resetEditor(html) {
  const editor = document.getElementById('editor');
  editor.innerHTML = html;
  return editor;
}

function setCursor(node, offset = 0) {
  const sel   = window.getSelection();
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function firstText(el) {
  const w = document.createTreeWalker(el, 0x4);
  return w.nextNode();
}

function gatherEnterCtx(editor) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  const range   = sel.getRangeAt(0);
  const node    = range.startContainer;
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;

  const pre         = element.closest('pre');
  const heading     = element.closest('h1, h2, h3');
  const checklistLi = element.closest('ul[data-list="checklist"] li');
  const li          = element.closest('li');
  const summary     = element.closest('summary');
  const detailsBlock = !summary ? element.closest('details > :not(summary)') : null;
  const inDetailsContent = !!detailsBlock;
  const detailsContentEmpty = detailsBlock ? detailsBlock.textContent.trim() === '' : false;
  const blockquote  = element.closest('blockquote');
  const block       = _getCurrentBlock();

  const isHrTrigger = !li && !blockquote && block
    && /^---$/.test(block.textContent.trim());

  let preIsExiting = false;
  if (pre) {
    const code = pre.querySelector('code') ?? pre;
    preIsExiting = /(<br\s*\/?>\s*){2,}$/.test(code.innerHTML);
  }

  const checklistEmpty = checklistLi
    ? checklistLi.textContent.trim() === '' : false;

  let liEmpty = false, liIsLast = false, liIsNested = false;
  if (li) {
    liEmpty    = li.textContent.trim() === '';
    liIsLast   = li === li.parentElement.lastElementChild;
    liIsNested = li.parentElement?.parentElement?.tagName === 'LI';
  }

  let bqLineEmpty = false, bqIsLastBlock = false, bqPrevEmpty = false;
  if (blockquote) {
    const curBlock = block !== editor && block?.parentNode === blockquote ? block : null;
    bqLineEmpty   = curBlock
      ? curBlock.textContent.trim() === '' : blockquote.textContent.trim() === '';
    bqIsLastBlock = !curBlock || curBlock === blockquote.lastElementChild;
    bqPrevEmpty   = curBlock?.previousElementSibling
      ? curBlock.previousElementSibling.textContent.trim() === '' : false;
  }

  const textBeforeCursor =
    range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.textContent.slice(0, range.startOffset)
      : '';
  const hasTrailingSpaces =
    !pre && !li && !blockquote && / {2,}$/.test(textBeforeCursor);

  return {
    inSummary: !!summary,
    inDetailsContent, detailsContentEmpty,
    inPre: !!pre, preIsExiting,
    inHeading: !!heading,
    inChecklistLi: !!checklistLi, checklistEmpty,
    inLi: !!li && !checklistLi, liEmpty, liIsLast, liIsNested,
    inBlockquote: !!blockquote, bqLineEmpty, bqIsLastBlock, bqPrevEmpty,
    isHrTrigger,
    hasTrailingSpaces,
  };
}

function gatherBackspaceCtx() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  const node  = sel.getRangeAt(0).startContainer;
  const el    = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;

  const checklistLi = el.closest('ul[data-list="checklist"] li');
  const blockquote  = el.closest('blockquote');
  const li          = checklistLi ? null : el.closest('li');

  return {
    inChecklistLi:    !!checklistLi,
    checklistAtStart: checklistLi ? _isCursorAtListStart(checklistLi) : false,
    checklistHasPrev: !!checklistLi?.previousElementSibling,
    inBlockquote:     !!blockquote,
    bqAtStart:        false,
    inLi:             !!li,
    liAtStart:        li ? _isCursorAtListStart(li) : false,
    liHasPrev:        !!li?.previousElementSibling,
    liIsNested:       li ? li.parentElement?.parentElement?.tagName === 'LI' : false,
  };
}

// ══ 1. gatherEnterCtx → decideEnterAction ══════════════════════

console.log('\n1. Enter — detekcja kontekstu z DOM');

test('p z tekstem → default', () => {
  const ed = resetEditor('<p>hello</p>');
  setCursor(firstText(ed.querySelector('p')), 3);
  expect(decideEnterAction(gatherEnterCtx(ed)).action).toBe('default');
});
test('h1 → heading-new-para', () => {
  const ed = resetEditor('<h1>Title</h1>');
  setCursor(firstText(ed.querySelector('h1')), 2);
  expect(decideEnterAction(gatherEnterCtx(ed)).action).toBe('heading-new-para');
});
test('h2 → heading-new-para', () => {
  const ed = resetEditor('<h2>Sub</h2>');
  setCursor(firstText(ed.querySelector('h2')), 1);
  expect(decideEnterAction(gatherEnterCtx(ed)).action).toBe('heading-new-para');
});
test('h3 → heading-new-para', () => {
  const ed = resetEditor('<h3>Sub</h3>');
  setCursor(firstText(ed.querySelector('h3')), 1);
  expect(decideEnterAction(gatherEnterCtx(ed)).action).toBe('heading-new-para');
});
test('pusty li ostatni → li-exit', () => {
  const ed = resetEditor('<ul><li>a</li><li></li></ul>');
  const li = ed.querySelectorAll('li')[1];
  setCursor(li, 0);
  expect(decideEnterAction(gatherEnterCtx(ed)).action).toBe('li-exit');
});
test('niepusty li → default', () => {
  const ed = resetEditor('<ul><li>hello</li></ul>');
  setCursor(firstText(ed.querySelector('li')), 2);
  expect(decideEnterAction(gatherEnterCtx(ed)).action).toBe('default');
});
test('pusty li zagnieżdżony ostatni → li-outdent', () => {
  const ed = resetEditor('<ul><li>a<ul><li></li></ul></li></ul>');
  const innerLi = ed.querySelector('ul > li > ul > li');
  setCursor(innerLi, 0);
  expect(decideEnterAction(gatherEnterCtx(ed)).action).toBe('li-outdent');
});
test('pre z kodem → pre-linebreak', () => {
  const ed = resetEditor('<pre><code>fn()</code></pre>');
  setCursor(firstText(ed.querySelector('code')), 2);
  expect(decideEnterAction(gatherEnterCtx(ed)).action).toBe('pre-linebreak');
});
test('blok --- → hr-insert', () => {
  const ed = resetEditor('<p>---</p>');
  setCursor(firstText(ed.querySelector('p')), 3);
  expect(decideEnterAction(gatherEnterCtx(ed)).action).toBe('hr-insert');
});
test('blockquote z treścią → blockquote-new-para', () => {
  const ed = resetEditor('<blockquote><p>text</p></blockquote>');
  setCursor(firstText(ed.querySelector('blockquote p')), 1);
  expect(decideEnterAction(gatherEnterCtx(ed)).action).toBe('blockquote-new-para');
});
test('checklist pusty li → checklist-exit', () => {
  const ed = resetEditor('<ul data-list="checklist"><li data-checked="false"></li></ul>');
  const li = ed.querySelector('li');
  setCursor(li, 0);
  expect(decideEnterAction(gatherEnterCtx(ed)).action).toBe('checklist-exit');
});
test('checklist niepusty li → checklist-new-item', () => {
  const ed = resetEditor('<ul data-list="checklist"><li data-checked="false">task</li></ul>');
  setCursor(firstText(ed.querySelector('li')), 2);
  expect(decideEnterAction(gatherEnterCtx(ed)).action).toBe('checklist-new-item');
});

// ══ 2. gatherBackspaceCtx → decideBackspaceAction ══════════════

console.log('\n2. Backspace — detekcja kontekstu z DOM');

test('li środek → null', () => {
  const ed = resetEditor('<ul><li>hello</li></ul>');
  setCursor(firstText(ed.querySelector('li')), 3);
  expect(decideBackspaceAction(gatherBackspaceCtx())).toBe(null);
});
test('drugi li na początku → li-merge', () => {
  const ed = resetEditor('<ul><li>first</li><li>second</li></ul>');
  const li2 = ed.querySelectorAll('li')[1];
  const r = document.createRange();
  r.setStart(li2, 0); r.collapse(true);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(r);
  expect(decideBackspaceAction(gatherBackspaceCtx()).action).toBe('li-merge');
});
test('jedyny li na początku → li-exit-to-p', () => {
  const ed = resetEditor('<ul><li>only</li></ul>');
  const li = ed.querySelector('li');
  const r = document.createRange();
  r.setStart(li, 0); r.collapse(true);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(r);
  expect(decideBackspaceAction(gatherBackspaceCtx()).action).toBe('li-exit-to-p');
});
test('p na początku → null', () => {
  const ed = resetEditor('<p>text</p>');
  const p = ed.querySelector('p');
  const r = document.createRange();
  r.setStart(p, 0); r.collapse(true);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(r);
  expect(decideBackspaceAction(gatherBackspaceCtx())).toBe(null);
});

// ══ 3. _getCurrentBlock z DOM ══════════════════════════════════

console.log('\n3. _getCurrentBlock z DOM');

test('kursor w p → P', () => {
  const ed = resetEditor('<p>text</p>');
  setCursor(firstText(ed.querySelector('p')), 2);
  expect(_getCurrentBlock()?.tagName).toBe('P');
});
test('kursor w li → LI', () => {
  const ed = resetEditor('<ul><li>item</li></ul>');
  setCursor(firstText(ed.querySelector('li')), 1);
  expect(_getCurrentBlock()?.tagName).toBe('LI');
});
test('kursor w h3 → H3', () => {
  const ed = resetEditor('<h3>head</h3>');
  setCursor(firstText(ed.querySelector('h3')), 1);
  expect(_getCurrentBlock()?.tagName).toBe('H3');
});
test('kursor w code > pre → fallback editor (PRE nie w blockTags)', () => {
  // PRE nie jest w blockTags — _getCurrentBlock zwraca editor jako fallback.
  // Pre-handling w _handleEnter używa element.closest('pre') bezpośrednio.
  const ed = resetEditor('<pre><code>code</code></pre>');
  setCursor(firstText(ed.querySelector('code')), 1);
  // Zwraca editor div (fallback) — nie PRE
  expect(_getCurrentBlock()?.id).toBe('editor');
});

// ══ 4. _isCursorAtListStart z DOM ══════════════════════════════

console.log('\n4. _isCursorAtListStart z DOM');

test('offset 0 w li → true', () => {
  const ed = resetEditor('<ul><li>hello</li></ul>');
  const li = ed.querySelector('li');
  const r = document.createRange();
  r.setStart(li, 0); r.collapse(true);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(r);
  expect(_isCursorAtListStart(li)).toBe(true);
});
test('offset 2 w li → false', () => {
  const ed = resetEditor('<ul><li>hello</li></ul>');
  setCursor(firstText(ed.querySelector('li')), 2);
  expect(_isCursorAtListStart(ed.querySelector('li'))).toBe(false);
});
test('offset końcowy → false', () => {
  const ed = resetEditor('<ul><li>hello</li></ul>');
  setCursor(firstText(ed.querySelector('li')), 5);
  expect(_isCursorAtListStart(ed.querySelector('li'))).toBe(false);
});

// ══ 5. detectSpaceTrigger z DOM context ════════════════════════

console.log('\n5. detectSpaceTrigger z DOM context');

test('# w p → heading 1', () => {
  const ed = resetEditor('<p>#</p>');
  setCursor(firstText(ed.querySelector('p')), 1);
  const bt = _getCurrentBlock()?.textContent ?? '';
  expect(detectSpaceTrigger(bt, bt)?.trigger).toBe('heading');
  expect(detectSpaceTrigger(bt, bt)?.level).toBe(1);
});
test('## w p → heading 2', () => {
  const ed = resetEditor('<p>##</p>');
  setCursor(firstText(ed.querySelector('p')), 2);
  const bt = _getCurrentBlock()?.textContent ?? '';
  expect(detectSpaceTrigger(bt, bt)?.level).toBe(2);
});
test('- w p → bullet', () => {
  const ed = resetEditor('<p>-</p>');
  setCursor(firstText(ed.querySelector('p')), 1);
  const bt = _getCurrentBlock()?.textContent ?? '';
  expect(detectSpaceTrigger(bt, bt)?.trigger).toBe('bullet');
});
test('1. w p → ordered', () => {
  const ed = resetEditor('<p>1.</p>');
  setCursor(firstText(ed.querySelector('p')), 2);
  const bt = _getCurrentBlock()?.textContent ?? '';
  expect(detectSpaceTrigger(bt, bt)?.trigger).toBe('ordered');
});
test('``` w p → code-block', () => {
  const ed = resetEditor('<p>```</p>');
  setCursor(firstText(ed.querySelector('p')), 3);
  const bt = _getCurrentBlock()?.textContent ?? '';
  expect(detectSpaceTrigger(bt, bt)?.trigger).toBe('code-block');
});
test('> w p → blockquote', () => {
  const ed = resetEditor('<p>></p>');
  setCursor(firstText(ed.querySelector('p')), 1);
  const bt = _getCurrentBlock()?.textContent ?? '';
  expect(detectSpaceTrigger(bt, bt)?.trigger).toBe('blockquote');
});
test('zwykły tekst → null', () => {
  const ed = resetEditor('<p>hello</p>');
  setCursor(firstText(ed.querySelector('p')), 3);
  const bt = _getCurrentBlock()?.textContent ?? '';
  expect(detectSpaceTrigger(bt, bt)).toBe(null);
});

await results([
  'Testy DOM wymagają node_modules/jsdom',
  'DOM mutations (execCommand, range.insertNode) pominięte — nie wspierane przez jsdom',
]);

/**
 * editor-block-analyzer.test.mjs
 * Testy: detectSpaceTrigger · decideEnterAction · decideBackspaceAction
 *
 * Czyste funkcje — zero DOM, zero browser API. 100% testowalność w Node.js.
 */

import { test, expect, results } from './_runner.mjs';
import {
  detectSpaceTrigger,
  decideEnterAction,
  decideBackspaceAction,
} from './editor-block-analyzer.mjs';

// ══ 1. detectSpaceTrigger ════════════════════════════════════════

console.log('\n1. detectSpaceTrigger — checklist');

test('-[ ] → checklist unchecked', () => {
  const r = detectSpaceTrigger('-[ ]', '-[ ]');
  expect(r?.trigger).toBe('checklist');
  expect(r?.checked).toBe(false);
});
test('-[x] → checklist checked', () => {
  const r = detectSpaceTrigger('-[x]', '-[x]');
  expect(r?.checked).toBe(true);
});
test('-[X] → checklist checked', () => {
  const r = detectSpaceTrigger('-[X]', '-[X]');
  expect(r?.checked).toBe(true);
});

console.log('\n2. detectSpaceTrigger — nagłówki');

test('# → heading level 1', () => {
  const r = detectSpaceTrigger('#', '#');
  expect(r?.trigger).toBe('heading');
  expect(r?.level).toBe(1);
});
test('## → heading level 2', () => {
  expect(detectSpaceTrigger('##', '##')?.level).toBe(2);
});
test('### → heading level 3', () => {
  expect(detectSpaceTrigger('###', '###')?.level).toBe(3);
});
test('#### → brak triggera (max h3)', () => {
  expect(detectSpaceTrigger('####', '####')).toBe(null);
});

console.log('\n3. detectSpaceTrigger — listy');

test('- → bullet', () => {
  expect(detectSpaceTrigger('-', '-')?.trigger).toBe('bullet');
});
test('* → bullet', () => {
  expect(detectSpaceTrigger('*', '*')?.trigger).toBe('bullet');
});
test('1. → ordered', () => {
  expect(detectSpaceTrigger('1.', '1.')?.trigger).toBe('ordered');
});
test('2. → ordered (dowolna cyfra)', () => {
  expect(detectSpaceTrigger('2.', '2.')?.trigger).toBe('ordered');
});
test('99. → ordered', () => {
  expect(detectSpaceTrigger('99.', '99.')?.trigger).toBe('ordered');
});

console.log('\n4. detectSpaceTrigger — callout blocks');

test('>[!NOTE] → callout note', () => {
  const r = detectSpaceTrigger('>[!NOTE]', '>[!NOTE]');
  expect(r?.trigger).toBe('callout');
  expect(r?.type).toBe('note');
});
test('>[!TIP] → callout tip', () => {
  expect(detectSpaceTrigger('>[!TIP]', '>[!TIP]')?.type).toBe('tip');
});
test('>[!IMPORTANT] → callout important', () => {
  expect(detectSpaceTrigger('>[!IMPORTANT]', '>[!IMPORTANT]')?.type).toBe('important');
});
test('>[!WARNING] → callout warning', () => {
  expect(detectSpaceTrigger('>[!WARNING]', '>[!WARNING]')?.type).toBe('warning');
});
test('>[!CAUTION] → callout caution', () => {
  expect(detectSpaceTrigger('>[!CAUTION]', '>[!CAUTION]')?.type).toBe('caution');
});
test('callout case-insensitive', () => {
  expect(detectSpaceTrigger('>[!note]', '>[!note]')?.type).toBe('note');
});
test('>[!UNKNOWN] → brak triggera', () => {
  expect(detectSpaceTrigger('>[!UNKNOWN]', '>[!UNKNOWN]')).toBe(null);
});

console.log('\n5. detectSpaceTrigger — blok kodu i cytat');

test('``` → code-block', () => {
  expect(detectSpaceTrigger('```', '```')?.trigger).toBe('code-block');
});
test('```js → code-block z language', () => {
  const r = detectSpaceTrigger('```js', '```js');
  expect(r?.trigger).toBe('code-block');
  expect(r?.language).toBe('js');
});
test('>- → toggle-list', () => {
  expect(detectSpaceTrigger('>-', '>-')?.trigger).toBe('toggle-list');
});
test('> → blockquote', () => {
  expect(detectSpaceTrigger('>', '>')?.trigger).toBe('blockquote');
});

console.log('\n6. detectSpaceTrigger — brak triggera');

test('zwykły tekst → null', () => {
  expect(detectSpaceTrigger('hello world', 'hello world')).toBe(null);
});
test('pusty string → null', () => {
  expect(detectSpaceTrigger('', '')).toBe(null);
});
test('-- → null (jeden myślnik triggeruje)', () => {
  expect(detectSpaceTrigger('--', '--')).toBe(null);
});
test('whitespace wokół triggera → ok (trim)', () => {
  expect(detectSpaceTrigger('  #  ', '#')?.trigger).toBe('heading');
});

// ══ 2. decideEnterAction ════════════════════════════════════════

console.log('\n7. decideEnterAction — pre');

const base = {
  inSummary: false,
  inDetailsContent: false, detailsContentEmpty: false,
  inPre: false, preIsExiting: false,
  inHeading: false, headingAtStart: false, headingHasTextAfter: false,
  inChecklistLi: false, checklistEmpty: false,
  inLi: false, liEmpty: false, liIsLast: false, liIsNested: false,
  inBlockquote: false, bqLineEmpty: false, bqIsLastBlock: false, bqPrevEmpty: false,
  isHrTrigger: false,
  hasTrailingSpaces: false,
};

test('inPre + nie exiting → pre-linebreak', () => {
  expect(decideEnterAction({ ...base, inPre: true }).action).toBe('pre-linebreak');
});
test('inPre + exiting → pre-exit', () => {
  expect(decideEnterAction({ ...base, inPre: true, preIsExiting: true }).action).toBe('pre-exit');
});

console.log('\n8. decideEnterAction — nagłówek, checklist');

test('inHeading (kursor na końcu) → heading-new-para', () => {
  expect(decideEnterAction({ ...base, inHeading: true }).action).toBe('heading-new-para');
});
test('inHeading + tekst za kursorem → heading-split', () => {
  expect(decideEnterAction({ ...base, inHeading: true, headingHasTextAfter: true }).action)
    .toBe('heading-split');
});
test('inHeading + kursor przed treścią → heading-para-before', () => {
  expect(decideEnterAction({
    ...base, inHeading: true, headingAtStart: true, headingHasTextAfter: true,
  }).action).toBe('heading-para-before');
});
test('inHeading pusty (atStart, brak treści) → heading-new-para', () => {
  expect(decideEnterAction({ ...base, inHeading: true, headingAtStart: true }).action)
    .toBe('heading-new-para');
});
test('inChecklistLi pusty → checklist-exit', () => {
  expect(decideEnterAction({ ...base, inChecklistLi: true, checklistEmpty: true }).action)
    .toBe('checklist-exit');
});
test('inChecklistLi niepusty → checklist-new-item', () => {
  expect(decideEnterAction({ ...base, inChecklistLi: true, checklistEmpty: false }).action)
    .toBe('checklist-new-item');
});

console.log('\n9. decideEnterAction — lista');

test('li pusty last nested → li-outdent', () => {
  expect(decideEnterAction({ ...base, inLi: true, liEmpty: true, liIsLast: true, liIsNested: true }).action)
    .toBe('li-outdent');
});
test('li pusty last top-level → li-exit', () => {
  expect(decideEnterAction({ ...base, inLi: true, liEmpty: true, liIsLast: true, liIsNested: false }).action)
    .toBe('li-exit');
});
test('li pusty środkowy → li-split', () => {
  expect(decideEnterAction({ ...base, inLi: true, liEmpty: true, liIsLast: false }).action)
    .toBe('li-split');
});
test('li niepusty → default (browser)', () => {
  expect(decideEnterAction({ ...base, inLi: true, liEmpty: false }).action)
    .toBe('default');
});

console.log('\n10. decideEnterAction — blockquote');

test('bq linia pusta + ostatnia + prev pusta → blockquote-exit', () => {
  expect(decideEnterAction({ ...base, inBlockquote: true, bqLineEmpty: true, bqIsLastBlock: true, bqPrevEmpty: true }).action)
    .toBe('blockquote-exit');
});
test('bq linia pusta + ostatnia + prev niepusta → blockquote-new-para', () => {
  expect(decideEnterAction({ ...base, inBlockquote: true, bqLineEmpty: true, bqIsLastBlock: true, bqPrevEmpty: false }).action)
    .toBe('blockquote-new-para');
});
test('bq normalny → blockquote-new-para', () => {
  expect(decideEnterAction({ ...base, inBlockquote: true }).action)
    .toBe('blockquote-new-para');
});

console.log('\n11. decideEnterAction — hr i default');

test('isHrTrigger → hr-insert', () => {
  expect(decideEnterAction({ ...base, isHrTrigger: true }).action).toBe('hr-insert');
});
test('hasTrailingSpaces → hard-break', () => {
  expect(decideEnterAction({ ...base, hasTrailingSpaces: true }).action).toBe('hard-break');
});
test('brak specjalnego kontekstu → default', () => {
  expect(decideEnterAction(base).action).toBe('default');
});

console.log('\n12. decideEnterAction — summary i details');

test('inSummary → summary-to-content', () => {
  expect(decideEnterAction({ ...base, inSummary: true }).action).toBe('summary-to-content');
});
test('inDetailsContent pusty → details-exit', () => {
  expect(decideEnterAction({ ...base, inDetailsContent: true, detailsContentEmpty: true }).action).toBe('details-exit');
});
test('inDetailsContent niepusty → default (brak specjalnej akcji)', () => {
  expect(decideEnterAction({ ...base, inDetailsContent: true, detailsContentEmpty: false }).action).toBe('default');
});
test('inSummary ma priorytet nad inPre', () => {
  expect(decideEnterAction({ ...base, inSummary: true, inPre: true }).action).toBe('summary-to-content');
});

// ══ 3. decideBackspaceAction ════════════════════════════════════

console.log('\n13. decideBackspaceAction — checklist');

const bkBase = {
  inChecklistLi: false, checklistAtStart: false, checklistHasPrev: false,
  inBlockquote: false, bqAtStart: false,
  inLi: false, liAtStart: false, liHasPrev: false, liIsNested: false,
};

test('checklist na początku z prev → checklist-merge', () => {
  expect(decideBackspaceAction({ ...bkBase, inChecklistLi: true, checklistAtStart: true, checklistHasPrev: true }).action)
    .toBe('checklist-merge');
});
test('checklist na początku bez prev → checklist-exit-to-p', () => {
  expect(decideBackspaceAction({ ...bkBase, inChecklistLi: true, checklistAtStart: true, checklistHasPrev: false }).action)
    .toBe('checklist-exit-to-p');
});
test('checklist nie na początku → null', () => {
  expect(decideBackspaceAction({ ...bkBase, inChecklistLi: true, checklistAtStart: false }))
    .toBe(null);
});

console.log('\n14. decideBackspaceAction — blockquote, lista');

test('blockquote na początku → blockquote-unwrap', () => {
  expect(decideBackspaceAction({ ...bkBase, inBlockquote: true, bqAtStart: true }).action)
    .toBe('blockquote-unwrap');
});
test('blockquote nie na początku → null', () => {
  expect(decideBackspaceAction({ ...bkBase, inBlockquote: true, bqAtStart: false }))
    .toBe(null);
});
test('li na początku z prev → li-merge', () => {
  expect(decideBackspaceAction({ ...bkBase, inLi: true, liAtStart: true, liHasPrev: true }).action)
    .toBe('li-merge');
});
test('li na początku zagnieżdżony → li-outdent', () => {
  expect(decideBackspaceAction({ ...bkBase, inLi: true, liAtStart: true, liHasPrev: false, liIsNested: true }).action)
    .toBe('li-outdent');
});
test('li na początku top-level → li-exit-to-p', () => {
  expect(decideBackspaceAction({ ...bkBase, inLi: true, liAtStart: true, liHasPrev: false, liIsNested: false }).action)
    .toBe('li-exit-to-p');
});
test('li nie na początku → null', () => {
  expect(decideBackspaceAction({ ...bkBase, inLi: true, liAtStart: false })).toBe(null);
});
test('brak kontekstu → null', () => {
  expect(decideBackspaceAction(bkBase)).toBe(null);
});

console.log('\n15. decideBackspaceAction — summary');

const bkBaseFull = { ...bkBase, inSummary: false, summaryEmpty: false, summaryAtStart: false };

test('inSummary pusty na początku → summary-unwrap', () => {
  expect(decideBackspaceAction({ ...bkBaseFull, inSummary: true, summaryAtStart: true, summaryEmpty: true }).action)
    .toBe('summary-unwrap');
});
test('inSummary niepusty → null (brak interceptu)', () => {
  expect(decideBackspaceAction({ ...bkBaseFull, inSummary: true, summaryAtStart: true, summaryEmpty: false }))
    .toBe(null);
});
test('inSummary pusty ale nie na początku → null', () => {
  expect(decideBackspaceAction({ ...bkBaseFull, inSummary: true, summaryAtStart: false, summaryEmpty: true }))
    .toBe(null);
});

// ── WYNIKI ────────────────────────────────────────────────────────

await results();

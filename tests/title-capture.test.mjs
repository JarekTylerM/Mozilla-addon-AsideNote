/**
 * title-capture.test.mjs — parser w polu tytułu i podpowiedzi podglądu
 *
 * Pole tytułu używa składni szybkiego dodawania, ale działa na elemencie,
 * który już istnieje. Najważniejsze, żeby nic nie zmieniło się po cichu:
 * zwykły tytuł nie dostaje podglądu, to co było w tytule przed edycją
 * zostaje dosłownie, a sama godzina nie przestawia istniejącego terminu.
 */

import { test, expect, results } from './_runner.mjs';
import { titleEditChanges } from './quick-capture-core.mjs';
import { describeCapture, describeTitleEdit } from './quick-capture-preview.mjs';

const MESSAGES = {
  common_today: 'today',
  common_tomorrow: 'tomorrow',
  common_yesterday: 'yesterday',
  quickCapture_preview_note_empty: 'Adding a note',
  quickCapture_preview_note_titled: 'Adding note: $1',
  quickCapture_preview_task_empty: 'Adding a task',
  quickCapture_preview_task_titled: 'Adding task: $1',
  quickCapture_preview_task_dated: 'Adding task $1',
  quickCapture_preview_task_dated_titled: 'Adding task $1: $2',
  quickCapture_preview_date_time: '$1 at $2',
  quickCapture_preview_flag_important: 'Important',
  quickCapture_preview_flag_inProgress: 'In progress',
  quickCapture_preview_flags: '$1 · $2',
  quickCapture_preview_tag_new: '#$1 (new tag)',
  quickCapture_preview_needTitle: 'Add a title',
  quickCapture_hint_rejected: '$1 stays in the title',
  quickCapture_hint_makeTask: 'Start with ! to make it a task',
  titleCapture_preview: 'Enter applies: $1',
  titleCapture_toTask: 'becomes a task',
  recurrence_daily: 'Daily',
  recurrence_weekly: 'Weekly',
  recurrence_monthly: 'Monthly',
  recurrence_yearly: 'Yearly',
};

function t(key, subs) {
  const msg = MESSAGES[key];
  if (msg === undefined) throw new Error(`brak klucza locale: ${key}`);
  const arr = subs === undefined ? [] : Array.isArray(subs) ? subs : [subs];
  return msg.replace(/\$(\d)/g, (_, i) => arr[Number(i) - 1] ?? '');
}

const ENV = { t, locale: 'pl', tags: [{ name: 'dom' }] };
const TASK = { type: 'task' };
const NOTE = { type: 'note' };
const pl = (raw, note, baseline = '') => titleEditChanges(raw, note, { baseline, locale: 'pl' });

function daysFromToday(ts) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((ts - today.getTime()) / 86400000);
}

// ── titleEditChanges ──────────────────────────────────────────────

console.log('\n1. Zadanie: składnia bez "!"');

test('zwykły tytuł → null (Enter tylko przechodzi do treści)', () => {
  expect(pl('Spacer z psem', TASK)).toBeNull();
  expect(pl('', TASK)).toBeNull();
});
test('"Kino jutro o 18" → termin, godzina, czysty tytuł', () => {
  const e = pl('Kino jutro o 18', TASK);
  expect(e.hasChanges).toBe(true);
  expect(e.title).toBe('Kino');
  expect(daysFromToday(e.due)).toBe(1);
  expect(e.time).toBe('18:00');
});
test('sama godzina nie podaje terminu (istniejący zostaje)', () => {
  const e = pl('Kino o 18', TASK);
  expect(e.time).toBe('18:00');
  expect(e.due).toBeNull();
});
test('!! włącza ważne, !> w trakcie, !!> oba', () => {
  expect(pl('!!Kino', TASK).important).toBe(true);
  expect(pl('!!Kino', TASK).focus).toBe(false);
  const both = pl('!!>Kino', TASK);
  expect(both.important).toBe(true);
  expect(both.focus).toBe(true);
  const f = pl('!>Kino', TASK);
  expect(f.important).toBe(false);
  expect(f.focus).toBe(true);
  expect(f.title).toBe('Kino');
});
test('sam "!" w zadaniu niczego nie zmienia', () => {
  expect(pl('!Kino', TASK)).toBeNull();
});
test('tag w zadaniu', () => {
  const e = pl('Kino #dom', TASK);
  expect(e.tagNames).toEqual(['dom']);
  expect(e.title).toBe('Kino');
});
test('cudzysłów zostawia tekst dosłownie', () => {
  expect(pl('"Plan na jutro"', TASK)).toBeNull();
});

console.log('\n2. Notatka');

test('notatka: daty nie są terminem', () => {
  expect(pl('Spotkanie jutro', NOTE)).toBeNull();
});
test('notatka: tagi działają', () => {
  const e = pl('Pomysł #dom', NOTE);
  expect(e.tagNames).toEqual(['dom']);
  expect(e.toTask).toBe(false);
  expect(e.title).toBe('Pomysł');
});
test('notatka z "!" → zadanie z terminem', () => {
  const e = pl('!Spacer jutro', NOTE);
  expect(e.toTask).toBe(true);
  expect(e.title).toBe('Spacer');
  expect(daysFromToday(e.due)).toBe(1);
});

console.log('\n3. Tytuł sprzed edycji zostaje dosłownie');

test('"Plan na jutro" otwarte ponownie nie dostaje terminu', () => {
  expect(pl('Plan na jutro', TASK, 'Plan na jutro')).toBeNull();
});
test('dopisany fragment działa, stary zostaje w tytule', () => {
  const e = pl('Plan na jutro o 18', TASK, 'Plan na jutro');
  expect(e.title).toBe('Plan na jutro');
  expect(e.due).toBeNull();
  expect(e.time).toBe('18:00');
});
test('stary prefiks !! nie włącza ważnego drugi raz', () => {
  expect(pl('!!Kino', TASK, '!!Kino')).toBeNull();
});
test('stary tag nie wraca jako zmiana', () => {
  expect(pl('C# i #dom', NOTE, 'C# i #dom')).toBeNull();
});

console.log('\n4. Odrzucone fragmenty');

test('25:00 → brak zmian, ale jest powód', () => {
  const e = pl('Kino 25:00', TASK);
  expect(e.hasChanges).toBe(false);
  expect(e.rejected).toEqual(['25:00']);
  expect(e.title).toBe('Kino 25:00');
});

// ── describeTitleEdit ─────────────────────────────────────────────

console.log('\n5. Podgląd pod tytułem');

test('brak zmian → brak podglądu', () => {
  expect(describeTitleEdit(null, ENV)).toBeNull();
});
test('termin, godzina, tag znany i nowy', () => {
  const d = describeTitleEdit(pl('Kino jutro o 18 #dom #kino', TASK), ENV);
  expect(d.text).toBe('Enter applies: tomorrow at 18:00 · #dom · #kino (new tag)');
});
test('sama godzina, ważne, cykl', () => {
  expect(describeTitleEdit(pl('!!Joga o 7:30 codziennie', TASK), ENV).text).toBe(
    'Enter applies: 07:30 · Important · Daily',
  );
});
test('zmiana na zadanie jest nazwana', () => {
  expect(describeTitleEdit(pl('!Spacer', NOTE), ENV).text).toBe('Enter applies: becomes a task');
});
test('odrzucony fragment → sama podpowiedź', () => {
  const d = describeTitleEdit(pl('Kino 30.02', TASK), ENV);
  expect(d.text).toBe('');
  expect(d.hint).toBe('„30.02” stays in the title');
});

// ── describeCapture: podpowiedzi ──────────────────────────────────

console.log('\n6. Podpowiedzi w szybkim dodawaniu');

test('notatka z terminem → podpowiedź o "!"', () => {
  expect(describeCapture('spacer jutro', ENV).hint).toBe('Start with ! to make it a task');
  expect(describeCapture('kawa o 18', ENV).hint).toBe('Start with ! to make it a task');
});
test('zwykła notatka → bez podpowiedzi', () => {
  expect(describeCapture('pomysł na weekend', ENV).hint === undefined).toBe(true);
});
test('zadanie z 25:00 → podpowiedź, co zostało w tytule', () => {
  expect(describeCapture('!kino 25:00', ENV).hint).toBe('„25:00” stays in the title');
});
test('poprawne zadanie → bez podpowiedzi', () => {
  expect(describeCapture('!kino jutro o 18', ENV).hint === undefined).toBe(true);
});

await results();

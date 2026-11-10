/**
 * last-export.test.mjs — wiek ostatniej kopii zapasowej (sekcja Dane)
 *
 * Linia "Ostatni eksport: …" nie może kłamać w żadną stronę: ani pokazać
 * ujemnej liczby dni, ani uznać uszkodzonego znacznika za świeżą kopię.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { test, expect, results } from './_runner.mjs';
import { lastExportInfo } from './last-export.mjs';

const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const NOW = at(2026, 11, 12, 10);

console.log('\n1. Brak znacznika');

test('undefined → never', () => {
  expect(lastExportInfo(undefined, NOW)).toEqual({ kind: 'never', days: 0 });
});

test('null, tekst, NaN, zero i liczba ujemna → never', () => {
  for (const bad of [null, '2026-11-01', NaN, 0, -5, Infinity]) {
    expect(lastExportInfo(bad, NOW).kind).toBe('never');
  }
});

console.log('\n2. Dni kalendarzowe');

test('eksport sprzed godziny → today', () => {
  expect(lastExportInfo(at(2026, 11, 12, 9), NOW)).toEqual({ kind: 'today', days: 0 });
});

test('wczoraj 23:50, teraz 0:10 → yesterday (nie "today" z dzielenia przez 24 h)', () => {
  const info = lastExportInfo(at(2026, 11, 11, 23, 50), at(2026, 11, 12, 0, 10));
  expect(info).toEqual({ kind: 'yesterday', days: 1 });
});

test('dwa dni wstecz → daysAgo 2', () => {
  expect(lastExportInfo(at(2026, 11, 10, 8), NOW)).toEqual({ kind: 'daysAgo', days: 2 });
});

test('miesiąc wstecz przez granicę miesiąca', () => {
  expect(lastExportInfo(at(2026, 10, 12), NOW)).toEqual({ kind: 'daysAgo', days: 31 });
});

test('zmiana czasu (25-godzinna doba 25.10.2026) nie gubi ani nie dokłada dnia', () => {
  const info = lastExportInfo(at(2026, 10, 24, 12), at(2026, 10, 26, 12));
  expect(info.days).toBe(2);
});

console.log('\n3. Zegar');

test('znacznik z przyszłości → today, nie ujemne dni', () => {
  expect(lastExportInfo(at(2026, 11, 20), NOW)).toEqual({ kind: 'today', days: 0 });
});

console.log('\n4. Teksty');

test('każdy wariant ma tekst w PL i EN, a daysAgo placeholder liczby dni', () => {
  for (const lang of ['pl', 'en']) {
    const messages = JSON.parse(
      readFileSync(
        fileURLToPath(new URL(`../_locales/${lang}/messages.json`, import.meta.url)),
        'utf8',
      ),
    );
    for (const kind of ['never', 'today', 'yesterday', 'daysAgo']) {
      const key = `panel_data_lastExport_${kind}`;
      if (!messages[key]?.message) throw new Error(`brak ${key} w ${lang}`);
    }
    const daysAgo = messages.panel_data_lastExport_daysAgo;
    if (!/\$DAYS\$/.test(daysAgo.message) || daysAgo.placeholders?.days?.content !== '$1') {
      throw new Error(`${lang}: panel_data_lastExport_daysAgo bez placeholdera $DAYS$`);
    }
  }
});

await results();

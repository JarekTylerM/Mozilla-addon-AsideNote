/**
 * recurrence.test.mjs — termin i treść następnej instancji zadania cyklicznego
 *
 * Główna własność: następna instancja nigdy nie ląduje w przeszłości, więc
 * odhaczenie zaległego zadania cyklicznego nie tworzy kolejnego zaległego.
 */

import { test, expect, results } from './_runner.mjs';
import { nextDueDate, contentForNextInstance } from './recurrence.mjs';

const day = (y, m, d) => new Date(y, m - 1, d).getTime();
const noon = (y, m, d) => new Date(y, m - 1, d, 12).getTime();

// Czwartek 12 listopada 2026, południe
const THU = noon(2026, 11, 12);

console.log('\n1. nextDueDate — terminy na czas');

test('daily: termin dziś → jutro', () => {
  expect(nextDueDate(day(2026, 11, 12), 'daily', null, THU)).toBe(day(2026, 11, 13));
});

test('weekly: +7 dni', () => {
  expect(nextDueDate(day(2026, 11, 12), 'weekly', null, THU)).toBe(day(2026, 11, 19));
});

test('monthly: ten sam dzień miesiąca', () => {
  expect(nextDueDate(day(2026, 11, 12), 'monthly', null, THU)).toBe(day(2026, 12, 12));
});

test('yearly: +1 rok', () => {
  expect(nextDueDate(day(2026, 11, 12), 'yearly', null, THU)).toBe(day(2027, 11, 12));
});

test('custom pn/śr/pt: z czwartku na piątek', () => {
  expect(nextDueDate(day(2026, 11, 12), 'custom', [1, 3, 5], THU)).toBe(day(2026, 11, 13));
});

test('custom bez dni: dni robocze — z piątku na poniedziałek', () => {
  const fri = noon(2026, 11, 13);
  expect(nextDueDate(day(2026, 11, 13), 'custom', null, fri)).toBe(day(2026, 11, 16));
});

console.log('\n2. nextDueDate — zaległe zadania');

test('daily zaległe od poniedziałku, odhaczone w czwartek → dziś', () => {
  expect(nextDueDate(day(2026, 11, 9), 'daily', null, THU)).toBe(day(2026, 11, 12));
});

test('daily z terminem wczoraj → dziś', () => {
  expect(nextDueDate(day(2026, 11, 11), 'daily', null, THU)).toBe(day(2026, 11, 12));
});

test('weekly zaległe o 3 tygodnie → najbliższy przyszły tydzień', () => {
  // poniedziałek 19.10 → 26.10, 2.11, 9.11, 16.11 (pierwszy ≥ dziś)
  expect(nextDueDate(day(2026, 10, 19), 'weekly', null, THU)).toBe(day(2026, 11, 16));
});

test('weekly zachowuje dzień tygodnia po zaległości', () => {
  const next = nextDueDate(day(2026, 10, 19), 'weekly', null, THU);
  expect(new Date(next).getDay()).toBe(1);
});

test('monthly zaległe o 2 miesiące → najbliższy przyszły', () => {
  expect(nextDueDate(day(2026, 9, 5), 'monthly', null, THU)).toBe(day(2026, 12, 5));
});

test('custom zaległe → najbliższy dzień z listy od dziś', () => {
  // wtorki: 3.11 zaległe → 10.11 też minął → 17.11
  expect(nextDueDate(day(2026, 11, 3), 'custom', [2], THU)).toBe(day(2026, 11, 17));
});

console.log('\n3. nextDueDate — końce miesięcy');

test('31.01 + miesiąc → ostatni dzień lutego, nie 3 marca', () => {
  const jan = noon(2027, 1, 31);
  expect(nextDueDate(day(2027, 1, 31), 'monthly', null, jan)).toBe(day(2027, 2, 28));
});

test('29.02 + rok → 28.02', () => {
  const leap = noon(2028, 2, 29);
  expect(nextDueDate(day(2028, 2, 29), 'yearly', null, leap)).toBe(day(2029, 2, 28));
});

test('zmiana czasu: daily przez koniec października', () => {
  const sat = noon(2026, 10, 24);
  expect(nextDueDate(day(2026, 10, 24), 'daily', null, sat)).toBe(day(2026, 10, 25));
  const sun = noon(2026, 10, 25);
  expect(nextDueDate(day(2026, 10, 25), 'daily', null, sun)).toBe(day(2026, 10, 26));
});

test('wynik to zawsze początek dnia', () => {
  const next = new Date(nextDueDate(day(2026, 11, 12) + 5 * 3600_000, 'daily', null, THU));
  expect(next.getHours()).toBe(0);
  expect(next.getMinutes()).toBe(0);
});

console.log('\n4. contentForNextInstance');

test('odznacza pozycje checklisty', () => {
  const html =
    '<ul data-list="checklist"><li data-checked="true">a</li><li data-checked="false">b</li></ul>';
  expect(contentForNextInstance(html)).toBe(
    '<ul data-list="checklist"><li data-checked="false">a</li><li data-checked="false">b</li></ul>',
  );
});

test('zachowuje resztę treści', () => {
  expect(contentForNextInstance('<p>Kroki <strong>raportu</strong></p>')).toBe(
    '<p>Kroki <strong>raportu</strong></p>',
  );
});

test('brak treści → pusty string', () => {
  expect(contentForNextInstance(undefined)).toBe('');
  expect(contentForNextInstance('')).toBe('');
});

results();

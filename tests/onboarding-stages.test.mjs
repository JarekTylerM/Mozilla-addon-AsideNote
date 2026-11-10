/**
 * onboarding-stages.test.mjs — migracja znaczników lekcji przewodnika
 *
 * Wydanie 1.1 składa 7 lekcji w 4. Główna własność: zmiana listy lekcji nie
 * pokazuje przewodnika od nowa komuś, kto ukończył lekcję 1.
 */

import { test, expect, results } from './_runner.mjs';
import { migrateStages, STAGES_VERSION, STAGE_COUNT } from './onboarding-stages.mjs';

const ALL_V2 = { 1: true, 2: true, 3: true, 4: true, 5: true, 6: true, 7: true };

console.log('\n1. Bieżąca numeracja');

test('wersja bieżąca: bez zmian i bez zapisu', () => {
  const res = migrateStages({ 1: true, 3: true }, STAGES_VERSION);
  expect(res).toEqual({ stages: { 1: true, 3: true }, changed: false });
});

test('wersja nowsza niż znana: nic nie przesuwa i nie każe zapisywać', () => {
  const res = migrateStages(ALL_V2, 99);
  expect(res.changed).toBe(false);
  expect(res.stages).toEqual({ 1: true, 2: true, 3: true, 4: true });
});

console.log('\n2. Z 7 lekcji (v2) na 4');

test('wszystko ukończone → wszystko ukończone', () => {
  const res = migrateStages(ALL_V2, 2);
  expect(res).toEqual({
    stages: { 1: true, 2: true, 3: true, 4: true },
    changed: true,
  });
});

test('tylko Start → tylko Start', () => {
  expect(migrateStages({ 1: true }, 2).stages).toEqual({
    1: true, 2: false, 3: false, 4: false,
  });
});

test('Szybkie dodawanie (4) → lekcja 2, Formatowanie (2) → lekcja 3', () => {
  const stages = migrateStages({ 2: true, 4: true }, 2).stages;
  expect(stages[2]).toBe(true);
  expect(stages[3]).toBe(true);
});

test('lekcja 4 wymaga obu źródeł: Trybów skupienia (5) i Danych (7)', () => {
  expect(migrateStages({ 5: true }, 2).stages[4]).toBe(false);
  expect(migrateStages({ 7: true }, 2).stages[4]).toBe(false);
  expect(migrateStages({ 5: true, 7: true }, 2).stages[4]).toBe(true);
});

test('lekcje bez następcy (3 i 6) niczego nie oznaczają', () => {
  expect(migrateStages({ 3: true, 6: true }, 2).stages).toEqual({
    1: false, 2: false, 3: false, 4: false,
  });
});

console.log('\n3. Z 6 lekcji (v1, brak znacznika wersji)');

test('v1 w całości: najpierw przesunięcie 4–6 → 5–7, potem złożenie', () => {
  const v1 = { 1: true, 2: true, 3: true, 4: true, 5: true, 6: true };
  // Po v1→v2: 1,2,3,5,6,7. Lekcji "Szybkie dodawanie" w v1 nie było.
  expect(migrateStages(v1, undefined).stages).toEqual({
    1: true, 2: false, 3: true, 4: true,
  });
});

test('wersja zapisana jako 1 działa jak brak wersji', () => {
  const v1 = { 1: true, 4: true };
  expect(migrateStages(v1, 1)).toEqual(migrateStages(v1, undefined));
});

console.log('\n4. Przewodnik nie wraca');

test('ukończona lekcja 1 zostaje ukończona z każdej dawnej wersji', () => {
  for (const version of [undefined, 1, 2]) {
    for (const extra of [{}, { 2: true }, { 4: true, 5: true }, ALL_V2]) {
      const res = migrateStages({ ...extra, 1: true }, version);
      if (res.stages[1] !== true) {
        throw new Error(`wersja ${version}: lekcja 1 straciła znacznik`);
      }
    }
  }
});

test('nieukończona lekcja 1 nie staje się ukończona', () => {
  expect(migrateStages({ 2: true, 4: true, 5: true, 7: true }, 2).stages[1]).toBe(false);
});

console.log('\n5. Dane brzegowe');

test('brak znaczników: pusty wynik, ale z zapisem wersji', () => {
  const res = migrateStages(undefined, undefined);
  expect(res.changed).toBe(true);
  expect(Object.values(res.stages).some(Boolean)).toBe(false);
});

test('klucze tekstowe z JSON i śmieci', () => {
  const res = migrateStages({ '1': true, foo: true, '2.5': true, '-1': true, 4: 'yes' }, 2);
  expect(res.stages).toEqual({ 1: true, 2: false, 3: false, 4: false });
});

test('wynik ma dokładnie tyle lekcji, ile bieżąca numeracja', () => {
  expect(Object.keys(migrateStages(ALL_V2, 2).stages).length).toBe(STAGE_COUNT);
});

await results();

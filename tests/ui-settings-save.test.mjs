/**
 * ui-settings-save.test.mjs — równoczesne zapisy ustawień
 *
 * saveUiSettings czyta całe ustawienia, dokleja zmianę i zapisuje całość.
 * Dwa zapisy naraz czytały ten sam stan, więc późniejszy kasował zmianę
 * wcześniejszego. Szybkie opcje w dolnym pasku i zapis pozycji kursora
 * sprawiają, że to się realnie zdarza.
 */

import { test, expect, results } from './_runner.mjs';

// Storage imitowany z opóźnieniem, jak prawdziwe API asynchroniczne.
const store = {};
const tick = () => new Promise((resolve) => setTimeout(resolve, 1));
globalThis.browser = {
  storage: {
    local: {
      async get(key) {
        await tick();
        return key in store ? { [key]: structuredClone(store[key]) } : {};
      },
      async set(values) {
        await tick();
        Object.assign(store, structuredClone(values));
      },
    },
  },
};

const { saveUiSettings, loadUiSettings } = await import('./storage.mjs');

console.log('\n1. Równoczesne zapisy');

await Promise.all([
  saveUiSettings({ uiZoom: 110 }),
  saveUiSettings({ fontFamily: 'lexend' }),
  saveUiSettings({ colorScheme: 'dark' }),
]);
const merged = await loadUiSettings();

test('żaden z równoczesnych zapisów nie ginie', () => {
  expect(merged.uiZoom).toBe(110);
  expect(merged.fontFamily).toBe('lexend');
  expect(merged.colorScheme).toBe('dark');
});

await saveUiSettings({ uiZoom: 80 });
await Promise.all([saveUiSettings({ uiZoom: 90 }), saveUiSettings({ uiZoom: 100 })]);
const last = await loadUiSettings();

test('przy tym samym kluczu wygrywa ostatnia zmiana', () => {
  expect(last.uiZoom).toBe(100);
});

const failing = browser.storage.local.set;
browser.storage.local.set = async () => {
  throw new Error('quota');
};
let rejected = false;
await saveUiSettings({ uiZoom: 120 }).catch(() => {
  rejected = true;
});
browser.storage.local.set = failing;
await saveUiSettings({ fontFamily: 'system' });
const afterError = await loadUiSettings();

test('błąd zapisu dociera do wywołującego', () => {
  expect(rejected).toBe(true);
});

test('po błędzie kolejne zapisy działają', () => {
  expect(afterError.fontFamily).toBe('system');
});

await results();

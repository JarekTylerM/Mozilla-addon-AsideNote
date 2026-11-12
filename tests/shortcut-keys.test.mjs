/**
 * shortcut-keys.test.mjs — zdarzenie klawiatury → zapis skrótu
 *
 * Skrót, który przyjmie browser.commands.update(), ma sztywne reguły
 * (modyfikator wymagany poza F1–F12, najwyżej dwa modyfikatory, zamknięta
 * lista klawiszy). Źle zbudowany string przeglądarka odrzuca wyjątkiem,
 * a użytkownik widzi tylko „nie udało się” — dlatego walidacja siedzi
 * u nas i jest testowana tutaj.
 */

import { test, expect, results } from './_runner.mjs';
import {
  conflictingCommand,
  isFunctionKey,
  isValidShortcut,
  keyFromCode,
  modifiersFromEvent,
  previewLabel,
  shortcutFromEvent,
} from './shortcut-keys.mjs';

/** @param {string} code @param {object} mods */
const ev = (code, mods = {}) => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

console.log('\n1. event.code → klawisz');

test('litery i cyfry', () => {
  expect(keyFromCode('KeyQ')).toBe('Q');
  expect(keyFromCode('Digit7')).toBe('7');
});

test('klawisze funkcyjne i nazwane', () => {
  expect(keyFromCode('F12')).toBe('F12');
  expect(keyFromCode('ArrowUp')).toBe('Up');
  expect(keyFromCode('Comma')).toBe('Comma');
  expect(keyFromCode('Space')).toBe('Space');
});

test('klawisze spoza listy WebExtensions', () => {
  expect(keyFromCode('Numpad5')).toBeNull();
  expect(keyFromCode('Escape')).toBeNull();
  expect(keyFromCode('Backquote')).toBeNull();
  expect(keyFromCode('')).toBeNull();
  expect(keyFromCode(undefined)).toBeNull();
});

test('F1–F12 rozpoznane, F13 nie', () => {
  expect(isFunctionKey('F1')).toBe(true);
  expect(isFunctionKey('F12')).toBe(true);
  expect(isFunctionKey('F13')).toBe(false);
  expect(isFunctionKey('Q')).toBe(false);
});

console.log('\n2. Modyfikatory');

test('kolejność: główny, potem Shift', () => {
  expect(modifiersFromEvent({ ctrlKey: true, shiftKey: true })).toEqual(['Ctrl', 'Shift']);
  expect(modifiersFromEvent({ altKey: true, shiftKey: true })).toEqual(['Alt', 'Shift']);
});

test('klawisz Windows nie jest modyfikatorem skrótu', () => {
  expect(modifiersFromEvent({ metaKey: true })).toEqual([]);
});

test('macOS: ⌘ to Command, fizyczny Control to MacCtrl', () => {
  expect(modifiersFromEvent({ metaKey: true }, true)).toEqual(['Command']);
  expect(modifiersFromEvent({ ctrlKey: true }, true)).toEqual(['MacCtrl']);
});

console.log('\n3. Zdarzenie → skrót');

test('Alt+Shift+Q', () => {
  expect(shortcutFromEvent(ev('KeyQ', { altKey: true, shiftKey: true }))).toEqual({
    shortcut: 'Alt+Shift+Q',
  });
});

test('Ctrl+K', () => {
  expect(shortcutFromEvent(ev('KeyK', { ctrlKey: true }))).toEqual({ shortcut: 'Ctrl+K' });
});

test('sam klawisz funkcyjny wystarczy', () => {
  expect(shortcutFromEvent(ev('F9'))).toEqual({ shortcut: 'F9' });
  expect(shortcutFromEvent(ev('F9', { altKey: true }))).toEqual({ shortcut: 'Alt+F9' });
});

test('sama litera i Shift+litera to za mało', () => {
  expect(shortcutFromEvent(ev('KeyQ'))).toEqual({ error: 'needsModifier' });
  expect(shortcutFromEvent(ev('KeyQ', { shiftKey: true }))).toEqual({ error: 'needsModifier' });
});

test('trzy modyfikatory odpadają', () => {
  expect(
    shortcutFromEvent(ev('KeyQ', { ctrlKey: true, altKey: true, shiftKey: true })),
  ).toEqual({ error: 'tooManyModifiers' });
});

test('klawisz spoza listy odrzucony z własnym komunikatem', () => {
  expect(shortcutFromEvent(ev('Numpad5', { ctrlKey: true }))).toEqual({
    error: 'unsupportedKey',
  });
});

test('same modyfikatory = podgląd, nie błąd', () => {
  expect(shortcutFromEvent(ev('AltLeft', { altKey: true }))).toEqual({ pending: ['Alt'] });
  expect(shortcutFromEvent(ev('ShiftLeft', { altKey: true, shiftKey: true }))).toEqual({
    pending: ['Alt', 'Shift'],
  });
});

test('zdarzenie bez code nie wywraca nagrywania', () => {
  expect(shortcutFromEvent({ ctrlKey: true })).toEqual({ pending: ['Ctrl'] });
});

test('macOS: ⌘⇧N', () => {
  expect(
    shortcutFromEvent(ev('KeyN', { metaKey: true, shiftKey: true }), { isMac: true }),
  ).toEqual({ shortcut: 'Command+Shift+N' });
});

console.log('\n4. Walidacja gotowego skrótu');

test('poprawne', () => {
  expect(isValidShortcut('Alt+Shift+Q')).toBe(true);
  expect(isValidShortcut('Ctrl+Period')).toBe(true);
  expect(isValidShortcut('Command+Shift+N')).toBe(true);
  expect(isValidShortcut('F5')).toBe(true);
});

test('niepoprawne', () => {
  expect(isValidShortcut('Shift+Q')).toBe(false);
  expect(isValidShortcut('Q')).toBe(false);
  expect(isValidShortcut('Ctrl+Alt+Shift+Q')).toBe(false);
  expect(isValidShortcut('Alt+Alt+Q')).toBe(false);
  expect(isValidShortcut('Alt+')).toBe(false);
  expect(isValidShortcut('Alt+ą')).toBe(false);
  expect(isValidShortcut('')).toBe(false);
  expect(isValidShortcut(null)).toBe(false);
});

console.log('\n5. Kolizja z drugą komendą dodatku');

const assigned = { 'toggle-sidebar': 'Alt+Shift+Q', _execute_browser_action: 'Alt+Shift+S' };

test('ten sam skrót co druga komenda', () => {
  expect(conflictingCommand('Alt+Shift+S', assigned, 'toggle-sidebar')).toBe(
    '_execute_browser_action',
  );
});

test('własny, niezmieniony skrót nie jest kolizją', () => {
  expect(conflictingCommand('Alt+Shift+Q', assigned, 'toggle-sidebar')).toBeNull();
});

test('wolna kombinacja', () => {
  expect(conflictingCommand('Alt+Shift+Y', assigned, 'toggle-sidebar')).toBeNull();
});

test('nieprzypisany skrót drugiej komendy nie koliduje z niczym', () => {
  expect(conflictingCommand('', { _execute_browser_action: '' }, 'toggle-sidebar')).toBeNull();
});

console.log('\n6. Podgląd w trakcie wciskania');

test('podgląd kombinacji', () => {
  expect(previewLabel(['Alt', 'Shift'])).toBe('Alt+Shift+…');
  expect(previewLabel([])).toBe('');
});

await results();

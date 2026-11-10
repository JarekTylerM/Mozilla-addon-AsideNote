/**
 * dev-build.test.mjs — wersja testowa nie może dotknąć danych głównej
 *
 * Firefox przypisuje storage do identyfikatora dodatku, więc to ID oddziela
 * testowe notatki od prawdziwych. Testy pilnują też, żeby obie wersje dało się
 * odróżnić i uruchomić naraz.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { test, expect, results } from './_runner.mjs';
import {
  toDevManifest,
  toSelfDistributedManifest,
  withUpdateEntry,
  devUpdateLink,
  DEV_ADDON_ID,
  DEV_ICON_PATH,
  DEV_NAME,
  DEV_UPDATE_URL,
} from '../build-dev-manifest.mjs';
import { isDevBuild } from './build-flavor.mjs';

const read = (rel) =>
  readFileSync(fileURLToPath(new URL('../' + rel, import.meta.url)), 'utf8');

const prod = JSON.parse(read('manifest.json'));
const before = JSON.stringify(prod);
const dev = toDevManifest(prod);

console.log('\n1. Rozdzielenie danych');

test('wersja testowa ma inny identyfikator niż główna', () => {
  expect(dev.browser_specific_settings.gecko.id).toBe(DEV_ADDON_ID);
  expect(dev.browser_specific_settings.gecko.id === prod.browser_specific_settings.gecko.id).toBe(false);
});

test('manifest główny nadal ma identyfikator opublikowanego dodatku', () => {
  // Zmiana tego ID odcięłaby użytkowników AMO od aktualizacji i ich danych
  expect(prod.browser_specific_settings.gecko.id).toBe('asidenotes-tyler@addons.mozilla.org');
});

test('przekształcenie nie zmienia manifestu wejściowego', () => {
  expect(JSON.stringify(prod)).toBe(before);
});

test('identyfikator ma format akceptowany przez Firefoksa', () => {
  expect(/^[a-zA-Z0-9-._]+@[a-zA-Z0-9-._]+$/.test(DEV_ADDON_ID)).toBe(true);
});

console.log('\n2. Rozpoznanie wersji');

test('isDevBuild rozpoznaje tylko wersję testową', () => {
  expect(isDevBuild(DEV_ADDON_ID)).toBe(true);
  expect(isDevBuild(prod.browser_specific_settings.gecko.id)).toBe(false);
  expect(isDevBuild(undefined)).toBe(false);
});

test('background.js używa tego samego rozpoznania', () => {
  const source = read('background.js');
  if (!source.includes('/-dev@/.test(browser.runtime.id)')) {
    throw new Error('background.js rozpoznaje wersję testową inaczej niż build-flavor.js');
  }
  expect(/-dev@/.test(DEV_ADDON_ID)).toBe(true);
});

console.log('\n3. Odróżnienie w przeglądarce');

test('nazwa i tytuły mówią, że to wersja testowa', () => {
  expect(dev.name).toBe(DEV_NAME);
  expect(dev.sidebar_action.default_title).toBe(DEV_NAME);
  expect(dev.browser_action.default_title).toBe(DEV_NAME);
});

test('ikony wskazują ikonę testową, a theme_icons jej nie przykrywają', () => {
  expect(dev.icons[48]).toBe(DEV_ICON_PATH);
  expect(dev.sidebar_action.default_icon).toBe(DEV_ICON_PATH);
  expect(dev.browser_action.default_icon).toBe(DEV_ICON_PATH);
  expect('theme_icons' in dev.browser_action).toBe(false);
});

test('skróty różnią się od skrótów wersji głównej', () => {
  for (const command of Object.keys(prod.commands)) {
    const a = prod.commands[command].suggested_key.default;
    const b = dev.commands[command].suggested_key.default;
    if (a === b) throw new Error(`${command}: ten sam skrót ${a}`);
  }
});

// Litery menu Firefoksa (Alt+litera, także z Shiftem) — PL: Plik, Edycja,
// Widok, Historia, Zakładki, Narzędzia, Pomoc; EN: File, Edit, View,
// History (S), Bookmarks, Tools, Help. Menu wygrywa ze skrótem dodatku.
const MENU_ACCESS_KEYS = new Set(['P', 'E', 'W', 'H', 'Z', 'N', 'F', 'V', 'S', 'B', 'T']);

test('skróty wersji testowej nie otwierają menu Firefoksa', () => {
  for (const [command, def] of Object.entries(dev.commands)) {
    const key = /** @type {any} */ (def).suggested_key.default;
    const m = /^Alt\+Shift\+([A-Z])$/.exec(key);
    if (m && MENU_ACCESS_KEYS.has(m[1])) {
      throw new Error(`${command}: ${key} otwiera menu Firefoksa`);
    }
  }
});

test('reszta manifestu jest taka sama', () => {
  expect(dev.version).toBe(prod.version);
  expect(JSON.stringify(dev.permissions)).toBe(JSON.stringify(prod.permissions));
  expect(dev.content_security_policy).toBe(prod.content_security_policy);
});

console.log('\n4. Paczka do samodzielnej dystrybucji');

const self = toSelfDistributedManifest(prod);

test('paczka ma adres aktualizacji po HTTPS i identyfikator testowy', () => {
  expect(self.browser_specific_settings.gecko.update_url).toBe(DEV_UPDATE_URL);
  expect(DEV_UPDATE_URL.startsWith('https://')).toBe(true);
  expect(self.browser_specific_settings.gecko.id).toBe(DEV_ADDON_ID);
});

test('wersja główna z AMO i ładowana lokalnie nie mają adresu aktualizacji', () => {
  // AMO odrzuca update_url w dodatku dystrybuowanym przez siebie
  expect('update_url' in prod.browser_specific_settings.gecko).toBe(false);
  expect('update_url' in dev.browser_specific_settings.gecko).toBe(false);
});

test('version_name to zwykły numer wersji', () => {
  expect(self.version_name).toBe(prod.version);
});

test('własny numer paczki: version liczbowy, etykieta w version_name', () => {
  const m = toSelfDistributedManifest(prod, { version: '1.0.1.1', versionName: '1.0.1a' });
  expect(m.version).toBe('1.0.1.1');
  expect(m.version_name).toBe('1.0.1a');
  expect(prod.version === '1.0.1.1').toBe(false); // wejście bez zmian
});

test('wersja z literą (1.0.1a) jest odrzucana — AMO i Firefox uznałyby ją za niższą', () => {
  let threw = false;
  try {
    toSelfDistributedManifest(prod, { version: '1.0.1a' });
  } catch {
    threw = true;
  }
  expect(threw).toBe(true);
});

test('wpis aktualizacji ma wersję i adres pliku .xpi', () => {
  const file = withUpdateEntry(null, '1.0.1');
  const updates = file.addons[DEV_ADDON_ID].updates;
  expect(updates.length).toBe(1);
  expect(updates[0].version).toBe('1.0.1');
  expect(updates[0].update_link).toBe(devUpdateLink('1.0.1'));
  expect(updates[0].update_link.startsWith('https://')).toBe(true);
  expect(updates[0].update_link.endsWith('.xpi')).toBe(true);
});

test('nowa wersja dopisuje się, a ponowny build tej samej nie tworzy duplikatu', () => {
  let file = withUpdateEntry(null, '1.0.1');
  file = withUpdateEntry(file, '1.0.2');
  file = withUpdateEntry(file, '1.0.2');
  const versions = file.addons[DEV_ADDON_ID].updates.map((u) => u.version);
  expect(versions).toEqual(['1.0.1', '1.0.2']);
});

await results();

/**
 * i18n-keys.test.mjs — każdy napis widoczny w UI ma tłumaczenie
 *
 * Klucze żyją w trzech miejscach naraz: w HTML (data-i18n / data-i18n-attr),
 * w kodzie (t("…")) i w dwóch plikach messages.json. Rozjazd nie wywala
 * niczego — `t()` zwraca wtedy sam klucz, więc w panelu pojawia się
 * "tagSelector_create_title" zamiast etykiety, a suite zostaje zielony.
 * Ten plik to domyka: porównuje użycia z zawartością obu locale.
 *
 * Czytamy pliki jako tekst — import scripts/*.js ciągnąłby `browser`.
 *
 * Uruchomienie: node tests/i18n-keys.test.mjs
 */

import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { test, expect, results } from './_runner.mjs';

const read = (rel) =>
  readFileSync(fileURLToPath(new URL('../' + rel, import.meta.url)), 'utf8');

const LANGS = ['en', 'pl'];
const MESSAGES = Object.fromEntries(
  LANGS.map((lang) => [lang, JSON.parse(read(`_locales/${lang}/messages.json`))]),
);

const HTML_FILES = ['sidebar.html', 'popup.html'];
const SCRIPT_FILES = readdirSync(
  fileURLToPath(new URL('../scripts', import.meta.url)),
).filter((f) => f.endsWith('.js'));

/** Klucze z data-i18n="…" i data-i18n-attr="attr:klucz;attr2:klucz2". */
function htmlKeys(html) {
  /** @type {Set<string>} */
  const keys = new Set();
  for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) keys.add(m[1]);
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) {
    for (const pair of m[1].split(';')) {
      const key = pair.split(':')[1];
      if (key) keys.add(key.trim());
    }
  }
  return keys;
}

/**
 * Klucze z t("literał"). Wywołania ze zmienną (t(key), t(result.error ?? …))
 * pomijamy — nie da się ich rozstrzygnąć statycznie.
 */
function scriptKeys(src) {
  /** @type {Set<string>} */
  const keys = new Set();
  for (const m of src.matchAll(/\bt\(\s*["']([A-Za-z0-9_]+)["']/g)) keys.add(m[1]);
  return keys;
}

/* ══ 1. HTML ═══════════════════════════════════════════════════ */

console.log('\n1. Klucze z data-i18n w HTML');

for (const file of HTML_FILES) {
  const keys = [...htmlKeys(read(file))].sort();
  for (const lang of LANGS) {
    test(`${file} → ${lang}: wszystkie klucze istnieją`, () => {
      const missing = keys.filter((k) => !MESSAGES[lang][k]);
      expect(missing.join(', ')).toBe('');
    });
  }
}

/* ══ 2. Kod ════════════════════════════════════════════════════ */

console.log('\n2. Klucze z t("…") w scripts/');

for (const lang of LANGS) {
  test(`scripts/ → ${lang}: wszystkie klucze istnieją`, () => {
    /** @type {string[]} */
    const missing = [];
    for (const file of SCRIPT_FILES) {
      for (const key of scriptKeys(read(`scripts/${file}`))) {
        if (!MESSAGES[lang][key]) missing.push(`${file}: ${key}`);
      }
    }
    expect(missing.join(', ')).toBe('');
  });
}

/* ══ 3. Oba locale trzymają ten sam zestaw ═════════════════════ */

console.log('\n3. Zgodność pl ↔ en');

test('ten sam zestaw kluczy w obu locale', () => {
  const pl = Object.keys(MESSAGES.pl).sort();
  const en = Object.keys(MESSAGES.en).sort();
  const onlyPl = pl.filter((k) => !MESSAGES.en[k]);
  const onlyEn = en.filter((k) => !MESSAGES.pl[k]);
  expect([...onlyPl, ...onlyEn].join(', ')).toBe('');
});

test('żaden komunikat nie jest pusty', () => {
  /** @type {string[]} */
  const empty = [];
  for (const lang of LANGS) {
    for (const [key, value] of Object.entries(MESSAGES[lang])) {
      if (!value.message || !value.message.trim()) empty.push(`${lang}: ${key}`);
    }
  }
  expect(empty.join(', ')).toBe('');
});

/* ══ 4. Elementy, których szuka panel.js ═══════════════════════ */

console.log('\n4. Elementy dropdownu tagów w sidebar.html');

const SIDEBAR = read('sidebar.html');

for (const id of [
  'tag-search-input',
  'tag-create-btn',
  'tag-options',
  'tag-dropdown-hint',
  'tag-dropdown-error',
  'goto-panel',
  'shortcuts-filter-input',
  'shortcuts-filter-empty',
]) {
  test(`#${id} istnieje`, () => {
    expect(SIDEBAR.includes(`id="${id}"`)).toBe(true);
  });
}

results();

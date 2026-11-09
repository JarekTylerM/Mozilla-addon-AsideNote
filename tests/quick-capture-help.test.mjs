/**
 * quick-capture-help.test.mjs — pomoc składni vs. parser i locale
 *
 * Pomoc opisuje składnię, którą implementuje parser.js. Nic tego dotąd nie
 * pilnowało i rozjazd wszedł do wydania: angielska pomoc popupu uczyła
 * "!package 06/15 2:30pm", a parser nie łapie "2:30pm" (brak granicy słowa
 * przed "pm") — powstawało zadanie bez godziny, z "2:30pm" w tytule.
 *
 * Te testy biorą KAŻDY przykład z listy pomocy, wkładają go do parsera
 * w obu językach i sprawdzają, że faktycznie robi to, co obiecuje opis.
 * Pomoc nie może uczyć składni, której parser nie zna.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { test, expect, results } from './_runner.mjs';
import { QUICK_CAPTURE_HELP } from './quick-capture-help.mjs';
import { parseCapture } from './parser.mjs';

const localePath = (lang) =>
  fileURLToPath(new URL(`../_locales/${lang}/messages.json`, import.meta.url));

const MESSAGES = {
  en: JSON.parse(readFileSync(localePath('en'), 'utf8')),
  pl: JSON.parse(readFileSync(localePath('pl'), 'utf8')),
};

/** Locale przekazywany do parseCapture — EN musi być "en-US" (MM/DD). */
const PARSER_LOCALE = { en: 'en-US', pl: 'pl' };

/** @param {string} lang @param {string} key */
const msg = (lang, key) => MESSAGES[lang][key]?.message;

/** Wiersz po kluczu opisu — testy adresują wiersze po znaczeniu, nie po indeksie. */
const row = (desc) => QUICK_CAPTURE_HELP.find((r) => r.desc === desc);

/** Przykład z wiersza: literał albo tekst z locale. */
const example = (lang, token) => token.text ?? msg(lang, token.key);

const LANGS = ['en', 'pl'];

// ── Kształt danych ────────────────────────────────────────────────

console.log('\n1. Kształt listy');

test('lista nie jest pusta', () => {
  expect(QUICK_CAPTURE_HELP.length).toBeGreaterThan(0);
});

test('każdy wiersz ma co najmniej jeden chip', () => {
  for (const r of QUICK_CAPTURE_HELP) {
    if (!r.tokens.length) throw new Error(`wiersz ${r.desc} bez chipów`);
  }
});

test('token ma dokładnie jedno z text/key', () => {
  for (const r of QUICK_CAPTURE_HELP) {
    for (const tok of r.tokens) {
      const n = (tok.text !== undefined ? 1 : 0) + (tok.key !== undefined ? 1 : 0);
      if (n !== 1) throw new Error(`${r.desc}: token ma ${n} pól, oczekiwano 1`);
    }
  }
});

test('klucze opisów są unikalne — jeden wiersz na regułę', () => {
  const descs = QUICK_CAPTURE_HELP.map((r) => r.desc);
  expect(new Set(descs).size).toBe(descs.length);
});

// ── Locale ────────────────────────────────────────────────────────

console.log('\n2. Locale');

test('każdy klucz opisu istnieje w EN i PL', () => {
  for (const r of QUICK_CAPTURE_HELP) {
    for (const lang of LANGS) {
      if (!msg(lang, r.desc)) throw new Error(`brak ${r.desc} w ${lang}`);
    }
  }
});

test('każdy klucz przykładu istnieje w EN i PL', () => {
  for (const r of QUICK_CAPTURE_HELP) {
    for (const tok of r.tokens) {
      if (tok.key === undefined) continue;
      for (const lang of LANGS) {
        if (!msg(lang, tok.key)) throw new Error(`brak ${tok.key} w ${lang}`);
      }
    }
  }
});

// ── Przykłady vs. parser ──────────────────────────────────────────

console.log('\n3. Przykłady faktycznie parsują się');

test('przykład notatki jest notatką, nie zadaniem', () => {
  for (const lang of LANGS) {
    const ex = example(lang, row('shortcuts_qc_plain').tokens[0]);
    const out = parseCapture(ex, PARSER_LOCALE[lang]);
    expect(out.isTask).toBeFalsy();
    expect(out.title).toBe(ex);
  }
});

test('prefiksy !, !!, !>, !!> dają obiecane flagi', () => {
  const cases = [
    ['shortcuts_qc_task', { isTask: true, isUrgent: false, isInProgress: false }],
    ['shortcuts_qc_taskImportant', { isTask: true, isUrgent: true, isInProgress: false }],
    ['shortcuts_qc_taskInProgress', { isTask: true, isUrgent: false, isInProgress: true }],
    ['shortcuts_qc_taskImportantInProgress', { isTask: true, isUrgent: true, isInProgress: true }],
  ];
  for (const [desc, want] of cases) {
    const prefix = row(desc).tokens[0].text;
    const out = parseCapture(prefix + 'coś', 'pl');
    expect(out.isTask).toBe(want.isTask);
    expect(out.isUrgent).toBe(want.isUrgent);
    expect(out.isInProgress).toBe(want.isInProgress);
    expect(out.title).toBe('coś');
  }
});

test('dziś / jutro dają termin', () => {
  for (const lang of LANGS) {
    for (const tok of row('shortcuts_qc_dayKeywords').tokens) {
      const ex = example(lang, tok);
      const out = parseCapture('!x ' + ex, PARSER_LOCALE[lang]);
      if (out.due === null) throw new Error(`${lang}: "${ex}" nie dało terminu`);
      expect(out.title).toBe('x');
    }
  }
});

test('nazwa dnia tygodnia daje termin w przyszłości', () => {
  for (const lang of LANGS) {
    const ex = example(lang, row('shortcuts_qc_weekdays').tokens[0]);
    const out = parseCapture('!x ' + ex, PARSER_LOCALE[lang]);
    if (out.due === null) throw new Error(`${lang}: "${ex}" nie dało terminu`);
    expect(out.due).toBeGreaterThan(Date.now() - 86400000);
    expect(out.title).toBe('x');
  }
});

test('przykłady dat parsują się w swoim locale (DD.MM vs MM/DD)', () => {
  for (const lang of LANGS) {
    for (const tok of row('shortcuts_qc_date').tokens) {
      const ex = example(lang, tok);
      const out = parseCapture('!x ' + ex, PARSER_LOCALE[lang]);
      if (out.due === null) throw new Error(`${lang}: data "${ex}" nie sparsowana`);
      expect(out.title).toBe('x');
    }
  }
});

test('wariant z rokiem trafia w podany rok', () => {
  for (const lang of LANGS) {
    const ex = example(lang, row('shortcuts_qc_date').tokens[1]);
    const year = Number(ex.match(/\d{4}/)[0]);
    const out = parseCapture('!x ' + ex, PARSER_LOCALE[lang]);
    expect(new Date(out.due).getFullYear()).toBe(year);
  }
});

test('przykład godziny daje dokładnie tę godzinę', () => {
  // Regresja na "2:30pm": parser zwracał time=null i zostawiał tekst w tytule
  for (const lang of LANGS) {
    const ex = example(lang, row('shortcuts_qc_time').tokens[0]);
    const out = parseCapture('!x ' + ex, PARSER_LOCALE[lang]);
    expect(out.time).toBe(ex);
    expect(out.title).toBe('x');
  }
});

test('przykłady cykliczności dają regułę powtarzania', () => {
  for (const lang of LANGS) {
    for (const tok of row('shortcuts_qc_recurrence').tokens) {
      const ex = example(lang, tok);
      const out = parseCapture('!x ' + ex, PARSER_LOCALE[lang]);
      if (out.recurrence === null) throw new Error(`${lang}: "${ex}" nie dało cykliczności`);
      expect(out.title).toBe('x');
    }
  }
});

test('żaden przykład nie zostawia po sobie śmieci w tytule', () => {
  // Jeśli parser nie rozumie fragmentu, zostawia go w tytule (celowo).
  // Tytuł "x" po wszystkich przykładach = każdy fragment został skonsumowany.
  for (const lang of LANGS) {
    for (const r of QUICK_CAPTURE_HELP) {
      if (r.desc === 'shortcuts_qc_plain') continue; // notatka, nie składnia
      if (r.desc === 'shortcuts_qc_quoted') continue; // osobny test niżej
      for (const tok of r.tokens) {
        if (tok.key === undefined) continue; // prefiksy testowane wyżej
        const ex = example(lang, tok);
        const out = parseCapture('!x ' + ex, PARSER_LOCALE[lang]);
        if (out.title !== 'x') {
          throw new Error(`${lang}: "${ex}" zostawiło tytuł "${out.title}"`);
        }
      }
    }
  }
});

test('przykład tagu naprawdę tworzy tag', () => {
  for (const lang of LANGS) {
    const ex = example(lang, row('shortcuts_qc_tag').tokens[0]);
    expect(parseCapture(`x ${ex}`, PARSER_LOCALE[lang]).tagNames).toEqual([ex.slice(1)]);
  }
});

test('przykład cudzysłowu daje dosłowny tytuł, bez terminu', () => {
  for (const lang of LANGS) {
    const ex = example(lang, row('shortcuts_qc_quoted').tokens[0]);
    const out = parseCapture(ex, PARSER_LOCALE[lang]);
    expect(out.isTask).toBe(true);
    expect(out.due).toBeNull();
    expect(out.title).toBe(ex.slice(2, -1));
  }
});

// ── Pokrycie parsera ──────────────────────────────────────────────

console.log('\n4. Pokrycie');

test('lista dokumentuje wszystkie prefiksy zadań, które zna parser', () => {
  const documented = new Set(
    QUICK_CAPTURE_HELP.flatMap((r) => r.tokens.map((tok) => tok.text)).filter(Boolean),
  );
  for (const prefix of ['!', '!!', '!>', '!!>']) {
    if (!documented.has(prefix)) throw new Error(`prefiks ${prefix} nieudokumentowany`);
  }
});

await results();

/**
 * onboarding-steps.test.mjs — spójność przewodnika ze światem zewnętrznym
 *
 * Kroki tour-a celują w elementy po selektorze i opisują je kluczami locale.
 * Jedno i drugie żyje w innych plikach niż onboarding.js, więc zmiana w
 * sidebar.html albo usunięcie klucza rozbraja krok po cichu — tooltip
 * wyląduje na środku ekranu albo pokaże surową nazwę klucza, a suite
 * pozostanie zielony. Ten plik to domyka.
 *
 * Onboarding.js NIE jest importowany: ciągnie i18n.js i storage.js, które
 * potrzebują `browser`. Czytamy go jako tekst i wyciągamy dane kroków —
 * brzydsze, ale nie wymaga mockowania połowy WebExtensions API.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { test, expect, results } from './_runner.mjs';

const read = (rel) =>
  readFileSync(fileURLToPath(new URL('../' + rel, import.meta.url)), 'utf8');

const SRC = read('scripts/onboarding.js');
const HTML = read('sidebar.html');
const MESSAGES = {
  en: JSON.parse(read('_locales/en/messages.json')),
  pl: JSON.parse(read('_locales/pl/messages.json')),
};
const LANGS = ['en', 'pl'];

/** Ciało tablicy STEPS — bez reszty modułu, żeby nie łapać przykładów z komentarzy. */
const STEPS_BODY = SRC.slice(
  SRC.indexOf('const STEPS'),
  SRC.indexOf('/* ── Stałe'),
);

/** @type {{stage:number, idx:number, body:string}[]} */
const STEPS = [
  ...STEPS_BODY.matchAll(
    /\{\s*(?:\/\/[^\n]*\n\s*)*stage:\s*(\d+),\s*idx:\s*(\d+),([\s\S]*?)\n  \},/g,
  ),
].map((m) => ({ stage: Number(m[1]), idx: Number(m[2]), body: m[3] }));

/** Selektory elementów tworzonych w runtime przez notes.js — nie ma ich w HTML. */
const RUNTIME_SELECTORS = new Set([
  '#notesList .note-item',
  '.notes-empty',
  'body',
]);

/** Czy statyczny selektor da się znaleźć w sidebar.html. */
function resolves(sel) {
  if (RUNTIME_SELECTORS.has(sel)) return true;
  if (sel.startsWith('#')) return new RegExp(`id="${sel.slice(1)}"`).test(HTML);
  if (sel.startsWith('.')) return new RegExp(`class="[^"]*\\b${sel.slice(1)}\\b`).test(HTML);
  return HTML.includes(sel);
}

const field = (body, name) => body.match(new RegExp(`${name}:\\s*'([^']+)'`))?.[1];

const stages = [...new Set(STEPS.map((s) => s.stage))].sort();

// ── Kształt ───────────────────────────────────────────────────────

console.log('\n1. Kształt kroków');

test('kroki dają się wyciągnąć ze źródła', () => {
  // Guard na sam parser testu — gdyby format STEPS się zmienił, reszta
  // testów przechodziłaby na pustej liście i niczego nie sprawdzała.
  expect(STEPS.length).toBeGreaterThan(20);
});

test('każda lekcja ma idx 0..n-1 w kolejności tablicy', () => {
  for (const stage of stages) {
    const idxs = STEPS.filter((s) => s.stage === stage).map((s) => s.idx);
    const want = idxs.map((_, i) => i);
    if (JSON.stringify(idxs) !== JSON.stringify(want)) {
      throw new Error(`lekcja ${stage}: idx = [${idxs}], oczekiwano [${want}]`);
    }
  }
});

test('każda lekcja kończy się krokiem type: done', () => {
  for (const stage of stages) {
    const inStage = STEPS.filter((s) => s.stage === stage);
    const last = inStage[inStage.length - 1];
    if (!/type:\s*'done'/.test(last.body)) {
      throw new Error(`lekcja ${stage} nie kończy się krokiem 'done'`);
    }
  }
});

test('krok done występuje tylko na końcu lekcji', () => {
  for (const stage of stages) {
    const inStage = STEPS.filter((s) => s.stage === stage);
    for (const s of inStage.slice(0, -1)) {
      if (/type:\s*'done'/.test(s.body)) {
        throw new Error(`lekcja ${stage}, idx ${s.idx}: 'done' w środku lekcji`);
      }
    }
  }
});

test('numery lekcji są ciągłe od 1', () => {
  expect(stages).toEqual(stages.map((_, i) => i + 1));
});

// ── Locale ────────────────────────────────────────────────────────

console.log('\n2. Locale');

test('każdy textKey i textKeyFallback istnieje w EN i PL', () => {
  const keys = [
    ...STEPS_BODY.matchAll(/textKey(?:Fallback)?:\s*'([^']+)'/g),
  ].map((m) => m[1]);
  expect(keys.length).toBeGreaterThan(0);
  for (const k of keys) {
    for (const lang of LANGS) {
      if (!MESSAGES[lang][k]) throw new Error(`brak ${k} w ${lang}`);
    }
  }
});

test('każdy krok ma tekst', () => {
  for (const s of STEPS) {
    if (!/textKey:/.test(s.body)) {
      throw new Error(`lekcja ${s.stage}, idx ${s.idx}: brak textKey`);
    }
  }
});

test('fallback zawsze idzie w parze z isFallback', () => {
  for (const s of STEPS) {
    const hasKey = /textKeyFallback:/.test(s.body);
    const hasCond = /isFallback:/.test(s.body);
    if (hasKey !== hasCond) {
      throw new Error(
        `lekcja ${s.stage}, idx ${s.idx}: textKeyFallback i isFallback muszą występować razem`,
      );
    }
  }
});

test('etykieta etapu istnieje dla każdej lekcji', () => {
  for (const stage of stages) {
    const key = `ob_stage${stage}_label`;
    if (!SRC.includes(`'${key}'`)) throw new Error(`STAGE_LABELS bez ${key}`);
    for (const lang of LANGS) {
      if (!MESSAGES[lang][key]) throw new Error(`brak ${key} w ${lang}`);
    }
  }
});

test('żaden textKey nie obsługuje dwóch lekcji naraz', () => {
  // Przenumerowanie lekcji potrafi skleić dwie na jednym kluczu — obie
  // przechodzą wtedy kontrolę "klucz istnieje w locale", a użytkownik
  // dostaje w jednej lekcji tekst z zupełnie innej.
  /** @type {Map<string, number>} */
  const owner = new Map();
  for (const s of STEPS) {
    for (const m of s.body.matchAll(/textKey(?:Fallback)?:\s*'([^']+)'/g)) {
      const prev = owner.get(m[1]);
      if (prev !== undefined && prev !== s.stage) {
        throw new Error(`${m[1]} użyty w lekcji ${prev} i ${s.stage}`);
      }
      owner.set(m[1], s.stage);
    }
  }
});

test('STAGE_LABELS pokrywa dokładnie zbiór lekcji z kroków', () => {
  const mapped = [
    ...SRC.slice(SRC.indexOf('const STAGE_LABELS')).matchAll(/^\s*(\d+):\s*'ob_stage/gm),
  ].map((m) => Number(m[1]));
  expect(mapped).toEqual(stages);
});

test('żaden klucz ob_* w locale nie jest osierocony', () => {
  // Łapie pozostałości po przenumerowaniu: klucz, do którego nikt już
  // nie sięga, zwykle znaczy że jakiś krok wskazuje na zły.
  // Klucz bywa cytowany w całości ('ob_btn_next'), ale też wpleciony w
  // data-i18n-attr="title:ob_btn_settings;aria-label:ob_btn_settings" —
  // dlatego szukamy po granicy znaku, nie po cudzysłowach. Granica
  // odróżnia też ob_s1_2 od ob_s1_2_empty.
  const referenced = (k) => {
    const rx = new RegExp(`(?<![\\w-])${k}(?![\\w-])`);
    return rx.test(SRC) || rx.test(HTML);
  };
  for (const k of Object.keys(MESSAGES.en)) {
    if (!k.startsWith('ob_')) continue;
    if (!referenced(k)) throw new Error(`${k} nieużywany w onboarding.js ani sidebar.html`);
  }
});

// ── Panel etapów ──────────────────────────────────────────────────

console.log('\n3. Panel etapów');

/** Przyciski etapów z panelu: data-ob-stage + widoczny numer + klucz etykiety. */
const PANEL_BUTTONS = [
  ...HTML.matchAll(
    /data-ob-stage="(\d+)"[\s\S]{0,200}?__num">(\d+)<[\s\S]{0,200}?data-i18n="(ob_stage\d+_label)"/g,
  ),
].map((m) => ({ stage: Number(m[1]), num: Number(m[2]), labelKey: m[3] }));

test('panel ma przycisk dla każdej lekcji i żadnego nadmiarowego', () => {
  expect(PANEL_BUTTONS.map((b) => b.stage)).toEqual(stages);
});

test('widoczny numer zgadza się z data-ob-stage', () => {
  for (const b of PANEL_BUTTONS) {
    if (b.num !== b.stage) {
      throw new Error(`przycisk data-ob-stage="${b.stage}" pokazuje numer ${b.num}`);
    }
  }
});

test('przycisk etapu wskazuje na etykietę swojego etapu', () => {
  for (const b of PANEL_BUTTONS) {
    if (b.labelKey !== `ob_stage${b.stage}_label`) {
      throw new Error(`etap ${b.stage} ma etykietę ${b.labelKey}`);
    }
  }
});

// ── Cele w DOM ────────────────────────────────────────────────────

console.log('\n4. Cele w sidebar.html');

test('każdy statyczny target istnieje w sidebar.html', () => {
  for (const s of STEPS) {
    const sel = field(s.body, 'target');
    if (!sel) continue; // target: null albo funkcja — sprawdzane niżej
    if (!resolves(sel)) {
      throw new Error(`lekcja ${s.stage}, idx ${s.idx}: target ${sel} nie istnieje`);
    }
  }
});

test('każdy revealHidden istnieje w sidebar.html', () => {
  for (const s of STEPS) {
    const sel = field(s.body, 'revealHidden');
    if (!sel) continue;
    if (!resolves(sel)) {
      throw new Error(`lekcja ${s.stage}, idx ${s.idx}: revealHidden ${sel} nie istnieje`);
    }
  }
});

test('każdy selektor z await istnieje', () => {
  for (const s of STEPS) {
    for (const m of s.body.matchAll(/selector:\s*'([^']+)'/g)) {
      if (!resolves(m[1])) {
        throw new Error(`lekcja ${s.stage}, idx ${s.idx}: await selector ${m[1]} nie istnieje`);
      }
    }
  }
});

test('selektory używane przez helpery kroków też istnieją', () => {
  // noteItemTarget/noteListEmpty żyją poza tablicą STEPS
  for (const m of SRC.matchAll(/querySelector\('([^']+)'\)/g)) {
    if (!resolves(m[1])) throw new Error(`helper celuje w nieistniejące ${m[1]}`);
  }
});

test('krok typu try ma na co czekać', () => {
  for (const s of STEPS) {
    if (!/type:\s*'try'/.test(s.body)) continue;
    if (!/await:/.test(s.body)) {
      throw new Error(`lekcja ${s.stage}, idx ${s.idx}: 'try' bez await — tour utknie`);
    }
  }
});

// ── Pokrycie funkcji ──────────────────────────────────────────────

console.log('\n5. Pokrycie');

test('tour pokazuje, jak nadać każdy stan, po którym da się filtrować', () => {
  // Lekcja 5 uczy filtrów "ważne" i "tylko w trakcie". Jeśli przewodnik
  // nie pokazuje przycisków nadających te stany, uczy filtrować po czymś,
  // czego użytkownik nie umie ustawić.
  const targets = new Set(
    STEPS.map((s) => field(s.body, 'target')).filter(Boolean),
  );
  for (const sel of ['#important-btn', '#focus-btn', '#convert-type']) {
    if (!targets.has(sel)) throw new Error(`tour nie pokazuje ${sel}`);
  }
});

test('składnia priorytetów jest opisana w tekstach lekcji', () => {
  for (const lang of LANGS) {
    const all = Object.keys(MESSAGES[lang])
      .filter((k) => k.startsWith('ob_'))
      .map((k) => MESSAGES[lang][k].message)
      .join(' ');
    for (const token of ['!!', '!>']) {
      if (!all.includes(token)) {
        throw new Error(`${lang}: żadna lekcja nie wspomina o "${token}"`);
      }
    }
  }
});

await results();

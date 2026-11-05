/**
 * security-surface.test.mjs — strażnik deklaracji z docs/SECURITY.md
 *
 * Dokument dla działów bezpieczeństwa obiecuje konkretne rzeczy: trzy
 * uprawnienia, zero dostępu do stron, zero połączeń sieciowych, zero
 * zdalnego i dynamicznie budowanego kodu. Te testy sprawiają, że obietnica
 * nie rozjedzie się z kodem po cichu: dodanie uprawnienia, fetch() albo
 * poluzowanie CSP robi suite czerwonym, zanim zmiana trafi do wydania.
 * Zmieniasz świadomie powierzchnię ataku? Popraw najpierw SECURITY.md,
 * potem ten plik.
 */

import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { test, expect, results } from './_runner.mjs';

const read = (rel) =>
  readFileSync(fileURLToPath(new URL('../' + rel, import.meta.url)), 'utf8');

const MANIFEST = JSON.parse(read('manifest.json'));

/** Cały kod uruchamiany w rozszerzeniu: scripts/*.js + background.js */
const SOURCES = [
  ...readdirSync(fileURLToPath(new URL('../scripts', import.meta.url)))
    .filter((f) => f.endsWith('.js'))
    .map((f) => ({ name: `scripts/${f}`, src: read(`scripts/${f}`) })),
  { name: 'background.js', src: read('background.js') },
];

/** Komentarze nie są kodem — usuń je, żeby nie łapać przykładów z opisów. */
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

/** @param {RegExp} rx */
function offenders(rx) {
  return SOURCES.filter(({ src }) => rx.test(stripComments(src))).map((s) => s.name);
}

const csp = Object.fromEntries(
  MANIFEST.content_security_policy
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const [name, ...vals] = d.split(/\s+/);
      return [name, vals.join(' ')];
    }),
);

test('uprawnienia: dokładnie storage, alarms, notifications', () => {
  expect([...MANIFEST.permissions].sort()).toEqual(['alarms', 'notifications', 'storage']);
});

test('brak opcjonalnych uprawnień i uprawnień do stron', () => {
  expect(MANIFEST.optional_permissions ?? []).toEqual([]);
  expect(MANIFEST.host_permissions ?? []).toEqual([]);
  for (const p of MANIFEST.permissions) {
    if (/[:/*<]/.test(p)) throw new Error(`uprawnienie do adresów: ${p}`);
  }
});

test('brak skryptów wstrzykiwanych w strony i zasobów dostępnych dla stron', () => {
  for (const key of ['content_scripts', 'web_accessible_resources', 'externally_connectable', 'user_scripts']) {
    if (key in MANIFEST) throw new Error(`manifest zawiera ${key}`);
  }
});

test('deklaracja: rozszerzenie nie zbiera danych', () => {
  expect(MANIFEST.browser_specific_settings.gecko.data_collection_permissions.required)
    .toEqual(['none']);
});

test('CSP: tylko własne skrypty, bez sieci, ramek, workerów i formularzy', () => {
  expect(csp['script-src']).toBe("'self'");
  expect(csp['object-src']).toBe("'none'");
  expect(csp['base-uri']).toBe("'none'");
  expect(csp['img-src']).toBe("'self' data:");
  for (const d of ['connect-src', 'frame-src', 'worker-src', 'media-src', 'form-action']) {
    expect(csp[d]).toBe("'none'");
  }
  for (const [d, v] of Object.entries(csp)) {
    if (/unsafe-eval|unsafe-inline|https?:|\*/.test(v)) {
      throw new Error(`CSP ${d} poluzowane: ${v}`);
    }
  }
});

test('kod nie nawiązuje połączeń sieciowych', () => {
  expect(offenders(/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|RTCPeerConnection/)).toEqual([]);
});

test('kod nie wykonuje dynamicznie budowanych skryptów', () => {
  expect(offenders(/\beval\s*\(|new\s+Function\s*\(|set(?:Timeout|Interval)\s*\(\s*['"`]/)).toEqual([]);
});

test('kod nie czyta kart, historii, ciasteczek ani schowka', () => {
  expect(offenders(/browser\.(?:tabs|history|cookies|bookmarks|webRequest|downloads)\b|navigator\.clipboard\.read/)).toEqual([]);
});

test('importy tylko lokalne (bez zdalnych modułów)', () => {
  expect(offenders(/(?:import|from)\s*\(?\s*['"`](?!\.{1,2}\/)/)).toEqual([]);
});

await results();

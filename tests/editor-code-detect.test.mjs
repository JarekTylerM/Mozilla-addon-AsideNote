/**
 * editor-code-detect.test.mjs — kiedy wklejony tekst staje się blokiem kodu
 *
 * Dwie strony tej samej monety: CSP, .env czy JSON mają wejść jako blok
 * kodu (linie, stała szerokość, bez linków), a zwykła notatka — także
 * polska lista z punktami zakończonymi średnikiem — nie.
 */

import { test, expect, results } from './_runner.mjs';
import { looksLikeCode } from './editor-code-detect.mjs';

console.log('\n1. Kod i konfiguracja → tak');

const yes = {
  'CSP rozbite na dyrektywy': "default-src 'none';\nscript-src 'self';\nimg-src 'self' data: https://cdn.example.com;\nconnect-src https://api.example.com;",
  'CSP bez średników': "default-src 'none'\nscript-src 'self' https://cdn.example.com\nstyle-src 'self'",
  '.env': 'API_URL=https://api.example.com\nDEBUG=false\nTIMEOUT=30',
  JSON: '{\n  "name": "asidenote",\n  "version": "1.1.0"\n}',
  'JavaScript z wcięciem': 'function go(a) {\n  if (a) {\n    run();\n  }\n}',
  'nginx': 'server {\n  listen 80;\n  server_name example.com;\n}',
  'SQL': 'SELECT id, title\nFROM notes\nWHERE done = 0;\nORDER BY id;',
  'HTML': '<ul>\n  <li>a</li>\n</ul>',
};
for (const [name, text] of Object.entries(yes)) {
  test(name, () => { expect(looksLikeCode(text)).toBe(true); });
}

console.log('\n2. Zwykły tekst → nie');

const no = {
  'jedna linia': "default-src 'none';",
  'notatka': 'Kupić bilety na koncert\nZadzwonić do Ani w sprawie kawy\nSpacer w niedzielę',
  'polska lista ze średnikami': 'Na weekend:\n1) bilety na koncert;\n2) kawa z Anią;\n3) prezent dla mamy.',
  'lista z dwukropkami': 'Termin: piątek\nMiejsce: kawiarnia\nGodzina: 18:00',
  'mail': 'Cześć,\n\nw piątek idziemy na koncert; bilety mam ja.\nDo zobaczenia!',
  'markdown': '# Plan\n\n- spacer\n- kawa',
  'pusty': '',
};
for (const [name, text] of Object.entries(no)) {
  test(name, () => { expect(looksLikeCode(text)).toBe(false); });
}

await results();

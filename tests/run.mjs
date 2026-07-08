/**
 * run.mjs — odpala wszystkie pliki testowe i zbiera wyniki
 *
 * Uruchomienie: node tests/run.mjs
 */

import { spawnSync } from 'child_process';
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { fileURLToPath } from 'url';
const testsDir = fileURLToPath(new URL('.', import.meta.url));
const scriptsDir = fileURLToPath(new URL('../scripts', import.meta.url));

/**
 * Regeneruj mirrory tests/*.mjs z scripts/*.js.
 *
 * Testy importują czyste moduły jako .mjs (ESM w Node bez browser API).
 * Mirrory są gitignore'owane i generowane — wcześniej ręcznie przez sync.bat
 * (tylko Windows). Robimy to tutaj, cross-platform, przed każdym uruchomieniem,
 * żeby suite ZAWSZE testował aktualny kod źródłowy — nie da się już przeoczyć
 * synca i testować nieaktualnej kopii (był to realny bug: stałe mirrory dawały
 * fałszywe faile na heading-split i data-language).
 *
 * tags.mjs NIE jest mirrorem — ma własne mocki (patrz tests/tags.mjs) i jest
 * commitowany. Dlatego nie ma go na liście.
 */
const MIRRORED = [
  'parser',
  'sanitize',
  'alarms',
  'storage',
  'quick-capture-core',
  'utils',
  'editor-url',
  'editor-pattern',
  'editor-block-analyzer',
  'editor-selection',
];

function syncMirrors() {
  // Import między mirrorami musi wskazywać na .mjs (np. quick-capture-core →
  // parser). Przepisujemy ścieżki tylko dla modułów z listy MIRRORED.
  const rewrite = new RegExp(
    `(from\\s+['"]\\./(?:${MIRRORED.join('|')}))\\.js(['"])`,
    'g',
  );
  for (const name of MIRRORED) {
    const src = readFileSync(join(scriptsDir, `${name}.js`), 'utf8');
    writeFileSync(join(testsDir, `${name}.mjs`), src.replace(rewrite, '$1.mjs$2'));
  }
}

syncMirrors();

// Znajdź wszystkie *.test.mjs w katalogu tests/
const files = readdirSync(testsDir)
  .filter(f => f.endsWith('.test.mjs'))
  .sort();

if (files.length === 0) {
  console.log('Brak plików *.test.mjs w tests/');
  process.exit(0);
}

console.log(`\nAsideNotes Test Suite — ${files.length} plik(ów)\n${'═'.repeat(60)}`);

let totalPassed = 0, totalFailed = 0, totalBugged = 0;
const failedFiles = [];

for (const file of files) {
  const filePath = join(testsDir, file);
  console.log(`\n▶ ${file}`);

  const result = spawnSync('node', [filePath], { encoding: 'utf8' });

  // Wypisz stdout pliku testowego
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr && result.exitCode !== 0) process.stderr.write(result.stderr);

  // Parsuj wyniki z ostatniej linii "Wyniki: X/Y"
  const match = result.stdout?.match(/Wyniki: (\d+)\/(\d+) ✓\s+\|\s+(\d+) ✗[^|]*\|\s+(\d+)/);
  if (match) {
    const [, p, total, f, b] = match.map(Number);
    totalPassed += p;
    totalFailed += f;
    totalBugged += b;
    if (f > 0) failedFiles.push(file);
  }
}

const totalTests = totalPassed + totalFailed;
console.log(`\n${'═'.repeat(60)}`);
console.log('PODSUMOWANIE WSZYSTKICH TESTÓW');
console.log(`${'─'.repeat(60)}`);
console.log(`  Testy:   ${totalPassed}/${totalTests} ✓`);
console.log(`  Faile:   ${totalFailed} ✗`);
console.log(`  Bugi:    ${totalBugged} 🐛 aktywnych`);

if (failedFiles.length) {
  console.log(`\n  Pliki z failami:`);
  for (const f of failedFiles) console.log(`    • ${f}`);
}

console.log('');
process.exit(totalFailed > 0 ? 1 : 0);

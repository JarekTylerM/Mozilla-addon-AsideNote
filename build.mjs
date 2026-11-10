#!/usr/bin/env node
/**
 * build.mjs — AsideNotes AMO build script
 *
 * Uruchomienie: node build.mjs
 * Output:       dist/  +  asidenotes-X.Y.Z.zip
 *
 * Wersja testowa: node build.mjs --dev
 * Output:         dist-dev/ (bez minifikacji i bez ZIP-a), z własnym ID, a więc
 *                 z osobnymi danymi. Patrz build-dev-manifest.mjs.
 *
 * Wersja testowa do podpisania w AMO ("Na własną rękę"): node build.mjs --self
 * Output:         dist-self/ + asidenotes-dev-X.Y.Z.zip + updates/asidenotes-dev.json
 *

 * Co robi:
 *   - Minifikuje JS  (usuwa komentarze, whitespace, puste linie)
 *   - Minifikuje CSS (usuwa komentarze, whitespace)
 *   - Minifikuje HTML (usuwa komentarze, zbędny whitespace)
 *   - Kopiuje bez zmian: manifest.json, _locales, assets
 *   - Pakuje do ZIP gotowego do AMO
 *
 * Bez zewnętrznych zależności — tylko Node.js built-ins.
 * Wymaga: Node.js 18+
 *
 * AMO source code: przy submisji załącz źródła (katalog bez dist/)
 * lub wskaż ten skrypt jako build instruction.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync,
         statSync, copyFileSync, existsSync, rmSync } from 'fs';
import { join, extname, dirname, relative } from 'path';
import { createWriteStream } from 'fs';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import {
  toDevManifest,
  toSelfDistributedManifest,
  withUpdateEntry,
  devUpdateLink,
  DEV_ICON_PATH,
  DEV_ICON_SVG,
  DEV_UPDATE_URL,
  DEV_UPDATES_FILE,
} from './build-dev-manifest.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const IS_SELF = process.argv.includes('--self');
const IS_DEV = IS_SELF || process.argv.includes('--dev');
const DIST = join(ROOT, IS_SELF ? 'dist-self' : IS_DEV ? 'dist-dev' : 'dist');

/** @param {string} name wartość z --name=wartość */
function argValue(name) {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : undefined;
}

// Tylko --self: wersja paczki testowej niezależna od wersji głównej z AMO,
// np. node build.mjs --self --version=1.0.1.1 --version-name=1.0.1a
const SELF_OVERRIDE = {
  version: argValue('version'),
  versionName: argValue('version-name'),
};
if (!IS_SELF && (SELF_OVERRIDE.version || SELF_OVERRIDE.versionName)) {
  console.error('--version i --version-name działają tylko z --self');
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────

function read(p)       { return readFileSync(p, 'utf8'); }
function write(p, s)   { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s, 'utf8'); }
function copyBin(s, d) { mkdirSync(dirname(d), { recursive: true }); copyFileSync(s, d); }

function size(b) {
  return b < 1024 ? `${b}B` : `${(b / 1024).toFixed(1)}KB`;
}

function walk(dir, cb, base = dir) {
  readdirSync(dir).forEach(f => {
    const full = join(dir, f);
    if (statSync(full).isDirectory()) walk(full, cb, base);
    else cb(full, relative(base, full));
  });
}

// ── JS Minifier ──────────────────────────────────────────────────
//
// Podejście: state machine przez każdy znak.
// Stany: code, lineComment, blockComment, string, templateLiteral, regex
// Bezpieczne dla:
//   - stringów z // i /* wewnątrz
//   - template literals z zagnieżdżonymi wyrażeniami
//   - URL w stringach (https://)
//   - regex literałów

function minifyJS(src) {
  let out = '';
  let i = 0;
  let state = 'code';         // code | lineComment | blockComment | string | template | regex
  let strChar = '';           // ' lub "
  let prevToken = '';         // ostatni niebiały token (do detekcji regex)
  let depth = 0;              // głębokość ${} w template literals

  const REGEX_PREV = new Set([
    '=', '(', '[', '!', '&', '|', '?', ':', ',', ';',
    '{', '}', 'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  ]);

  function canBeRegex() {
    return REGEX_PREV.has(prevToken) || prevToken === '';
  }

  while (i < src.length) {
    const c  = src[i];
    const c2 = src.slice(i, i + 2);

    switch (state) {
      case 'code':
        if (c2 === '//') {
          state = 'lineComment'; i += 2;
        } else if (c2 === '/*') {
          // Zachowaj komentarze licencyjne /*!
          if (src[i + 2] === '!') {
            const end = src.indexOf('*/', i + 3);
            if (end !== -1) { out += src.slice(i, end + 2); i = end + 2; }
            else { out += src.slice(i); i = src.length; }
          } else {
            state = 'blockComment'; i += 2;
          }
        } else if (c === '`') {
          state = 'template'; depth = 0; out += c; i++;
        } else if (c === '"' || c === "'") {
          state = 'string'; strChar = c; out += c; i++;
        } else if (c === '/' && canBeRegex()) {
          state = 'regex'; out += c; i++;
        } else if (c === '\n' || c === '\r') {
          // Zamień newline na spację zamiast usuwać — chroni ASI
          if (out.length && out[out.length - 1] !== '\n' &&
              out[out.length - 1] !== ' ') {
            out += '\n';
          }
          i++;
        } else if (c === ' ' || c === '\t') {
          // Kolaps whitespace: jedna spacja jeśli potrzebna
          if (out.length && out[out.length - 1] !== ' ' &&
              out[out.length - 1] !== '\n' &&
              out[out.length - 1] !== '(' &&
              out[out.length - 1] !== '[' &&
              out[out.length - 1] !== '{') {
            out += ' ';
          }
          i++;
        } else {
          if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') {
            prevToken = /\w/.test(c) ? (prevToken + c).slice(-16) : c;
          }
          out += c; i++;
        }
        break;

      case 'lineComment':
        if (c === '\n') { state = 'code'; out += '\n'; i++; }
        else i++;
        break;

      case 'blockComment':
        if (c2 === '*/') { state = 'code'; i += 2; }
        else i++;
        break;

      case 'string':
        out += c; i++;
        if (c === '\\') { out += src[i] || ''; i++; }
        else if (c === strChar) state = 'code';
        break;

      case 'template':
        out += c; i++;
        if (c === '\\') { out += src[i] || ''; i++; }
        else if (c === '`') state = 'code';
        else if (c === '$' && src[i] === '{') { out += src[i]; i++; depth++; }
        else if (c === '}' && depth > 0) depth--;
        break;

      case 'regex':
        out += c; i++;
        if (c === '\\') { out += src[i] || ''; i++; }
        else if (c === '[') {
          // Character class — kopiuj do ]
          while (i < src.length && src[i] !== ']') {
            if (src[i] === '\\') { out += src[i]; i++; }
            out += src[i]; i++;
          }
          if (i < src.length) { out += src[i]; i++; }
        } else if (c === '/') {
          // Koniec regex — kopiuj flagi
          while (i < src.length && /[gimsuy]/.test(src[i])) {
            out += src[i]; i++;
          }
          state = 'code';
          prevToken = '/';
        }
        break;
    }
  }

  // Post-processing: usuń wielokrotne puste linie, trim
  return out
    .replace(/\n{2,}/g, '\n')     // max 1 newline
    .replace(/ *\n */g, '\n')     // trailing spaces przed/po newline
    .trim();
}

// ── CSS Minifier ─────────────────────────────────────────────────

function minifyCSS(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')      // usuń komentarze /* */
    .replace(/\s*([{};:,>~])\s*/g, '$1')   // whitespace wokół tokenów (bez + — niszczy calc)
    .replace(/\s*!\s*important/g, '!important')
    .replace(/\n+/g, ' ')                   // newlines → spacja
    .replace(/\s{2,}/g, ' ')                // multi-space → single
    .replace(/;\s*}/g, '}')                 // usuń ; przed }
    .replace(/\s*{\s*/g, '{')
    .replace(/\s*}\s*/g, '}')
    .trim();
}

// ── HTML Minifier ─────────────────────────────────────────────────

function minifyHTML(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')    // usuń komentarze HTML
    .replace(/>\s+</g, '><')            // whitespace między tagami
    .replace(/\s{2,}/g, ' ')            // multi-space → single
    .replace(/^\s+|\s+$/gm, '')         // trim każdej linii
    .replace(/\n+/g, '\n')              // multi-newline → single
    .trim();
}

// ── Build ────────────────────────────────────────────────────────

// Wyczyść dist/
if (existsSync(DIST)) rmSync(DIST, { recursive: true });
mkdirSync(DIST, { recursive: true });

// Wczytaj manifest żeby dostać wersję
const manifest = JSON.parse(read(join(ROOT, 'manifest.json')));
// Paczka --self może mieć własny numer (SELF_OVERRIDE), wersja główna nie
const version  = (IS_SELF && SELF_OVERRIDE.version) || manifest.version;

let totalOrig = 0;
let totalMin  = 0;
const stats   = [];

function processFile(srcPath, relPath) {
  const destPath = join(DIST, relPath);
  const ext = extname(srcPath).toLowerCase();

  // Pliki binarne — kopiuj bez zmian
  if (['.png', '.jpg', '.svg', '.ico', '.woff', '.woff2'].includes(ext)) {
    copyBin(srcPath, destPath);
    return;
  }

  const original = read(srcPath);
  const origSize = Buffer.byteLength(original, 'utf8');
  totalOrig += origSize;

  let minified;
  if (IS_DEV) {
    // Czytelne źródła ułatwiają debugowanie. Sam manifest dostaje własne ID.
    const toManifest = IS_SELF
      ? (/** @type {any} */ m) => toSelfDistributedManifest(m, SELF_OVERRIDE)
      : toDevManifest;
    minified = relPath === 'manifest.json'
      ? JSON.stringify(toManifest(JSON.parse(original)), null, 2)
      : original;
  }
  else if (ext === '.js')   minified = minifyJS(original);
  else if (ext === '.css')  minified = minifyCSS(original);
  else if (ext === '.html') minified = minifyHTML(original);
  else                      minified = original; // JSON, txt — bez zmian

  const minSize = Buffer.byteLength(minified, 'utf8');
  totalMin += minSize;

  const pct  = ((1 - minSize / origSize) * 100).toFixed(0);
  const flag = minSize < origSize ? `  -${pct}%` : '';
  stats.push({ file: relPath, orig: origSize, min: minSize, flag });

  write(destPath, minified);
}

// Pomijamy: node_modules, dist, tests, .git, build pliki, features.css (zastąpiony),
// pliki deweloperskie (README, tsconfig, sync.bat) — nie należą do rozszerzenia.
// LICENSE świadomie NIE jest tu wymieniony: MPL-2.0 §3.1 wymaga, żeby tekst
// licencji towarzyszył dystrybuowanym źródłom.
const IGNORE = new Set([
  'node_modules', 'dist', 'dist-dev', 'dist-self', 'updates', 'tests', '.git', 'docs',
  'build.mjs', 'build.js', 'build-dev-manifest.mjs',
  'package.json', 'package-lock.json',
  'features.css',   // zastąpiony przez 7 plików tematycznych
  'README.md', 'tsconfig.json', 'sync.bat',
]);

function buildDir(dir) {
  readdirSync(dir).forEach(f => {
    if (IGNORE.has(f) || f.startsWith('.')) return;
    // Archiwa nigdy nie należą do paczki. Krytyczne: zip wyjściowy powstaje
    // w ROOT (patrz zipPath niżej) i jest kasowany dopiero PO buildDir(ROOT),
    // więc bez tego filtra każdy build wpakowywał do dist/ paczkę poprzedniego
    // — a ta zawierała jeszcze wcześniejszą. Stąd 7,6 MB zamiast ~700 KB.
    if (f.toLowerCase().endsWith('.zip')) return;
    // Deklaracje typów TS (types.d.ts itp.) to artefakt dev (checkJs), nie
    // należą do rozszerzenia — przeglądarka ich nie używa.
    if (f.toLowerCase().endsWith('.d.ts')) return;
    const full = join(dir, f);
    const rel  = relative(ROOT, full);
    const stat = statSync(full);
    if (stat.isDirectory()) buildDir(full);
    else processFile(full, rel);
  });
}

buildDir(ROOT);

if (IS_DEV) write(join(DIST, DEV_ICON_PATH), DEV_ICON_SVG);

// ── ZIP ──────────────────────────────────────────────────────────

// AMO i Firefox wymagają forward-slash w ścieżkach archiwum (ZIP APPNOTE 4.4.17).
// PowerShell 5.1 Compress-Archive zapisuje backslashe → zasoby (np. assets\...)
// nie ładują się, a linter AMO odrzuca paczkę. Pakujemy Pythonem (zipfile zawsze
// daje '/'), z fallbackiem na Info-ZIP; Compress-Archive tylko w ostateczności.
const zipName = IS_SELF ? `asidenotes-dev-${version}.zip` : `asidenotes-${version}.zip`;
const zipPath = join(ROOT, zipName);

function _findPython() {
  for (const cmd of ['python3', 'python', 'py']) {
    try {
      execSync(`${cmd} --version`, { stdio: 'pipe' });
      return cmd;
    } catch {
      /* próbuj następny */
    }
  }
  return null;
}

/** Pakuje DIST → zipPath z forward-slashami (spec-compliant, sortowane). */
function _zipWithPython(py) {
  const helper = join(tmpdir(), `asidenote-zip-${process.pid}.py`);
  const script = [
    'import zipfile, os, sys',
    'dist, out = sys.argv[1], sys.argv[2]',
    "with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:",
    '    for root, _dirs, files in os.walk(dist):',
    '        for f in sorted(files):',
    '            full = os.path.join(root, f)',
    "            arc = os.path.relpath(full, dist).replace(os.sep, '/')",
    '            z.write(full, arc)',
  ].join('\n');
  writeFileSync(helper, script, 'utf8');
  try {
    execSync(`${py} "${helper}" "${DIST}" "${zipPath}"`, { stdio: 'pipe' });
  } finally {
    try { rmSync(helper); } catch { /* best-effort cleanup */ }
  }
}

// Wersja testowa ładowana lokalnie nie idzie do dystrybucji, więc nie ma paczki
if (!IS_DEV || IS_SELF) try {
  if (existsSync(zipPath)) rmSync(zipPath);
  const py = _findPython();
  if (py) {
    _zipWithPython(py);
  } else if (process.platform !== 'win32') {
    execSync(`cd "${DIST}" && zip -rX "${zipPath}" .`, { stdio: 'pipe' });
  } else {
    execSync(
      `powershell -Command "Compress-Archive -Path '${DIST}\\*' -DestinationPath '${zipPath}'"`,
      { stdio: 'pipe' }
    );
    console.log('\n⚠️  ZIP przez Compress-Archive — ścieżki mogą mieć backslashe (PS 5.1),');
    console.log('   co odrzuci linter AMO. Zainstaluj Pythona lub Info-ZIP i przebuduj.');
  }
  const zipSize = statSync(zipPath).size;
  console.log(`\n📦 ${zipName} — ${(zipSize / 1024).toFixed(1)} KB`);
} catch (e) {
  console.log(`\n⚠️  ZIP failed: ${e.message}`);
  console.log(`   dist/ jest gotowe — spakuj ręcznie.`);
}

// ── Report ───────────────────────────────────────────────────────

console.log('\nAsideNotes Build Report');
console.log('═'.repeat(60));

stats
  .filter(s => s.flag)
  .sort((a, b) => (b.orig - b.min) - (a.orig - a.min))
  .forEach(s => {
    const bar = '█'.repeat(Math.round((1 - s.min / s.orig) * 20));
    console.log(
      `  ${s.file.padEnd(38)} ${size(s.orig).padStart(7)} → ${size(s.min).padStart(7)}  ${s.flag.trim().padStart(4)}  ${bar}`
    );
  });

const saved    = totalOrig - totalMin;
const savedPct = ((saved / totalOrig) * 100).toFixed(1);
console.log('─'.repeat(60));
console.log(`  Łącznie: ${size(totalOrig)} → ${size(totalMin)}  (oszczędność: ${size(saved)} / ${savedPct}%)`);
console.log(`\n  Output: ${IS_SELF ? 'dist-self/' : IS_DEV ? 'dist-dev/' : 'dist/'}`);
if (IS_SELF) {
  const updatesPath = join(ROOT, DEV_UPDATES_FILE);
  const existing = existsSync(updatesPath) ? JSON.parse(read(updatesPath)) : null;
  write(updatesPath, JSON.stringify(withUpdateEntry(existing, version), null, 2) + '\n');
  console.log(`\n  Do wysłania na AMO ("Na własną rękę"): ${zipName}`);
  console.log(`  Plik aktualizacji:  ${DEV_UPDATES_FILE}`);
  console.log(`  Sprawdzany pod:     ${DEV_UPDATE_URL}`);
  console.log(`  Podpisane .xpi ma trafić pod: ${devUpdateLink(version)}`);
} else if (IS_DEV) {
  console.log('  Załaduj w about:debugging: dist-dev/manifest.json');
  console.log('  Osobne dane, nazwa "AsideNotes DEV", skróty Alt+Shift+W i Alt+Shift+A.');
}

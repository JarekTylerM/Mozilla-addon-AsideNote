#!/usr/bin/env node
/**
 * build.mjs — AsideNotes AMO build script
 *
 * Uruchomienie: node build.mjs
 * Output:       dist/  +  asidenotes-X.Y.Z.zip
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const DIST = join(ROOT, 'dist');

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
const version  = manifest.version;

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
  if (ext === '.js')        minified = minifyJS(original);
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

// Pomijamy: node_modules, dist, tests, .git, build pliki, features.css (zastąpiony)
const IGNORE = new Set([
  'node_modules', 'dist', 'tests', '.git',
  'build.mjs', 'build.js',
  'package.json', 'package-lock.json',
  'features.css',   // zastąpiony przez 7 plików tematycznych
]);

function buildDir(dir) {
  readdirSync(dir).forEach(f => {
    if (IGNORE.has(f) || f.startsWith('.')) return;
    const full = join(dir, f);
    const rel  = relative(ROOT, full);
    const stat = statSync(full);
    if (stat.isDirectory()) buildDir(full);
    else processFile(full, rel);
  });
}

buildDir(ROOT);

// ── ZIP ──────────────────────────────────────────────────────────

const zipName = `asidenotes-${version}.zip`;
const zipPath = join(ROOT, zipName);

try {
  if (existsSync(zipPath)) rmSync(zipPath);
  const isWin = process.platform === 'win32';
  if (isWin) {
    execSync(
      `powershell -Command "Compress-Archive -Path '${DIST}\\*' -DestinationPath '${zipPath}'"`,
      { stdio: 'pipe' }
    );
  } else {
    execSync(`cd "${DIST}" && zip -r "${zipPath}" .`, { stdio: 'pipe' });
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
console.log(`\n  Output: dist/`);

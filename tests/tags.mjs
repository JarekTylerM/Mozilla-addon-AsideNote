/**
 * tests/tags.mjs — tags.js przystosowany do testów Node.js
 *
 * Różnice względem scripts/tags.js:
 *   1. saveTags → noop (brak browser.storage w Node.js)
 *   2. import storage.js → zastąpiony noop inline
 *   3. import sanitize.js → ./sanitize.mjs (skopiowane przez sync.bat)
 *
 * NIE kopiować przez sync.bat — patrz komentarz w sync.bat.
 */

import { validateText, MAX_TAG_NAME_LEN } from './sanitize.mjs';

// ── Mock: saveTags noop ───────────────────────────────────────────
function saveTags() { /* noop — brak browser.storage w Node.js */ }

// ── Reszta identyczna z scripts/tags.js ──────────────────────────

export const PALETTE = [
  { bg: '#e8edf5', fg: '#2d4a7a', darkBg: '#1e2a3a', darkFg: '#8aafd4' },
  { bg: '#e4ede8', fg: '#2d5a42', darkBg: '#1a2e22', darkFg: '#7aaf8e' },
  { bg: '#ede8ed', fg: '#5a3068', darkBg: '#2a1a30', darkFg: '#b07acc' },
  { bg: '#f0eadf', fg: '#6b4822', darkBg: '#2e2010', darkFg: '#c4946a' },
  { bg: '#e8e4f0', fg: '#3d2d7a', darkBg: '#1e1a32', darkFg: '#9a88d4' },
  { bg: '#f0e8e3', fg: '#6b3420', darkBg: '#2e1810', darkFg: '#c4806a' },
  { bg: '#e3eaea', fg: '#2a5258', darkBg: '#162828', darkFg: '#7ab0b4' },
  { bg: '#eaece0', fg: '#3d4a22', darkBg: '#1e2212', darkFg: '#96aa6a' },
  { bg: '#ede3ea', fg: '#6b2d4a', darkBg: '#2e1422', darkFg: '#c47898' },
  { bg: '#e3ece8', fg: '#1e5240', darkBg: '#122820', darkFg: '#70a892' },
  { bg: '#ece8e3', fg: '#4a3d2d', darkBg: '#221e18', darkFg: '#aa9880' },
  { bg: '#e8e3ec', fg: '#3d2d5a', darkBg: '#1e1828', darkFg: '#9888bc' },
];

export const tagState = { tags: [] };

export function getTag(id) {
  return tagState.tags.find((t) => t.id === id) ?? null;
}

export function createTag(name) {
  const result = validateText(name, MAX_TAG_NAME_LEN);
  if (result.error) return { ok: false, error: result.error };
  const trimmed = result.value.trim();
  if (!trimmed) return { ok: false, error: 'validation_empty' };

  const color = PALETTE[tagState.tags.length % PALETTE.length];
  const tag = {
    id: `tag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: trimmed,
    color,
  };
  tagState.tags.push(tag);
  saveTags(tagState.tags);
  return { ok: true, tag };
}

export function updateTag(id, name) {
  const tag = tagState.tags.find((t) => t.id === id);
  if (!tag) return { ok: false, error: 'validation_tagNotFound' };

  const result = validateText(name, MAX_TAG_NAME_LEN);
  if (result.error) return { ok: false, error: result.error };
  const trimmed = result.value.trim();
  if (!trimmed) return { ok: false, error: 'validation_empty' };

  tag.name = trimmed;
  saveTags(tagState.tags);
  return { ok: true };
}

export function deleteTag(id) {
  tagState.tags = tagState.tags.filter((t) => t.id !== id);
  saveTags(tagState.tags);
}

export function updateTagColor(id, color) {
  const tag = tagState.tags.find((t) => t.id === id);
  if (!tag) return;
  tag.color = color;
  saveTags(tagState.tags);
}

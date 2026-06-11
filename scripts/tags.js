/* ══════════════════════════════════════════════════════════════
   tags.js — stan tagów + CRUD + factory dla pilla
   ──────────────────────────────────────────────────────────────
   createTag i updateTag zwracają { ok, tag?, error? } żeby UI mogło
   pokazać komunikat walidacji (np. "nazwa za długa"). Caller, który
   nie obsługuje błędu, może sprawdzić result.ok i zignorować szczegóły.
   ══════════════════════════════════════════════════════════════ */

import { saveTags } from './storage.js';
import { validateText, MAX_TAG_NAME_LEN } from './sanitize.js';

export const PALETTE = [
  { bg: '#e8edf5', fg: '#2d4a7a', darkBg: '#1e2a3a', darkFg: '#8aafd4' }, // dusty blue
  { bg: '#e4ede8', fg: '#2d5a42', darkBg: '#1a2e22', darkFg: '#7aaf8e' }, // dusty sage
  { bg: '#ede8ed', fg: '#5a3068', darkBg: '#2a1a30', darkFg: '#b07acc' }, // dusty mauve
  { bg: '#f0eadf', fg: '#6b4822', darkBg: '#2e2010', darkFg: '#c4946a' }, // warm amber
  { bg: '#e8e4f0', fg: '#3d2d7a', darkBg: '#1e1a32', darkFg: '#9a88d4' }, // soft lavender
  { bg: '#f0e8e3', fg: '#6b3420', darkBg: '#2e1810', darkFg: '#c4806a' }, // warm terra
  { bg: '#e3eaea', fg: '#2a5258', darkBg: '#162828', darkFg: '#7ab0b4' }, // soft teal
  { bg: '#eaece0', fg: '#3d4a22', darkBg: '#1e2212', darkFg: '#96aa6a' }, // soft olive
  { bg: '#ede3ea', fg: '#6b2d4a', darkBg: '#2e1422', darkFg: '#c47898' }, // dusty rose
  { bg: '#e3ece8', fg: '#1e5240', darkBg: '#122820', darkFg: '#70a892' }, // forest
  { bg: '#ece8e3', fg: '#4a3d2d', darkBg: '#221e18', darkFg: '#aa9880' }, // warm brown
  { bg: '#e8e3ec', fg: '#3d2d5a', darkBg: '#1e1828', darkFg: '#9888bc' }, // midnight
];

export const tagState = { tags: [] };

export function getTag(id) {
  return tagState.tags.find((t) => t.id === id) ?? null;
}

/**
 * Tworzy tag z walidacją nazwy.
 * @returns {{ ok: boolean, tag?: object, error?: string }} klucz i18n błędu
 */
export function createTag(name) {
  const result = validateText(name, MAX_TAG_NAME_LEN);
  if (result.error) {
    return { ok: false, error: result.error };
  }
  const trimmed = result.value.trim();
  if (!trimmed) {
    return { ok: false, error: 'validation_empty' };
  }

  const color = PALETTE[tagState.tags.length % PALETTE.length];
  const tag = {
    id: `tag_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: trimmed,
    color,
  };
  tagState.tags.push(tag);
  saveTags(tagState.tags);
  return { ok: true, tag };
}

/**
 * Aktualizuje nazwę tagu z walidacją.
 * @returns {{ ok: boolean, error?: string }}
 */
export function updateTag(id, name) {
  const tag = tagState.tags.find((t) => t.id === id);
  if (!tag) return { ok: false, error: 'validation_tagNotFound' };

  const result = validateText(name, MAX_TAG_NAME_LEN);
  if (result.error) {
    return { ok: false, error: result.error };
  }
  const trimmed = result.value.trim();
  if (!trimmed) {
    return { ok: false, error: 'validation_empty' };
  }

  tag.name = trimmed;
  saveTags(tagState.tags);
  return { ok: true };
}

export function deleteTag(id) {
  tagState.tags = tagState.tags.filter((t) => t.id !== id);
  saveTags(tagState.tags);
}

/**
 * Factory dla DOM elementu .tag-pill
 * @param {object} tag
 * @param {object} [opts]
 * @param {number} [opts.truncate=0]   - skróć nazwę do N znaków, dodaj title
 * @param {boolean} [opts.removable=false] - dodaje klasę --removable
 */
export function makeTagPill(
  tag,
  { truncate = 0, removable = false, interactive = false } = {},
) {
  // <button> gdy element jest klikalny (filter, selector dropdown, removable w edytorze)
  // <span> gdy pasywny (display only — np. tagi na elemencie listy)
  const clickable = removable || interactive;
  const pill = document.createElement(clickable ? 'button' : 'span');

  if (clickable) {
    pill.type = 'button'; // żeby <button> w przyszłym <form> nie submitował
  }

  pill.className = 'tag-pill pill' + (removable ? ' pill--clickable' : '');
  pill.textContent =
    truncate && tag.name.length > truncate
      ? tag.name.slice(0, truncate) + '…'
      : tag.name;
  pill.style.setProperty('--tag-bg-light', tag.color.bg);
  pill.style.setProperty('--tag-fg-light', tag.color.fg);
  pill.style.setProperty('--tag-bg-dark',  tag.color.darkBg || tag.color.bg);
  pill.style.setProperty('--tag-fg-dark',  tag.color.darkFg || tag.color.fg);
  if (truncate) pill.title = tag.name;
  return pill;
}

export function updateTagColor(id, color) {
  const tag = tagState.tags.find((t) => t.id === id);
  if (!tag) return;
  tag.color = color;
  saveTags(tagState.tags);
}

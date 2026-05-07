/* ══════════════════════════════════════════════════════════════
   tags.js — stan tagów + CRUD + factory dla pilla
   ══════════════════════════════════════════════════════════════ */

import { saveTags } from "./storage.js";

const PALETTE = [
  { bg: "#dbeafe", fg: "#1d4ed8" },
  { bg: "#dcfce7", fg: "#15803d" },
  { bg: "#fce7f3", fg: "#be185d" },
  { bg: "#fef9c3", fg: "#a16207" },
  { bg: "#ede9fe", fg: "#6d28d9" },
  { bg: "#ffedd5", fg: "#c2410c" },
  { bg: "#f0f9ff", fg: "#0369a1" },
  { bg: "#f7fee7", fg: "#3f6212" },
];

export const tagState = { tags: [] };

export function getTag(id) {
  return tagState.tags.find(t => t.id === id) ?? null;
}

export function createTag(name) {
  const color = PALETTE[tagState.tags.length % PALETTE.length];
  const tag = { id: `tag_${Date.now()}`, name: name.trim(), color };
  tagState.tags.push(tag);
  saveTags(tagState.tags);
  return tag;
}

export function updateTag(id, name) {
  const tag = tagState.tags.find(t => t.id === id);
  if (!tag) return;
  tag.name = name.trim();
  saveTags(tagState.tags);
}

export function deleteTag(id) {
  tagState.tags = tagState.tags.filter(t => t.id !== id);
  saveTags(tagState.tags);
}

/**
 * Factory dla DOM elementu .tag-pill
 * @param {object} tag
 * @param {object} [opts]
 * @param {number} [opts.truncate=0]   - skróć nazwę do N znaków, dodaj title
 * @param {boolean} [opts.removable=false] - dodaje klasę --removable
 */
export function makeTagPill(tag, { truncate = 0, removable = false } = {}) {
  const pill = document.createElement("span");
  pill.className = "tag-pill pill" + (removable ? " pill--clickable" : "");
  pill.textContent = truncate && tag.name.length > truncate
    ? tag.name.slice(0, truncate) + "…"
    : tag.name;
  pill.style.setProperty("--tag-bg", tag.color.bg);
  pill.style.setProperty("--tag-fg", tag.color.fg);
  if (truncate) pill.title = tag.name;
  return pill;
}

/* ══════════════════════════════════════════════════════════════
   storage.js — warstwa persystencji
   Jedyne miejsce dotykające browser.storage.local
   ══════════════════════════════════════════════════════════════ */

/* ── Notes ────────────────────────────────────── */

export async function loadNotes() {
  const res = await browser.storage.local.get("notes");
  const notes = res.notes || [];
  // migracja: stare notatki bez type
  return notes.map(n => n.type ? n : { ...n, type: "note" });
}

export function saveNotes(notes) {
  browser.storage.local.set({ notes });
}

/* ── Tags ─────────────────────────────────────── */

export async function loadTags() {
  const res = await browser.storage.local.get("tags");
  return res.tags || [];
}

export function saveTags(tags) {
  browser.storage.local.set({ tags });
}

/* ── Collapsed sections ───────────────────────── */

export async function loadCollapsedSections() {
  const res = await browser.storage.local.get("collapsedSections");
  return res.collapsedSections || ["done"];
}

export function saveCollapsedSections(sections) {
  browser.storage.local.set({ collapsedSections: sections });
}

/* ── Filter prefs ─────────────────────────────── */

export async function loadFilterPrefs() {
  const res = await browser.storage.local.get("filterPrefs");
  return res.filterPrefs || {};
}

export function saveFilterPrefs(prefs) {
  browser.storage.local.set({ filterPrefs: prefs });
}

/* ══════════════════════════════════════════════════════════════
   storage.js — warstwa persystencji
   Jedyne miejsce dotykające browser.storage.local

   Schema versioning:
   - CURRENT_SCHEMA to bieżąca wersja modelu danych notatek.
   - loadNotes() czyta zapisany schemaVersion; jeśli starszy niż bieżący,
     przepuszcza dane przez migrateNotes() i zapisuje nową wersję.
   - migrateNotes() obsługuje transformacje modelu między wersjami schematu.
     Każda przyszła zmiana schematu dokłada tu kolejny blok `if (fromVersion < N)`.
   - loadNotes() wykonuje dodatkowo defensywną normalizację typów — niezależnie
     od wersji schematu. Zabezpiecza przed storage poisoning przez devtools.
   - Eksport JSON (panel.js) również zapisuje schemaVersion; import może
     przepuścić wczytane dane przez migrateNotes() (patrz panel.js).

   save*: wszystkie zwracają Promise i rzucają błąd dalej. Caller, który
   nie potrzebuje czekać, może wołać bez await (zachowanie jak dawniej).
   ══════════════════════════════════════════════════════════════ */

export const CURRENT_SCHEMA = 3;

/* ── Migracja modelu notatek ──────────────────── */

/**
 * Przekształca tablicę notatek ze starszego schematu do bieżącego.
 * Wołane przez loadNotes() (dane z storage) oraz przez import (dane z JSON).
 *
 * Zakłada że input jest tablicą obiektów — defensywna normalizacja typów
 * jest osobno w loadNotes() i nie jest tu duplikowana.
 *
 * @param {Array} notes - notatki w dowolnym starszym schemacie
 * @param {number} fromVersion - schemaVersion danych wejściowych (0 = brak)
 * @returns {Array} notatki w schemacie CURRENT_SCHEMA
 */
export function migrateNotes(notes, fromVersion = 0) {
  let result = notes;

  // v0 → v1: zapewnij pole `type` na każdej notatce.
  if (fromVersion < 1) {
    result = result.map((n) => (n.type ? n : { ...n, type: 'note' }));
  }

// v1 → v2: dodaj pole recurrence na taskach
  if (fromVersion < 2) {
    result = result.map((n) =>
      n.type === 'task' && n.recurrence === undefined
        ? { ...n, recurrence: null }
        : n,
    );
  }

  // v2 → v3: dodaj pole recurrenceDays na taskach
  if (fromVersion < 3) {
    result = result.map((n) =>
      n.type === 'task' && n.recurrenceDays === undefined
        ? { ...n, recurrenceDays: null }
        : n,
    );
  }

  return result;
}

/* ── Notes ────────────────────────────────────── */

export async function loadNotes() {
  const res = await browser.storage.local.get(['notes', 'schemaVersion']);

  // Defensywna normalizacja — wykonywana zawsze, niezależnie od schemaVersion.
  // Odrzuca wpisy bez poprawnego ID i normalizuje typy pól.
  // Zabezpiecza przed storage poisoning przez devtools (np. tags: {} zamiast [],
  // title: 12345 zamiast string, content: null) który mógłby crashować renderList().
  const raw = Array.isArray(res.notes) ? res.notes : [];
  let notes = raw
    .filter(
      (n) =>
        n &&
        typeof n === 'object' &&
        typeof n.id === 'string' &&
        n.id.length > 0,
    )
    .map((n) => ({
      ...n,
      title:   typeof n.title   === 'string' ? n.title   : '',
      content: typeof n.content === 'string' ? n.content : '',
      type:    n.type === 'task'              ? 'task'    : 'note',
      tags:    Array.isArray(n.tags)          ? n.tags    : [],
      created: typeof n.created === 'number'  ? n.created : Date.now(),
    }));

  const version = typeof res.schemaVersion === 'number' ? res.schemaVersion : 0;

  if (version < CURRENT_SCHEMA) {
    notes = migrateNotes(notes, version);
    // Utrwal zmigrowane dane + nową wersję schematu
    try {
      await browser.storage.local.set({ notes, schemaVersion: CURRENT_SCHEMA });
    } catch (e) {
      console.error('[storage] schema migration save failed:', e);
      // Nie rzucamy — lepiej zwrócić zmigrowane dane w pamięci
      // niż wywalić boot; przy następnym starcie migracja spróbuje ponownie
    }
  }

  return notes;
}

export async function saveNotes(notes) {
  try {
    await browser.storage.local.set({ notes });
  } catch (e) {
    console.error('[storage] saveNotes failed:', e);
    throw e;
  }
}

/* ── Tags ─────────────────────────────────────── */

export async function loadTags() {
  const res = await browser.storage.local.get('tags');
  // Array.isArray guard — tags: {} po poisoning crashowałoby tagState.tags.find()
  return Array.isArray(res.tags) ? res.tags : [];
}

export async function saveTags(tags) {
  try {
    await browser.storage.local.set({ tags });
  } catch (e) {
    console.error('[storage] saveTags failed:', e);
    throw e;
  }
}

/* ── Collapsed sections ───────────────────────── */

export async function loadCollapsedSections() {
  const res = await browser.storage.local.get('collapsedSections');
  return Array.isArray(res.collapsedSections)
    ? res.collapsedSections
    : ['done', 'overdue'];
}

export async function saveCollapsedSections(sections) {
  try {
    await browser.storage.local.set({ collapsedSections: sections });
  } catch (e) {
    console.error('[storage] saveCollapsedSections failed:', e);
    throw e;
  }
}

/* ── Filter prefs ─────────────────────────────── */

export async function loadFilterPrefs() {
  const res = await browser.storage.local.get('filterPrefs');
  return res.filterPrefs || {};
}

export async function saveFilterPrefs(prefs) {
  try {
    await browser.storage.local.set({ filterPrefs: prefs });
  } catch (e) {
    console.error('[storage] saveFilterPrefs failed:', e);
    throw e;
  }
}

/* ── Focus id ─────────────────────────────────── */

export async function loadFocusId() {
  const res = await browser.storage.local.get('focusId');
  // Migracja: stary format to string lub null → konwertuj na tablicę
  const val = res.focusId;
  if (Array.isArray(val)) return val;
  if (val && typeof val === 'string') return [val];
  return [];
}

export async function saveFocusId(ids) {
  try {
    await browser.storage.local.set({ focusId: ids });
  } catch (e) {
    console.error('[storage] saveFocusId failed:', e);
  }
}

/* ── UI settings ──────────────────────────────── */

export async function loadUiSettings() {
  const res = await browser.storage.local.get('uiSettings');
  return {
    showToolbar:         true,
    showToolbarTooltips: true,
    colorScheme:         'auto',
    showEditorPlaceholder: true,
    ...(res.uiSettings || {}),
  };
}

export async function saveUiSettings(patch) {
  // Merge z istniejącymi — żeby zmiana jednego pola nie kasowała pozostałych
  try {
    const current = await loadUiSettings();
    await browser.storage.local.set({ uiSettings: { ...current, ...patch } });
  } catch (e) {
    console.error('[storage] saveUiSettings failed:', e);
    throw e;
  }
}

/* ── Backup przed importem ────────────────────── */

/**
 * Zapisuje migawkę bieżących danych pod osobnym kluczem, żeby import
 * (który nadpisuje wszystko) był odwracalny. Trzyma tylko jedną migawkę
 * — ostatnią sprzed importu.
 */
export async function saveLastBackupBeforeImport(snapshot) {
  try {
    await browser.storage.local.set({ _lastBackupBeforeImport: snapshot });
  } catch (e) {
    console.error('[storage] saveLastBackupBeforeImport failed:', e);
    throw e;
  }
}

export async function loadLastBackupBeforeImport() {
  const res = await browser.storage.local.get('_lastBackupBeforeImport');
  return res._lastBackupBeforeImport || null;
}

/* ── Deleted notes (kosz) ─────────────────────── */

const MAX_DELETED    = 50;                       // max elementów w koszu
const DELETED_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dni auto-expire

export async function loadDeletedNotes() {
  const res = await browser.storage.local.get('deletedNotes');
  // Array.isArray guard — deletedNotes: {} po poisoning crashowałoby .filter()
  const all = Array.isArray(res.deletedNotes) ? res.deletedNotes : [];
  const cutoff = Date.now() - DELETED_TTL_MS;
  // Odfiltruj elementy starsze niż TTL. Brak deletedAt (NaN) → zawsze filtrowane.
  return all.filter(
    (n) => n && typeof n === 'object' && typeof n.deletedAt === 'number' && n.deletedAt >= cutoff,
  );
}

export async function saveDeletedNotes(notes) {
  try {
    await browser.storage.local.set({
      deletedNotes: notes.slice(0, MAX_DELETED),
    });
  } catch (e) {
    console.error('[storage] saveDeletedNotes failed:', e);
    throw e;
  }
}

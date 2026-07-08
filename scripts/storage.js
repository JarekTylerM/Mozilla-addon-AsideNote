// @ts-check
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

/* ── Self-write tracking (sync między oknami) ── */

/*
 * browser.storage.onChanged odpala się także w kontekście, który wykonał
 * zapis. Sidebar (app.js) odróżnia własne zapisy od zapisów z innego okna
 * lub popupu przez znaczniki per-klucz: każdy zapis przez _set() zostawia
 * znacznik, a handler onChanged konsumuje go przez consumeSelfWrite().
 * TTL chroni przed "przeciekiem" znaczników, gdy zapis identycznej wartości
 * nie wygeneruje eventu — przeterminowane znaczniki są ignorowane.
 */
const SELF_WRITE_TTL_MS = 5000;
/** @type {Map<string, number[]>} */
const _selfWrites = new Map(); // klucz → tablica timestampów zapisów

/** @param {string[]} keys */
function _markSelfWrites(keys) {
  const now = Date.now();
  for (const k of keys) {
    const arr = _selfWrites.get(k) ?? [];
    arr.push(now);
    _selfWrites.set(k, arr);
  }
}

/**
 * Czy ostatnia zmiana klucza pochodzi z tego kontekstu?
 * Konsumuje jeden znacznik (FIFO). Wołane z handlera storage.onChanged.
 *
 * @param {string} key
 * @returns {boolean} true = zapis własny, zignoruj event
 */
export function consumeSelfWrite(key) {
  const now = Date.now();
  const arr = (_selfWrites.get(key) ?? []).filter(
    (ts) => now - ts < SELF_WRITE_TTL_MS,
  );
  const own = arr.length > 0;
  if (own) arr.shift();
  _selfWrites.set(key, arr);
  return own;
}

/* ── Graceful degradation zapisu ──────────────────
   browser.storage.local.set może się nie powieść (quota, uszkodzony
   profil, błąd IO). Dotąd błąd lądował tylko w konsoli — użytkownik
   tracił zmiany bez żadnego sygnału. Nieudane zapisy trafiają do
   _pendingWrites: UI (app.js) pokazuje baner z akcją "Ponów" po evencie
   storage:save-error, a auto-retry ponawia zapis co 5 s. Udany zapis
   klucza kasuje jego zaległą wersję — świeże dane nigdy nie zostaną
   nadpisane starszymi z kolejki. */

/** @type {Record<string, any> | null} */
let _pendingWrites = null; // { klucz: wartość } z nieudanych zapisów
/** @type {ReturnType<typeof setTimeout> | null} */
let _retryTimer = null;

/** @param {string} type */
function _notifySaveState(type) {
  // storage.js jest importowany też w testach node (bez DOM)
  if (typeof document !== "undefined") {
    document.dispatchEvent(new CustomEvent(type));
  }
}

/**
 * Jedyne wejście zapisu — znakuje klucze przed browser.storage.local.set.
 * @param {Record<string, any>} obj
 */
async function _set(obj) {
  const keys = Object.keys(obj);
  _markSelfWrites(keys);
  try {
    await browser.storage.local.set(obj);
    if (_pendingWrites) {
      // Nowszy udany zapis klucza unieważnia jego zaległą wersję
      for (const k of keys) delete _pendingWrites[k];
      if (Object.keys(_pendingWrites).length === 0) {
        _pendingWrites = null;
        _notifySaveState("storage:save-ok");
      }
    }
  } catch (e) {
    _pendingWrites = { ...(_pendingWrites || {}), ...obj };
    _notifySaveState("storage:save-error");
    if (!_retryTimer) {
      _retryTimer = setTimeout(() => {
        _retryTimer = null;
        retryPendingWrites();
      }, 5000);
    }
    throw e;
  }
}

/**
 * Ponawia zaległe zapisy — wołane z banera "Ponów" (app.js) i auto-retry.
 * @returns {Promise<boolean>} true gdy po próbie nic nie zalega
 */
export async function retryPendingWrites() {
  if (!_pendingWrites) return true;
  try {
    await _set({ ..._pendingWrites });
    return true;
  } catch {
    // Klucze wróciły do _pendingWrites (catch w _set), kolejny
    // auto-retry jest już zaplanowany — baner zostaje widoczny
    return false;
  }
}

/* ── Migracja modelu notatek ──────────────────── */

/**
 * Przekształca tablicę notatek ze starszego schematu do bieżącego.
 * Wołane przez loadNotes() (dane z storage) oraz przez import (dane z JSON).
 *
 * Zakłada że input jest tablicą obiektów — defensywna normalizacja typów
 * jest osobno w loadNotes() i nie jest tu duplikowana.
 *
 * @param {Note[]} notes - notatki w dowolnym starszym schemacie
 * @param {number} fromVersion - schemaVersion danych wejściowych (0 = brak)
 * @returns {Note[]} notatki w schemacie CURRENT_SCHEMA
 */
export function migrateNotes(notes, fromVersion = 0) {
  let result = notes;

  // v0 → v1: zapewnij pole `type` na każdej notatce.
  if (fromVersion < 1) {
    result = result.map((n) => (n.type ? n : { ...n, type: "note" }));
  }

  // v1 → v2: dodaj pole recurrence na taskach
  if (fromVersion < 2) {
    result = result.map((n) =>
      n.type === "task" && n.recurrence === undefined
        ? { ...n, recurrence: null }
        : n,
    );
  }

  // v2 → v3: dodaj pole recurrenceDays na taskach
  if (fromVersion < 3) {
    result = result.map((n) =>
      n.type === "task" && n.recurrenceDays === undefined
        ? { ...n, recurrenceDays: null }
        : n,
    );
  }

  return result;
}

/* ── Notes ────────────────────────────────────── */

export async function loadNotes() {
  const res = await browser.storage.local.get(["notes", "schemaVersion"]);

  // Defensywna normalizacja — wykonywana zawsze, niezależnie od schemaVersion.
  // Odrzuca wpisy bez poprawnego ID i normalizuje typy pól.
  // Zabezpiecza przed storage poisoning przez devtools (np. tags: {} zamiast [],
  // title: 12345 zamiast string, content: null) który mógłby crashować renderList().
  const raw = Array.isArray(res.notes) ? res.notes : [];
  let notes = raw
    .filter(
      (n) =>
        n &&
        typeof n === "object" &&
        typeof n.id === "string" &&
        n.id.length > 0,
    )
    .map((n) => {
      // Flaga `focus` na notatce to relikt — stan "w trakcie" żyje w kluczu
      // focusId; szczątkowe flagi z historycznych zapisów są zdejmowane,
      // żeby nie zasilały focusIds przy przyszłym eksporcie/imporcie.
      const { focus, ...rest } = n;
      return {
        ...rest,
        title: typeof n.title === "string" ? n.title : "",
        content: typeof n.content === "string" ? n.content : "",
        type: n.type === "task" ? "task" : "note",
        tags: Array.isArray(n.tags) ? n.tags : [],
        created: typeof n.created === "number" ? n.created : Date.now(),
      };
    });

  const version = typeof res.schemaVersion === "number" ? res.schemaVersion : 0;

  if (version < CURRENT_SCHEMA) {
    notes = migrateNotes(notes, version);
    // Utrwal zmigrowane dane + nową wersję schematu
    try {
      await _set({ notes, schemaVersion: CURRENT_SCHEMA });
    } catch (e) {
      console.error("[storage] schema migration save failed:", e);
      // Nie rzucamy — lepiej zwrócić zmigrowane dane w pamięci
      // niż wywalić boot; przy następnym starcie migracja spróbuje ponownie
    }
  }

  return notes;
}

/** @param {Note[]} notes */
export async function saveNotes(notes) {
  try {
    await _set({ notes });
  } catch (e) {
    console.error("[storage] saveNotes failed:", e);
    throw e;
  }
}

/* ── Tags ─────────────────────────────────────── */

export async function loadTags() {
  const res = await browser.storage.local.get("tags");
  // Array.isArray guard — tags: {} po poisoning crashowałoby tagState.tags.find()
  return Array.isArray(res.tags) ? res.tags : [];
}

/** @param {Tag[]} tags */
export async function saveTags(tags) {
  try {
    await _set({ tags });
  } catch (e) {
    console.error("[storage] saveTags failed:", e);
    throw e;
  }
}

/* ── Collapsed sections ───────────────────────── */

export async function loadCollapsedSections() {
  const res = await browser.storage.local.get("collapsedSections");
  return Array.isArray(res.collapsedSections)
    ? res.collapsedSections
    : ["done", "overdue"];
}

/** @param {string[]} sections */
export async function saveCollapsedSections(sections) {
  try {
    await _set({ collapsedSections: sections });
  } catch (e) {
    console.error("[storage] saveCollapsedSections failed:", e);
    throw e;
  }
}

/* ── Filter prefs ─────────────────────────────── */

export async function loadFilterPrefs() {
  const res = await browser.storage.local.get("filterPrefs");
  return res.filterPrefs || {};
}

/** @param {Record<string, any>} prefs */
export async function saveFilterPrefs(prefs) {
  try {
    await _set({ filterPrefs: prefs });
  } catch (e) {
    console.error("[storage] saveFilterPrefs failed:", e);
    throw e;
  }
}

/* ── Focus id ─────────────────────────────────── */

export async function loadFocusId() {
  const res = await browser.storage.local.get("focusId");
  // Migracja: stary format to string lub null → konwertuj na tablicę
  const val = res.focusId;
  if (Array.isArray(val)) return val;
  if (val && typeof val === "string") return [val];
  return [];
}

/** @param {string[]} ids */
export async function saveFocusId(ids) {
  try {
    await _set({ focusId: ids });
  } catch (e) {
    console.error("[storage] saveFocusId failed:", e);
  }
}

/* ── UI settings ──────────────────────────────── */

export async function loadUiSettings() {
  const res = await browser.storage.local.get("uiSettings");
  return {
    showToolbar: true,
    showToolbarTooltips: true,
    colorScheme: "auto",
    showEditorPlaceholder: true,
    uiZoom: 100,
    zenMode: false,
    ...(res.uiSettings || {}),
  };
}

/** @param {Record<string, any>} patch */
export async function saveUiSettings(patch) {
  // Merge z istniejącymi — żeby zmiana jednego pola nie kasowała pozostałych
  try {
    const current = await loadUiSettings();
    await _set({ uiSettings: { ...current, ...patch } });
  } catch (e) {
    console.error("[storage] saveUiSettings failed:", e);
    throw e;
  }
}

/* ── Backup przed importem ────────────────────── */

/**
 * Zapisuje migawkę bieżących danych pod osobnym kluczem, żeby import
 * (który nadpisuje wszystko) był odwracalny. Trzyma tylko jedną migawkę
 * — ostatnią sprzed importu.
 * @param {any} snapshot
 */
export async function saveLastBackupBeforeImport(snapshot) {
  try {
    await _set({ _lastBackupBeforeImport: snapshot });
  } catch (e) {
    console.error("[storage] saveLastBackupBeforeImport failed:", e);
    throw e;
  }
}

export async function loadLastBackupBeforeImport() {
  const res = await browser.storage.local.get("_lastBackupBeforeImport");
  return res._lastBackupBeforeImport || null;
}

/* ── Cursor resume — sprzątanie osieroconych wpisów ── */

/**
 * Usuwa z uiSettings klucze `cursor_<id>` dla notatek, które już nie
 * istnieją. Bez tego każda kiedykolwiek otwarta notatka zostawia po sobie
 * wpis na zawsze — uiSettings rośnie bez ograniczeń. Wołane raz na boot.
 *
 * @param {Iterable<string>} validIds - ID istniejących notatek (aktywne + kosz)
 */
export async function pruneCursorSettings(validIds) {
  try {
    const res = await browser.storage.local.get("uiSettings");
    const ui = res.uiSettings;
    if (!ui || typeof ui !== "object") return;
    const valid = new Set(validIds);
    let changed = false;
    for (const key of Object.keys(ui)) {
      if (key.startsWith("cursor_") && !valid.has(key.slice(7))) {
        delete ui[key];
        changed = true;
      }
    }
    if (changed) await _set({ uiSettings: ui });
  } catch (e) {
    // Sprzątanie jest best-effort — błąd nie może blokować bootu
    console.error("[storage] pruneCursorSettings failed:", e);
  }
}

/* ── Deleted notes (kosz) ─────────────────────── */

export const MAX_DELETED = 50; // max elementów w koszu (używane też w notes.js)
const DELETED_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dni auto-expire

export async function loadDeletedNotes() {
  const res = await browser.storage.local.get("deletedNotes");
  // Array.isArray guard — deletedNotes: {} po poisoning crashowałoby .filter()
  const all = Array.isArray(res.deletedNotes) ? res.deletedNotes : [];
  const cutoff = Date.now() - DELETED_TTL_MS;
  // Odfiltruj elementy starsze niż TTL. Brak deletedAt (NaN) → zawsze filtrowane.
  return all.filter(
    (n) =>
      n &&
      typeof n === "object" &&
      typeof n.deletedAt === "number" &&
      n.deletedAt >= cutoff,
  );
}

/** @param {DeletedNote[]} notes */
export async function saveDeletedNotes(notes) {
  try {
    await _set({
      deletedNotes: notes.slice(0, MAX_DELETED),
    });
  } catch (e) {
    console.error("[storage] saveDeletedNotes failed:", e);
    throw e;
  }
}

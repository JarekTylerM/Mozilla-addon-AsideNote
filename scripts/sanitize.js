// @ts-check
/* ══════════════════════════════════════════════════════════════
   sanitize.js — centralna sanityzacja HTML + walidacja pól
   ──────────────────────────────────────────────────────────────
   Jedyne miejsce definiujące whitelist tagów/atrybutów, walidację
   URL oraz limity długości pól. Używane przez:
   - panel.js (import JSON, walidacja tagów)
   - notes.js (zapis treści edytora do storage, limit title)
   - tags.js (limit nazwy tagu)
   - app.js (live feedback dla pola tytułu)

   Filozofia: sanityzacja przy ZAPISIE (nie tylko przy imporcie).
   Dane w storage są zawsze czyste — editor.innerHTML przy odczycie
   może być przypisane bezpośrednio, bo co trafiło do storage,
   przeszło przez sanitizeHTML().

   Walidacja pól: limit długości (DoS prevention) + odfiltrowanie
   kontrolnych Unicode (bidi spoofing, null bytes).

   ALLOWED_TAGS: podzbiór tagów produkowanych przez edytor. Wszystko
   spoza tej listy jest redukowane do textContent — bez wyjątków.

   ALLOWED_ATTRS: per-tag whitelist atrybutów. Żaden event handler
   (on*) nie przejdzie, bo nie ma go w żadnej liście.
   ══════════════════════════════════════════════════════════════ */

/* ── Limity pól ──────────────────────────────────── */

// Tytuł notatki: 200 znaków to ~2-3 zdania, więcej to nie tytuł.
export const MAX_TITLE_LEN = 200;

// Nazwa tagu: 50 znaków. Tag pill w UI i tak trunkuje na 12 — 50 daje
// buforu na alfabety nie-łacińskie z multibajtowymi znakami.
export const MAX_TAG_NAME_LEN = 50;

// Treść notatki (HTML): 50 KB. Realnie notatka tekstowa to <5 KB;
// 50 KB pozwala na obszerne wklejone fragmenty bez utraty UX, ale chroni
// przed skumulowanym DoS przy imporcie (2 000 notatek × 50 KB = 100 MB
// worst-case w pamięci DOMParsera — akceptowalny górny pułap).
// Poprzedni limit 100 KB przy MAX_IMPORT_NOTES=10 000 dawał ~1 GB.
export const MAX_CONTENT_LEN = 50_000;

// Górny limit surowego HTML ze schowka przy WKLEJANIU (przed sanityzacją).
// Wyższy niż MAX_CONTENT_LEN, bo surowy HTML ze stron jest markup-heavy i
// sanitizeHTML redukuje go do właściwej treści — to guard na paste-bomb ze
// schowka, nie limit rozmiaru zapisanej notatki. Trzymany tu (jedno źródło
// "rozsądnego rozmiaru") zamiast magicznej stałej w editor.js.
export const MAX_PASTE_LEN = 4 * MAX_CONTENT_LEN; // 200 KB

// Liczba notatek w jednym imporcie. 2 000 to dużo nawet dla power-usera,
// a przy MAX_CONTENT_LEN=50 KB daje rozsądny górny pułap pamięci.
export const MAX_IMPORT_NOTES = 2_000;

// Liczba tagów w jednym imporcie.
export const MAX_IMPORT_TAGS = 500;

// ID notatki/tagu: limit znaków + dozwolone tylko alfanumeryczne + "_-".
// Format Date.now().toString(36) + losowy suffix = ~14 znaków; tag_<ts> ~17.
// 100 znaków to luz, ale chroni przed wstrzyknięciem długiego stringa jako ID.
export const MAX_ID_LEN = 100;
const ID_RX = /^[A-Za-z0-9_-]+$/;

// Wartości dla `reminder` (minuty przed due). Zgodne z UI selectem.
const VALID_REMINDERS = new Set([0, 5, 15, 30, 60]);

// Wartości dla `recurrence`.
const VALID_RECURRENCES = new Set([
  'daily',
  'weekly',
  'monthly',
  'yearly',
  'custom',
]);
const VALID_DAYS = new Set([0, 1, 2, 3, 4, 5, 6]);

/**
 * Wycina znaki kontrolne Unicode które mogą służyć do bidi spoofingu lub
 * pozostawiać niewidoczne znaki w polu. Zostawia normalny whitespace
 * (\t \n \r \x20) i wszystkie znaki drukowalne.
 *
 * Usuwane:
 * - U+0000-U+0008, U+000B-U+000C, U+000E-U+001F, U+007F (control)
 * - U+200B-U+200F (zero-width, RTL/LTR marks)
 * - U+202A-U+202E (bidi override)
 * - U+2060-U+206F (invisible operators / formatting)
 * - U+FEFF (BOM)
 * @param {string} str
 */
function _stripControlChars(str) {
  return str.replace(
    /[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g,
    '',
  );
}

/**
 * Waliduje i normalizuje tekst dla pól typu title/tagName.
 * Zwraca { value, error } gdzie:
 * - value to znormalizowany tekst (po stripControlChars, przed limitem)
 * - error to klucz i18n jeśli walidacja się nie udała, albo null
 *
 * Strategia: tnij gdy za długo, ale ZWRÓĆ ERROR ŻEBY UI MOGŁO POKAZAĆ
 * komunikat — nie obcinaj po cichu. Storage nie dostaje zbyt długiego
 * tekstu (caller decyduje co zapisać na podstawie error).
 *
 * @param {*} input - dowolna wartość, nie tylko string
 * @param {number} maxLen
 * @returns {{ value: string, error: string|null, truncated: string }}
 */
export function validateText(input, maxLen) {
  if (input === null || input === undefined) {
    return { value: '', error: null, truncated: '' };
  }
  if (typeof input !== 'string') {
    return { value: '', error: 'validation_notString', truncated: '' };
  }

  const cleaned = _stripControlChars(input);

  if (cleaned.length > maxLen) {
    return {
      value: cleaned,
      error: 'validation_tooLong',
      truncated: cleaned.slice(0, maxLen),
    };
  }

  return { value: cleaned, error: null, truncated: cleaned };
}

/**
 * Walidacja ID (notatki/tagu). Wymaga: string, alfanumeryczny + "_-",
 * długość 1..MAX_ID_LEN. Używane przy imporcie i odczycie z storage.
 *
 * @param {*} id
 * @returns {boolean}
 */
export function isValidId(id) {
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= MAX_ID_LEN &&
    ID_RX.test(id)
  );
}

/**
 * Waliduje i sanityzuje obiekt notatki z importu.
 * Zwraca: { ok: true, note } albo { ok: false }.
 * Notatki które nie pasują do schematu są ODRZUCANE (nie naprawiane) —
 * w imporcie lepiej stracić jedną notatkę niż wpuścić śmieci do storage.
 *
 * @param {*} raw - obiekt z JSON, dowolnego kształtu
 * @returns {{ ok: boolean, note?: Note, truncated?: boolean }}
 */
export function sanitizeImportedNote(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false };
  }

  // ID — wymagane, musi pasować do schematu
  if (!isValidId(raw.id)) return { ok: false };

  // type — "note" albo "task"
  const type = raw.type === 'task' ? 'task' : 'note';

  // title — string, przycięty do MAX_TITLE_LEN, control chars wycięte
  const titleResult = validateText(raw.title, MAX_TITLE_LEN);
  const title = titleResult.truncated;

  // content — sanityzowany HTML (przez sanitizeHTML), przycięty do limitu.
  // Sygnalizujemy przycięcie (truncated), żeby import mógł POINFORMOWAĆ
  // użytkownika zamiast po cichu gubić dane na round-tripie eksport→import
  // (notatka >MAX_CONTENT_LEN eksportuje się w całości, ale import ją tnie).
  let content = '';
  let truncated = false;
  if (typeof raw.content === 'string') {
    truncated = raw.content.length > MAX_CONTENT_LEN;
    const trimmed = truncated
      ? raw.content.slice(0, MAX_CONTENT_LEN)
      : raw.content;
    content = sanitizeHTML(trimmed);
  }

  // created — timestamp (number, dodatni, sensowny zakres)
  const created =
    typeof raw.created === 'number' &&
    raw.created > 0 &&
    raw.created < 4102444800000 // < 2100-01-01
      ? raw.created
      : Date.now();

  // tags — tablica valid ID, max 50 tagów per notatkę
  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter(isValidId).slice(0, 50)
    : [];

  /** @type {Note} */
  const note = { id: raw.id, type, title, content, created, tags };

  // Pola task-only — tylko jeśli type=task
  if (type === 'task') {
    note.completed = raw.completed === true;
    note.focus = raw.focus === true;
    note.important = raw.important === true;

    // due — number (timestamp) albo null
    note.due =
      typeof raw.due === 'number' && raw.due > 0 && raw.due < 4102444800000
        ? raw.due
        : null;

    // time — "HH:MM" w zakresie 00:00-23:59 albo null
    note.time = _validateTimeString(raw.time);

    // reminder — jeden z VALID_REMINDERS
    note.reminder = VALID_REMINDERS.has(raw.reminder) ? raw.reminder : 0;

    // recurrence — null albo jeden z presetów
    note.recurrence = VALID_RECURRENCES.has(raw.recurrence)
      ? raw.recurrence
      : null;

    // recurrenceDays — tablica 1–7 unikalnych dni (0=nd…6=sb), tylko dla custom
    if (note.recurrence === 'custom' && Array.isArray(raw.recurrenceDays)) {
      const days = [
        ...new Set(
          raw.recurrenceDays.filter((/** @type {number} */ d) =>
            VALID_DAYS.has(d),
          ),
        ),
      ];
      note.recurrenceDays = days.length > 0 ? days : [1, 2, 3, 4, 5];
    } else {
      note.recurrenceDays = null;
    }
  }

  // truncated leci w wyniku (nie w note) — caller raportuje, storage zostaje czyste
  return { ok: true, note, truncated };
}

/**
 * Waliduje i sanityzuje obiekt tagu z importu.
 * Tagi bez wymaganych pól są odrzucane (zwraca null).
 *
 * @param {*} raw
 * @returns {object|null}
 */
export function sanitizeImportedTag(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!isValidId(raw.id)) return null;

  // name — wymagana, niepusta po cleanup, max MAX_TAG_NAME_LEN
  const nameResult = validateText(raw.name, MAX_TAG_NAME_LEN);
  const name = nameResult.truncated.trim();
  if (!name) return null;

  // color — { bg, fg } gdzie oba są stringami z hex/rgb (max 30 znaków każdy)
  if (
    !raw.color ||
    typeof raw.color !== 'object' ||
    typeof raw.color.bg !== 'string' ||
    typeof raw.color.fg !== 'string' ||
    raw.color.bg.length > 30 ||
    raw.color.fg.length > 30
  ) {
    return null;
  }
  // Akceptuj tylko proste formaty kolorów (hex #rgb/#rrggbb, rgb(...), nazwy CSS).
  // Blokuje "javascript:" i inne wstrzyknięcia przez fakt że color leci do
  // CSS variable (--tag-bg / --tag-fg) — CSS samo by to zignorowało, ale
  // czyścimy upstream.
  const COLOR_RX = /^(#[0-9a-f]{3,8}|rgba?\([\d\s,.%]+\)|[a-z]+)$/i;
  if (
    !COLOR_RX.test(raw.color.bg.trim()) ||
    !COLOR_RX.test(raw.color.fg.trim())
  ) {
    return null;
  }

  return {
    id: raw.id,
    name,
    color: { bg: raw.color.bg.trim(), fg: raw.color.fg.trim() },
  };
}

/** @param {*} t @returns {string|null} */
function _validateTimeString(t) {
  if (typeof t !== 'string') return null;
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/* ── HTML sanitization ──────────────────────────── */

export const ALLOWED_TAGS = new Set([
  'P',
  'DIV',
  'BR',
  'SPAN',
  'H1',
  'H2',
  'H3',
  'STRONG',
  'B',
  'EM',
  'I',
  'U',
  'S',
  'STRIKE',
  'UL',
  'OL',
  'LI',
  'BLOCKQUOTE',
  'CODE',
  'PRE',
  'A',
  'HR',
  'DETAILS',
  'SUMMARY',
]);

// Tylko href dla <a>. Wszystkie inne atrybuty obcinane.
// UL: data-list dla checklisty ("checklist").
// LI: data-checked dla stanu checkbox ("true"/"false").
// BLOCKQUOTE: data-callout dla typu callouta ("note"|"tip"|"important"|"warning"|"caution").
// CODE: data-language z triggera ```js — używane przy eksporcie do Markdown.
/** @type {Record<string, Set<string>>} */
export const ALLOWED_ATTRS = {
  A: new Set(['href', 'target', 'rel', 'title']),
  OL: new Set(['start']),
  DETAILS: new Set(['open']),
  UL: new Set(['data-list']),
  LI: new Set(['data-checked']),
  BLOCKQUOTE: new Set(['data-callout', 'data-callout-label']),
  CODE: new Set(['data-language']),
};

/**
 * Walidacja schematu URL.
 * Używa URL API zamiast regexu — odporna na:
 *   - whitespace przed schemą (\tjavascript:...)
 *   - newline w środku schematu (java\nscript:...)
 * URL-encoded colon (javascript%3A...) NIE jest zagrożeniem —
 * przeglądarka traktuje to jako ścieżkę, nie schemat.
 *
 * Blokowane schematy: javascript, data, vbscript, file, blob,
 * *-extension (moz-extension:, chrome-extension:).
 *
 * @param {string|null} href
 * @returns {string|null} href do użycia albo null jeśli niebezpieczny
 */
export function safeHref(href) {
  if (!href) return null;
  const trimmed = href.trim();
  if (!trimmed) return null;

  const BLOCKED = new Set([
    'javascript',
    'data',
    'vbscript',
    'file',
    'blob',
    'about',
    'resource',
  ]);

  try {
    const url = new URL(trimmed, 'https://x.invalid');
    const scheme = url.protocol.slice(0, -1).toLowerCase();
    if (BLOCKED.has(scheme) || scheme.endsWith('-extension')) return null;
    return trimmed;
  } catch {
    // Fallback dla URL których URL API nie parsuje (np. mailto:, relative)
    if (
      /^[\s\0]*(?:javascript|data|vbscript|file|blob|about|resource)[\s\0]*:/i.test(
        trimmed,
      )
    )
      return null;
    return trimmed;
  }
}

/**
 * Sanityzuje HTML string.
 * Zwraca string zawierający wyłącznie ALLOWED_TAGS z ALLOWED_ATTRS.
 * Wszystkie on* handlery, <script>, <iframe>, <object>, <embed>,
 * <form>, <input> etc. są usuwane (tag nieznany → jego textContent).
 *
 * @param {string} html
 * @returns {string}
 */
// Maksymalna głębokość drzewa przy sanityzacji. Sensowna notatka nie
// przekracza kilkunastu poziomów (listy zagnieżdżone + inline formatting);
// 60 daje duży zapas. Głębsze poddrzewa są spłaszczane do textContent —
// chroni _cleanNode (rekurencja) przed stack overflow na wrogim HTML
// z importu/paste (np. 50 000 zagnieżdżonych <span>).
const MAX_SANITIZE_DEPTH = 60;

/** @param {string} html @returns {string} */
export function sanitizeHTML(html) {
  if (!html || typeof html !== 'string') return '';

  // DOMParser w detached document — <img onerror=...> nie strzeli przy parse
  const doc = new DOMParser().parseFromString(html, 'text/html');
  _cleanNode(doc.body, doc, 0);
  return doc.body.innerHTML;
}

/** @param {Element} node @param {Document} doc @param {number} depth */
function _cleanNode(node, doc, depth) {
  // Iteruj od końca — modyfikujemy drzewo w trakcie
  const children = Array.from(node.children);
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];

    if (!ALLOWED_TAGS.has(child.tagName) || depth >= MAX_SANITIZE_DEPTH) {
      // Użyj doc zamiast globalnego document — poprawny kontekst DOMParsera
      child.replaceWith(doc.createTextNode(child.textContent || ''));
      continue;
    }

    // Sanityzuj atrybuty — usuń wszystko spoza whitelisty
    const allowedForTag = ALLOWED_ATTRS[child.tagName] || new Set();
    for (const attr of Array.from(child.attributes)) {
      if (!allowedForTag.has(attr.name.toLowerCase())) {
        child.removeAttribute(attr.name);
      }
    }

    // <a>: waliduj href, wymuś rel/target
    if (child.tagName === 'A') {
      const href = safeHref(child.getAttribute('href'));
      if (href === null) {
        child.replaceWith(doc.createTextNode(child.textContent || ''));
        continue;
      }
      child.setAttribute('href', href);
      child.setAttribute('target', '_blank');
      child.setAttribute('rel', 'noopener noreferrer');
    }

    _cleanNode(child, doc, depth + 1);
  }
}

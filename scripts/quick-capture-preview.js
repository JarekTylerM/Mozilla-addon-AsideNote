// @ts-check
/* ══════════════════════════════════════════════════════════════
   quick-capture-preview.js — opis "co zaraz powstanie"
   ──────────────────────────────────────────────────────────────
   Używane przez:
   - app.js       (podgląd pod polem capture w sidebarze)
   - popup.js     (podgląd w mikro-oknie)

   Wcześniej ten sam opis budowały dwie niemal identyczne kopie
   (app.js::_updateQcPreview i popup.js::_updatePreview) i zdążyły się
   rozjechać: sidebar liczył dziś/jutro przez relativeDayLabel (obsługa
   "wczoraj"), popup liczył je inline na innych kluczach locale. Obie
   gubiły też połowę wyniku parsera — `!!`, `!>` i cykliczność nie
   pojawiały się w podglądzie, mimo że quick capture je stosuje.

   Kontrakt: funkcje są czyste — zero DOM, zero `browser`. Tłumaczenie,
   locale i "teraz" wchodzą przez PreviewEnv, więc test podaje własne
   `t` i sztywny znacznik czasu. Renderem (textContent, hidden,
   data-type) zajmuje się caller.
   ══════════════════════════════════════════════════════════════ */

import { parseCapture } from './parser.js';
import { captureDue } from './quick-capture-core.js';
import { normalizeTagName } from './sanitize.js';

/** Separator flag w opisie — także między opisem a flagami (patrz locale). */
const FLAG_SEPARATOR = ' · ';

/** Wartości cykliczności z parsera → klucze locale (te same, co w pickerze). */
const RECURRENCE_KEYS = {
  daily: 'recurrence_daily',
  weekly: 'recurrence_weekly',
  monthly: 'recurrence_monthly',
  yearly: 'recurrence_yearly',
};

/**
 * @typedef {object} PreviewEnv
 * @property {(key: string, subs?: string|string[]) => string} t tłumaczenie
 * @property {string} locale UI locale — do Intl ORAZ do parseCapture
 *   (jawnie, nie autodetekcja: podgląd i zapis muszą parsować tak samo)
 * @property {number} [now] "teraz" — wstrzykiwalne dla testów
 * @property {{ name: string }[]} [tags] istniejące tagi: podgląd odróżnia
 *   przypisanie od utworzenia nowego, żeby literówka nie przeszła niezauważona
 */

/**
 * @typedef {object} CaptureDescription
 * @property {string} text gotowy tekst podglądu
 * @property {"note"|"task"} type typ elementu, który powstanie
 * @property {string} [hint] druga linia: czego parser nie użył albo jak dostać
 *   więcej (`!` przed notatką z datą). Brak pola = nic do dodania.
 */

/**
 * Podpowiedź pod podglądem. Najpierw to, co zostało w tytule wbrew pozorom
 * (25:00, 30.02) — inaczej użytkownik widzi zadanie bez godziny i nie wie
 * czemu. Potem notatka z terminem w treści: bez `!` data nic nie znaczy,
 * a jedno zdanie uczy składni lepiej niż pomoc, której nikt nie otwiera.
 *
 * @param {string} raw
 * @param {boolean} isTask
 * @param {string[]} rejected
 * @param {PreviewEnv} env
 * @returns {string|null}
 */
function _captureHint(raw, isTask, rejected, env) {
  if (rejected.length) {
    return env.t('quickCapture_hint_rejected', [
      rejected.map((text) => `„${text}”`).join(', '),
    ]);
  }
  if (!isTask) {
    const asTask = parseCapture('!' + raw.trim(), env.locale);
    if (asTask.dateGiven || asTask.time || asTask.recurrence) {
      return env.t('quickCapture_hint_makeTask');
    }
  }
  return null;
}

/**
 * Etykieta dnia dla terminu: "dziś" / "jutro" / "wczoraj", a poza tym
 * zakresem — data dzienna w locale użytkownika.
 *
 * "Wczoraj" jest osiągalne: parser przyjmuje datę wsteczną z jawnym rokiem
 * (np. `!raport 06.11.2026` 7 listopada), więc podgląd musi to nazwać.
 *
 * @param {number} timestamp
 * @param {PreviewEnv} env
 * @returns {string}
 */
export function formatCaptureDay(timestamp, env) {
  const startOfDay = (/** @type {Date} */ d) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round(
    (startOfDay(new Date(timestamp)) - startOfDay(new Date(env.now ?? Date.now()))) /
      86400000,
  );

  if (diffDays === 0) return env.t('common_today');
  if (diffDays === 1) return env.t('common_tomorrow');
  if (diffDays === -1) return env.t('common_yesterday');

  return new Intl.DateTimeFormat(env.locale, {
    day: 'numeric',
    month: 'short',
  }).format(new Date(timestamp));
}

/**
 * Opisuje, co powstanie z danego inputu quick capture.
 *
 * Odbicie parsera 1:1 — każde pole, które wpływa na tworzony element
 * (typ, tytuł, termin, godzina, ważność, "w trakcie", cykliczność), musi
 * dać się zobaczyć w tekście. Podgląd, który milczy o `!!`, jest gorszy
 * niż brak podglądu: użytkownik czyta potwierdzenie czegoś innego, niż
 * faktycznie zapisze.
 *
 * @param {string} raw surowy tekst z pola capture
 * @param {PreviewEnv} env
 * @returns {CaptureDescription|null} null gdy nie ma czego pokazywać
 *   (pusty input) — caller wtedy chowa kontener
 */
export function describeCapture(raw, env) {
  if (!raw || !raw.trim()) return null;

  const { isTask, isUrgent, isInProgress, title, due, time, recurrence, tagNames, rejected } =
    parseCapture(raw, env.locale);
  const hint = _captureHint(raw, isTask, rejected, env);

  // Sam tag nie daje tytułu, więc Enter niczego nie doda: podgląd mówi, czego
  // brakuje, zamiast obiecywać wpis, który nie powstanie
  if (!title && tagNames.length) {
    return {
      type: isTask ? 'task' : 'note',
      text: env.t('quickCapture_preview_needTitle'),
      ...(hint && { hint }),
    };
  }

  const known = new Set((env.tags ?? []).map((t) => normalizeTagName(t.name)));
  const tagFlags = tagNames.map((name) =>
    known.has(normalizeTagName(name))
      ? `#${name}`
      : env.t('quickCapture_preview_tag_new', [name]),
  );

  /** @param {string} base @param {string[]} flags */
  const withFlags = (base, flags) =>
    flags.length
      ? env.t('quickCapture_preview_flags', [base, flags.join(FLAG_SEPARATOR)])
      : base;

  if (!isTask) {
    return {
      type: 'note',
      text: withFlags(
        title
          ? env.t('quickCapture_preview_note_titled', [title])
          : env.t('quickCapture_preview_note_empty'),
        tagFlags,
      ),
      ...(hint && { hint }),
    };
  }

  // Ten sam termin, który dostanie zapisywane zadanie — łącznie z regułą
  // "!!/!> bez daty ⇒ dziś" (captureDue, jedna definicja dla obu ścieżek).
  const effectiveDue = captureDue(
    { isUrgent, isInProgress, due },
    env.now ?? Date.now(),
  );

  let dateCtx = '';
  if (effectiveDue) {
    const dateStr = formatCaptureDay(effectiveDue, env);
    dateCtx = time
      ? env.t('quickCapture_preview_date_time', [dateStr, time])
      : dateStr;
  }

  let text;
  if (dateCtx && title) {
    text = env.t('quickCapture_preview_task_dated_titled', [dateCtx, title]);
  } else if (dateCtx) {
    text = env.t('quickCapture_preview_task_dated', [dateCtx]);
  } else if (title) {
    text = env.t('quickCapture_preview_task_titled', [title]);
  } else {
    text = env.t('quickCapture_preview_task_empty');
  }

  // Flagi doklejane jako sufiks, nie wplatane w zdanie — inaczej locale
  // musiałby mieć wariant komunikatu na każdą kombinację ważne × w trakcie
  // × cykliczność × (data, tytuł). Sufiks skaluje się liniowo.
  const flags = [];
  if (isUrgent) flags.push(env.t('quickCapture_preview_flag_important'));
  // Tylko `!>` i `!!>` — `!!` to samo "ważne" (wantsFocusSeed)
  if (isInProgress) {
    flags.push(env.t('quickCapture_preview_flag_inProgress'));
  }
  const recurrenceKey =
    recurrence && recurrence in RECURRENCE_KEYS
      ? RECURRENCE_KEYS[/** @type {keyof typeof RECURRENCE_KEYS} */ (recurrence)]
      : null;
  if (recurrenceKey) flags.push(env.t(recurrenceKey));

  return {
    type: 'task',
    text: withFlags(text, [...flags, ...tagFlags]),
    ...(hint && { hint }),
  };
}

/**
 * Opis tego, co Enter w polu tytułu zmieni w otwartym elemencie, np.
 * "Enter zapisze: jutro o 18:00 · #praca". Pokazywany tylko, gdy parser
 * coś rozpoznał — zwykły tytuł nie dostaje żadnego komunikatu.
 *
 * @param {import('./quick-capture-core.js').TitleEdit|null} edit
 * @param {PreviewEnv} env
 * @returns {{ text: string, hint?: string }|null}
 */
export function describeTitleEdit(edit, env) {
  if (!edit) return null;

  const hint = edit.rejected.length
    ? env.t('quickCapture_hint_rejected', [
        edit.rejected.map((text) => `„${text}”`).join(', '),
      ])
    : null;

  if (!edit.hasChanges) return hint ? { text: '', hint } : null;

  /** @type {string[]} */
  const parts = [];
  if (edit.toTask) parts.push(env.t('titleCapture_toTask'));
  if (edit.due) {
    const day = formatCaptureDay(edit.due, env);
    parts.push(edit.time ? env.t('quickCapture_preview_date_time', [day, edit.time]) : day);
  } else if (edit.time) {
    parts.push(edit.time);
  }
  if (edit.important) parts.push(env.t('quickCapture_preview_flag_important'));
  if (edit.focus) parts.push(env.t('quickCapture_preview_flag_inProgress'));
  if (edit.recurrence && edit.recurrence in RECURRENCE_KEYS) {
    parts.push(env.t(RECURRENCE_KEYS[/** @type {keyof typeof RECURRENCE_KEYS} */ (edit.recurrence)]));
  }
  const known = new Set((env.tags ?? []).map((t) => normalizeTagName(t.name)));
  for (const name of edit.tagNames) {
    parts.push(
      known.has(normalizeTagName(name))
        ? `#${name}`
        : env.t('quickCapture_preview_tag_new', [name]),
    );
  }

  return {
    text: env.t('titleCapture_preview', [parts.join(FLAG_SEPARATOR)]),
    ...(hint && { hint }),
  };
}

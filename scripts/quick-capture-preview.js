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
 */

/**
 * @typedef {object} CaptureDescription
 * @property {string} text gotowy tekst podglądu
 * @property {"note"|"task"} type typ elementu, który powstanie
 */

/**
 * Etykieta dnia dla terminu: "dziś" / "jutro" / "wczoraj", a poza tym
 * zakresem — data dzienna w locale użytkownika.
 *
 * "Wczoraj" jest osiągalne: parser przyjmuje jawną datę wsteczną
 * (np. `!raport 01.01` w lipcu), więc podgląd musi to nazwać.
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

  const { isTask, isUrgent, isInProgress, title, due, time, recurrence } =
    parseCapture(raw, env.locale);

  if (!isTask) {
    return {
      type: 'note',
      text: title
        ? env.t('quickCapture_preview_note_titled', [title])
        : env.t('quickCapture_preview_note_empty'),
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
  // "w trakcie" także dla `!!` — ważne zasiewa focusIds tak samo jak `!>`
  // (wantsFocusSeed w quick-capture-core.js). Bez tego `!!` obiecywałby
  // element bez oznaczenia, a lista pokazywałaby go jako w trakcie.
  if (isInProgress || isUrgent) {
    flags.push(env.t('quickCapture_preview_flag_inProgress'));
  }
  const recurrenceKey =
    recurrence && recurrence in RECURRENCE_KEYS
      ? RECURRENCE_KEYS[/** @type {keyof typeof RECURRENCE_KEYS} */ (recurrence)]
      : null;
  if (recurrenceKey) flags.push(env.t(recurrenceKey));

  if (flags.length) {
    text = env.t('quickCapture_preview_flags', [
      text,
      flags.join(FLAG_SEPARATOR),
    ]);
  }

  return { type: 'task', text };
}

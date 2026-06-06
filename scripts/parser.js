/* ══════════════════════════════════════════════════════════════
   parser.js — parser quick capture (shared: sidebar + popup)
   ──────────────────────────────────────────────────────────────
   Eksportuje parseCapture(input, locale?) → { isTask, title, due, time }
   Locale-aware: PL rozpoznaje jutro/dziś + DD.MM,
                 EN rozpoznaje tomorrow/today + MM/DD.

   Walidacja: niepoprawna data (np. 30.02) lub godzina (np. 25:99) NIE
   jest dopasowywana — fragment zostaje w tytule, żeby user zobaczył,
   że nie został zrozumiany (lepsze niż ciche zrozumienie źle).

   Priorytet przy konflikcie: słowo kluczowe (jutro/dziś) > data liczbowa.
   Gdy input zawiera oba (np. "!coś jutro 15.06") — wygrywa słowo kluczowe,
   data liczbowa jest ignorowana i zostaje w tytule.
   ══════════════════════════════════════════════════════════════ */

const CAPTURE_KEYWORDS_PL = {
  tomorrow: /\bjutro\b/i,
  today: /(?<!\p{L})(dziś|dzisiaj)(?!\p{L})/iu,
  date: /\b(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\b/,
  monthFirst: false,
  weekdays: [
    { rx: /(?<!\p{L})niedziela(?!\p{L})/iu, day: 0 },
    { rx: /(?<!\p{L})poniedzia[łl]ek(?!\p{L})/iu, day: 1 },
    { rx: /(?<!\p{L})wtorek(?!\p{L})/iu, day: 2 },
    { rx: /(?<!\p{L})[śs]roda(?!\p{L})/iu, day: 3 },
    { rx: /(?<!\p{L})czwartek(?!\p{L})/iu, day: 4 },
    { rx: /(?<!\p{L})pi[ąa]tek(?!\p{L})/iu, day: 5 },
    { rx: /(?<!\p{L})sobota(?!\p{L})/iu, day: 6 },
  ],
};

const CAPTURE_KEYWORDS_EN = {
  tomorrow: /\btomorrow\b/i,
  today: /\btoday\b/i,
  date: /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/,
  monthFirst: true,
  weekdays: [
    { rx: /\bsunday\b/i, day: 0 },
    { rx: /\bmonday\b/i, day: 1 },
    { rx: /\btuesday\b/i, day: 2 },
    { rx: /\bwednesday\b/i, day: 3 },
    { rx: /\bthursday\b/i, day: 4 },
    { rx: /\bfriday\b/i, day: 5 },
    { rx: /\bsaturday\b/i, day: 6 },
  ],
};

/**
 * Czy podany (lub wykryty) locale używa formatu MM/DD (US) zamiast DD.MM.
 * @param {string|null} explicitLocale - jawnie przekazany locale, np. "en-US";
 *   gdy null — autodetekcja z browser.i18n / navigator.language.
 */
function _isMonthFirstLocale(explicitLocale = null) {
  const locale = (
    explicitLocale ??
    (typeof browser !== 'undefined' && browser.i18n
      ? browser.i18n.getUILanguage()
      : navigator.language)
  ).toLowerCase();
  return locale === 'en' || locale.startsWith('en-us');
}

function _captureKeywords(explicitLocale) {
  return _isMonthFirstLocale(explicitLocale)
    ? CAPTURE_KEYWORDS_EN
    : CAPTURE_KEYWORDS_PL;
}

/**
 * Ile dni do przodu to następne wystąpienie dnia tygodnia.
 * Liczymy od jutra — ten sam dzień co dziś = za 7 dni.
 */
function _daysUntilWeekday(targetDay, todayDay) {
  const diff = (targetDay - todayDay + 7) % 7;
  return diff === 0 ? 7 : diff;
}

/**
 * Parsuje input quick capture.
 * @param {string} input — raw text z pola capture
 * @param {string|null} [locale] — jawny locale ("en-US", "pl"); null = autodetekcja.
 *   Jawny locale przydatny w testach (bez mockowania globalnego `browser`).
 * @returns {{ isTask: boolean, title: string, due: number|null, time: string|null }}
 */
export function parseCapture(input, locale = null) {
  if (!input || typeof input !== 'string') {
    return { isTask: false, title: '', due: null, time: null };
  }
  const isUrgentInProgress = input.startsWith('!!>');
  const isUrgent = !isUrgentInProgress && input.startsWith('!!');
  const isInProgress = !isUrgentInProgress && input.startsWith('!>');
  const isTask =
    isUrgentInProgress || isUrgent || isInProgress || input.startsWith('!');
  let title = isTask
    ? input
        .slice(isUrgentInProgress ? 3 : isUrgent || isInProgress ? 2 : 1)
        .trim()
    : input.trim();
  let due = null;
  let time = null;

  if (!isTask) return { isTask, title, due, time };

  const kw = _captureKeywords(locale);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // ── Czas — format HH:MM ──
  // Walidacja: godzina 0-23, minuta 0-59. Poza zakresem → nie dopasowuj,
  // zostaw w tytule (user zobaczy, że "25:99" nie zostało zrozumiane).
  const timeMatch = title.match(/\b(\d{1,2}):(\d{2})\b/);
  if (timeMatch) {
    const hh = parseInt(timeMatch[1], 10);
    const mm = parseInt(timeMatch[2], 10);
    if (hh >= 0 && hh < 24 && mm >= 0 && mm < 60) {
      time = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      title = title.replace(timeMatch[0], '').replace(/\s+/g, ' ').trim();
    }
    // poza zakresem — time zostaje null, fragment zostaje w title
  }

  // ── Słowa kluczowe / data ──
  // Priorytet: jutro/dziś > data liczbowa (patrz nagłówek pliku).
  if (kw.tomorrow.test(title)) {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    due = d.getTime();
    title = title.replace(kw.tomorrow, '').replace(/\s+/g, ' ').trim();
  } else if (kw.today.test(title)) {
    due = today.getTime();
    title = title.replace(kw.today, '').replace(/\s+/g, ' ').trim();
  } else {
    const todayDay = today.getDay();
    const weekdayMatch = kw.weekdays.find(({ rx }) => rx.test(title));
    if (weekdayMatch) {
      const d = new Date(today);
      d.setDate(d.getDate() + _daysUntilWeekday(weekdayMatch.day, todayDay));
      due = d.getTime();
      const wdM = weekdayMatch.rx.exec(title);
      if (wdM) title = title.replace(wdM[0], '').replace(/\s+/g, ' ').trim();
    }
  }

  if (!due) {
    const dateMatch = title.match(kw.date);
    if (dateMatch) {
      const first = parseInt(dateMatch[1], 10);
      const second = parseInt(dateMatch[2], 10);
      const year = dateMatch[3]
        ? parseInt(dateMatch[3], 10)
        : today.getFullYear();
      const day = kw.monthFirst ? second : first;
      const month = (kw.monthFirst ? first : second) - 1;

      // Walidacja overflow: JS po cichu przesuwa daty (new Date(2026,1,30)
      // → 2 marca). Sprawdzamy, czy zbudowany Date faktycznie odpowiada
      // wpisanym wartościom. Jeśli nie — data nie istnieje, zostaw w tytule.
      const parsed = new Date(year, month, day, 0, 0, 0, 0);
      if (
        parsed.getFullYear() === year &&
        parsed.getMonth() === month &&
        parsed.getDate() === day
      ) {
        due = parsed.getTime();
        title = title.replace(dateMatch[0], '').replace(/\s+/g, ' ').trim();
      }
      // overflow — due zostaje null, fragment zostaje w title
    }
  }

  // Czas bez daty → dziś
  if (time && !due) due = today.getTime();

  // ── Cykliczność ──
  let recurrence = null;
  const RECURRENCE_PL = [
    { rx: /\bcodziennie\b/i, val: 'daily' },
    { rx: /\bco\s+tydzie[ńn](?!\p{L})/iu, val: 'weekly' },
    { rx: /\bco\s+miesi[ąa]c\b/i, val: 'monthly' },
    { rx: /\bco\s+rok\b/i, val: 'yearly' },
  ];
  const RECURRENCE_EN = [
    { rx: /\bdaily\b/i, val: 'daily' },
    { rx: /\bweekly\b/i, val: 'weekly' },
    { rx: /\bmonthly\b/i, val: 'monthly' },
    { rx: /\byearly\b/i, val: 'yearly' },
  ];
  const recurrenceList = _isMonthFirstLocale(locale)
    ? RECURRENCE_EN
    : RECURRENCE_PL;
  for (const { rx, val } of recurrenceList) {
    if (rx.test(title)) {
      recurrence = val;
      title = title.replace(rx, '').replace(/\s+/g, ' ').trim();
      break;
    }
  }

  return {
    isTask,
    isUrgent: !!isUrgent || !!isUrgentInProgress,
    isInProgress: !!isInProgress || !!isUrgentInProgress,
    title,
    due,
    time,
    recurrence,
  };
}

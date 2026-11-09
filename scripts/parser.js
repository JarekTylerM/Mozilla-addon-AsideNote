// @ts-check
/* ══════════════════════════════════════════════════════════════
   parser.js — parser quick capture (shared: sidebar + popup)
   ──────────────────────────────────────────────────────────────
   Eksportuje parseCapture(input, locale?) →
     { isTask, isUrgent, isInProgress, title, due, time, recurrence, tagNames }
   Locale-aware: PL rozpoznaje jutro/dziś + DD.MM,
                 EN rozpoznaje tomorrow/today + MM/DD.

   Kolejność ma znaczenie:
     1. cudzysłowy — ich treść jest dosłowna i nic jej nie dotknie,
     2. #tagi — przed datami, inaczej `#jutro` byłoby terminem,
     3. godzina, cykliczność, termin.

   Słowa wokół terminu ("na", "w", "od kolejnego", "o") należą do terminu i
   znikają razem z nim. Inaczej `!raport we wtorek` dawało tytuł "raport we".

   Walidacja: niepoprawna data (np. 30.02) lub godzina (np. 25:99) NIE
   jest dopasowywana — fragment zostaje w tytule, żeby user zobaczył,
   że nie został zrozumiany (lepsze niż ciche zrozumienie źle).

   Data bez roku, która już minęła, przechodzi na przyszły rok. Jawny rok
   jest brany dosłownie, także gdy wskazuje przeszłość.

   Priorytet przy konflikcie: słowo kluczowe (jutro/dziś) > data liczbowa.
   Gdy input zawiera oba (np. "!coś jutro 15.06") — wygrywa słowo kluczowe,
   data liczbowa jest ignorowana i zostaje w tytule.
   ══════════════════════════════════════════════════════════════ */

import { MAX_TAG_NAME_LEN, normalizeTagName } from './sanitize.js';

/**
 * Całe słowo lub fraza. `\b` nie działa z polskimi znakami, więc granice
 * wyznacza \p{L}.
 * @param {string} source
 */
const _word = (source) =>
  new RegExp(`(?<!\\p{L})(?:${source})(?!\\p{L})`, 'iu');

/**
 * Regexy jednego dnia tygodnia.
 * @param {number} day
 * @param {string} forms formy pojedyncze ("wtorek", "wtorku")
 * @param {string} plural forma mnoga znacząca "w każdy" ("wtorki")
 * @param {{ before: string, every: string, everyPlural: string }} parts
 */
const _weekday = (day, forms, plural, { before, every, everyPlural }) => ({
  day,
  rx: _word(`${before}(?:${forms})`),
  every: _word(`${every}(?:${forms})|${everyPlural}(?:${plural})`),
});

const PL_WEEKDAY_PARTS = {
  before:
    '(?:(?:od|na|do|w|we)\\s+)?(?:(?:kolejn|nast[ęe]pn|najbli[żz]sz|przysz[łl])\\p{L}*\\s+)?',
  every: '(?:(?:w|we)\\s+)?(?:co|ka[żz]d\\p{L}*)\\s+',
  everyPlural: '(?:w|we)\\s+',
};

const EN_WEEKDAY_PARTS = {
  before: '(?:(?:on|by|from|next|this)\\s+){0,2}',
  every: 'every\\s+',
  everyPlural: '(?:on\\s+)?',
};

const CAPTURE_KEYWORDS_PL = {
  tomorrow: _word('(?:(?:na|do)\\s+)?jutr[oa]'),
  today: _word('(?:(?:na|do)\\s+)?(?:dzi[śs]|dzisiaj)'),
  dayAfterTomorrow: _word('(?:(?:na|do)\\s+)?pojutrze'),
  inWeek: _word('za\\s+tydzie[ńn]'),
  inDays: _word('za\\s+(\\d{1,3})\\s+(?:dni|dzie[ńn])'),
  // Poprzedzające słowa i cyfry wykluczają wersje (1.10.3, "wersja 1.10")
  date: /(?<![\p{L}\d./-])(?<!(?:wersj\p{L}*|version|ver\.?)\s+)(?:(?:na|do|od)\s+)?(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?(?!\d|\.\d)/iu,
  monthFirst: false,
  weekdays: [
    _weekday(0, 'niedziel[aęei]', 'niedziele', PL_WEEKDAY_PARTS),
    _weekday(1, 'poniedzia[łl](?:ek|ku)', 'poniedzia[łl]ki', PL_WEEKDAY_PARTS),
    _weekday(2, 'wtor(?:ek|ku)', 'wtorki', PL_WEEKDAY_PARTS),
    _weekday(3, '[śs]rod[aęey]', '[śs]rody', PL_WEEKDAY_PARTS),
    _weekday(4, 'czwart(?:ek|ku)', 'czwartki', PL_WEEKDAY_PARTS),
    _weekday(5, 'pi[ąa]t(?:ek|ku)', 'pi[ąa]tki', PL_WEEKDAY_PARTS),
    _weekday(6, 'sobot[aęey]', 'soboty', PL_WEEKDAY_PARTS),
  ],
  recurrence: [
    { rx: _word('codziennie|co\\s+dzie[ńn]|ka[żz]dego\\s+dnia'), val: 'daily' },
    { rx: _word('co\\s+tydzie[ńn]'), val: 'weekly' },
    { rx: _word('co\\s+miesi[ąa]c'), val: 'monthly' },
    { rx: _word('co\\s+rok'), val: 'yearly' },
  ],
};

const CAPTURE_KEYWORDS_EN = {
  tomorrow: _word('(?:(?:by|for)\\s+)?tomorrow'),
  today: _word('(?:(?:by|for)\\s+)?today'),
  dayAfterTomorrow: _word('(?:(?:by|for|on)\\s+)?(?:the\\s+)?day\\s+after\\s+tomorrow'),
  inWeek: _word('in\\s+a\\s+week'),
  inDays: _word('in\\s+(\\d{1,3})\\s+days?'),
  date: /(?<![\p{L}\d./-])(?<!(?:version|ver\.?)\s+)(?:(?:on|by|from)\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?(?!\d|\/\d)/iu,
  monthFirst: true,
  weekdays: [
    _weekday(0, 'sunday', 'sundays', EN_WEEKDAY_PARTS),
    _weekday(1, 'monday', 'mondays', EN_WEEKDAY_PARTS),
    _weekday(2, 'tuesday', 'tuesdays', EN_WEEKDAY_PARTS),
    _weekday(3, 'wednesday', 'wednesdays', EN_WEEKDAY_PARTS),
    _weekday(4, 'thursday', 'thursdays', EN_WEEKDAY_PARTS),
    _weekday(5, 'friday', 'fridays', EN_WEEKDAY_PARTS),
    _weekday(6, 'saturday', 'saturdays', EN_WEEKDAY_PARTS),
  ],
  recurrence: [
    { rx: _word('daily|every\\s+day'), val: 'daily' },
    { rx: _word('weekly|every\\s+week'), val: 'weekly' },
    { rx: _word('monthly|every\\s+month'), val: 'monthly' },
    { rx: _word('yearly|every\\s+year'), val: 'yearly' },
  ],
};

/** Godzina z tym, co ją zapowiada: "o 10:30", "na 10:30", "at 10:30", "o godz. 10:30". */
const TIME_RX =
  /(?<![\p{L}\d:])(?:(?:o|na|do|at|by)\s+)?(?:godz(?:\.|in[ąey])?\s*)?(\d{1,2}):(\d{2})(?![\d:])/iu;

/**
 * Tag: `#nazwa` jako osobne słowo. Dzięki temu w tytule zostają `C#`
 * i `https://x.pl/a#sekcja`. Jeden znak interpunkcji za tagiem należy do niego.
 */
const TAG_RX = /(^|\s)#([\p{L}\p{N}][\p{L}\p{N}_-]*)[,;.]?(?=\s|$)/gu;

/** Tekst w cudzysłowie: prosty, polski lub angielski. */
const QUOTED_RX = /["„“]([^"„“”]+)["”]/g;

/** Pierwszy znak prywatnego obszaru Unicode: zastępuje cudzysłowy na czas parsowania. */
const PLACEHOLDER_BASE = 0xe100;

/**
 * Czy dopasowany `#tekst` to tag. `#1234` to numer zgłoszenia, a `#1a2b3c` kolor,
 * więc zostają w tytule. Za długa nazwa też: i tak nie przeszłaby walidacji tagu.
 * @param {string} name
 */
function _isTagName(name) {
  if (name.length > MAX_TAG_NAME_LEN) return false;
  if (!/\p{L}/u.test(name)) return false;
  const looksLikeColor =
    /^(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(name) && /\d/.test(name);
  return !looksLikeColor;
}

/**
 * Wyjmuje tagi z tekstu.
 * @param {string} text
 * @returns {{ text: string, tagNames: string[] }}
 */
function _extractTags(text) {
  /** @type {Map<string, string>} znormalizowana nazwa → pierwsza wpisana forma */
  const found = new Map();
  const rest = text.replace(TAG_RX, (match, before, name) => {
    if (!_isTagName(name)) return match;
    const key = normalizeTagName(name);
    if (!found.has(key)) found.set(key, name);
    return before;
  });
  return {
    text: found.size ? rest.replace(/\s+/g, ' ').trim() : rest,
    tagNames: [...found.values()],
  };
}

/**
 * Chowa cudzysłowy pod znacznikami. Znacznik to jeden znak spoza liter i cyfr,
 * więc żaden regex terminu ani tagu go nie dotknie.
 * @param {string} text
 * @returns {{ text: string, quotes: { raw: string, inner: string }[] }}
 */
function _protectQuotes(text) {
  /** @type {{ raw: string, inner: string }[]} */
  const quotes = [];
  const protectedText = text.replace(QUOTED_RX, (raw, inner) => {
    quotes.push({ raw, inner });
    return String.fromCharCode(PLACEHOLDER_BASE + quotes.length - 1);
  });
  return { text: protectedText, quotes };
}

/**
 * Przywraca cudzysłowy. Sam cudzysłów bez innego tekstu to w zadaniu sposób na
 * dosłowny tytuł (`!"wersja 1.10"`), więc znaki cudzysłowu znikają. W pozostałych
 * przypadkach są częścią tytułu (`!Przeczytać "Lalkę"`).
 * @param {string} text
 * @param {{ raw: string, inner: string }[]} quotes
 * @param {boolean} stripWhole
 */
function _restoreQuotes(text, quotes, stripWhole) {
  if (stripWhole && quotes.length === 1 && text.length === 1) return quotes[0].inner;
  return text.replace(/[-]/g, (ch) => {
    const quote = quotes[ch.charCodeAt(0) - PLACEHOLDER_BASE];
    return quote ? quote.raw : '';
  });
}

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

/** @param {string|null} [explicitLocale] */
function _captureKeywords(explicitLocale) {
  return _isMonthFirstLocale(explicitLocale)
    ? CAPTURE_KEYWORDS_EN
    : CAPTURE_KEYWORDS_PL;
}

/**
 * Ile dni do przodu to następne wystąpienie dnia tygodnia.
 * Liczymy od jutra — ten sam dzień co dziś = za 7 dni.
 * @param {number} targetDay
 * @param {number} todayDay
 */
function _daysUntilWeekday(targetDay, todayDay) {
  const diff = (targetDay - todayDay + 7) % 7;
  return diff === 0 ? 7 : diff;
}

/**
 * @typedef {object} Capture
 * @property {boolean} isTask
 * @property {boolean} isUrgent
 * @property {boolean} isInProgress
 * @property {string} title
 * @property {number|null} due
 * @property {string|null} time
 * @property {string|null} [recurrence]
 * @property {string[]} tagNames nazwy tagów w formie wpisanej przez użytkownika
 */

/**
 * Parsuje input quick capture.
 * @param {string} input — raw text z pola capture
 * @param {string|null} [locale] jawny locale ("en-US", "pl"); null = autodetekcja.
 *   Jawny locale przydatny w testach (bez mockowania globalnego `browser`).
 * @returns {Capture}
 */
export function parseCapture(input, locale = null) {
  if (!input || typeof input !== 'string') {
    return {
      isTask: false,
      isUrgent: false,
      isInProgress: false,
      title: '',
      due: null,
      time: null,
      recurrence: null,
      tagNames: [],
    };
  }
  const isUrgentInProgress = input.startsWith('!!>');
  const isUrgent = !isUrgentInProgress && input.startsWith('!!');
  const isInProgress = !isUrgentInProgress && input.startsWith('!>');
  const isTask =
    isUrgentInProgress || isUrgent || isInProgress || input.startsWith('!');
  const body = isTask
    ? input
        .slice(isUrgentInProgress ? 3 : isUrgent || isInProgress ? 2 : 1)
        .trim()
    : input.trim();

  const { text: protectedBody, quotes } = _protectQuotes(body);
  const { text: withoutTags, tagNames } = _extractTags(protectedBody);
  let title = withoutTags;
  let due = null;
  let time = null;

  if (!isTask)
    return {
      isTask,
      isUrgent: false,
      isInProgress: false,
      title: _restoreQuotes(title, quotes, false),
      due,
      time,
      recurrence: null,
      tagNames,
    };

  const kw = _captureKeywords(locale);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  /** @param {number} offset */
  const dayFromToday = (offset) => {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    return d.getTime();
  };

  /**
   * Usuwa dopasowanie z tytułu.
   * @param {string} matched
   */
  const remove = (matched) => {
    title = title.replace(matched, '').replace(/\s+/g, ' ').trim();
  };

  // ── Czas — format HH:MM ──
  // Walidacja: godzina 0-23, minuta 0-59. Poza zakresem → nie dopasowuj,
  // zostaw w tytule (user zobaczy, że "25:99" nie zostało zrozumiane).
  const timeMatch = title.match(TIME_RX);
  if (timeMatch) {
    const hh = parseInt(timeMatch[1], 10);
    const mm = parseInt(timeMatch[2], 10);
    if (hh >= 0 && hh < 24 && mm >= 0 && mm < 60) {
      time = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      remove(timeMatch[0]);
    }
    // poza zakresem — time zostaje null, fragment zostaje w title
  }

  // ── Cykliczność ──
  /** @type {string|null} */
  let recurrence = null;
  for (const { rx, val } of kw.recurrence) {
    const match = title.match(rx);
    if (match) {
      recurrence = val;
      remove(match[0]);
      break;
    }
  }

  // ── "co wtorek", "w każdą środę", "w piątki" — cykl z terminem naraz ──
  const todayDay = today.getDay();
  for (const { every, day } of kw.weekdays) {
    const match = title.match(every);
    if (match) {
      recurrence ??= 'weekly';
      due = dayFromToday(_daysUntilWeekday(day, todayDay));
      remove(match[0]);
      break;
    }
  }

  // ── Słowa kluczowe / data ──
  // Priorytet: jutro/dziś > data liczbowa (patrz nagłówek pliku).
  // "pojutrze" i "day after tomorrow" muszą iść przed "jutro"/"tomorrow".
  if (!due) {
    /** @type {[RegExp, (m: RegExpMatchArray) => number][]} */
    const relative = [
      [kw.dayAfterTomorrow, () => dayFromToday(2)],
      [kw.tomorrow, () => dayFromToday(1)],
      [kw.today, () => dayFromToday(0)],
      [kw.inWeek, () => dayFromToday(7)],
      [kw.inDays, (m) => dayFromToday(parseInt(m[1], 10))],
    ];
    for (const [rx, toDue] of relative) {
      const match = title.match(rx);
      if (match) {
        due = toDue(match);
        remove(match[0]);
        break;
      }
    }
  }

  if (!due) {
    for (const { rx, day } of kw.weekdays) {
      const match = title.match(rx);
      if (match) {
        due = dayFromToday(_daysUntilWeekday(day, todayDay));
        remove(match[0]);
        break;
      }
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
      /** @param {number} y */
      const validDate = (y) => {
        const parsed = new Date(y, month, day, 0, 0, 0, 0);
        return parsed.getFullYear() === y &&
          parsed.getMonth() === month &&
          parsed.getDate() === day
          ? parsed.getTime()
          : null;
      };

      const thisYear = validDate(year);
      if (thisYear !== null) {
        // Data bez roku, która już minęła, to prawie zawsze najbliższa przyszła:
        // "01.01" w listopadzie to nowy rok, a nie zadanie od razu do nadrobienia.
        // Jawny rok traktujemy dosłownie. Gdy w przyszłym roku takiej daty nie ma
        // (29.02), zostaje ta z bieżącego.
        const rolled =
          !dateMatch[3] && thisYear < today.getTime() ? validDate(year + 1) : null;
        due = rolled ?? thisYear;
        remove(dateMatch[0]);
      }
      // overflow — due zostaje null, fragment zostaje w title
    }
  }

  // Czas bez daty → dziś. Cykl bez daty też: bez terminu kolejna instancja
  // nigdy by nie powstała (notes.js: toggleCompleted wymaga note.due).
  if ((time || recurrence) && !due) due = dayFromToday(0);

  return {
    isTask,
    isUrgent: !!isUrgent || !!isUrgentInProgress,
    isInProgress: !!isInProgress || !!isUrgentInProgress,
    title: _restoreQuotes(title, quotes, true),
    due,
    time,
    recurrence,
    tagNames,
  };
}

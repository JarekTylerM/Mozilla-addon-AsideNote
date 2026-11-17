// @ts-check
/* ══════════════════════════════════════════════════════════════
   parser.js — parser quick capture (shared: sidebar, popup, pole tytułu)
   ──────────────────────────────────────────────────────────────
   Eksportuje parseCapture(input, locale?, options?) → Capture (typedef niżej).

   Język i kolejność daty zależą od locale:
     pl          → polskie słowa, DD.MM
     en, en-US   → angielskie słowa, MM/DD
     inne        → angielskie słowa, DD/MM lub DD.MM; zapis US (06/15),
                   którego nie da się odczytać jako DD/MM, też przejdzie.

   Kolejność ma znaczenie:
     1. cudzysłowy — ich treść jest dosłowna i nic jej nie dotknie,
     2. #tagi — przed datami, inaczej `#jutro` byłoby terminem,
     3. godzina z minutami / am-pm / "godz." — przed datą, bo "o 10.05"
        to godzina, a nie 10 maja,
     4. cykliczność, termin (słowa > dzień tygodnia > data),
     5. sama godzina bez minut ("o 18") — na końcu, gdy terminy już zniknęły
        z tekstu, więc "o 18 jutro" też zadziała.

   Słowa wokół terminu ("na", "w", "od kolejnego", "o") należą do terminu i
   znikają razem z nim. Inaczej `!raport we wtorek` dawało tytuł "raport we".

   Świadomość użytkownika: wynik mówi nie tylko CO wyszło, ale też Z CZEGO.
     tokens   — fragmenty, które parser zrozumiał (podgląd może je pokazać),
     rejected — fragmenty wyglądające na datę/godzinę, które nie istnieją
                (30.02, 25:00). Zostają w tytule, a podgląd mówi dlaczego —
                lepsze niż ciche zrozumienie źle albo ciche zignorowanie.

   Data bez roku, która już minęła, przechodzi na przyszły rok. Jawny rok
   jest brany dosłownie, także gdy wskazuje przeszłość.
   ══════════════════════════════════════════════════════════════ */

import { MAX_TAG_NAME_LEN, normalizeTagName } from './sanitize.js';

/* ── Budowanie wzorców ──────────────────────────────────────── */

/**
 * Całe słowo lub fraza. `\b` nie działa z polskimi znakami, więc granice
 * wyznacza \p{L}.
 * @param {string} source
 */
const _word = (source) =>
  new RegExp(`(?<!\\p{L})(?:${source})(?!\\p{L})`, 'iu');

/** Liczba cyfrą albo słowem ("za 2 tygodnie", "za dwa tygodnie", "in two weeks"). */
const NUM = '\\d{1,3}|dwa|dwie|trzy|cztery|pi[ęe][ćc]|sze[śs][ćc]|two|three|four|five|six';

/** @type {Record<string, number>} */
const NUM_WORDS = {
  dwa: 2, dwie: 2, trzy: 3, cztery: 4, piec: 5, szesc: 6,
  two: 2, three: 3, four: 4, five: 5, six: 6,
};

/**
 * Bez polskich znaków i wielkich liter — do porównań nazw ("październik" = "pazdziernik").
 * @param {string} text
 */
const _fold = (text) =>
  text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l');

/** @param {string} raw */
const _toNumber = (raw) => (/^\d+$/.test(raw) ? parseInt(raw, 10) : NUM_WORDS[_fold(raw)] ?? 0);

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

/** Poprzedzające słowa i cyfry wykluczają wersje (1.10.3, "wersja 1.10"). */
const DATE_BEFORE = '(?<![\\p{L}\\d./-])(?<!(?:wersj\\p{L}*|version|ver\\.?)\\s+)';
/** Kwota to nie data: "3.50 zł", "2.10 €", "1.5%". */
const DATE_NOT_AMOUNT = '(?!\\s*(?:z[łl]|pln|eur|usd|gbp|€|\\$|%))';
const DATE_PREFIX = '(?:(?:na|do|od|on|by|from)\\s+)?';

/**
 * Data liczbowa. Grupy: a, b (dzień/miesiąc w kolejności locale), y (rok).
 * @param {string} sep znak(i) separatora jako klasa regexu
 */
const _numericDate = (sep) =>
  new RegExp(
    `${DATE_BEFORE}${DATE_PREFIX}(?<a>\\d{1,2})(?<sep>${sep})(?<b>\\d{1,2})(?:\\k<sep>(?<y>\\d{4}))?(?!\\d|[./]\\d)${DATE_NOT_AMOUNT}`,
    'iu',
  );

const PL_MONTHS =
  'stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|wrze[śs]nia|pa[źz]dziernika|listopada|grudnia';
const PL_MONTH_STEMS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paz', 'lis', 'gru'];

const EN_MONTHS =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const EN_MONTH_STEMS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const ORDINAL = '(?:st|nd|rd|th)?';
const YEAR_TAIL = '(?:,?\\s+(?<y>\\d{4}))?(?!\\d)';

/** "15 sierpnia", "na 1 maja 2027". */
const PL_NAMED_DATES = [
  new RegExp(
    `${DATE_BEFORE}${DATE_PREFIX}(?<day>\\d{1,2})\\s+(?<mon>${PL_MONTHS})(?!\\p{L})${YEAR_TAIL}(?:\\s*r\\.)?`,
    'iu',
  ),
];

/** "Aug 15", "August 15th, 2027", "15 Aug", "15th of August". */
const EN_NAMED_DATES = [
  new RegExp(
    `(?<![\\p{L}\\d])${DATE_PREFIX}(?<mon>${EN_MONTHS})\\.?\\s+(?<day>\\d{1,2})${ORDINAL}(?![\\p{L}\\d:])${YEAR_TAIL}`,
    'iu',
  ),
  new RegExp(
    `${DATE_BEFORE}${DATE_PREFIX}(?<day>\\d{1,2})${ORDINAL}\\s+(?:of\\s+)?(?<mon>${EN_MONTHS})\\.?(?!\\p{L})${YEAR_TAIL}`,
    'iu',
  ),
];

/* ── Słowniki języków ──────────────────────────────────────── */

/**
 * Termin względny: wzorzec → przesunięcie od dziś.
 * @typedef {{ rx: RegExp, days?: (m: RegExpMatchArray) => number, months?: (m: RegExpMatchArray) => number, weekday?: number }} RelativeRule
 */

/**
 * @typedef {object} Language
 * @property {RelativeRule[]} relative od najdłuższej frazy ("pojutrze" przed "jutro")
 * @property {ReturnType<typeof _weekday>[]} weekdays
 * @property {{ rx: RegExp, val: string }[]} recurrence
 * @property {RegExp[]} namedDates
 * @property {{ stems: string[] }} months
 */

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

/** @type {Language} */
const PL = {
  relative: [
    { rx: _word('(?:(?:na|do)\\s+)?pojutrze'), days: () => 2 },
    { rx: _word('(?:(?:na|do)\\s+)?jutr[oa]'), days: () => 1 },
    { rx: _word('(?:(?:na|do)\\s+)?(?:dzi[śs]|dzisiaj)'), days: () => 0 },
    {
      rx: _word('(?:w|na)\\s+(?:przysz[łl]y|nast[ęe]pny|kolejny)\\s+tydzie[ńn]|w\\s+(?:przysz[łl]ym|nast[ęe]pnym|kolejnym)\\s+tygodniu'),
      weekday: 1,
    },
    { rx: _word('za\\s+tydzie[ńn]'), days: () => 7 },
    { rx: _word(`za\\s+(${NUM})\\s+(?:dni|dzie[ńn])`), days: (m) => _toNumber(m[1]) },
    { rx: _word(`za\\s+(${NUM})\\s+tygodni[e]?`), days: (m) => 7 * _toNumber(m[1]) },
    { rx: _word('za\\s+miesi[ąa]c'), months: () => 1 },
    { rx: _word(`za\\s+(${NUM})\\s+miesi[ąę]c(?:e|y)`), months: (m) => _toNumber(m[1]) },
  ],
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
  namedDates: PL_NAMED_DATES,
  months: { stems: PL_MONTH_STEMS },
};

/** @type {Language} */
const EN = {
  relative: [
    { rx: _word('(?:(?:by|for|on)\\s+)?(?:the\\s+)?day\\s+after\\s+tomorrow'), days: () => 2 },
    { rx: _word('(?:(?:by|for)\\s+)?tomorrow'), days: () => 1 },
    { rx: _word('(?:(?:by|for)\\s+)?(?:today|tonight)'), days: () => 0 },
    { rx: _word('next\\s+week'), weekday: 1 },
    { rx: _word('in\\s+a\\s+week'), days: () => 7 },
    { rx: _word(`in\\s+(${NUM})\\s+days?`), days: (m) => _toNumber(m[1]) },
    { rx: _word(`in\\s+(${NUM})\\s+weeks?`), days: (m) => 7 * _toNumber(m[1]) },
    { rx: _word('in\\s+a\\s+month'), months: () => 1 },
    { rx: _word(`in\\s+(${NUM})\\s+months?`), months: (m) => _toNumber(m[1]) },
  ],
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
  namedDates: EN_NAMED_DATES,
  months: { stems: EN_MONTH_STEMS },
};

/**
 * Ustawienia locale: język słów i zapis daty liczbowej.
 * @typedef {{ lang: Language, date: RegExp, monthFirst: boolean, swapFallback: boolean }} LocaleRules
 */

/** @type {Record<'pl'|'us'|'intl', LocaleRules>} */
const LOCALE_RULES = {
  pl: { lang: PL, date: _numericDate('\\.'), monthFirst: false, swapFallback: false },
  us: { lang: EN, date: _numericDate('\\/'), monthFirst: true, swapFallback: false },
  intl: { lang: EN, date: _numericDate('[./]'), monthFirst: false, swapFallback: true },
};

/* ── Godzina ───────────────────────────────────────────────── */

const GODZ = 'godz(?:\\.|in(?:ie|[ąaey]))?\\s*';
const AMPM = '\\s?(?<ap>[ap])\\.?m\\.?(?!\\p{L})';

/**
 * Godzina zapowiedziana albo jednoznaczna — szukana przed datą.
 * Każdy wzorzec ma grupy h, m (opcjonalnie) i ap (am/pm, opcjonalnie).
 * `strict` = zapis, który na pewno miał być godziną: gdy nie istnieje
 * (25:00), trafia do `rejected`.
 */
const TIME_RULES = [
  // 14:30, o 9:00, o godz. 9:00, at 2:30pm, @ 9:00
  {
    rx: new RegExp(
      `(?<![\\p{L}\\d:])(?:(?:o|na|do|at|by)\\s+|@\\s*)?(?:(?:o\\s+)?${GODZ})?(?<h>\\d{1,2}):(?<m>\\d{2})(?:${AMPM})?(?![\\d:])`,
      'iu',
    ),
    strict: true,
  },
  // 9am, 5 pm, 9.30pm
  {
    rx: new RegExp(
      `(?<![\\p{L}\\d:.])(?:(?:at|by|o)\\s+|@\\s*)?(?<h>\\d{1,2})(?:\\.(?<m>\\d{2}))?${AMPM}`,
      'iu',
    ),
    strict: true,
  },
  // o 10.30, godz. 10.30 — kropka po "o" to godzina, nie data
  {
    rx: new RegExp(
      `(?<!\\p{L})(?:(?:o|at)\\s+(?:${GODZ})?|${GODZ})(?<h>\\d{1,2})\\.(?<m>\\d{2})(?![\\d.])`,
      'iu',
    ),
    strict: true,
  },
  // o godz. 9, godzina 18
  {
    rx: new RegExp(`(?<!\\p{L})(?:o\\s+)?${GODZ}(?<h>\\d{1,2})(?![\\d.:])`, 'iu'),
    strict: false,
  },
];

/**
 * Sama godzina bez minut: "o 18", "at 6". Tylko na końcu tekstu albo przed
 * interpunkcją — "pomyśl o 5 pomysłach" to nie jest 5:00.
 */
const BARE_HOUR_RX =
  /(?<!\p{L})(?:o|at)\s+(?<h>\d{1,2})(?=\s*(?:[,;!?)]|\.(?!\d)|$))/iu;

/**
 * Dopasowanie godziny → "HH:MM" albo null, gdy taka godzina nie istnieje.
 * @param {{ h?: string, m?: string, ap?: string }} groups
 */
function _toTime({ h = '', m, ap }) {
  let hh = parseInt(h, 10);
  const mm = m ? parseInt(m, 10) : 0;
  if (mm > 59) return null;
  if (ap) {
    if (hh < 1 || hh > 12) return null;
    hh = (hh % 12) + (ap.toLowerCase() === 'p' ? 12 : 0);
  } else if (hh > 23) {
    return null;
  }
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/* ── Tagi i cudzysłowy ─────────────────────────────────────── */

/**
 * Tag: `#nazwa` jako osobne słowo. Dzięki temu w tytule zostają `C#`
 * i `https://x.pl/a#sekcja`. Jeden znak interpunkcji za tagiem należy do niego.
 */
const TAG_RX = /(^|\s)#([\p{L}\p{N}][\p{L}\p{N}_-]*)[,;.]?(?=\s|$)/gu;

/** Tekst w cudzysłowie: prosty, polski lub angielski. */
const QUOTED_RX = /["„“]([^"„“”]+)["”]/g;

/** Prywatny obszar Unicode: znaczniki chronionych fragmentów na czas parsowania. */
const PLACEHOLDER_BASE = 0xe100;
const PLACEHOLDER_RX = /[-]/g;

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
 * Chowa cudzysłowy i fragmenty `keep` pod znacznikami. Znacznik to jeden znak
 * spoza liter i cyfr, więc żaden regex terminu ani tagu go nie dotknie.
 * @param {string} text
 * @param {string[]} keep fragmenty do zostawienia dosłownie (bez cudzysłowów)
 * @returns {{ text: string, quotes: { raw: string, inner: string }[] }}
 */
function _protect(text, keep) {
  /** @type {{ raw: string, inner: string }[]} */
  const quotes = [];
  /** @param {string} raw @param {string} inner */
  const mark = (raw, inner) => {
    quotes.push({ raw, inner });
    return String.fromCharCode(PLACEHOLDER_BASE + quotes.length - 1);
  };
  let result = text.replace(QUOTED_RX, (raw, inner) => mark(raw, inner));
  for (const fragment of keep) {
    if (!fragment || quotes.length >= 0xff) continue;
    const at = result.indexOf(fragment);
    if (at === -1) continue;
    result = result.slice(0, at) + mark(fragment, fragment) + result.slice(at + fragment.length);
  }
  return { text: result, quotes };
}

/**
 * Przywraca chronione fragmenty. Sam cudzysłów bez innego tekstu to w zadaniu
 * sposób na dosłowny tytuł (`!"wersja 1.10"`), więc znaki cudzysłowu znikają.
 * W pozostałych przypadkach są częścią tytułu (`!Przeczytać "Lalkę"`).
 * @param {string} text
 * @param {{ raw: string, inner: string }[]} quotes
 * @param {boolean} stripWhole
 */
function _restore(text, quotes, stripWhole) {
  if (stripWhole && quotes.length === 1 && text.length === 1) return quotes[0].inner;
  return text.replace(PLACEHOLDER_RX, (ch) => {
    const quote = quotes[ch.charCodeAt(0) - PLACEHOLDER_BASE];
    return quote ? quote.raw : '';
  });
}

/* ── Locale ────────────────────────────────────────────────── */

/**
 * Reguły dla locale. Polski tylko dla `pl`: rozszerzenie ma interfejs
 * polski i angielski, więc każdy inny język widzi angielski — i po
 * angielsku musi rozumieć "tomorrow". Wcześniej en-GB czy de dostawały
 * polskie słowa.
 * @param {string|null} [explicitLocale] np. "en-US"; null = autodetekcja
 * @returns {LocaleRules}
 */
function _localeRules(explicitLocale = null) {
  const locale = (
    explicitLocale ??
    (typeof browser !== 'undefined' && browser.i18n
      ? browser.i18n.getUILanguage()
      : typeof navigator !== 'undefined'
        ? navigator.language
        : 'en')
  ).toLowerCase();
  if (locale.startsWith('pl')) return LOCALE_RULES.pl;
  if (locale === 'en' || locale.startsWith('en-us')) return LOCALE_RULES.us;
  return LOCALE_RULES.intl;
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

/* ── Wynik ─────────────────────────────────────────────────── */

/**
 * Fragment, który parser zrozumiał — w formie wpisanej przez użytkownika.
 * @typedef {{ kind: 'time'|'date'|'recurrence'|'tag', text: string }} CaptureToken
 */

/**
 * @typedef {object} Capture
 * @property {boolean} isTask
 * @property {boolean} isUrgent
 * @property {boolean} isInProgress
 * @property {string} title
 * @property {number|null} due
 * @property {boolean} dateGiven czy termin padł w tekście (a nie "dziś" dopisane
 *   do samej godziny lub cyklu) — pole tytułu nie nadpisuje wtedy istniejącego terminu
 * @property {string|null} time
 * @property {string|null} recurrence
 * @property {string[]} tagNames nazwy tagów w formie wpisanej przez użytkownika
 * @property {CaptureToken[]} tokens rozpoznane fragmenty, w kolejności znalezienia
 * @property {string[]} rejected fragmenty wyglądające na datę lub godzinę, których
 *   nie ma w kalendarzu (30.02, 25:00) — zostały w tytule
 */

/**
 * @typedef {object} CaptureOptions
 * @property {string[]} [keep] fragmenty do zostawienia w tytule dosłownie, jak
 *   w cudzysłowie. Pole tytułu podaje tu to, co parser rozpoznałby już
 *   w tytule sprzed edycji — "Plan na jutro" otwarte ponownie nie dostanie
 *   nagle terminu.
 */

/** @returns {Capture} */
const _empty = () => ({
  isTask: false,
  isUrgent: false,
  isInProgress: false,
  title: '',
  due: null,
  dateGiven: false,
  time: null,
  recurrence: null,
  tagNames: [],
  tokens: [],
  rejected: [],
});

/** Śmieci zostające na brzegach tytułu po wycięciu terminu ("raport, jutro" → "raport"). */
const EDGE_JUNK_RX = /^[\s,;:–—-]+|[\s,;:–—-]+$/g;

/**
 * Parsuje input quick capture.
 * @param {string} input — raw text z pola capture
 * @param {string|null} [locale] jawny locale ("en-US", "pl"); null = autodetekcja.
 *   Jawny locale przydatny w testach (bez mockowania globalnego `browser`).
 * @param {CaptureOptions} [options]
 * @returns {Capture}
 */
export function parseCapture(input, locale = null, options = {}) {
  if (!input || typeof input !== 'string') return _empty();

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

  const { text: protectedBody, quotes } = _protect(body, options.keep ?? []);
  const { text: withoutTags, tagNames } = _extractTags(protectedBody);

  /** @type {CaptureToken[]} */
  const tokens = tagNames.map((name) => ({ kind: /** @type {const} */ ('tag'), text: `#${name}` }));

  if (!isTask) {
    return {
      ..._empty(),
      title: _restore(withoutTags, quotes, false),
      tagNames,
      tokens,
    };
  }

  const rules = _localeRules(locale);
  const { lang } = rules;
  let title = withoutTags;
  /** @type {string[]} */
  const rejected = [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayDay = today.getDay();

  /** @param {number} offset */
  const dayFromToday = (offset) => {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    return d.getTime();
  };

  /**
   * Za n miesięcy. Brakujący dzień przycina do końca miesiąca:
   * 31 stycznia + miesiąc = koniec lutego, a nie 3 marca.
   * @param {number} n
   */
  const monthsFromToday = (n) => {
    const d = new Date(today.getFullYear(), today.getMonth() + n, 1);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(today.getDate(), lastDay));
    return d.getTime();
  };

  /**
   * Wycina dopasowanie z tytułu dokładnie tam, gdzie zostało znalezione,
   * i zapisuje je jako rozpoznany fragment. Wcześniej `replace(tekst)`
   * kasował pierwsze takie samo wystąpienie — niekoniecznie to dopasowane.
   * @param {RegExpMatchArray} match
   * @param {CaptureToken['kind']} kind
   */
  const take = (match, kind) => {
    const start = match.index ?? title.indexOf(match[0]);
    title = title.slice(0, start) + ' ' + title.slice(start + match[0].length);
    title = title.replace(/\s+/g, ' ').trim();
    tokens.push({ kind, text: match[0].trim() });
  };

  /** @param {RegExpMatchArray} match */
  const reject = (match) => {
    const text = _restore(match[0].trim(), quotes, false);
    if (!rejected.includes(text)) rejected.push(text);
  };

  /** @type {string|null} */
  let time = null;
  /** @type {string|null} */
  let recurrence = null;
  /** @type {number|null} */
  let due = null;

  // ── Godzina zapowiedziana lub jednoznaczna ──
  // Niepoprawna (25:00) nie jest dopasowywana — zostaje w tytule i trafia do
  // `rejected`, żeby podgląd powiedział, czemu nie została godziną.
  for (const { rx, strict } of TIME_RULES) {
    const match = title.match(rx);
    if (!match) continue;
    const parsed = _toTime(match.groups ?? {});
    if (parsed) {
      time = parsed;
      take(match, 'time');
      break;
    }
    if (strict) reject(match);
  }

  // ── Cykliczność ──
  for (const { rx, val } of lang.recurrence) {
    const match = title.match(rx);
    if (match) {
      recurrence = val;
      take(match, 'recurrence');
      break;
    }
  }

  // ── "co wtorek", "w każdą środę", "w piątki" — cykl z terminem naraz ──
  for (const { every, day } of lang.weekdays) {
    const match = title.match(every);
    if (match) {
      recurrence ??= 'weekly';
      due = dayFromToday(_daysUntilWeekday(day, todayDay));
      take(match, 'recurrence');
      break;
    }
  }

  // ── Termin: słowa > dzień tygodnia > data ──
  // Gdy tekst ma kilka terminów ("jutro 15.06"), wygrywa pierwszy w tej
  // kolejności, a reszta zostaje w tytule — widać, co nie zostało użyte.
  if (due === null) {
    for (const rule of lang.relative) {
      const match = title.match(rule.rx);
      if (!match) continue;
      due =
        rule.weekday !== undefined
          ? dayFromToday(_daysUntilWeekday(rule.weekday, todayDay))
          : rule.months
            ? monthsFromToday(rule.months(match))
            : dayFromToday(rule.days ? rule.days(match) : 0);
      take(match, 'date');
      break;
    }
  }

  if (due === null) {
    for (const { rx, day } of lang.weekdays) {
      const match = title.match(rx);
      if (match) {
        due = dayFromToday(_daysUntilWeekday(day, todayDay));
        take(match, 'date');
        break;
      }
    }
  }

  if (due === null) {
    /**
     * Prawdziwa data albo null. JS po cichu przesuwa daty (new Date(2026,1,30)
     * → 2 marca), więc sprawdzamy, czy zbudowany Date ma wpisane wartości.
     * @param {number} y @param {number} month 0-11 @param {number} day
     */
    const validDate = (y, month, day) => {
      const parsed = new Date(y, month, day, 0, 0, 0, 0);
      return parsed.getFullYear() === y &&
        parsed.getMonth() === month &&
        parsed.getDate() === day
        ? parsed.getTime()
        : null;
    };

    /**
     * Data bez roku, która już minęła, to prawie zawsze najbliższa przyszła:
     * "01.01" w listopadzie to nowy rok. Jawny rok jest brany dosłownie.
     * Gdy w przyszłym roku takiej daty nie ma (29.02), zostaje bieżący.
     * @param {number} month @param {number} day @param {string|undefined} yearText
     */
    const resolve = (month, day, yearText) => {
      const year = yearText ? parseInt(yearText, 10) : today.getFullYear();
      const thisYear = validDate(year, month, day);
      if (thisYear === null) return null;
      const rolled =
        !yearText && thisYear < today.getTime() ? validDate(year + 1, month, day) : null;
      return rolled ?? thisYear;
    };

    const numeric = title.match(rules.date);
    if (numeric?.groups) {
      const a = parseInt(numeric.groups.a, 10);
      const b = parseInt(numeric.groups.b, 10);
      const [day, month] = rules.monthFirst ? [b, a] : [a, b];
      let ts = resolve(month - 1, day, numeric.groups.y);
      // Zapis US (06/15) poza USA: jako DD/MM nie istnieje, jako MM/DD tak
      if (ts === null && rules.swapFallback) ts = resolve(day - 1, month, numeric.groups.y);
      if (ts !== null) {
        due = ts;
        take(numeric, 'date');
      } else if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
        // 30.02 to próba daty; 2.50 (kwota) albo 1.15 już nie — bez komunikatu
        reject(numeric);
      }
    }

    if (due === null) {
      for (const rx of lang.namedDates) {
        const match = title.match(rx);
        if (!match?.groups) continue;
        // "I may 2 go" — małe "may" przed liczbą to raczej czasownik niż maj
        if (match.groups.mon === 'may' && rx === EN_NAMED_DATES[0]) continue;
        const stem = _fold(match.groups.mon).slice(0, 3);
        const month = lang.months.stems.indexOf(stem);
        const ts = resolve(month, parseInt(match.groups.day, 10), match.groups.y);
        if (ts !== null) {
          due = ts;
          take(match, 'date');
        } else {
          reject(match);
        }
        break;
      }
    }
  }

  const dateGiven = due !== null;

  // ── Sama godzina: "o 18" — dopiero teraz, gdy terminy zniknęły z tekstu ──
  if (!time) {
    const match = title.match(BARE_HOUR_RX);
    const parsed = match ? _toTime(match.groups ?? {}) : null;
    if (match && parsed) {
      time = parsed;
      take(match, 'time');
    }
  }

  // Czas bez daty → dziś. Cykl bez daty też: bez terminu kolejna instancja
  // nigdy by nie powstała (notes.js: toggleCompleted wymaga note.due).
  if ((time || recurrence) && due === null) due = dayFromToday(0);

  if (tokens.length > tagNames.length) title = title.replace(EDGE_JUNK_RX, '');

  return {
    isTask,
    isUrgent: isUrgent || isUrgentInProgress,
    isInProgress: isInProgress || isUrgentInProgress,
    title: _restore(title, quotes, true),
    due,
    dateGiven,
    time,
    recurrence,
    tagNames,
    tokens: tokens.map((tok) => ({ ...tok, text: _restore(tok.text, quotes, false) })),
    rejected,
  };
}

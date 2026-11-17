// @ts-check
/* ══════════════════════════════════════════════════════════════
   quick-capture-help.js — jedna lista składni quick capture
   ──────────────────────────────────────────────────────────────
   Używane przez:
   - app.js    (panel skróty → sekcja Quick capture, sidebar)
   - popup.js  (rozwijana pomoc "?" w mikro-oknie)

   Powód istnienia: obie powierzchnie opisywały tę samą składnię
   niezależnie i rozjechały się. Sidebar nie miał `!!`, `!!>` ani
   cykliczności; popup nie miał dni tygodnia ani cykliczności i uczył
   składni `2:30pm`, której parser nie przyjmuje. Zestaw wierszy jest
   teraz jeden — dopisanie reguły do parsera to dopisanie wiersza tutaj.

   Czego tu NIE ma: Enter / Shift+Enter. To jedyne pozycje, które
   znaczą co innego na każdej powierzchni (w sidebarze Shift+Enter
   otwiera edytor, w popupie otwiera panel boczny), więc zostają
   lokalne — wspólna lista opisuje wyłącznie składnię tekstu.

   Przykłady w chipach są zależne od języka: polski parser rozumie
   "jutro" i DD.MM, angielski "tomorrow" i MM/DD. Dlatego token to
   albo literał (`!`, `14:30`), albo klucz locale.
   ══════════════════════════════════════════════════════════════ */

/**
 * Chip przykładu: literał niezależny od języka ALBO klucz locale.
 * @typedef {{ text: string, key?: undefined } | { key: string, text?: undefined }} HelpToken
 */

/**
 * @typedef {object} HelpRow
 * @property {HelpToken[]} tokens chipy po lewej
 * @property {string} desc klucz locale opisu
 * @property {string} group klucz locale nagłówka grupy — wiersze jednej
 *   grupy stoją obok siebie, nagłówek pojawia się przy pierwszym z nich
 */

/** @type {HelpRow[]} */
export const QUICK_CAPTURE_HELP = [
  {
    tokens: [{ key: 'shortcuts_qc_ex_plain' }],
    desc: 'shortcuts_qc_plain',
    group: 'shortcuts_qc_group_type',
  },
  {
    tokens: [{ text: '!' }],
    desc: 'shortcuts_qc_task',
    group: 'shortcuts_qc_group_type',
  },
  {
    tokens: [{ text: '!!' }],
    desc: 'shortcuts_qc_taskImportant',
    group: 'shortcuts_qc_group_type',
  },
  {
    tokens: [{ text: '!>' }],
    desc: 'shortcuts_qc_taskInProgress',
    group: 'shortcuts_qc_group_type',
  },
  {
    tokens: [{ text: '!!>' }],
    desc: 'shortcuts_qc_taskImportantInProgress',
    group: 'shortcuts_qc_group_type',
  },
  {
    tokens: [
      { key: 'shortcuts_qc_ex_today' },
      { key: 'shortcuts_qc_ex_tomorrow' },
    ],
    desc: 'shortcuts_qc_dayKeywords',
    group: 'shortcuts_qc_group_date',
  },
  {
    tokens: [{ key: 'shortcuts_qc_ex_weekday' }],
    desc: 'shortcuts_qc_weekdays',
    group: 'shortcuts_qc_group_date',
  },
  {
    tokens: [
      { key: 'shortcuts_qc_ex_date' },
      { key: 'shortcuts_qc_ex_dateYear' },
    ],
    desc: 'shortcuts_qc_date',
    group: 'shortcuts_qc_group_date',
  },
  {
    tokens: [{ key: 'shortcuts_qc_ex_monthName' }],
    desc: 'shortcuts_qc_monthName',
    group: 'shortcuts_qc_group_date',
  },
  {
    tokens: [
      { key: 'shortcuts_qc_ex_inWeeks' },
      { key: 'shortcuts_qc_ex_nextWeek' },
    ],
    desc: 'shortcuts_qc_relative',
    group: 'shortcuts_qc_group_date',
  },
  {
    tokens: [{ text: '14:30' }],
    desc: 'shortcuts_qc_time',
    group: 'shortcuts_qc_group_time',
  },
  {
    tokens: [{ key: 'shortcuts_qc_ex_hour' }],
    desc: 'shortcuts_qc_hour',
    group: 'shortcuts_qc_group_time',
  },
  {
    tokens: [
      { key: 'shortcuts_qc_ex_daily' },
      { key: 'shortcuts_qc_ex_weekly' },
    ],
    desc: 'shortcuts_qc_recurrence',
    group: 'shortcuts_qc_group_time',
  },
  {
    tokens: [{ key: 'shortcuts_qc_ex_tag' }],
    desc: 'shortcuts_qc_tag',
    group: 'shortcuts_qc_group_other',
  },
  {
    tokens: [{ key: 'shortcuts_qc_ex_quoted' }],
    desc: 'shortcuts_qc_quoted',
    group: 'shortcuts_qc_group_other',
  },
];

/**
 * Wprowadzenie nad ściągą: zasada w dwóch zdaniach i jeden pełny przykład
 * rozłożony na części. Sama ściąga mówi „co można wpisać”, ale nie „jak to
 * złożyć” — nowa osoba po kliknięciu „?” nie wiedziała, że wszystko idzie
 * w jednej linii, że ! musi stać na początku, a reszta zostaje tytułem.
 *
 * Przykład i jego części są w locale (inny język = inne słowa), a test
 * sprawdza, że przykład naprawdę daje to, co opisują części.
 */
export const QUICK_CAPTURE_INTRO = {
  heading: 'shortcuts_qc_how_title',
  texts: ['shortcuts_qc_how_text', 'shortcuts_qc_how_text2'],
  example: 'shortcuts_qc_how_example',
  /** @type {{ tokens: HelpToken[], desc: string }[]} */
  parts: [
    { tokens: [{ text: '!!' }], desc: 'shortcuts_qc_how_part_marker' },
    { tokens: [{ key: 'shortcuts_qc_how_ex_title' }], desc: 'shortcuts_qc_how_part_title' },
    { tokens: [{ key: 'shortcuts_qc_how_ex_when' }], desc: 'shortcuts_qc_how_part_when' },
    { tokens: [{ key: 'shortcuts_qc_ex_tag' }], desc: 'shortcuts_qc_how_part_tag' },
  ],
};

/**
 * Renderuje listę do podanego <ul>. Buduje węzły przez createElement
 * i textContent — do panelu pomocy nie trafia HTML z pliku locale, więc
 * podmieniony messages.json nie może tu nic wstrzyknąć (popup wcześniej
 * dostawał stąd gotowy HTML i musiał go filtrować przez _setRichText).
 *
 * Markup jest wspólny (ul > li > code + span); różnice wizualne robią
 * arkusze każdej powierzchni przez klasę .qc-help. Kolejność:
 *   1. „Jak to działa” — zasada, pełny przykład, jego części
 *   2. ściąga w grupach; przed pierwszym wierszem grupy stoi
 *      li.qc-help__heading — piętnaście wierszy jednym ciągiem czytało
 *      się jak ściana przykładów
 *
 * @param {HTMLElement} list docelowy <ul> — zawartość jest nadpisywana
 * @param {(key: string) => string} t
 */
export function renderQuickCaptureHelp(list, t) {
  list.textContent = '';
  list.classList.add('qc-help');

  /** @param {string} cls @param {HTMLElement[]} children */
  const item = (cls, children) => {
    const li = document.createElement('li');
    if (cls) li.className = cls;
    for (const c of children) li.appendChild(c);
    list.appendChild(li);
  };
  /** @param {string} tag @param {string} text */
  const el = (tag, text) => {
    const n = document.createElement(tag);
    n.textContent = text;
    return n;
  };
  /** @param {{ tokens: HelpToken[], desc: string }} row @param {string} cls */
  const row = (row, cls) =>
    item(cls, [
      ...row.tokens.map((tok) => el('code', tok.text ?? t(tok.key ?? ''))),
      el('span', t(row.desc)),
    ]);

  // 1. Jak to działa
  item('qc-help__heading', [el('span', t(QUICK_CAPTURE_INTRO.heading))]);
  for (const key of QUICK_CAPTURE_INTRO.texts) {
    item('qc-help__text', [el('span', t(key))]);
  }
  item('qc-help__example', [el('code', t(QUICK_CAPTURE_INTRO.example))]);
  for (const part of QUICK_CAPTURE_INTRO.parts) row(part, 'qc-help__part');

  // 2. Ściąga w grupach
  /** @type {string|null} */
  let group = null;
  for (const r of QUICK_CAPTURE_HELP) {
    if (r.group !== group) {
      group = r.group;
      item('qc-help__heading', [el('span', t(group))]);
    }
    row(r, '');
  }
}

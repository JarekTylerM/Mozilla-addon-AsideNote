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
 */

/** @type {HelpRow[]} */
export const QUICK_CAPTURE_HELP = [
  {
    tokens: [{ key: 'shortcuts_qc_ex_plain' }],
    desc: 'shortcuts_qc_plain',
  },
  {
    tokens: [{ text: '!' }],
    desc: 'shortcuts_qc_task',
  },
  {
    tokens: [{ text: '!!' }],
    desc: 'shortcuts_qc_taskImportant',
  },
  {
    tokens: [{ text: '!>' }],
    desc: 'shortcuts_qc_taskInProgress',
  },
  {
    tokens: [{ text: '!!>' }],
    desc: 'shortcuts_qc_taskImportantInProgress',
  },
  {
    tokens: [
      { key: 'shortcuts_qc_ex_today' },
      { key: 'shortcuts_qc_ex_tomorrow' },
    ],
    desc: 'shortcuts_qc_dayKeywords',
  },
  {
    tokens: [{ key: 'shortcuts_qc_ex_weekday' }],
    desc: 'shortcuts_qc_weekdays',
  },
  {
    tokens: [
      { key: 'shortcuts_qc_ex_date' },
      { key: 'shortcuts_qc_ex_dateYear' },
    ],
    desc: 'shortcuts_qc_date',
  },
  {
    tokens: [{ text: '14:30' }],
    desc: 'shortcuts_qc_time',
  },
  {
    tokens: [
      { key: 'shortcuts_qc_ex_daily' },
      { key: 'shortcuts_qc_ex_weekly' },
    ],
    desc: 'shortcuts_qc_recurrence',
  },
  {
    tokens: [{ key: 'shortcuts_qc_ex_tag' }],
    desc: 'shortcuts_qc_tag',
  },
  {
    tokens: [{ key: 'shortcuts_qc_ex_quoted' }],
    desc: 'shortcuts_qc_quoted',
  },
];

/**
 * Renderuje listę do podanego <ul>. Buduje węzły przez createElement
 * i textContent — do panelu pomocy nie trafia HTML z pliku locale, więc
 * podmieniony messages.json nie może tu nic wstrzyknąć (popup wcześniej
 * dostawał stąd gotowy HTML i musiał go filtrować przez _setRichText).
 *
 * Markup jest wspólny (ul > li > code + span); różnice wizualne robią
 * arkusze każdej powierzchni przez klasę .qc-help.
 *
 * @param {HTMLElement} list docelowy <ul> — zawartość jest nadpisywana
 * @param {(key: string) => string} t
 */
export function renderQuickCaptureHelp(list, t) {
  list.textContent = '';
  list.classList.add('qc-help');

  for (const row of QUICK_CAPTURE_HELP) {
    const li = document.createElement('li');

    for (const token of row.tokens) {
      const code = document.createElement('code');
      code.textContent = token.text ?? t(token.key ?? '');
      li.appendChild(code);
    }

    const desc = document.createElement('span');
    desc.textContent = t(row.desc);
    li.appendChild(desc);

    list.appendChild(li);
  }
}

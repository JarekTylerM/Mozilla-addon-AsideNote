// @ts-check
/* ══════════════════════════════════════════════════════════════
   note-sections.js — sekcje listy: co do której trafia i co w niej tworzyć
   ──────────────────────────────────────────────────────────────
   Czysta logika bez DOM i `browser` (testowalna w Node). Podział na sekcje
   i termin nadawany przez przycisk "+" muszą korzystać z tych samych granic:
   element utworzony w sekcji ma w niej wylądować.

   Daty liczone kalendarzowo (new Date(r, m, d + n)), nie przez dodawanie 24 h.
   Doba przy zmianie czasu ma 23 albo 25 godzin, więc "dziś + 24 h" trafiałoby
   na niewłaściwy dzień.
   ══════════════════════════════════════════════════════════════ */

export const SECTION_ORDER = [
  'overdue',
  'today',
  'tomorrow',
  'week',
  'month',
  'later',
  'unscheduled',
  'notes',
  'done',
];

/**
 * Początek dnia przesunięty o `offset` dni.
 * @param {Date} date
 * @param {number} [offset]
 */
function _dayStart(date, offset = 0) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + offset,
  ).getTime();
}

/**
 * Granice sekcji terminowych dla danego "teraz".
 * @param {number} now
 */
function _boundaries(now) {
  const date = new Date(now);
  // Tydzień kończy się w niedzielę: poniedziałek = 1 … niedziela = 7
  const dayOfWeek = date.getDay() || 7;
  return {
    today: _dayStart(date),
    tomorrow: _dayStart(date, 1),
    dayAfterTomorrow: _dayStart(date, 2),
    nextMonday: _dayStart(date, 8 - dayOfWeek),
    lastDayOfMonth: new Date(date.getFullYear(), date.getMonth() + 1, 0).getTime(),
    endOfMonth: new Date(
      date.getFullYear(),
      date.getMonth() + 1,
      0,
      23,
      59,
      59,
    ).getTime(),
    firstOfNextMonth: new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime(),
  };
}

/**
 * Sekcja, do której należy element.
 * @param {{ type?: string, completed?: boolean, due?: number|null }} note
 * @param {number} [now]
 * @returns {string}
 */
export function bucketFor(note, now = Date.now()) {
  if (note.type === 'note') return 'notes';
  if (note.completed) return 'done';
  if (!note.due) return 'unscheduled';

  const b = _boundaries(now);
  if (note.due < b.today) return 'overdue';
  if (note.due < b.tomorrow) return 'today';
  if (note.due < b.dayAfterTomorrow) return 'tomorrow';
  if (note.due < b.nextMonday) return 'week';
  if (note.due < b.endOfMonth) return 'month';
  return 'later';
}

/**
 * Co tworzy przycisk "+" w danej sekcji. `null` = sekcja nie ma przycisku:
 * nikt nie zakłada elementu z terminem w przeszłości ani od razu ukończonego.
 *
 * Sekcje-przedziały dostają ostatni dzień przedziału ("do końca tygodnia",
 * "do końca miesiąca"), a "później" pierwszy dzień, który do niej należy.
 * Termin to tylko punkt startu: w otwartym edytorze można go od razu zmienić.
 *
 * @param {string} section
 * @param {number} [now]
 * @returns {{ type: 'note'|'task', due: number|null }|null}
 */
export function newItemForSection(section, now = Date.now()) {
  const b = _boundaries(now);
  switch (section) {
    case 'notes':
      return { type: 'note', due: null };
    case 'unscheduled':
      return { type: 'task', due: null };
    case 'today':
      return { type: 'task', due: b.today };
    case 'tomorrow':
      return { type: 'task', due: b.tomorrow };
    case 'week':
      return { type: 'task', due: _dayStart(new Date(b.nextMonday), -1) };
    case 'month':
      return { type: 'task', due: b.lastDayOfMonth };
    case 'later':
      // Pod koniec miesiąca "ten tydzień" i "jutro" sięgają już następnego
      // miesiąca, więc jego pierwszy dzień mógłby do nich należeć.
      return {
        type: 'task',
        due: Math.max(b.firstOfNextMonth, b.nextMonday, b.dayAfterTomorrow),
      };
    default:
      return null;
  }
}

/**
 * @typedef {object} ListFilters
 * @property {string} filterType
 * @property {boolean} [zenMode]
 * @property {string} [searchQuery]
 * @property {string[]} [filterTags]
 * @property {boolean} [filterInProgress]
 * @property {number|null} [filterDate]
 */

/**
 * Sekcje widoczne bez elementów, gdy lista nie jest pusta (np. są same zadania),
 * żeby zawsze było gdzie kliknąć "+". Całkiem pusta lista ma zamiast nich
 * podpisane przyciski (notes.js: _buildStartScreen).
 *
 * Nie pokazujemy ich przy wyszukiwaniu i filtrach zawężających wynik: tam
 * pusta sekcja wyglądałaby jak informacja o wynikach, a zen ma nie rozpraszać.
 *
 * @param {ListFilters} filters
 * @returns {string[]}
 */
export function alwaysVisibleSections({
  filterType,
  zenMode = false,
  searchQuery = '',
  filterTags = [],
  filterInProgress = false,
  filterDate = null,
}) {
  if (zenMode || searchQuery || filterTags.length || filterInProgress || filterDate) {
    return [];
  }
  if (filterType === 'task') return ['unscheduled'];
  if (filterType === 'note') return ['notes'];
  return ['unscheduled', 'notes'];
}

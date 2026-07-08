// @ts-check
/* ══════════════════════════════════════════════
   alarms.js — planowanie przypomnień
   ──────────────────────────────────────────────
   isAlarmable(note) to jedyne miejsce definiujące inwariant
   "ten task może mieć zaplanowany alarm". Używane przez:
   - scheduleAlarm() (tutaj)
   - rescheduleAll() (tutaj)
   - notes.js::quickCapture (warunek przed scheduleAlarm)
   - background.js::rescheduleOnBoot — UWAGA: background.js nie jest
     modułem ES (MV2), więc NIE może importować tego helpera. Trzyma
     własną kopię warunku — przy zmianie isAlarmable zsynchronizuj
     też background.js ręcznie.
   ══════════════════════════════════════════════ */

/**
 * @typedef {object} AlarmableNote
 * @property {string} id
 * @property {string} [type]
 * @property {boolean} [completed]
 * @property {number|null} [due]
 * @property {string|null} [time]
 * @property {number} [reminder]
 */

/**
 * Czy task kwalifikuje się do zaplanowania alarmu.
 * @param {AlarmableNote} note
 * @returns {boolean}
 */
export function isAlarmable(note) {
  return (
    note.type === "task" &&
    !note.completed &&
    !!note.due &&
    !!note.time
  );
}

/** @param {AlarmableNote} note */
export function scheduleAlarm(note) {
  if (!isAlarmable(note)) {
    browser.alarms.clear(note.id);
    return;
  }

  // isAlarmable gwarantuje time/due w runtime; ?? zachowuje istniejący guard
  // (niepoprawne dane → NaN → odfiltrowane przez Number.isFinite niżej).
  const [h, m] = (note.time ?? "").split(":").map(Number);
  const dt = new Date(note.due ?? NaN);
  dt.setHours(h, m, 0, 0);

  const offsetMs = (note.reminder ?? 0) * 60000;
  const when     = dt.getTime() - offsetMs;

  // Number.isFinite: niepoprawny time (np. "abc" po storage poisoning) daje
  // NaN — bez guardu alarms.create({ when: NaN }) rzuca TypeError.
  if (!Number.isFinite(when) || when <= Date.now()) {
    browser.alarms.clear(note.id);
    return;
  }

  browser.alarms.create(note.id, { when });
}

/** @param {string} id */
export function clearAlarm(id) {
  browser.alarms.clear(id);
}

/** @param {AlarmableNote[]} notes */
export async function rescheduleAll(notes) {
  await browser.alarms.clearAll();
  notes.filter(isAlarmable).forEach(scheduleAlarm);
}

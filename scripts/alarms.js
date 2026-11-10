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

/**
 * Nazwa alarmu porannego podsumowania (zadania bez godziny). Planuje go
 * background.js — tu tylko pilnujemy, żeby przeplanowanie alarmów notatek
 * go nie skasowało. KOPIA stałej w background.js (nie-ESM) — trzymaj w sync.
 */
export const DIGEST_ALARM = "__digest";

/** @param {AlarmableNote[]} notes */
export async function rescheduleAll(notes) {
  // Nie clearAll(): to skasowałoby alarm podsumowania, który żyje w
  // background.js i nie jest odtwarzany przy otwarciu sidebara.
  const existing = await browser.alarms.getAll();
  await Promise.all(
    existing
      .filter((a) => a.name !== DIGEST_ALARM)
      .map((a) => browser.alarms.clear(a.name)),
  );
  notes.filter(isAlarmable).forEach(scheduleAlarm);
}

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
 * Czy task kwalifikuje się do zaplanowania alarmu.
 * @param {object} note
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

export function scheduleAlarm(note) {
  if (!isAlarmable(note)) {
    browser.alarms.clear(note.id);
    return;
  }

  const [h, m] = note.time.split(":").map(Number);
  const dt = new Date(note.due);
  dt.setHours(h, m, 0, 0);

  const offsetMs = (note.reminder ?? 0) * 60000;
  const when     = dt.getTime() - offsetMs;

  if (when <= Date.now()) {
    browser.alarms.clear(note.id);
    return;
  }

  browser.alarms.create(note.id, { when });
}

export function clearAlarm(id) {
  browser.alarms.clear(id);
}

export async function rescheduleAll(notes) {
  await browser.alarms.clearAll();
  notes.filter(isAlarmable).forEach(scheduleAlarm);
}

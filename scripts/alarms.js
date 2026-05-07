/* ══════════════════════════════════════════════
   alarms.js — planowanie przypomnień
   ══════════════════════════════════════════════ */

export function scheduleAlarm(note) {
  if (!note.due || !note.time || note.type !== "task" || note.completed) {
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
  notes
    .filter(n => n.type === "task" && !n.completed && n.due && n.time)
    .forEach(scheduleAlarm);
}
/* ══════════════════════════════════════════════════════════════
   background.js — alarmy, powiadomienia, toggle sidebara
   UWAGA: brak importu z i18n.js / alarms.js (background nie jest
   modułem ES w MV2). Tłumaczenia przez browser.i18n.getMessage
   bezpośrednio.

   DUPLIKAT LOGIKI: rescheduleOnBoot() poniżej powiela inwariant
   isAlarmable() oraz obliczenie `when` z alarms.js::scheduleAlarm.
   Background nie może zaimportować tych funkcji (nie-ESM), więc trzyma
   własną kopię. Przy zmianie logiki w alarms.js — zsynchronizuj TUTAJ.
   ══════════════════════════════════════════════════════════════ */

// Re-schedule alarmów po restarcie przeglądarki
// (kopia logiki alarms.js::scheduleAlarm — patrz nagłówek pliku)
async function rescheduleOnBoot() {
  const res = await browser.storage.local.get("notes");
  const notes = res.notes || [];
  await browser.alarms.clearAll();
  const now = Date.now();
  notes.forEach((note) => {
    // inwariant isAlarmable (kopia z alarms.js)
    if (note.type !== "task" || !note.due || note.completed) return;
    // type guard — time musi być stringiem "HH:MM"
    if (typeof note.time !== "string" || !note.time) return;
    const [h, m] = note.time.split(":").map(Number);
    const dt = new Date(note.due);
    dt.setHours(h, m, 0, 0);
    // uwzględnij reminder offset — tak samo jak alarms.js::scheduleAlarm
    const offsetMs = (note.reminder ?? 0) * 60000;
    const when = dt.getTime() - offsetMs;
    if (when > now) browser.alarms.create(note.id, { when });
  });
}
browser.runtime.onStartup.addListener(rescheduleOnBoot);
browser.runtime.onInstalled.addListener(rescheduleOnBoot);

// Powiadomienie gdy alarm odpali
browser.alarms.onAlarm.addListener(async (alarm) => {
  const res = await browser.storage.local.get("notes");
  const note = (res.notes || []).find((n) => n.id === alarm.name);
  const reminder = note?.reminder ?? 0;

  // Body powiadomienia — trzy warianty
  let message;
  if (!note?.time) {
    message = browser.i18n.getMessage("notif_message_noTime");
  } else if (reminder === 0) {
    message = browser.i18n.getMessage("notif_message_onTime", [note.time]);
  } else if (reminder === 60) {
    message = browser.i18n.getMessage("notif_message_1hBefore", [note.time]);
  } else {
    message = browser.i18n.getMessage("notif_message_minBefore", [
      note.time,
      String(reminder),
    ]);
  }

  browser.notifications.create("notif_" + alarm.name, {
    type: "basic",
    iconUrl: browser.runtime.getURL("assets/icons/mdi--event-note.png"),
    title:
      "AsideNotes: " +
      (note?.title || browser.i18n.getMessage("notif_title_fallback")),
    message,
  });
});

// Toggle sidebara
browser.commands.onCommand.addListener((command) => {
  if (command === "toggle-sidebar") browser.sidebarAction.toggle();
});

browser.notifications.onClicked.addListener(() => {
  browser.sidebarAction.open();
});

// ── Message relay: popup → sidebar ──────────────
// Weryfikacja sender.id — patrz komentarz w app.js.
// _pendingSelectId jest walidowany przed zapisem (isValidId regex).
browser.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id !== browser.runtime.id) return;
  if (msg.action === "openAndSelect") {
    // Waliduj noteId przed zapisem do storage — zapobiega wstrzyknięciu
    // przez potencjalnie skompromitowany kontekst popup.html
    if (
      typeof msg.noteId === "string" &&
      /^[A-Za-z0-9_-]{1,100}$/.test(msg.noteId)
    ) {
      browser.storage.local.set({ _pendingSelectId: msg.noteId });
    }
  }
  // 'noteAdded' jest nasłuchiwane bezpośrednio przez sidebar (app.js)
});

// Re-schedule alarmów po restarcie przeglądarki
async function rescheduleOnBoot() {
  const res = await browser.storage.local.get("notes");
  const notes = res.notes || [];
  await browser.alarms.clearAll();

  const now = Date.now();
  notes.forEach((note) => {
    if (note.type !== "task" || !note.due || !note.time || note.completed)
      return;
    const [h, m] = note.time.split(":").map(Number);
    const dt = new Date(note.due);
    dt.setHours(h, m, 0, 0);
    const when = dt.getTime();
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
  const reminderText =
    reminder === 0
      ? ""
      : reminder === 60
        ? " — przypomnienie 1h przed"
        : ` — przypomnienie ${reminder} min przed`;

  browser.notifications.create("notif_" + alarm.name, {
    type: "basic",
    iconUrl: browser.runtime.getURL("assets/icons/mdi--event-note.png"),
    title: note?.title || "Przypomnienie",
    message: note?.time
      ? `Zaplanowane na ${note.time}${reminderText}`
      : "Masz zadanie do wykonania",
  });
});

// Toggle sidebara
browser.commands.onCommand.addListener((command) => {
  if (command === "toggle-sidebar") browser.sidebarAction.toggle();
});

browser.notifications.onClicked.addListener(() => {
  browser.sidebarAction.open();
});

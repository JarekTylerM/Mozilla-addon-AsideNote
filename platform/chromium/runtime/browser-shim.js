/* ══════════════════════════════════════════════════════════════
   browser-shim.js — wspólny kod Firefoksa uruchomiony w Chrome/Edge
   ──────────────────────────────────────────────────────────────
   Wspólny kod woła browser.* (API WebExtensions w wersji Firefoksa).
   Chromium ma chrome.*, które w MV3 też zwraca Promise, więc większość
   API przechodzi bez zmian. Ten plik:
   1. wystawia globalne `browser` jako nakładkę na `chrome`,
   2. podmienia browser.sidebarAction (Firefox) na chrome.sidePanel,
   3. tłumaczy nazwę komendy _execute_action ↔ _execute_browser_action,
      żeby interfejs (data-command=…) nie musiał znać przeglądarki.

   Ładowany jako PIERWSZY skrypt: w sidebar.html i popup.html (build
   wstrzykuje <script> do <head>) oraz w service workerze (background-sw.js).
   Klasyczny skrypt, nie moduł — musi zadziałać też przez importScripts.
   ══════════════════════════════════════════════════════════════ */
(() => {
  'use strict';
  if (typeof chrome === 'undefined' || !chrome.runtime?.id) return;

  const PANEL_PORT = 'asidenotes-sidepanel';
  const isWorker = typeof window === 'undefined';
  const isSidePanel = !isWorker && /\/sidebar\.html$/.test(location.pathname);

  /* ── Okno, w którym otwierać panel ──────────────────────────
     chrome.sidePanel.open() działa tylko w odpowiedzi na gest
     użytkownika i nie przeżyje await — windowId musi być znane
     ZANIM użytkownik kliknie. Strony zapamiętują swoje okno od razu
     przy starcie, worker bierze je z argumentu tab komendy. */
  /** @type {number | undefined} */
  let knownWindowId;
  if (!isWorker) {
    chrome.windows?.getCurrent().then((w) => { knownWindowId = w.id; }).catch(() => {});
  } else {
    chrome.windows?.onFocusChanged.addListener((id) => {
      if (id !== chrome.windows.WINDOW_ID_NONE) knownWindowId = id;
    });
  }

  /* ── Które okna mają otwarty panel ──────────────────────────
     Chromium nie ma sidebarAction.toggle() ani pytania "czy panel jest
     otwarty". Panel sam zgłasza się workerowi przez port; zamknięcie
     panelu zrywa port. Zamykanie: worker prosi panel o window.close(),
     co w Chromium zamyka panel boczny. */
  /** @type {Map<number, chrome.runtime.Port>} */
  const openPanels = new Map();

  if (isWorker) {
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== PANEL_PORT) return;
      if (port.sender?.id !== chrome.runtime.id) return;
      port.onMessage.addListener((msg) => {
        if (msg && typeof msg.windowId === 'number') {
          openPanels.set(msg.windowId, port);
          port.onDisconnect.addListener(() => {
            if (openPanels.get(msg.windowId) === port) openPanels.delete(msg.windowId);
          });
        }
      });
    });
  }

  if (isSidePanel) {
    const connect = () => {
      const port = chrome.runtime.connect({ name: PANEL_PORT });
      port.onMessage.addListener((msg) => {
        if (msg?.action === 'close') window.close();
      });
      // Worker uśpiony/zrestartowany → port zerwany; zgłoś się ponownie
      port.onDisconnect.addListener(() => setTimeout(connect, 1000));
      chrome.windows.getCurrent().then((w) => port.postMessage({ windowId: w.id }));
    };
    connect();
  }

  /** @param {number | undefined} windowId */
  function openPanel(windowId = knownWindowId) {
    // Bez znanego okna albo poza gestem użytkownika (np. kliknięcie
    // powiadomienia po uśpieniu workera) Chromium odmawia — wtedy panel
    // otworzy sam użytkownik, a _pendingSelectId i tak zaznaczy wpis.
    if (typeof windowId !== 'number') return Promise.resolve();
    return chrome.sidePanel.open({ windowId }).catch((e) => {
      console.warn('AsideNotes: sidePanel.open', e?.message ?? e);
    });
  }

  /** @type {chrome.tabs.Tab | undefined} */
  let lastCommandTab;

  const sidebarAction = {
    open: () => openPanel(),
    close: () => {
      const port = typeof knownWindowId === 'number' ? openPanels.get(knownWindowId) : undefined;
      port?.postMessage({ action: 'close' });
      return Promise.resolve();
    },
    toggle: () => {
      const windowId = lastCommandTab?.windowId ?? knownWindowId;
      const port = typeof windowId === 'number' ? openPanels.get(windowId) : undefined;
      if (port) {
        port.postMessage({ action: 'close' });
        return Promise.resolve();
      }
      return openPanel(windowId);
    },
    isOpen: () => Promise.resolve(
      typeof knownWindowId === 'number' && openPanels.has(knownWindowId),
    ),
  };

  /* ── Komendy: nazwy i zapamiętanie karty ────────────────────── */
  const TO_FIREFOX = { _execute_action: '_execute_browser_action' };
  const commands = chrome.commands && {
    getAll: () => chrome.commands.getAll().then((list) =>
      list.map((c) => ({ ...c, name: TO_FIREFOX[c.name] ?? c.name }))),
    onCommand: {
      addListener: (fn) => chrome.commands.onCommand.addListener((name, tab) => {
        lastCommandTab = tab;
        try {
          fn(TO_FIREFOX[name] ?? name, tab);
        } finally {
          lastCommandTab = undefined;
        }
      }),
      removeListener: () => {},
      hasListener: () => false,
    },
  };

  const overrides = { sidebarAction, ...(commands ? { commands } : {}) };
  const browserApi = new Proxy(chrome, {
    get: (target, key) => (key in overrides ? overrides[key] : target[key]),
  });

  try {
    globalThis.browser = browserApi;
  } catch {
    Object.defineProperty(globalThis, 'browser', { value: browserApi, configurable: true });
  }
})();

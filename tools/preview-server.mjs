/**
 * preview-server.mjs — podgląd sidebara w zwykłej przeglądarce (dev only)
 *
 * Sidebar normalnie żyje w Firefoksie i korzysta z `browser.*`. Otwarty jako
 * plik w przeglądarce nie wystartuje: app.js wywala się na pierwszym
 * browser.storage.local.get i zostaje pusty ekran. Przez to każdą zmianę w
 * panelu, dropdownie czy edytorze trzeba było sprawdzać ręcznie w Firefoksie.
 *
 * Ten serwer podaje pliki projektu jak zwykły static server, a pod adresem
 * /preview-harness.html składa sidebar.html z zaślepką `browser.*`
 * (storage trzymany w localStorage, i18n z _locales/pl). Nic nie zapisuje
 * na dysk — build i repo tego nie widzą.
 *
 *   node tools/preview-server.mjs [katalog] [port]
 *   → http://localhost:5199/preview-harness.html
 *
 * UWAGA: to tylko podgląd układu i logiki UI. Alarmy, komendy i cokolwiek
 * zależnego od prawdziwego WebExtensions API są zaślepione.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = process.argv[2] || '.';
const port = Number(process.argv[3] || 5199);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

/** Zaślepka WebExtensions API wstrzykiwana przed app.js. */
function stub(messages) {
  return `    <script>
      // ── Zaślepka WebExtension API — tylko podgląd (tools/preview-server.mjs)
      const MSG = ${JSON.stringify(messages)};
      const KEY = 'asidenote-preview-store';
      const store = JSON.parse(localStorage.getItem(KEY) || '{}');
      const persist = () => localStorage.setItem(KEY, JSON.stringify(store));
      const noop = () => Promise.resolve();
      window.browser = {
        i18n: {
          getMessage: (key, subs) => {
            let m = MSG[key] ?? '';
            if (subs != null) {
              const list = Array.isArray(subs) ? subs : [subs];
              m = m.replace(/\\$(\\w+)\\$/g, () => list.shift() ?? '');
              list.forEach((v, i) => (m = m.replace('$' + (i + 1), v)));
            }
            return m;
          },
          getUILanguage: () => 'pl',
        },
        storage: {
          local: {
            get: (keys) =>
              Promise.resolve(
                typeof keys === 'string' ? { [keys]: store[keys] } : { ...store },
              ),
            set: (obj) => (Object.assign(store, obj), persist(), Promise.resolve()),
            remove: (k) => (delete store[k], persist(), Promise.resolve()),
            getBytesInUse: () => Promise.resolve(JSON.stringify(store).length),
          },
          session: { get: () => Promise.resolve({}), set: noop },
          onChanged: { addListener: () => {} },
        },
        runtime: {
          id: 'preview',
          getManifest: () => ({ version: 'preview' }),
          sendMessage: noop,
          onMessage: { addListener: () => {} },
          lastError: null,
        },
        commands: {
          getAll: () =>
            Promise.resolve([
              { name: 'toggle-sidebar', shortcut: 'Alt+Shift+Q' },
              { name: '_execute_browser_action', shortcut: 'Alt+Shift+S' },
            ]),
          update: noop,
          reset: noop,
          onCommand: { addListener: () => {} },
        },
        alarms: {
          getAll: () => Promise.resolve([]),
          clear: noop,
          create: () => {},
          onAlarm: { addListener: () => {} },
        },
        sidebarAction: { open: noop },
        tabs: { query: () => Promise.resolve([]), create: noop },
        notifications: { create: noop },
      };
    </script>
`;
}

async function harness() {
  const html = await readFile(join(root, 'sidebar.html'), 'utf8');
  const raw = JSON.parse(
    await readFile(join(root, '_locales/pl/messages.json'), 'utf8'),
  );
  const messages = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, v.message]),
  );
  const tag = '<script type="module" src="scripts/app.js"></script>';
  // Zamiennik przez funkcję, nie string: zaślepka zawiera $' (w replace('$' + i)),
  // a to w łańcuchu zamiennika znaczy „reszta tekstu po dopasowaniu" — przez to
  // kod zaślepki gubił końcówkę linii i page wywalał się na SyntaxError.
  return html.replace(tag, () => stub(messages) + '    ' + tag);
}

createServer(async (req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  const rel = normalize(url).replace(/^([/\\])+/, '');
  try {
    if (rel === 'preview-harness.html') {
      res.writeHead(200, {
        'content-type': TYPES['.html'],
        'cache-control': 'no-store',
      });
      res.end(await harness());
      return;
    }
    const buf = await readFile(join(root, rel || 'sidebar.html'));
    res.writeHead(200, {
      'content-type': TYPES[extname(rel)] || 'application/octet-stream',
      // Bez tego przeglądarka trzyma stare moduły i poprawki „nie działają"
      'cache-control': 'no-store, must-revalidate',
    });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 ' + rel);
  }
}).listen(port, () =>
  console.log(`preview: http://localhost:${port}/preview-harness.html`),
);

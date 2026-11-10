/**
 * build-dev-manifest.mjs — manifest wersji testowej (node build.mjs --dev)
 *
 * Firefox przypisuje dane dodatku do jego identyfikatora. Wersja załadowana
 * tymczasowo z tym samym ID co zainstalowana zastępuje ją i pracuje na tych
 * samych notatkach. Własne ID daje osobne dane i pozwala mieć obie wersje
 * naraz, a nazwa, ikona i skróty pozwalają je odróżnić.
 *
 * Nie trafia do paczki: patrz IGNORE w build.mjs.
 */

export const DEV_ADDON_ID = 'asidenotes-dev@local.test';
export const DEV_NAME = 'AsideNotes DEV';
export const DEV_ICON_PATH = 'assets/icons/dev.svg';

/** Ikona wersji testowej: nie do pomylenia z ikoną notatnika na pasku. */
export const DEV_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="6" fill="#e8590c"/>
  <text x="16" y="23" font-family="sans-serif" font-size="22" font-weight="700" text-anchor="middle" fill="#fff">D</text>
</svg>
`;

/**
 * Skróty inne niż w wersji głównej: te same przy obu dodatkach trafiałyby
 * tylko do jednego z nich, nie wiadomo którego.
 *
 * Litera nie może otwierać menu Firefoksa: Alt(+Shift)+litera menu wygrywa
 * ze skrótem dodatku (Alt+Shift+W otwierało "Widok" w polskim Firefoksie).
 * Zajęte litery pilnuje MENU_ACCESS_KEYS w tests/dev-build.test.mjs.
 */
const DEV_SHORTCUTS = {
  'toggle-sidebar': 'Alt+Shift+D',
  _execute_browser_action: 'Alt+Shift+A',
};

/* ── Paczka do samodzielnej dystrybucji (node build.mjs --self) ──────────
   Wersja testowa podpisana przez AMO jako "Na własną rękę": instaluje się na
   stałe i aktualizuje sama. Plik aktualizacji leży w repo, a podpisane .xpi
   w wydaniach GitHuba. Wersja główna z AMO nie może mieć update_url: tam
   aktualizacjami zarządza Mozilla. */

const REPO = 'JarekTylerM/Mozilla-addon-AsideNote';

/** Plik aktualizacji w repo, względem jego katalogu głównego */
export const DEV_UPDATES_FILE = 'updates/asidenotes-dev.json';

/** Adres, pod którym Firefox sprawdza aktualizacje */
export const DEV_UPDATE_URL = `https://raw.githubusercontent.com/${REPO}/main/${DEV_UPDATES_FILE}`;

/**
 * Adres podpisanego pliku danej wersji w wydaniach GitHuba.
 * @param {string} version
 */
export function devUpdateLink(version) {
  return `https://github.com/${REPO}/releases/download/dev-v${version}/asidenotes-dev-${version}.xpi`;
}

/**
 * Numer wersji, który AMO przyjmie: 1–4 liczby rozdzielone kropkami, bez zer
 * wiodących. Litery ("1.0.1a") to stary format Firefoksa, w którym oznaczają
 * wersję PRZEDPREMIEROWĄ — 1.0.1a jest niższe niż 1.0.1, więc nie zastąpi
 * już wydanej 1.0.1. Wyświetlana etykieta idzie wtedy w version_name.
 */
export const AMO_VERSION_RE = /^(0|[1-9]\d{0,8})(\.(0|[1-9]\d{0,8})){0,3}$/;

/**
 * Manifest wersji testowej do podpisania w AMO. Bez przyrostka w version_name:
 * wersję i tak odróżnia nazwa, a walidacja AMO dostaje zwykły numer.
 * @param {any} manifest manifest wersji głównej
 * @param {{ version?: string, versionName?: string }} [override] tylko dla tej
 *   paczki (node build.mjs --self --version=1.0.1.1 --version-name=1.0.1a);
 *   wersja główna w manifest.json zostaje bez zmian
 * @returns {any}
 */
export function toSelfDistributedManifest(manifest, override = {}) {
  const version = override.version ?? manifest.version;
  if (!AMO_VERSION_RE.test(version)) {
    throw new Error(
      `Wersja "${version}" nie przejdzie walidacji AMO: użyj samych liczb ` +
        `(np. 1.0.1.1), a etykietę z literą podaj w --version-name.`,
    );
  }
  const dev = toDevManifest({ ...manifest, version });
  dev.version_name = override.versionName ?? version;
  dev.browser_specific_settings.gecko.update_url = DEV_UPDATE_URL;
  return dev;
}

/**
 * Plik aktualizacji po dodaniu wersji. Starsze wpisy zostają: Firefox wybiera
 * z nich najnowszą, a historia pozwala wrócić do poprzedniej wersji.
 * @param {any} existing dotychczasowa zawartość pliku lub null
 * @param {string} version
 * @returns {any}
 */
export function withUpdateEntry(existing, version) {
  const previous = existing?.addons?.[DEV_ADDON_ID]?.updates ?? [];
  const others = previous.filter((/** @type {any} */ u) => u.version !== version);
  return {
    addons: {
      [DEV_ADDON_ID]: {
        updates: [...others, { version, update_link: devUpdateLink(version) }],
      },
    },
  };
}

/**
 * Manifest wersji głównej → manifest wersji testowej. Nie zmienia wejścia.
 * @param {any} manifest
 * @returns {any}
 */
export function toDevManifest(manifest) {
  const dev = structuredClone(manifest);

  dev.name = DEV_NAME;
  dev.version_name = `${manifest.version}-dev`;
  dev.browser_specific_settings.gecko.id = DEV_ADDON_ID;

  dev.icons = { 48: DEV_ICON_PATH, 128: DEV_ICON_PATH };

  dev.sidebar_action.default_title = DEV_NAME;
  dev.sidebar_action.default_icon = DEV_ICON_PATH;

  dev.browser_action.default_title = DEV_NAME;
  dev.browser_action.default_icon = DEV_ICON_PATH;
  // theme_icons przykryłyby ikonę testową ikoną notatnika
  delete dev.browser_action.theme_icons;

  for (const [command, key] of Object.entries(DEV_SHORTCUTS)) {
    dev.commands[command].suggested_key.default = key;
  }

  return dev;
}

// @ts-check
/* ══════════════════════════════════════════════════════════════
   shortcut-keys.js — zdarzenie klawiatury → skrót w zapisie WebExtensions
   ──────────────────────────────────────────────────────────────
   Czysta logika, bez DOM i bez browser.* — dzięki temu da się ją
   przetestować w Node (tests/shortcut-keys.test.mjs). Zamiana skrótu
   w przeglądarce robi shortcut-editor.js.

   Zapis skrótu, którego oczekuje browser.commands.update():
     modyfikator [+ drugi modyfikator] + klawisz      np. "Alt+Shift+Q"
   - modyfikator główny: Ctrl, Alt, Command (⌘), MacCtrl — wymagany,
     chyba że klawiszem jest F1–F12 (te mogą stać samodzielnie),
   - drugi modyfikator: opcjonalny, inny niż pierwszy (zwykle Shift),
   - klawisz: A–Z, 0–9, F1–F12, Comma, Period, Home, End, PageUp,
     PageDown, Space, Insert, Delete, Up, Down, Left, Right.

   Klawisz bierzemy z event.code (fizyczne miejsce na klawiaturze), nie
   z event.key: przy wciśniętym Alt układ polski/niemiecki daje w .key
   znaki typu "ć" albo "@", a przeglądarka dopasowuje skróty do miejsca
   klawisza. Dla zapisu "Alt+Shift+Q" liczy się więc KeyQ, nie litera.
   ══════════════════════════════════════════════════════════════ */

/** Modyfikatory, które mogą stać jako pierwszy (główny) człon skrótu. */
export const PRIMARY_MODIFIERS = ['Ctrl', 'Alt', 'Command', 'MacCtrl'];

/** Klawisze nazwane inaczej w event.code niż w zapisie skrótu. */
const NAMED_KEYS = /** @type {Record<string, string>} */ ({
  Comma: 'Comma',
  Period: 'Period',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Space: 'Space',
  Insert: 'Insert',
  Delete: 'Delete',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
});

/** event.code samych modyfikatorów — po nich skrót jeszcze nie jest gotowy. */
const MODIFIER_CODES = new Set([
  'ControlLeft', 'ControlRight',
  'AltLeft', 'AltRight', 'AltGraph',
  'ShiftLeft', 'ShiftRight',
  'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight',
  'CapsLock',
]);

/** Pełny klawisz skrótu (bez modyfikatorów). */
const KEY_RX =
  /^(?:[A-Z0-9]|F[1-9]|F1[0-2]|Comma|Period|Home|End|PageUp|PageDown|Space|Insert|Delete|Up|Down|Left|Right)$/;

/**
 * event.code → nazwa klawisza w zapisie skrótu.
 * @param {string} [code]
 * @returns {string|null} null = klawisz nieobsługiwany w skrótach
 */
export function keyFromCode(code) {
  if (!code) return null;
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1];
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  return NAMED_KEYS[code] ?? null;
}

/** @param {string} key */
export function isFunctionKey(key) {
  return /^F([1-9]|1[0-2])$/.test(key);
}

/**
 * Modyfikatory wciśnięte w zdarzeniu, w kolejności wymaganej przez zapis
 * skrótu (główny, potem Shift).
 * @param {{ctrlKey?:boolean, altKey?:boolean, shiftKey?:boolean, metaKey?:boolean}} event
 * @param {boolean} [isMac] klawisz ⌘ liczy się tylko na macOS
 * @returns {string[]}
 */
export function modifiersFromEvent(event, isMac = false) {
  const mods = [];
  if (isMac) {
    // Na macOS "Ctrl" w zapisie skrótu oznacza ⌘; fizyczny Control to MacCtrl.
    if (event.metaKey) mods.push('Command');
    if (event.ctrlKey) mods.push('MacCtrl');
  } else if (event.ctrlKey) {
    mods.push('Ctrl');
  }
  if (event.altKey) mods.push('Alt');
  if (event.shiftKey) mods.push('Shift');
  return mods;
}

/**
 * @typedef {{shortcut: string}} ShortcutReady gotowy skrót
 * @typedef {{pending: string[]}} ShortcutPending same modyfikatory — czekamy
 * @typedef {{error: ShortcutError}} ShortcutRejected
 * @typedef {'needsModifier'|'unsupportedKey'|'tooManyModifiers'} ShortcutError
 */

/**
 * Zdarzenie keydown → skrót, podgląd albo powód odmowy.
 * @param {{code?:string, key?:string, ctrlKey?:boolean, altKey?:boolean, shiftKey?:boolean, metaKey?:boolean}} event
 * @param {{isMac?: boolean}} [opts]
 * @returns {ShortcutReady|ShortcutPending|ShortcutRejected}
 */
export function shortcutFromEvent(event, { isMac = false } = {}) {
  const mods = modifiersFromEvent(event, isMac);
  const code = event.code ?? '';

  // Sam modyfikator (albo zdarzenie bez .code) — pokaż podgląd "Alt+Shift+…"
  if (!code || MODIFIER_CODES.has(code)) return { pending: mods };

  const key = keyFromCode(code);
  if (!key) return { error: 'unsupportedKey' };
  if (mods.length > 2) return { error: 'tooManyModifiers' };
  // F1–F12 wolno użyć samodzielnie; reszta potrzebuje Ctrl/Alt/⌘ —
  // sam Shift+litera przechwytywałby zwykłe pisanie.
  if (!isFunctionKey(key) && !mods.some((m) => m !== 'Shift')) {
    return { error: 'needsModifier' };
  }
  return { shortcut: [...mods, key].join('+') };
}

/**
 * Czy string da się przekazać do browser.commands.update().
 * @param {string} shortcut
 * @returns {boolean}
 */
export function isValidShortcut(shortcut) {
  if (typeof shortcut !== 'string' || !shortcut) return false;
  const parts = shortcut.split('+');
  const key = /** @type {string} */ (parts.pop());
  if (!KEY_RX.test(key)) return false;
  if (parts.length > 2) return false;
  if (new Set(parts).size !== parts.length) return false;
  for (const mod of parts) {
    if (mod !== 'Shift' && !PRIMARY_MODIFIERS.includes(mod)) return false;
  }
  if (!isFunctionKey(key) && !parts.some((m) => m !== 'Shift')) return false;
  return true;
}

/**
 * Czy skrót jest już zajęty przez INNĄ komendę dodatku. Kolizji ze skrótami
 * przeglądarki ani innych dodatków nie da się sprawdzić z poziomu API —
 * o tym użytkownik dowie się dopiero, gdy skrót nie zadziała.
 * @param {string} shortcut
 * @param {Record<string,string>} current nazwa komendy → jej skrót
 * @param {string} name komenda, którą właśnie zmieniamy
 * @returns {string|null} nazwa kolidującej komendy albo null
 */
export function conflictingCommand(shortcut, current, name) {
  for (const [other, assigned] of Object.entries(current || {})) {
    if (other !== name && assigned && assigned === shortcut) return other;
  }
  return null;
}

/**
 * Podgląd w trakcie wciskania: "Alt+Shift+…" (same modyfikatory).
 * @param {string[]} mods
 * @param {string} [ellipsis]
 */
export function previewLabel(mods, ellipsis = '…') {
  return mods.length ? `${mods.join('+')}+${ellipsis}` : '';
}

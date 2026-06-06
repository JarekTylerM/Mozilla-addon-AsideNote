/**
 * dom-harness.mjs — minimalny harness DOM dla testów edytora
 *
 * Buduje środowisko jsdom z edytorem, ustawia globalny document/window,
 * udostępnia helpery do manipulacji kursorem i sprawdzania stanu.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

// ── Setup globalnego DOM ─────────────────────────────────────────

export function createEditorDOM(html = '') {
  const dom = new JSDOM(`<!DOCTYPE html>
    <html><body>
      <div id="editor" contenteditable="true">${html}</div>
    </body></html>`, {
    pretendToBeVisual: true,
  });

  const { window: win } = dom;
  const { document: doc } = win;

  // Eksponuj jako globale (potrzebne przez importowane moduły)
  global.window   = win;
  global.document = doc;
  global.Node     = win.Node;

  const editor = doc.getElementById('editor');

  return { dom, win, doc, editor };
}

// ── Cursor helpers ───────────────────────────────────────────────

/**
 * Ustaw kursor na początku węzła (lub węzła tekstowego).
 */
export function setCursorAt(node, offset = 0) {
  const sel   = global.window.getSelection();
  const range = global.document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

/**
 * Ustaw kursor w węźle tekstowym na podanym offsecie.
 */
export function setCursorInText(textNode, offset) {
  setCursorAt(textNode, offset);
}

/**
 * Znajdź pierwszy węzeł tekstowy w elemencie.
 */
export function firstText(el) {
  const walker = global.document.createTreeWalker(el, 0x4 /* SHOW_TEXT */);
  return walker.nextNode();
}

/**
 * Symuluj naciśnięcie klawisza (tworzy KeyboardEvent).
 */
export function makeKeyEvent(key, opts = {}) {
  return new global.window.KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    shiftKey: opts.shiftKey ?? false,
    ctrlKey:  opts.ctrlKey  ?? false,
    altKey:   opts.altKey   ?? false,
    ...opts,
  });
}

/**
 * Zwraca aktualny innerText editora znormalizowany (dla asercji).
 */
export function editorText(editor) {
  return editor.textContent;
}

/**
 * Zwraca tagi bezpośrednich dzieci editora.
 */
export function childTags(editor) {
  return Array.from(editor.children).map(c => c.tagName.toLowerCase());
}

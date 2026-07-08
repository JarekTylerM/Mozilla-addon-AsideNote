// @ts-check
/* ══════════════════════════════════════════════════════════════
   undo.js — undo/redo manager dla edytora rich-text
   ──────────────────────────────────────────────────────────────
   Kontrakt:
   - init(editorEl)              — podpina się do edytora, zaczyna obserwować
   - reset(initialContent?)      — wymaż stos, zacznij od nowa (np. przy zmianie notatki)
   - checkpoint()                — zapisz aktualny stan jako nowy snapshot
   - undo()                      — przywróć poprzedni snapshot, zwraca true/false
   - redo()                      — wróć do snapshotu cofniętego, zwraca true/false
   - canUndo() / canRedo()       — odpytanie stanu (np. dla disabled buttonów)
   ══════════════════════════════════════════════════════════════ */

const MAX_STACK = 50;
// Budżet pamięci stosu: suma długości snapshotów HTML. 50 snapshotów
// notatki 50 KB to 2,5 MB w pamięci — przy dużych notatkach ograniczamy
// łączny rozmiar, wyrzucając najstarsze wpisy (głębokość undo maleje,
// ale pamięć pozostaje pod kontrolą).
const MAX_STACK_CHARS = 500_000;
const TYPING_PAUSE_MS = 500;

/**
 * @typedef {{ startPath: number[]|null, startOffset: number, endPath: number[]|null, endOffset: number, collapsed: boolean } | null} SelData
 * @typedef {{ html: string, selection: SelData }} Snapshot
 */

/** @type {HTMLElement | null} */
let editor = null;
/** @type {Snapshot[]} */
let undoStack = [];
/** @type {Snapshot[]} */
let redoStack = [];
/** @type {ReturnType<typeof setTimeout> | null} */
let typingTimer = null;
/** @type {string | null} */
let lastSnapshotHTML = null;

/**
 * Snapshot to obiekt { html, selection } — selekcja przez ścieżkę offsetów,
 * bo Range nie jest serializable i traci ważność po innerHTML replace.
 */
function _captureSnapshot() {
  if (!editor) return null;
  return {
    html: editor.innerHTML,
    selection: _captureSelection(),
  };
}

function _captureSelection() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!editor || !editor.contains(range.startContainer)) return null;

  return {
    startPath: _nodePath(range.startContainer),
    startOffset: range.startOffset,
    endPath: _nodePath(range.endContainer),
    endOffset: range.endOffset,
    collapsed: range.collapsed,
  };
}

/**
 * Ścieżka indeksów od editora do node — żeby po innerHTML replace odnaleźć
 * "ten sam" węzeł w nowym drzewie.
 * @param {Node} node
 * @returns {number[]|null}
 */
function _nodePath(node) {
  /** @type {number[]} */
  const path = [];
  let current = node;
  while (current && current !== editor) {
    const parent = current.parentNode;
    if (!parent) return null;
    path.unshift(Array.prototype.indexOf.call(parent.childNodes, current));
    current = parent;
  }
  return path;
}

/** @param {SelData} selData */
function _restoreSelection(selData) {
  if (!selData) return;
  const startNode = _resolvePath(selData.startPath);
  const endNode = selData.collapsed ? startNode : _resolvePath(selData.endPath);
  if (!startNode || !endNode) return;

  try {
    const range = document.createRange();
    range.setStart(startNode, Math.min(selData.startOffset, _maxOffset(startNode)));
    range.setEnd(endNode, Math.min(selData.endOffset, _maxOffset(endNode)));
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  } catch {
    // Path zdezaktualizowany, ignore — kursor wyląduje "gdzieś"
  }
}

/** @param {number[]|null} path @returns {Node|null} */
function _resolvePath(path) {
  if (!path || !editor) return null;
  /** @type {Node} */
  let current = editor;
  for (const idx of path) {
    if (!current.childNodes[idx]) return current;
    current = current.childNodes[idx];
  }
  return current;
}

/** @param {Node} node @returns {number} */
function _maxOffset(node) {
  return node.nodeType === Node.TEXT_NODE
    ? (node.textContent?.length ?? 0)
    : node.childNodes.length;
}

/**
 * Push snapshotu na stos. Czyści redo. Limit 50 — najstarsze wypadają.
 * Pomija duplikaty (gdy nic się realnie nie zmieniło od ostatniego snapshotu).
 */
function _pushSnapshot() {
  const snapshot = _captureSnapshot();
  if (!snapshot) return;
  if (snapshot.html === lastSnapshotHTML) return;

  undoStack.push(snapshot);
  if (undoStack.length > MAX_STACK) undoStack.shift();

  // Budżet pamięci — wyrzucaj najstarsze aż suma zmieści się w limicie
  // (min. 2 wpisy: stan inicjalny + bieżący, żeby undo dalej działało)
  let total = undoStack.reduce((sum, s) => sum + s.html.length, 0);
  while (total > MAX_STACK_CHARS && undoStack.length > 2) {
    total -= undoStack.shift()?.html.length ?? 0;
  }

  redoStack = [];
  lastSnapshotHTML = snapshot.html;
}

/**
 * Restore — zastępuje innerHTML i przywraca selekcję.
 * @param {Snapshot|null|undefined} snapshot
 */
function _restoreSnapshot(snapshot) {
  if (!snapshot || !editor) return;
  editor.innerHTML = snapshot.html;
  lastSnapshotHTML = snapshot.html;
  _restoreSelection(snapshot.selection);
}

/* ── Public API ──────────────────────────────────────── */

/** @param {HTMLElement} editorEl */
export function init(editorEl) {
  editor = editorEl;
  reset();

  // Typing pauza — po 500ms bez input, zapisz snapshot
  editor.addEventListener("input", () => {
    if (typingTimer) clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      _pushSnapshot();
      typingTimer = null;
    }, TYPING_PAUSE_MS);
  });
}

/** @param {string} [initialContent] */
export function reset(initialContent) {
  undoStack = [];
  redoStack = [];
  if (typingTimer) {
    clearTimeout(typingTimer);
    typingTimer = null;
  }
  // Inicjalny snapshot — żeby pierwszy undo cofał do "stanu początkowego notatki"
  if (editor) {
    lastSnapshotHTML = initialContent ?? editor.innerHTML;
    undoStack.push({
      html: lastSnapshotHTML,
      selection: null,
    });
  }
}

/**
 * Wymuś natychmiastowy snapshot (przed/po operacji blokowej, paste, format change).
 * Anuluje typing timer — operacja blokowa = atomowy krok.
 */
export function checkpoint() {
  if (typingTimer) {
    clearTimeout(typingTimer);
    typingTimer = null;
  }
  _pushSnapshot();
}

export function undo() {
  // Anuluj pending typing snapshot, zapisz aktualny stan jeśli się zmienił
  if (typingTimer) {
    clearTimeout(typingTimer);
    typingTimer = null;
    _pushSnapshot();
  }

  if (undoStack.length <= 1) return false; // Pierwszy snapshot to stan inicjalny — nie cofamy

  const current = undoStack.pop();
  if (!current) return false;
  redoStack.push(current);
  const previous = undoStack[undoStack.length - 1];
  _restoreSnapshot(previous);
  return true;
}

export function redo() {
  if (redoStack.length === 0) return false;
  const next = redoStack.pop();
  if (!next) return false;
  undoStack.push(next);
  _restoreSnapshot(next);
  return true;
}

export function canUndo() {
  return undoStack.length > 1;
}

export function canRedo() {
  return redoStack.length > 0;
}
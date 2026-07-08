// @ts-check
/**
 * editor-selection.js — DOM selection helpers
 *
 * Funkcje pomocnicze do odczytu i manipulacji pozycją kursora.
 * Zero stanu modułu — każda funkcja jest czysta (operuje na
 * przekazanych węzłach DOM lub na window.getSelection()).
 *
 * Używane przez: editor.js (_handleEnter, _handleBackspace,
 *                _handleTab, _handleAltArrow, _initKeydown)
 */

// #editor jest zawsze w DOM w kontekstach używających tych helperów.
const getEditor = () =>
  /** @type {HTMLElement} */ (document.getElementById("editor"));

export function _getListItem() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const node = sel.getRangeAt(0).startContainer;
  const el =
    node.nodeType === Node.TEXT_NODE
      ? node.parentElement
      : /** @type {Element} */ (node);
  return el?.closest("li") ?? null;
}

/** @param {Element} li */
export function _isCursorAtListStart(li) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  // Guard: kursor musi być wewnątrz li — inaczej setEnd rzuci (cross-tree),
  // a logicznie kursor poza li z definicji nie jest "na początku listy"
  if (!li.contains(range.startContainer)) return false;
  const check = document.createRange();
  check.setStart(li, 0);
  check.setEnd(range.startContainer, range.startOffset);
  return check.toString() === "";
}

/** @param {Element} li */
export function _focusLi(li) {
  const range = document.createRange();
  range.setStart(li, 0);
  range.collapse(true);
  const sel = window.getSelection();
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(range);
  }
  getEditor().focus();
}

/** @param {Element} li */
export function _indentListItem(li) {
  const prev = li.previousElementSibling;
  if (!prev || prev.tagName !== "LI") return;

  const tag = li.parentElement?.tagName ?? "UL";
  // Reużyj istniejącej podlisty w prev: najpierw tego samego typu, a jeśli prev
  // ma już podlistę innego typu — dołącz do niej. Bez tego drugiego kroku
  // powstawały dwie równoległe listy (<ol> + <ul>) pod jednym elementem.
  let nested =
    prev.querySelector(`:scope > ${tag}`) ||
    prev.querySelector(":scope > ul, :scope > ol");
  if (!nested) {
    nested = document.createElement(tag);
    prev.appendChild(nested);
  }

  nested.appendChild(li);
  _focusLi(li);
}

/** @param {Element} li */
export function _outdentListItem(li) {
  const parentList = li.parentElement;
  if (!parentList) return;
  const parentLi = parentList.parentElement;
  if (!parentLi || parentLi.tagName !== "LI") return;

  parentLi.after(li);
  if (parentList.children.length === 0) parentList.remove();
  _focusLi(li);
}

export function _getCurrentBlock() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;

  const node = sel.getRangeAt(0).startContainer;
  const el =
    node.nodeType === Node.TEXT_NODE
      ? node.parentElement
      : /** @type {Element} */ (node);

  // Block tagi które obsługujemy
  const blockTags = ["P", "H1", "H2", "H3", "BLOCKQUOTE", "LI"];

  // DIV traktujemy jako block TYLKO jeśli to nie jest sam #editor
  /** @type {Element | null} */
  let current = el;
  while (current && current !== getEditor()) {
    if (blockTags.includes(current.tagName)) return current;
    if (current.tagName === "DIV") return current;
    current = current.parentElement;
  }

  // Fallback: text bezpośrednio w editorze, bez wrappera
  return getEditor();
}

/** @param {Element | null} block */
export function _clearBlock(block) {
  if (!block) return;

  if (block === getEditor()) {
    // Specjalna obsługa: editor jako block — wyczyść wszystko, ale zachowaj
    // pusty wrapper żeby formatBlock miał do czego się przyczepić
    getEditor().innerHTML = "";
    const p = document.createElement("p");
    p.innerHTML = "<br>";
    getEditor().appendChild(p);

    const r = document.createRange();
    r.setStart(p, 0);
    r.collapse(true);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(r);
    }
    return;
  }

  block.textContent = "";

  const r = document.createRange();
  r.setStart(block, 0);
  r.collapse(true);
  const sel = window.getSelection();
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(r);
  }
}

/** @param {Element} el */
export function _restoreCursorTo(el) {
  // Znajdź pierwszy węzeł tekstowy lub fallback na sam element
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const textNode = walker.nextNode();
  const sel = window.getSelection();
  const range = document.createRange();
  if (textNode) {
    range.setStart(textNode, 0);
  } else {
    range.setStart(el, 0);
  }
  range.collapse(true);
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(range);
  }
  getEditor().focus();
}

/* ── Context Resume — pozycja kursora jako offset tekstowy ────
   Przeniesione z editor.js: notes.js potrzebuje setCursorOffset przy
   selectNote, a import z editor.js tworzył cykl notes.js ↔ editor.js
   (działał dzięki hoistingowi ESM, ale był miną na przyszłość). */

// Bloki, z których każdy jest osobną LINIĄ (dostaje własny indeks linii).
const LINE_BLOCK_TAGS = new Set([
  "P", "DIV", "H1", "H2", "H3", "LI", "BLOCKQUOTE", "PRE", "SUMMARY", "HR",
]);
// Kontenery grupujące linie — same nie są linią (linie tworzą ich dzieci).
const LINE_CONTAINER_TAGS = new Set(["UL", "OL", "DETAILS"]);

/**
 * Buduje uporządkowaną (rosnącą po `linear`) listę pozycji kursora.
 *
 * Offset LINIOWY pozycji = (znaki tekstu przed nią) + (indeks jej linii).
 * Dodanie indeksu linii sprawia, że pusta linia (<p><br></p>, pusty <li>) ma
 * własny offset i nie zlewa się z końcem poprzedniej linii — to naprawia dryf
 * resume kursora. Offset dalej przeżywa re-render innerHTML, bo zależy tylko od
 * tekstu i liczby linii, nie od konkretnych węzłów.
 *
 * `pending` + `commitLine`: wejście w blok tylko ZAZNACZA nową linię; indeks
 * rośnie dopiero gdy pojawi się tekst lub pusta linia. Dzięki temu bloki
 * opakowujące (blockquote>p, ul>li) nie liczą się podwójnie.
 *
 * @param {HTMLElement} editorEl
 * @returns {Array<{node: Node, offset: number, linear: number}>}
 */
function _buildPositions(editorEl) {
  /** @type {Array<{node: Node, offset: number, linear: number}>} */
  const positions = [];
  let globalText = 0; // znaki tekstu wyemitowane dotąd
  let lineIndex = 0;
  let started = false; // pierwsza linia już zaksięgowana?
  let pending = false; // wejście w blok czeka na commit

  const commitLine = () => {
    if (!started) started = true;
    else if (pending) lineIndex += 1;
    pending = false;
  };

  /** @param {Node} node */
  const visit = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const len = child.textContent?.length ?? 0;
        if (len === 0) continue;
        commitLine();
        for (let i = 0; i <= len; i++) {
          positions.push({ node: child, offset: i, linear: globalText + i + lineIndex });
        }
        globalText += len;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const childEl = /** @type {Element} */ (child);
        if (childEl.tagName === "BR") continue; // soft break — jak dotąd, 0 znaków
        if (
          LINE_BLOCK_TAGS.has(childEl.tagName) ||
          LINE_CONTAINER_TAGS.has(childEl.tagName)
        ) {
          pending = true;
          const before = positions.length;
          visit(child);
          // Blok bez tekstu = pusta linia → własna pozycja (element, 0)
          if (positions.length === before && LINE_BLOCK_TAGS.has(childEl.tagName)) {
            commitLine();
            positions.push({ node: child, offset: 0, linear: globalText + lineIndex });
          }
        } else {
          visit(child); // inline (strong/em/a/code/u/span…) — bez łamania
        }
      }
    }
  };

  visit(editorEl);
  return positions;
}

/**
 * Zwraca pozycję kursora jako offset LINIOWY (patrz _buildPositions).
 * @param {HTMLElement} editorEl
 * @returns {number|null} null gdy brak selekcji lub kursor poza edytorem
 */
export function getCursorOffset(editorEl) {
  const sel = window.getSelection();
  if (!sel?.rangeCount || !editorEl) return null;
  const range = sel.getRangeAt(0);
  if (!editorEl.contains(range.startContainer)) return null;

  const positions = _buildPositions(editorEl);
  const hit = positions.find(
    (p) => p.node === range.startContainer && p.offset === range.startOffset,
  );
  if (hit) return hit.linear;

  // Fallback dla nietypowego kontenera (np. element-offset między blokami):
  // czysto tekstowy offset — gorszej rozdzielczości, ale bez wyjątku i nie
  // gorzej niż poprzednia implementacja.
  try {
    const pre = document.createRange();
    pre.selectNodeContents(editorEl);
    pre.setEnd(range.startContainer, range.startOffset);
    return pre.toString().length;
  } catch {
    return null;
  }
}

/**
 * Ustawia kursor na zadanym offsecie liniowym (odwrotność getCursorOffset).
 * Offset poza zakresem → kursor na końcu edytora.
 * @param {HTMLElement} editorEl
 * @param {number} offset
 */
export function setCursorOffset(editorEl, offset) {
  if (offset == null || offset < 0 || !editorEl) return;

  const positions = _buildPositions(editorEl);
  // positions rosną po `linear` → bierz dokładne trafienie, inaczej największą
  // pozycję o linear ≤ offset (klamrowanie w dół).
  let chosen = null;
  for (const p of positions) {
    if (p.linear === offset) { chosen = p; break; }
    if (p.linear < offset) chosen = p;
    else break;
  }

  const range = document.createRange();
  if (chosen) {
    range.setStart(chosen.node, chosen.offset);
    range.collapse(true);
    chosen.node.parentElement?.scrollIntoView?.({ block: "nearest" });
  } else {
    // Offset przed pierwszą pozycją lub pusty edytor → koniec treści
    range.selectNodeContents(editorEl);
    range.collapse(false);
  }
  const sel = window.getSelection();
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

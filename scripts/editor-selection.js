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

/**
 * @typedef {{ sc: Node, so: number, ec: Node, eo: number }} SavedSelection
 */

/**
 * Zapamiętuje zaznaczenie jako pary (węzeł, offset).
 *
 * Przeniesienie węzła w DOM to usunięcie + wstawienie, a usunięcie zwija
 * żywe zakresy do rodzica — kursor w przenoszonym punkcie listy lądowałby
 * poza nim. Same węzły tekstowe przeżywają przeniesienie, więc wystarczy
 * po operacji ustawić zakres na nich ponownie.
 *
 * @returns {SavedSelection|null}
 */
export function _saveSelection() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  return { sc: r.startContainer, so: r.startOffset, ec: r.endContainer, eo: r.endOffset };
}

/**
 * Przywraca zaznaczenie z _saveSelection. Zwraca false, gdy węzły zniknęły
 * z dokumentu (wtedy caller wybiera własny fallback).
 * @param {SavedSelection|null} saved
 * @returns {boolean}
 */
export function _restoreSelection(saved) {
  if (!saved || !saved.sc.isConnected || !saved.ec.isConnected) return false;
  const sel = window.getSelection();
  if (!sel) return false;
  try {
    const r = document.createRange();
    r.setStart(saved.sc, saved.so);
    r.setEnd(saved.ec, saved.eo);
    sel.removeAllRanges();
    sel.addRange(r);
    return true;
  } catch {
    return false; // offset poza węzłem po mutacji — niech caller ustawi kursor
  }
}

/**
 * Przywraca zaznaczenie, a gdy się nie da — kursor na początek punktu.
 * Fokus PRZED zakresem: focus() na nieaktywnym contenteditable potrafi
 * przestawić kursor, więc ustawiony wcześniej zakres by przepadł.
 * @param {SavedSelection|null} saved
 * @param {Element} li
 */
function _restoreOrFocusLi(saved, li) {
  getEditor()?.focus();
  if (!_restoreSelection(saved)) _focusLi(li);
}

/**
 * Wcięcie punktu pod poprzedni punkt.
 *
 * Kursor zostaje tam, gdzie był — wcześniej Tab przeskakiwał na początek
 * punktu, co przy wcinaniu w trakcie pisania wybijało z rytmu.
 *
 * @param {Element} li
 * @param {boolean} [manageSelection=true] false, gdy caller sam pilnuje zaznaczenia (operacja na wielu punktach)
 * @returns {boolean} true, gdy punkt został przeniesiony
 */
export function _indentListItem(li, manageSelection = true) {
  const prev = li.previousElementSibling;
  if (!prev || prev.tagName !== "LI") return false;

  const saved = manageSelection ? _saveSelection() : null;
  const parentList = li.parentElement;
  const tag = parentList?.tagName ?? "UL";
  // Reużyj istniejącej podlisty w prev: najpierw tego samego typu, a jeśli prev
  // ma już podlistę innego typu — dołącz do niej. Bez tego drugiego kroku
  // powstawały dwie równoległe listy (<ol> + <ul>) pod jednym elementem.
  let nested =
    prev.querySelector(`:scope > ${tag}`) ||
    prev.querySelector(":scope > ul, :scope > ol");
  if (!nested) {
    nested = document.createElement(tag);
    // Podlista checklisty jest checklistą — inaczej eksport do Markdown
    // gubi stan [x] wciętych punktów.
    const kind = parentList?.getAttribute("data-list");
    if (kind) nested.setAttribute("data-list", kind);
    prev.appendChild(nested);
  }

  nested.appendChild(li);
  if (manageSelection) _restoreOrFocusLi(saved, li);
  return true;
}

/**
 * Wyciągnięcie punktu poziom wyżej (za punkt-rodzica).
 *
 * Punkty, które stały POD wyciąganym, przechodzą do niego jako podpunkty.
 * Wcześniej zostawały przy dawnym rodzicu, czyli wizualnie NAD wyciągniętym
 * punktem — Shift+Tab na środku podlisty odwracał kolejność (A › B, C, D;
 * Shift+Tab na C dawało A › B, D, a dopiero potem C).
 *
 * @param {Element} li
 * @param {boolean} [manageSelection=true]
 * @returns {boolean} true, gdy punkt został przeniesiony
 */
export function _outdentListItem(li, manageSelection = true) {
  const parentList = li.parentElement;
  if (!parentList) return false;
  const parentLi = parentList.parentElement;
  if (!parentLi || parentLi.tagName !== "LI") return false;

  const saved = manageSelection ? _saveSelection() : null;

  /** @type {Element[]} */
  const following = [];
  for (let n = li.nextElementSibling; n; n = n.nextElementSibling) following.push(n);
  if (following.length) {
    let sub = li.querySelector(":scope > ul, :scope > ol");
    if (!sub) {
      sub = document.createElement(parentList.tagName.toLowerCase());
      const kind = parentList.getAttribute("data-list");
      if (kind) sub.setAttribute("data-list", kind);
      li.appendChild(sub);
    }
    for (const f of following) sub.appendChild(f);
  }

  parentLi.after(li);
  if (parentList.children.length === 0) parentList.remove();
  if (manageSelection) _restoreOrFocusLi(saved, li);
  return true;
}

/** @param {Node} n */
const _isListEl = (n) =>
  n.nodeType === Node.ELEMENT_NODE &&
  (/** @type {Element} */ (n).tagName === "UL" || /** @type {Element} */ (n).tagName === "OL");

/**
 * Punkty listy objęte zaznaczeniem — tylko "korzenie": punkt, którego
 * przodek-punkt też jest zaznaczony, pomijamy, bo i tak przesunie się
 * razem z nim.
 *
 * Punkt liczy się jako zaznaczony, gdy zakres dotyka jego WŁASNEJ treści
 * (nie podlisty) — inaczej zaznaczenie podpunktów łapałoby też rodzica,
 * który je zawiera.
 *
 * @param {Range} range
 * @returns {Element[]} w kolejności dokumentu
 */
export function _selectedListItems(range) {
  const ed = getEditor();
  const startEl =
    range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : /** @type {Element} */ (range.startContainer);
  const caretLi = startEl?.closest("li") ?? null;

  if (range.collapsed) return caretLi && ed.contains(caretLi) ? [caretLi] : [];

  const hit = Array.from(ed.querySelectorAll("li")).filter((li) =>
    Array.from(li.childNodes).some((n) => !_isListEl(n) && range.intersectsNode(n)),
  );
  if (!hit.length) return caretLi && ed.contains(caretLi) ? [caretLi] : [];

  const set = new Set(hit);
  return hit.filter((li) => {
    for (let p = li.parentElement?.closest("li"); p; p = p.parentElement?.closest("li")) {
      if (set.has(p)) return false;
    }
    return true;
  });
}

/**
 * Tab na zaznaczeniu wielu punktów — wcina wszystkie, nie tylko pierwszy.
 *
 * Wszystko albo nic: gdy pierwszego punktu nie ma pod co wciąć (początek
 * listy), nie ruszamy żadnego. Inaczej kolejne punkty wsunęłyby się pod
 * pierwszy i zmieniły się relacje między zaznaczonymi punktami.
 *
 * @param {Element[]} items wynik _selectedListItems
 * @returns {boolean}
 */
export function _indentListItems(items) {
  if (!items.length) return false;
  if (items[0].previousElementSibling?.tagName !== "LI") return false;
  const saved = _saveSelection();
  for (const li of items) _indentListItem(li, false);
  _restoreOrFocusLi(saved, items[0]);
  return true;
}

/**
 * Shift+Tab na zaznaczeniu wielu punktów. Od końca — wtedy żaden
 * zaznaczony punkt nie zostaje "następnikiem" wyciąganego i nie trafia
 * do jego podlisty (patrz _outdentListItem).
 *
 * @param {Element[]} items wynik _selectedListItems
 * @returns {boolean}
 */
export function _outdentListItems(items) {
  if (!items.length) return false;
  const saved = _saveSelection();
  let moved = false;
  for (const li of [...items].reverse()) moved = _outdentListItem(li, false) || moved;
  if (moved) _restoreOrFocusLi(saved, items[0]);
  return moved;
}

/**
 * Naprawia listę zagnieżdżoną bezpośrednio w liście (<ul><li>A</li><ul>…</ul></ul>).
 *
 * Taki układ produkuje m.in. Google Docs i część edytorów webmaili.
 * Przeglądarka go wyświetla, ale nasze operacje zakładają li > ul:
 * Tab/Shift+Tab nic nie robiły, a eksport do Markdown pomijał te punkty.
 * Podlista trafia do poprzedniego punktu; gdy go nie ma — do nowego,
 * pustego punktu z <br> (inaczej nie dałoby się w niego wejść kursorem).
 *
 * @param {Element} root
 * @returns {boolean} true, gdy coś poprawiono (caller przywraca zaznaczenie)
 */
export function _normalizeListNesting(root) {
  const strays = Array.from(
    root.querySelectorAll("ul > ul, ul > ol, ol > ul, ol > ol"),
  );
  if (!strays.length) return false;
  const doc = root.ownerDocument;
  for (const list of strays) {
    const prev = list.previousElementSibling;
    if (prev && prev.tagName === "LI") {
      const last = prev.lastElementChild;
      if (last && _isListEl(last)) {
        while (list.firstChild) last.appendChild(list.firstChild);
        list.remove();
      } else {
        prev.appendChild(list);
      }
    } else {
      const li = doc.createElement("li");
      li.appendChild(doc.createElement("br"));
      list.before(li);
      li.appendChild(list);
    }
  }
  return true;
}

/**
 * Dzieli <li> zawierający podlistę, zostawiając podlistę przy oryginale.
 *
 * Powód istnienia: natywny insertParagraph Firefoksa przenosi zagnieżdżoną
 * <ol>/<ul> do nowo powstałego <li>, który nie dostaje własnego kontenera
 * tekstu — powstaje <li><ol>…</ol></li>, do którego nie da się wejść
 * kursorem. Element listy bez miejsca na tekst jest nieedytowalny i nie
 * ma jak go naprawić z poziomu UI.
 *
 * Zakres cięcia to WŁASNA treść <li> — od kursora do pierwszej podlisty,
 * nie do końca elementu. Dzięki temu podlista zostaje pod punktem, do
 * którego należy, a nowy punkt pojawia się pod nią, na tym samym poziomie.
 *
 * Oba <li> dostają <br>, jeśli zostałyby bez własnej treści — to jedyne,
 * co trzyma je edytowalnymi.
 *
 * @param {Element} li dzielony element listy
 * @param {Range} range kursor (collapsed) wewnątrz li
 * @returns {Element} nowo utworzony <li>
 */
export function _splitListItemKeepingNested(li, range) {
  const nested = li.querySelector(":scope > ul, :scope > ol");
  return _splitBlockAtCaret(li, range, "li", nested);
}

/**
 * Dzieli blok w miejscu kursora: treść za kursorem wędruje do nowego
 * elementu wstawionego zaraz za oryginałem.
 *
 * `stopBefore` ogranicza cięcie do WŁASNEJ treści bloku — podajemy tam
 * zagnieżdżoną listę, żeby została przy oryginale zamiast wywędrować do
 * nowego punktu (patrz _splitListItemKeepingNested).
 *
 * Oba bloki dostają <br>, jeśli zostałyby bez treści. Element bez
 * kontenera tekstu jest nieedytowalny i nie da się go naprawić z UI —
 * to jest właśnie ten strażnik, którego brak psuł listy.
 *
 * @param {Element} block dzielony blok
 * @param {Range} range kursor (collapsed) wewnątrz bloku
 * @param {string} tag nazwa tagu nowego bloku ("li", "p", …)
 * @param {Element|null} [stopBefore] granica własnej treści bloku
 * @returns {Element} nowo utworzony blok
 */
export function _splitBlockAtCaret(block, range, tag, stopBefore = null) {
  const tail = document.createRange();
  tail.setStart(range.startContainer, range.startOffset);
  if (stopBefore) tail.setEndBefore(stopBefore);
  else tail.setEnd(block, block.childNodes.length);

  const newBlock = document.createElement(tag);
  // Kursor za granicą stopBefore — zakres wychodzi odwrócony i DOM zwija go
  // do pustego. Traktujemy to jak brak treści do przeniesienia.
  if (!tail.collapsed) {
    try {
      newBlock.appendChild(tail.extractContents());
    } catch {
      /* zakres nie do wyciągnięcia — nowy blok zostaje pusty */
    }
  }

  // extractContents zostawia po sobie węzły tekstowe zerowej długości.
  // Bez ich sprzątnięcia blok wygląda na niepusty, nie dostaje <br>
  // i wraca dokładnie ten bug, który ta funkcja naprawia.
  _dropEmptyTextNodes(newBlock);
  _dropEmptyTextNodes(block);

  if (!newBlock.childNodes.length) {
    newBlock.appendChild(document.createElement("br"));
  }
  // Oryginał został bez własnej treści (kursor stał na jej początku).
  // insertBefore(…, null) dokłada na koniec, więc jedno wyrażenie
  // obsługuje i wariant z podlistą, i blok pusty do końca.
  if (block.firstChild === stopBefore) {
    block.insertBefore(document.createElement("br"), stopBefore);
  }

  block.after(newBlock);
  return newBlock;
}

/**
 * Scala <li> z poprzednim punktem (Backspace na początku punktu).
 *
 * Dwie rzeczy, których nie robiło doklejanie wszystkiego na koniec:
 *  - własna treść scalanego punktu ląduje PRZED podlistą poprzednika,
 *    inaczej tekst renderuje się pod zagnieżdżoną listą,
 *  - podlisty obu punktów łączą się w jedną. Dwie równoległe podlisty
 *    pod jednym <li> to ten sam bug, przed którym broni się
 *    _indentListItem.
 *
 * @param {Element} li scalany punkt (zniknie)
 * @param {Element} prev punkt, do którego scalamy
 * @returns {{ node: Node|null, offset: number }} styk treści — miejsce na kursor
 */
export function _mergeListItemBack(li, prev) {
  const prevNested = prev.querySelector(":scope > ul, :scope > ol");
  const liNested = li.querySelector(":scope > ul, :scope > ol");

  // Domykające <br> własnej treści prev tylko przeszkadzają w styku
  let anchor = prevNested ? prevNested.previousSibling : prev.lastChild;
  while (anchor && anchor.nodeName === "BR") {
    const before = anchor.previousSibling;
    anchor.remove();
    anchor = before;
  }
  const offset =
    anchor?.nodeType === Node.TEXT_NODE ? (anchor.textContent ?? "").length : 0;

  for (const node of [...li.childNodes]) {
    if (node === liNested) continue;
    prev.insertBefore(node, prevNested);
  }

  if (liNested) {
    if (prevNested) {
      while (liNested.firstChild) prevNested.appendChild(liNested.firstChild);
      liNested.remove();
    } else {
      prev.appendChild(liNested);
    }
  }

  li.remove();
  if (!prev.firstChild) prev.appendChild(document.createElement("br"));

  return { node: anchor, offset };
}

/**
 * Lista bezpośrednio nad blokiem, do której markdown-trigger ma dopisać
 * punkt zamiast zakładać nową listę.
 *
 * Reguła jest pozycyjna, nie liczbowa: liczy się to, że blok sąsiaduje
 * z listą, a nie jaki numer wpisano. Po wyjściu z listy (Enter, Enter)
 * kursor stoi w akapicie, którego previousElementSibling to ta lista —
 * wtedy "4." kontynuuje. Żeby zacząć nową listę, trzeba mieć między nimi
 * cokolwiek, co listą nie jest (choćby pustą linię).
 *
 * Typ musi się zgadzać: <ol> kontynuuje tylko trigger numerowany, zwykły
 * <ul> tylko punktowany, a checklista tylko checklistę — inaczej
 * dopisalibyśmy punkt do listy innego rodzaju niż wpisany znak.
 *
 * @param {Element|null} block akapit zamieniany na punkt listy
 * @param {"ordered"|"bullet"|"checklist"} kind rodzaj wykrytego triggera
 * @returns {Element|null} lista do kontynuowania albo null
 */
export function _continuableList(block, kind) {
  const prev = block?.previousElementSibling;
  if (!prev) return null;

  const isChecklist =
    prev.tagName === "UL" && prev.getAttribute("data-list") === "checklist";

  if (kind === "ordered") return prev.tagName === "OL" ? prev : null;
  if (kind === "checklist") return isChecklist ? prev : null;
  if (kind === "bullet") return prev.tagName === "UL" && !isChecklist ? prev : null;
  return null;
}

/**
 * Usuwa bezpośrednie dzieci będące pustymi węzłami tekstowymi.
 * Tylko zerowej długości — spacja bywa znacząca i zostaje.
 * @param {Element} el
 */
function _dropEmptyTextNodes(el) {
  for (const node of [...el.childNodes]) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent === "") {
      node.remove();
    }
  }
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

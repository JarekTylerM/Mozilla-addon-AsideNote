// @ts-check
/* ══════════════════════════════════════════════════════════════
   editor-drag-handle.js — uchwyt ⠿ do przenoszenia bloków myszą
   ──────────────────────────────────────────────────────────────
   Po najechaniu na blok notatki w lewym marginesie edytora (8 px paddingu
   #editor, bez zmiany odstępów) pojawia się uchwyt z 6 kropek. Przeciągnięcie
   przenosi blok — akapit, nagłówek, cytat, blok kodu, rozwijaną sekcję —
   albo element listy w obrębie jego listy. To samo co Alt+↑/↓
   (editor.js: _handleAltArrow), tylko myszą; skrót zostaje drogą z klawiatury.

   Uchwyt i kreska miejsca upuszczenia leżą POZA polem edycji (w
   #editor-container), więc nie trafiają do zapisanej treści notatki.
   Przeciąganie na pointer events, nie natywnym drag&drop — ten w polu
   contenteditable wstawia tekst i HTML w przypadkowe miejsca.

   Moduł nie importuje nic z przeglądarki ani z innych modułów: zależności
   (cofanie, zapis, podpowiedź) przychodzą w initDragHandle. Dzięki temu
   czyste funkcje (findDragTarget, dropIndex) da się testować w Node.
   ══════════════════════════════════════════════════════════════ */

/** Elementy, które nie są blokiem do przenoszenia (puste łamanie linii itp.) */
const SKIP_TAGS = new Set(['BR', 'SCRIPT', 'STYLE']);

/**
 * Blok, który uchwyt ma przenosić dla elementu pod kursorem: najbliższy
 * element listy, a poza listą — bezpośrednie dziecko edytora. Element listy
 * w rozwijanej sekcji (details) przenosi całą sekcję — tak samo jak Alt+↑/↓.
 *
 * Jedyny element listy nie ma z kim się zamienić (przesuwa się tylko w swojej
 * liście), więc przenosi poziom wyżej: listę najwyższego poziomu w całości,
 * a podlistę — razem z elementem, w którym siedzi.
 *
 * Linia cytatu (akapit w <blockquote> najwyższego poziomu) to osobny blok —
 * można ją przestawiać w cytacie i wyciągać z niego. Cytat z jedną linią
 * przenosi się w całości, z tego samego powodu co lista z jednym elementem.
 * @param {Element|null} el
 * @param {Element} editor
 * @returns {HTMLElement|null}
 */
export function findDragTarget(el, editor) {
  if (!el || !editor.contains(el) || el === editor) return null;
  const li = el.closest('li');
  if (li && editor.contains(li) && !li.closest('details')) {
    const list = li.parentElement;
    const alone =
      !!list && ![...list.children].some((c) => c !== li && c.tagName === 'LI');
    if (!alone || !list) return /** @type {HTMLElement} */ (li);
    if (list.parentElement === editor) return /** @type {HTMLElement} */ (list);
    return findDragTarget(list.parentElement, editor);
  }
  /** @type {Element|null} */
  let block = el;
  /** @type {Element|null} */
  let line = null;
  while (block && block.parentElement !== editor) {
    if (block.parentElement?.tagName === 'BLOCKQUOTE') line = block;
    block = block.parentElement;
  }
  if (!block || SKIP_TAGS.has(block.tagName)) return null;
  if (line && block.tagName === 'BLOCKQUOTE' && line.parentElement === block && quoteLines(block).length > 1) {
    return /** @type {HTMLElement} */ (line);
  }
  return /** @type {HTMLElement} */ (block);
}

/**
 * Linie cytatu — jego bloki-dzieci (akapity). Cytat z samą treścią, bez
 * akapitów, nie ma linii.
 * @param {Element} quote
 * @returns {HTMLElement[]}
 */
export function quoteLines(quote) {
  return /** @type {HTMLElement[]} */ (
    [...quote.children].filter((c) => !SKIP_TAGS.has(c.tagName))
  );
}

/**
 * Czy element to linia cytatu (dziecko <blockquote> najwyższego poziomu).
 * @param {Element} el
 * @param {Element} editor
 */
export function isQuoteLine(el, editor) {
  const q = el.parentElement;
  return !!q && q.tagName === 'BLOCKQUOTE' && q.parentElement === editor;
}

/**
 * Poziomy, które można złapać w danym wierszu — od najgłębszego: element
 * listy → element nadrzędny (przy podliście) → cała lista. Dla bloku poza
 * listą to sam blok. Uchwyt wybiera poziom po kolumnie, w której stoi
 * kursor (initDragHandle: targetAt): przy samej krawędzi notatki cała
 * lista, we wcięciu — element.
 * @param {HTMLElement} target wynik findDragTarget
 * @param {Element} editor
 * @returns {HTMLElement[]}
 */
export function dragChain(target, editor) {
  const chain = [target];
  // Linia cytatu → cały cytat
  if (isQuoteLine(target, editor)) {
    chain.push(/** @type {HTMLElement} */ (target.parentElement));
    return chain;
  }
  let t = target;
  while (t.tagName === 'LI') {
    const list = t.parentElement;
    if (!list) break;
    const up =
      list.parentElement === editor
        ? /** @type {HTMLElement} */ (list)
        : findDragTarget(list.parentElement, editor);
    if (!up || chain.includes(up)) break;
    chain.push(up);
    t = up;
  }
  return chain;
}

/**
 * Rodzaj poziomu — do podpowiedzi na uchwycie.
 * @param {HTMLElement} item
 * @param {Element} [editor] potrzebny do rozpoznania linii cytatu
 * @returns {'list'|'item'|'line'|'block'}
 */
export function dragKind(item, editor) {
  if (item.tagName === 'LI') return 'item';
  if (editor && isQuoteLine(item, editor)) return 'line';
  if (item.tagName === 'UL' || item.tagName === 'OL') return 'list';
  return 'block';
}

/**
 * Indeks wstawienia wśród rodzeństwa: przed pierwszym blokiem, którego
 * środek leży niżej niż kursor. Przenoszony blok jest pomijany, więc
 * indeks dotyczy listy BEZ niego.
 * @param {{top:number, bottom:number}[]} rects prostokąty rodzeństwa bez przenoszonego bloku
 * @param {number} y pozycja kursora
 * @returns {number}
 */
export function dropIndex(rects, y) {
  for (let i = 0; i < rects.length; i++) {
    if (y < (rects[i].top + rects[i].bottom) / 2) return i;
  }
  return rects.length;
}

/**
 * Rodzeństwo, wśród którego blok może się przesuwać (te same reguły co
 * Alt+↑/↓: element listy zostaje w swojej liście, blok w edytorze).
 * @param {HTMLElement} item
 * @returns {HTMLElement[]}
 */
export function dragSiblings(item) {
  const parent = item.parentElement;
  if (!parent) return [];
  return /** @type {HTMLElement[]} */ (
    [...parent.children].filter(
      (c) =>
        !SKIP_TAGS.has(c.tagName) &&
        (item.tagName === 'LI' ? c.tagName === 'LI' : true),
    )
  );
}

/**
 * Element, w którym leży punkt zaznaczenia. Gdy punkt wskazuje między
 * dziećmi elementu (np. offset w samym #editor), bierzemy dziecko obok.
 * @param {Node} container
 * @param {number} offset
 * @param {boolean} isEnd
 * @returns {Element|null}
 */
function _pointElement(container, offset, isEnd) {
  /** @type {Node|null} */
  let node = container;
  if (container.nodeType === 1 && container.childNodes.length) {
    node = container.childNodes[isEnd ? Math.max(0, offset - 1) : offset] ?? container;
  }
  if (!node) return null;
  return node.nodeType === 1 ? /** @type {Element} */ (node) : node.parentElement;
}

/**
 * Czy koniec zaznaczenia stoi na samym początku bloku (nic z bloku nie jest
 * zaznaczone). Tak kończy się np. potrójne kliknięcie albo Shift+↓ do
 * początku następnej linii — tego bloku nie liczymy do grupy.
 * @param {Element} item
 * @param {Range} range
 */
function _endsAtStartOf(item, range) {
  const r = item.ownerDocument.createRange();
  r.setStart(item, 0);
  try {
    r.setEnd(range.endContainer, range.endOffset);
  } catch {
    return false;
  }
  return r.toString() === '';
}

/**
 * Bezpośrednie dziecko edytora, w którym leży element.
 * @param {Element} el
 * @param {Element} editor
 * @returns {HTMLElement|null}
 */
function _topBlock(el, editor) {
  /** @type {Element|null} */
  let block = el;
  while (block && block.parentElement !== editor) block = block.parentElement;
  return block && block !== editor ? /** @type {HTMLElement} */ (block) : null;
}

/**
 * Grupa bloków objęta zaznaczeniem — przenoszona razem uchwytem i Alt+↑/↓.
 * - Zaznaczenie w obrębie jednej listy → zaznaczone elementy tej listy.
 * - Zaznaczenie przez kilka bloków → te bloki w całości (lista, której
 *   dotyka zaznaczenie, idzie cała).
 * Zwraca null, gdy zaznaczenie jest puste albo obejmuje jeden blok — wtedy
 * działa zwykłe przenoszenie jednego bloku.
 * @param {Range|null} range
 * @param {Element} editor
 * @returns {HTMLElement[]|null}
 */
export function selectionGroup(range, editor) {
  if (!range || range.collapsed) return null;
  if (!editor.contains(range.commonAncestorContainer)) return null;
  const startEl = _pointElement(range.startContainer, range.startOffset, false);
  const endEl = _pointElement(range.endContainer, range.endOffset, true);
  if (!startEl || !endEl) return null;

  /** @param {HTMLElement} first @param {HTMLElement} last */
  const span = (first, last) => {
    if (last !== first && _endsAtStartOf(last, range)) {
      const prev = /** @type {HTMLElement|null} */ (last.previousElementSibling);
      if (prev) last = prev;
    }
    const siblings = dragSiblings(first);
    const a = siblings.indexOf(first);
    const b = siblings.indexOf(last);
    if (a === -1 || b === -1 || b <= a) return null;
    return siblings.slice(a, b + 1);
  };

  // Oba końce w tej samej liście albo w tym samym cytacie → jego elementy
  // (punkty listy / linie cytatu)
  const startItem = findDragTarget(startEl, editor);
  const endItem = findDragTarget(endEl, editor);
  if (
    startItem &&
    endItem &&
    startItem.parentElement === endItem.parentElement &&
    startItem.parentElement !== editor
  ) {
    return span(startItem, endItem);
  }

  const startTop = _topBlock(startEl, editor);
  const endTop = _topBlock(endEl, editor);
  if (!startTop || !endTop) return null;
  return span(startTop, endTop);
}

/** Pas przy górnej/dolnej krawędzi cytatu (px), w którym upuszczenie idzie
    PRZED/ZA cytat, a nie do środka. */
const QUOTE_EDGE = 8;

/**
 * Gdzie wyląduje przeciągana grupa dla pozycji kursora y.
 * - Elementy listy: między elementami tej samej listy (jak dotąd).
 * - Bloki i linie cytatu: między blokami notatki, albo — gdy kursor stoi
 *   wewnątrz cytatu (poza pasem QUOTE_EDGE przy jego brzegach) — między
 *   liniami tego cytatu. Tak blok trafia do cytatu, linia przestawia się
 *   w cytacie, a linia przeciągnięta poza cytat z niego wychodzi.
 * Zwraca null, gdy upuszczenie niczego nie zmieni.
 *
 * @param {Element} editor
 * @param {HTMLElement[]} items ciągła grupa przenoszonych bloków
 * @param {number} y
 * @param {(el: Element) => {top: number, bottom: number}} rectOf
 * @returns {{ parent: HTMLElement, before: Element|null, intoQuote: boolean } | null}
 */
export function resolveDrop(editor, items, y, rectOf) {
  const first = items[0];
  const last = items[items.length - 1];
  const notMoved = (/** @type {Element} */ el) => !items.includes(/** @type {HTMLElement} */ (el));

  /** @param {HTMLElement} parent @param {Element[]} siblings bez przenoszonych */
  const among = (parent, siblings, intoQuote = false) => {
    const before = siblings[dropIndex(siblings.map(rectOf), y)] ?? null;
    // Bez zmiany: ten sam rodzic i ten sam następnik co teraz
    if (parent === first.parentElement) {
      let next = last.nextElementSibling;
      while (next && (SKIP_TAGS.has(next.tagName) || !notMoved(next))) next = next.nextElementSibling;
      if (next === before) return null;
    }
    return { parent, before, intoQuote };
  };

  if (first.tagName === 'LI') {
    const list = /** @type {HTMLElement} */ (first.parentElement);
    const siblings = dragSiblings(first).filter(notMoved);
    return siblings.length ? among(list, siblings) : null;
  }

  const top = /** @type {HTMLElement[]} */ (
    [...editor.children].filter((c) => !SKIP_TAGS.has(c.tagName) && notMoved(c))
  );
  for (const q of top) {
    if (q.tagName !== 'BLOCKQUOTE') continue;
    const r = rectOf(q);
    const band = Math.min(QUOTE_EDGE, (r.bottom - r.top) / 4);
    if (y > r.top + band && y < r.bottom - band) {
      return among(q, quoteLines(q).filter(notMoved), true);
    }
  }
  return top.length ? among(/** @type {HTMLElement} */ (editor), top) : null;
}

/** Jak blisko lewej krawędzi edytora (px) mysz musi stać, żeby pokazać uchwyt.
    Obejmuje margines i pierwsze wcięcie listy. */
const HANDLE_ZONE = 44;
/** Ile mysz musi postać przy krawędzi, zanim uchwyt się pokaże (ms). */
const SHOW_DELAY = 200;
const DRAG_THRESHOLD = 4;
const AUTOSCROLL_EDGE = 28;
const AUTOSCROLL_STEP = 10;

/**
 * @param {HTMLElement} editor
 * @param {HTMLElement} container element z position: relative wokół edytora
 * @param {{
 *   title: (kind: 'list'|'item'|'line'|'block') => string,
 *   toQuoteLines: (blocks: HTMLElement[]) => Element[],
 *   beforeMove: () => void,
 *   afterMove: (items: HTMLElement[], selection: Range|null) => void,
 * }} deps
 */
export function initDragHandle(editor, container, deps) {
  const handle = document.createElement('div');
  handle.className = 'block-handle';
  // Z klawiatury to samo robi Alt+↑/↓ — uchwyt jest dla myszy
  handle.setAttribute('aria-hidden', 'true');
  handle.hidden = true;

  const indicator = document.createElement('div');
  indicator.className = 'block-drop-indicator';
  indicator.hidden = true;

  container.append(handle, indicator);

  /** @type {HTMLElement|null} */
  let hovered = null;
  /** Wiersz, przy którym stoi uchwyt (dla całej listy: wiersz pod kursorem) */
  /** @type {HTMLElement|null} */
  let hoveredRow = null;
  /** @type {null | {
   *   items: HTMLElement[], grabbed: HTMLElement,
   *   startY: number, lastY: number, moved: boolean,
   *   pointerId: number, raf: number,
   *   selection: { sc: Node, so: number, ec: Node, eo: number } | null,
   *   target: { parent: HTMLElement, before: Element|null, intoQuote: boolean } | null,
   * }} */
  let drag = null;

  const containerRect = () => container.getBoundingClientRect();

  /** Lewa krawędź uchwytu: margines edytora, wcięcie listy albo wcięcie
      cytatu (tuż za jego kreską, przed tekstem linii). */
  const handleLeft = (/** @type {HTMLElement} */ item) => {
    const base = containerRect().left;
    if (item.tagName === 'LI' && item.parentElement) {
      return item.parentElement.getBoundingClientRect().left - base;
    }
    if (isQuoteLine(item, editor)) {
      return item.getBoundingClientRect().left - base - 10;
    }
    return editor.getBoundingClientRect().left - base;
  };

  /**
   * @param {HTMLElement} item co złapie uchwyt
   * @param {HTMLElement} [row] wiersz, przy którym stoi — uchwyt całej listy
   *   stoi przy wierszu pod kursorem, nie przy pierwszym elemencie: nie
   *   przeskakuje i jest tam, gdzie ręka
   */
  const placeHandle = (item, row = item) => {
    const rect = row.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    // Blok przewinięty poza widok edytora — bez uchwytu
    if (rect.bottom < editorRect.top || rect.top > editorRect.bottom) {
      hideHandle();
      return;
    }
    const lh = parseFloat(getComputedStyle(row).lineHeight) || 20;
    const firstLine = Math.min(rect.height, lh);
    const top = rect.top - containerRect().top + firstLine / 2;
    handle.style.left = `${handleLeft(item)}px`;
    handle.style.top = `${top}px`;
    // Podpowiedź mówi, CO złapiesz (cała lista / element / blok). Pobierana
    // przy pokazaniu, nie przy starcie — wtedy tłumaczenia mogą jeszcze nie
    // być gotowe. Wprost do dymka aplikacji (tooltip.js).
    handle.dataset.tooltipContent = deps.title(dragKind(item, editor));
    handle.hidden = false;
    hovered = item;
    hoveredRow = row;
  };

  const hideHandle = () => {
    handle.hidden = true;
    hovered = null;
    hoveredRow = null;
  };

  /* Spokój zamiast ruchu: uchwyt NIE chodzi za kursorem po tekście. Pojawia
     się dopiero, gdy mysz stoi przy lewej krawędzi notatki (HANDLE_ZONE) —
     czyli wtedy, gdy ktoś faktycznie sięga po uchwyt — i to po krótkiej
     chwili (SHOW_DELAY), więc przelot myszy przez krawędź niczego nie
     zapala. Ważne dla osób wrażliwych na bodźce: przy czytaniu i pisaniu
     nic nie mruga ani nie skacze. */
  /** @type {ReturnType<typeof setTimeout>|0} */
  let showTimer = 0;
  const cancelShow = () => {
    clearTimeout(showTimer);
    showTimer = 0;
  };

  /**
   * Co złapie uchwyt w wierszu pod kursorem. W marginesie (sam #editor) albo
   * we wcięciu listy kursor nie stoi na bloku — sprawdzamy punkt tuż za
   * wcięciem. Potem poziom po kolumnie: każdy poziom ma uchwyt w swojej
   * kolumnie (margines notatki = cała lista, wcięcie listy = jej element),
   * więc wybieramy najgłębszy, którego kolumna zaczyna się przed kursorem.
   * @param {MouseEvent} e
   */
  const targetAt = (e) => {
    let el = e.target instanceof Element ? e.target : null;
    for (let i = 0; i < 4 && el && (el === editor || /^(UL|OL|BLOCKQUOTE)$/.test(el.tagName)); i++) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      // Za wcięciem: padding (+ kreska cytatu)
      const x = r.left + (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.borderLeftWidth) || 0) + 4;
      // elementsFromPoint, nie elementFromPoint: w tym miejscu może stać sam
      // uchwyt (leży nad edytorem) — bierzemy pierwszy element notatki pod nim
      const next = document
        .elementsFromPoint(x, e.clientY)
        .find((n) => editor.contains(n));
      if (!next || next === el) break;
      el = next;
    }
    const deepest = findDragTarget(el, editor);
    if (!deepest) return null;
    const px = e.clientX - containerRect().left;
    const chain = dragChain(deepest, editor);
    let pick = chain[chain.length - 1];
    for (let i = chain.length - 2; i >= 0; i--) {
      if (handleLeft(chain[i]) <= px) pick = chain[i];
    }
    return { item: pick, row: deepest };
  };

  editor.addEventListener('mousemove', (e) => {
    if (drag) return;
    const inZone = e.clientX - editor.getBoundingClientRect().left <= HANDLE_ZONE;
    const target = inZone ? targetAt(e) : null;
    if (!target) {
      cancelShow();
      hideHandle();
      return;
    }
    // Widoczny — przy przesuwaniu wzdłuż krawędzi idzie do bloku w wierszu
    if (!handle.hidden) {
      if (target.item !== hovered || target.row !== hoveredRow) {
        placeHandle(target.item, target.row);
      }
      return;
    }
    cancelShow();
    showTimer = setTimeout(() => {
      showTimer = 0;
      if (!drag) placeHandle(target.item, target.row);
    }, SHOW_DELAY);
  });

  container.addEventListener('mouseleave', () => {
    cancelShow();
    if (!drag) hideHandle();
  });
  // Pisanie zmienia układ bloków — uchwyt wraca przy następnym ruchu myszy
  editor.addEventListener('keydown', () => {
    cancelShow();
    if (!drag) hideHandle();
  });
  editor.addEventListener('scroll', () => {
    if (!drag && hovered) placeHandle(hovered, hoveredRow ?? hovered);
  });

  /** Miejsce upuszczenia + kreska dla pozycji y. */
  const updateTarget = () => {
    if (!drag) return;
    const { items, lastY } = drag;
    const target = resolveDrop(editor, items, lastY, (el) => el.getBoundingClientRect());
    drag.target = target;
    if (!target) {
      indicator.hidden = true;
      return;
    }
    const { parent, before, intoQuote } = target;
    const base = containerRect();
    const parentRect = parent.getBoundingClientRect();
    const siblings = intoQuote ? quoteLines(parent).filter((s) => !items.includes(s)) : [];

    // Pionowo: nad blokiem „before” albo pod ostatnim z rodzeństwa
    let lineY;
    if (before) lineY = before.getBoundingClientRect().top;
    else if (intoQuote) {
      const lastLine = siblings[siblings.length - 1];
      lineY = lastLine ? lastLine.getBoundingClientRect().bottom : parentRect.bottom - 6;
    } else {
      const rest = dragSiblings(/** @type {HTMLElement} */ (items[0])).filter((s) => !items.includes(s));
      const lastEl = parent === editor
        ? [...editor.children].filter((c) => !items.includes(/** @type {HTMLElement} */ (c))).pop()
        : rest[rest.length - 1];
      lineY = (lastEl ?? parent).getBoundingClientRect().bottom;
    }

    // Poziomo: w cytacie kreska jest wcięta do tekstu linii — od razu widać,
    // że blok trafi DO cytatu, a nie przed/za niego
    let left = parentRect.left;
    let width = parentRect.width;
    if (parent === editor) {
      left += 8;
      width -= 16;
    } else if (intoQuote) {
      const pad = parseFloat(getComputedStyle(parent).paddingLeft) || 12;
      const bar = parseFloat(getComputedStyle(parent).borderLeftWidth) || 3;
      left += pad + bar;
      width -= pad * 2 + bar;
    }
    indicator.style.top = `${lineY - base.top - 1}px`;
    indicator.style.left = `${left - base.left}px`;
    indicator.style.width = `${Math.max(0, width)}px`;
    indicator.hidden = false;
  };

  /** Przewijanie przy krawędzi edytora, póki kursor tam stoi. */
  const autoScroll = () => {
    if (!drag) return;
    const r = editor.getBoundingClientRect();
    const y = drag.lastY;
    let dy = 0;
    if (y < r.top + AUTOSCROLL_EDGE) dy = -AUTOSCROLL_STEP;
    else if (y > r.bottom - AUTOSCROLL_EDGE) dy = AUTOSCROLL_STEP;
    if (dy && drag.moved) {
      editor.scrollTop += dy;
      updateTarget();
    }
    drag.raf = requestAnimationFrame(autoScroll);
  };

  const endDrag = (/** @type {boolean} */ commit) => {
    if (!drag) return;
    const { items, target, moved, raf, pointerId, selection } = drag;
    cancelAnimationFrame(raf);
    // Najpierw zerujemy stan: zwolnienie wskaźnika odpala lostpointercapture,
    // które inaczej zakończyłoby przeciąganie drugi raz
    drag = null;
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    for (const el of items) {
      el.classList.remove('is-dragging');
      // Pusty class="" trafiłby do zapisanej treści notatki
      if (!el.classList.length) el.removeAttribute('class');
    }
    document.body.classList.remove('is-block-dragging');
    indicator.hidden = true;

    if (commit && moved && target) {
      deps.beforeMove();
      // Cytaty, z których wyjmujemy linie — pusty po przeniesieniu znika
      const sourceQuotes = new Set(
        items.map((i) => i.parentElement).filter((p) => p && p !== target.parent && p.tagName === 'BLOCKQUOTE'),
      );
      /** @type {Node[]} */
      let moving = items;
      if (target.intoQuote) {
        // Cytat z samą treścią (bez akapitów) — najpierw owijamy ją w <p>
        if (!quoteLines(target.parent).length && target.parent.firstChild) {
          const wrapper = document.createElement('p');
          while (target.parent.firstChild) wrapper.appendChild(target.parent.firstChild);
          target.parent.appendChild(wrapper);
        }
        // Cytat to same akapity: nagłówek → akapit, lista → linie „• …”
        const plain = items.every((i) => i.tagName === 'P');
        if (!plain) moving = deps.toQuoteLines(items);
        if (!plain) items.forEach((i) => i.isConnected && i.remove());
      }
      const fragment = document.createDocumentFragment();
      fragment.append(...moving);
      target.parent.insertBefore(fragment, target.before);
      for (const q of sourceQuotes) {
        if (q && !(q.textContent ?? '').trim() && !q.querySelector('img')) q.remove();
      }
      // Węzły tekstu są te same, więc zaznaczenie odtwarzamy z zapamiętanych
      // punktów — przeniesienie węzłów zwija żywy Range przeglądarki
      let range = null;
      if (selection) {
        range = document.createRange();
        try {
          range.setStart(selection.sc, selection.so);
          range.setEnd(selection.ec, selection.eo);
        } catch {
          range = null;
        }
      }
      deps.afterMove(
        /** @type {HTMLElement[]} */ (moving.filter((n) => n.nodeType === 1)),
        range,
      );
    }
    // Po upuszczeniu chowamy — wróci przy następnym ruchu myszy, w wierszu
    // pod nią, zamiast przeskoczyć do pierwszej linii przeniesionego bloku
    hideHandle();
  };

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !hovered) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    // Uchwyt bloku z zaznaczenia przenosi całe zaznaczenie (selectionGroup);
    // uchwyt poza nim — tylko ten blok
    const sel = window.getSelection();
    const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
    const group = selectionGroup(range, editor);
    const grabbed = hovered;
    const inGroup = !!group && group.some((g) => g.contains(grabbed));
    drag = {
      items: inGroup && group ? group : [grabbed],
      grabbed,
      selection: inGroup && range
        ? { sc: range.startContainer, so: range.startOffset, ec: range.endContainer, eo: range.endOffset }
        : null,
      startY: e.clientY,
      lastY: e.clientY,
      moved: false,
      pointerId: e.pointerId,
      raf: 0,
      target: null,
    };
    drag.raf = requestAnimationFrame(autoScroll);
  });

  handle.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.lastY = e.clientY;
    if (!drag.moved && Math.abs(e.clientY - drag.startY) < DRAG_THRESHOLD) return;
    if (!drag.moved) {
      drag.moved = true;
      for (const el of drag.items) el.classList.add('is-dragging');
      document.body.classList.add('is-block-dragging');
    }
    updateTarget();
  });

  handle.addEventListener('pointerup', () => endDrag(true));
  handle.addEventListener('pointercancel', () => endDrag(false));
  handle.addEventListener('lostpointercapture', () => endDrag(false));

  // Esc w trakcie przeciągania — blok zostaje na miejscu
  document.addEventListener(
    'keydown',
    (e) => {
      if (drag && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        endDrag(false);
      }
    },
    true,
  );
}

// @ts-check
/**
 * editor-paste-clickup.js — preprocessor dla HTML z ClickUp (Quill.js)
 *
 * Wykrywa HTML z edytora ClickUp i konwertuje do struktury
 * którą AsideNote rozumie — przed sanitizeHTML.
 *
 * Czysta funkcja — zero DOM side effects, zero imports.
 *
 * Całe drzewo wynikowe powstaje w ODŁĄCZONYM dokumencie DOMParsera
 * (bezwładnym: bez skryptów, bez ładowania obrazków). Surowy HTML ze
 * schowka nigdy nie trafia do innerHTML elementu dokumentu strony —
 * węzły są przenoszone, nie re-parsowane ze stringa.
 */

/**
 * Czy HTML pochodzi z ClickUp?
 * @param {string} html
 */
export function isClickUpHTML(html) {
  return (
    html.includes("ql-list-item") ||
    html.includes("ql-block") ||
    html.includes("ql-heading")
  );
}

/**
 * Wyciągnij czysty tekst z węzła — strip elementów UI (ql-ui, SVG, placeholdery).
 * @param {Element} node
 * @returns {Element}
 */
function _cleanNode(node) {
  const clone = /** @type {Element} */ (node.cloneNode(true));
  // Usuń wszystkie elementy UI ClickUp
  clone
    .querySelectorAll(
      ".ql-ui, .ql-collapsable-block-toggle, .ql-checklist-text, " +
        ".ql-togglelist-placeholder, svg",
    )
    .forEach((el) => el.remove());
  return clone;
}

/**
 * Przenosi treść `source` do `target`, bez białych znaków na brzegach
 * (odpowiednik dawnego innerHTML.trim()). Pusty wynik dostaje <br>,
 * żeby blok dało się kliknąć.
 * @param {Element} target
 * @param {Element} source
 * @param {boolean} [brIfEmpty]
 */
function _moveContent(target, source, brIfEmpty = true) {
  const first = source.firstChild;
  if (first?.nodeType === 3) {
    first.textContent = (first.textContent ?? "").replace(/^[\t\n\f\r ]+/, "");
  }
  const last = source.lastChild;
  if (last?.nodeType === 3) {
    last.textContent = (last.textContent ?? "").replace(/[\t\n\f\r ]+$/, "");
  }
  for (const n of Array.from(source.childNodes)) {
    if (n.nodeType === 3 && !n.textContent) continue;
    target.appendChild(n);
  }
  if (brIfEmpty && !target.firstChild) {
    target.appendChild(
      /** @type {Document} */ (target.ownerDocument).createElement("br"),
    );
  }
}

/**
 * Poziom wcięcia punktu w płaskiej liście Quilla: class="ql-indent-2"
 * albo data-indent="2". 0 = punkt główny.
 * @param {Element} li
 */
function _indentLevel(li) {
  const m = /(?:^|\s)ql-indent-(\d+)/.exec(li.className);
  if (m) return Number(m[1]);
  return parseInt(li.getAttribute("data-indent") ?? "0", 10) || 0;
}

/**
 * Quill trzyma podpunkty płasko — jeden <ol>, poziom w klasie punktu.
 * Przebudowuje to w zagnieżdżone listy (podpunkt w liście wewnątrz
 * punktu wyżej), bo bez tego podpunkt po wklejeniu tracił wcięcie.
 * @param {Element} list
 * @param {Document} doc
 */
function _nestFlatIndents(list, doc) {
  const items = [...list.children].filter((el) => el.tagName === "LI");
  if (!items.some((li) => _indentLevel(li) > 0)) return;
  /** @type {Element[]} ostatni punkt na danym poziomie */
  const lastAt = [];
  for (const li of items) {
    const level = _indentLevel(li);
    let parentLi = null;
    for (let l = Math.min(level, lastAt.length) - 1; l >= 0 && !parentLi; l--) {
      parentLi = lastAt[l] ?? null;
    }
    if (parentLi) {
      let sub = parentLi.querySelector(":scope > ul, :scope > ol");
      if (!sub) {
        sub = doc.createElement(list.tagName.toLowerCase());
        parentLi.appendChild(sub);
      }
      sub.appendChild(li);
    }
    lastAt[level] = li;
    lastAt.length = level + 1;
  }
}

/**
 * Rodzaj punktu dla podziału listy. checked/unchecked to jedna checklista,
 * toggled to rozwijane bloki (ich dzieci "none" siedzą już w podliście).
 * @param {Element} li
 */
function _kindOf(li) {
  const type = li.getAttribute("data-list") ?? "";
  return type === "checked" ? "unchecked" : type;
}

/**
 * Dzieli listę na ciągi punktów jednego rodzaju (nowe listy w `doc`).
 * Lista jednorodna zwraca się sama, w jednoelementowej tablicy.
 * @param {Element} list
 * @param {Document} doc
 * @returns {Element[]}
 */
function _splitByKind(list, doc) {
  const items = [...list.children].filter((el) => el.tagName === "LI");
  if (new Set(items.map(_kindOf)).size < 2) return [list];
  /** @type {Element[]} */
  const runs = [];
  let kind = null;
  for (const li of items) {
    if (_kindOf(li) !== kind || !runs.length) {
      runs.push(doc.createElement(list.tagName.toLowerCase()));
      kind = _kindOf(li);
    }
    runs[runs.length - 1].appendChild(li);
  }
  return runs;
}

/**
 * Rekurencyjnie konwertuje listę ClickUp na format AsideNote.
 * data-list="unchecked/checked" → ul[data-list="checklist"] li[data-checked]
 * data-list="toggled" + data-list="none" → details/summary
 * @param {Element} listNode
 * @param {Document} doc dokument DOMParsera, w którym budujemy wynik
 * @returns {Node}
 */
function _convertList(listNode, doc) {
  _nestFlatIndents(listNode, doc);

  // Quill trzyma w jednym <ol> kolejne listy różnych rodzajów (punktory,
  // zaraz po nich numeracja). Każdy ciąg punktów jednego rodzaju to osobna lista.
  const runs = _splitByKind(listNode, doc);
  if (runs.length > 1) {
    const frag = doc.createDocumentFragment();
    runs.forEach((run) => frag.appendChild(_convertList(run, doc)));
    return frag;
  }

  const items = /** @type {HTMLElement[]} */ ([...listNode.children]);

  // Sprawdź czy to checklist (pierwszy li ma data-list="unchecked/checked")
  const firstLi = items.find((el) => el.tagName === "LI");
  const firstType = firstLi?.dataset.list;

  // Toggle list — data-list="toggled"
  if (firstType === "toggled") {
    const frag = doc.createDocumentFragment();
    items.forEach((li) => {
      if (li.tagName !== "LI") return;
      const listType = li.dataset.list;

      if (listType === "toggled") {
        const details = doc.createElement("details");
        details.open = true;
        const summary = doc.createElement("summary");

        // Tekst summary — bez zagnieżdżonych list
        const summaryClone = /** @type {HTMLElement} */ (li.cloneNode(true));
        summaryClone.querySelectorAll("ul, ol").forEach((n) => n.remove());
        _moveContent(summary, _cleanNode(summaryClone));
        details.appendChild(summary);

        // Dzieci toggle (data-list="none")
        const nestedList = li.querySelector("ul, ol");
        if (nestedList) {
          [...nestedList.children].forEach((child) => {
            if (child.tagName !== "LI") return;
            const p = doc.createElement("p");
            const childClone = /** @type {HTMLElement} */ (
              child.cloneNode(true)
            );
            childClone.querySelectorAll("ul, ol").forEach((n) => n.remove());
            _moveContent(p, _cleanNode(childClone));
            details.appendChild(p);
          });
        }
        frag.appendChild(details);
      }
    });
    return frag;
  }

  // Checklist — data-list="unchecked" lub "checked"
  if (firstType === "unchecked" || firstType === "checked") {
    const ul = doc.createElement("ul");
    ul.setAttribute("data-list", "checklist");
    items.forEach((li) => {
      if (li.tagName !== "LI") return;
      const listType = li.dataset.list;
      const newLi = doc.createElement("li");
      newLi.setAttribute(
        "data-checked",
        listType === "checked" ? "true" : "false",
      );

      const liClone = /** @type {HTMLElement} */ (li.cloneNode(true));
      const nested = liClone.querySelector("ul, ol");
      if (nested) {
        liClone.removeChild(nested);
        _moveContent(newLi, _cleanNode(liClone));
        newLi.appendChild(_convertList(nested, doc));
      } else {
        _moveContent(newLi, _cleanNode(liClone));
      }
      ul.appendChild(newLi);
    });
    return ul;
  }

  // Zwykła lista — bullet lub ordered. Quill 2 trzyma OBA rodzaje w <ol>
  // i rozróżnia je atrybutem data-list punktu; sam tag dawał numerację
  // tam, gdzie w ClickUp były punktory.
  const kind =
    firstType === "bullet"
      ? "ul"
      : firstType === "ordered"
        ? "ol"
        : listNode.tagName.toLowerCase();
  const newList = doc.createElement(kind);
  items.forEach((li) => {
    if (li.tagName !== "LI") return;
    const newLi = doc.createElement("li");
    const liClone = /** @type {HTMLElement} */ (li.cloneNode(true));
    const nested = liClone.querySelector("ul, ol");
    if (nested) {
      liClone.removeChild(nested);
      _moveContent(newLi, _cleanNode(liClone));
      newLi.appendChild(_convertList(nested, doc));
    } else {
      _moveContent(newLi, _cleanNode(liClone));
    }
    newList.appendChild(newLi);
  });
  return newList;
}

/**
 * Główna funkcja konwersji.
 * @param {string} html — surowy HTML ze schowka
 * @returns {string|null} — HTML gotowy do sanitizeHTML (null gdy nie ClickUp)
 */
export function preprocessClickUp(html) {
  if (!isClickUpHTML(html)) return null;

  const doc = new DOMParser().parseFromString(html, "text/html");
  const result = doc.createElement("div");

  // Znajdź root — może być .ql-editor lub body
  const root = doc.querySelector(".ql-editor") ?? doc.body;

  for (const node of root.childNodes) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    const el = /** @type {Element} */ (node);
    const tag = el.tagName;

    // Nagłówki
    if (tag === "H1" || tag === "H2" || tag === "H3") {
      const h = doc.createElement(tag.toLowerCase());
      _moveContent(h, _cleanNode(el), false);
      result.appendChild(h);
      continue;
    }

    // Blok kodu — bez zmian; w blok kodu zamienia go normalizePastedHTML.
    // Potraktowany jak akapit rozpadał się na linie z klikalnymi linkami.
    if (
      el.classList.contains("ql-code-block-container") ||
      el.classList.contains("ql-code-block")
    ) {
      result.appendChild(el.cloneNode(true));
      continue;
    }

    // Cytaty: ClickUp opakowuje je w div.ql-blockquote-container. Jako akapit
    // dawał <p> z cytatem w środku i puste linie wokół.
    if (el.classList.contains("ql-blockquote-container")) {
      for (const bq of el.querySelectorAll(":scope > blockquote")) {
        const quote = doc.createElement("blockquote");
        const p = doc.createElement("p");
        _moveContent(p, _cleanNode(bq));
        quote.appendChild(p);
        result.appendChild(quote);
      }
      continue;
    }

    // Paragrafy (ql-block)
    if (tag === "DIV") {
      const clean = _cleanNode(el);
      const content = clean.innerHTML.trim();
      // Pomiń puste paragrafy z &nbsp; (ClickUp spacery)
      if (!content || content === "<br>" || content === "&nbsp;") continue;
      const p = doc.createElement("p");
      _moveContent(p, clean);
      result.appendChild(p);
      continue;
    }

    // Listy — konwertuj data-list na format AsideNote
    if (tag === "OL" || tag === "UL") {
      result.appendChild(_convertList(el, doc));
      continue;
    }

    // Reszta — kopiuj jak jest
    result.appendChild(el.cloneNode(true));
  }

  return result.innerHTML;
}

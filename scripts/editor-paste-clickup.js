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
 * Rekurencyjnie konwertuje listę ClickUp na format AsideNote.
 * data-list="unchecked/checked" → ul[data-list="checklist"] li[data-checked]
 * data-list="toggled" + data-list="none" → details/summary
 * @param {Element} listNode
 * @param {Document} doc dokument DOMParsera, w którym budujemy wynik
 * @returns {Node}
 */
function _convertList(listNode, doc) {
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

  // Zwykła lista — bullet lub ordered
  const newList = doc.createElement(listNode.tagName.toLowerCase());
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

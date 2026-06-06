/**
 * editor-paste-clickup.js — preprocessor dla HTML z ClickUp (Quill.js)
 *
 * Wykrywa HTML z edytora ClickUp i konwertuje do struktury
 * którą AsideNotes rozumie — przed sanitizeHTML.
 *
 * Czysta funkcja — zero DOM side effects, zero imports.
 */

/**
 * Czy HTML pochodzi z ClickUp?
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
 */
function _cleanNode(node) {
  const clone = node.cloneNode(true);
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
 * Pobierz poziom wcięcia z klasy ql-indent-N.
 */
function _getIndent(li) {
  for (const cls of li.classList) {
    const m = cls.match(/^ql-indent-(\d+)$/);
    if (m) return parseInt(m[1], 10);
  }
  return 0;
}


/**
 * Rekurencyjnie konwertuje listę ClickUp na format AsideNotes.
 * data-list="unchecked/checked" → ul[data-list="checklist"] li[data-checked]
 * data-list="toggled" + data-list="none" → details/summary
 */
function _convertList(listNode) {
  const items = [...listNode.children];

  // Sprawdź czy to checklist (pierwszy li ma data-list="unchecked/checked")
  const firstLi = items.find((el) => el.tagName === "LI");
  const firstType = firstLi?.dataset.list;

  // Toggle list — data-list="toggled"
  if (firstType === "toggled") {
    const frag = document.createDocumentFragment();
    items.forEach((li) => {
      if (li.tagName !== "LI") return;
      const listType = li.dataset.list;

      if (listType === "toggled") {
        const details = document.createElement("details");
        details.open = true;
        const summary = document.createElement("summary");

        // Tekst summary — bez zagnieżdżonych list
        const summaryClone = li.cloneNode(true);
        summaryClone.querySelectorAll("ul, ol").forEach((n) => n.remove());
        summary.innerHTML = _cleanNode(summaryClone).innerHTML.trim() || "<br>";
        details.appendChild(summary);

        // Dzieci toggle (data-list="none")
        const nestedList = li.querySelector("ul, ol");
        if (nestedList) {
          [...nestedList.children].forEach((child) => {
            if (child.tagName !== "LI") return;
            const p = document.createElement("p");
            const childClone = child.cloneNode(true);
            childClone.querySelectorAll("ul, ol").forEach((n) => n.remove());
            p.innerHTML = _cleanNode(childClone).innerHTML.trim() || "<br>";
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
    const ul = document.createElement("ul");
    ul.setAttribute("data-list", "checklist");
    items.forEach((li) => {
      if (li.tagName !== "LI") return;
      const listType = li.dataset.list;
      const newLi = document.createElement("li");
      newLi.setAttribute(
        "data-checked",
        listType === "checked" ? "true" : "false",
      );

      const liClone = li.cloneNode(true);
      const nested = liClone.querySelector("ul, ol");
      if (nested) {
        liClone.removeChild(nested);
        newLi.innerHTML = _cleanNode(liClone).innerHTML.trim() || "<br>";
        newLi.appendChild(_convertList(nested));
      } else {
        newLi.innerHTML = _cleanNode(liClone).innerHTML.trim() || "<br>";
      }
      ul.appendChild(newLi);
    });
    return ul;
  }

  // Zwykła lista — bullet lub ordered
  const newList = document.createElement(listNode.tagName.toLowerCase());
  items.forEach((li) => {
    if (li.tagName !== "LI") return;
    const newLi = document.createElement("li");
    const liClone = li.cloneNode(true);
    const nested = liClone.querySelector("ul, ol");
    if (nested) {
      liClone.removeChild(nested);
      newLi.innerHTML = _cleanNode(liClone).innerHTML.trim() || "<br>";
      newLi.appendChild(_convertList(nested));
    } else {
      newLi.innerHTML = _cleanNode(liClone).innerHTML.trim() || "<br>";
    }
    newList.appendChild(newLi);
  });
  return newList;
}

/**
 * Główna funkcja konwersji.
 * @param {string} html — surowy HTML ze schowka
 * @returns {string} — HTML gotowy do sanitizeHTML
 */
export function preprocessClickUp(html) {
  if (!isClickUpHTML(html)) return null;

  const doc = new DOMParser().parseFromString(html, "text/html");
  const result = document.createElement("div");

  // Znajdź root — może być .ql-editor lub body
  const root = doc.querySelector(".ql-editor") ?? doc.body;

  for (const node of root.childNodes) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    const tag = node.tagName;

    // Nagłówki
    if (tag === "H1" || tag === "H2" || tag === "H3") {
      const h = document.createElement(tag.toLowerCase());
      h.innerHTML = _cleanNode(node).innerHTML.trim();
      result.appendChild(h);
      continue;
    }

    // Paragrafy (ql-block)
    if (tag === "DIV") {
      const clean = _cleanNode(node);
      const content = clean.innerHTML.trim();
      // Pomiń puste paragrafy z &nbsp; (ClickUp spacery)
      if (!content || content === "<br>" || content === "&nbsp;") continue;
      const p = document.createElement("p");
      p.innerHTML = content;
      result.appendChild(p);
      continue;
    }

    // Listy — konwertuj data-list na format AsideNotes
    if (tag === "OL" || tag === "UL") {
      result.appendChild(_convertList(node));
      continue;
    }

    // Reszta — kopiuj jak jest
    result.appendChild(document.importNode(node, true));
  }

  return result.innerHTML;
}

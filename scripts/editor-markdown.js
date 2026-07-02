/* ══════════════════════════════════════════════════════════════
   editor-markdown.js — serializacja treści edytora do Markdown

   Czyste funkcje DOM — zero side effects, testowalne w Node (jsdom).
   Używane przez: _initCopyMarkdown w editor.js (przycisk "Kopiuj
   jako Markdown").

   Obsługiwany podzbiór HTML = dokładnie to, co produkuje edytor
   (patrz sanitize.js ALLOWED_TAGS):
     p/div, h1-h3, ul/ol/li (+ checklist), blockquote (+ callout),
     pre>code, hr, details/summary, br
     strong/b, em/i, u, s/strike, code, a

   Konwencje wyjścia (GFM):
     - checklist       → - [ ] / - [x]
     - callout         → > [!NOTE] (+ własna etykieta po markerze)
     - toggle list     → <details><summary> (HTML przechodzi w GFM)
     - underline       → <u>…</u> (Markdown nie ma podkreślenia)
     - twarde łamanie  → dwie spacje na końcu linii

   Bez escapowania znaków specjalnych — treść notatki to tekst
   użytkownika; nadmiarowe backslashe psują czytelność częściej,
   niż ratują składnię.
   ══════════════════════════════════════════════════════════════ */

const BLOCK_TAGS = new Set([
  "P",
  "DIV",
  "H1",
  "H2",
  "H3",
  "UL",
  "OL",
  "BLOCKQUOTE",
  "PRE",
  "HR",
  "DETAILS",
]);

/**
 * Serializuje zawartość elementu (np. #editor) do Markdown.
 * @param {Element} root
 * @returns {string}
 */
export function htmlToMarkdown(root) {
  if (!root) return "";
  const md = _serializeBlocks(Array.from(root.childNodes));
  // Zredukuj 3+ puste linie i utnij whitespace na końcach
  return md.replace(/\n{3,}/g, "\n\n").trim();
}

/* ── Bloki ───────────────────────────────────────── */

/** Serializuje listę węzłów jako sekwencję bloków rozdzieloną pustą linią. */
function _serializeBlocks(nodes) {
  const parts = [];
  let inlineRun = []; // luźne inline/tekst między blokami → własny akapit

  const flushInline = () => {
    if (!inlineRun.length) return;
    const text = inlineRun.map(_inline).join("").trim();
    inlineRun = [];
    if (text) parts.push(text);
  };

  for (const node of nodes) {
    if (
      node.nodeType === 1 /* ELEMENT_NODE */ &&
      BLOCK_TAGS.has(node.tagName)
    ) {
      flushInline();
      const block = _blockToMd(node);
      if (block !== null) parts.push(block);
    } else {
      inlineRun.push(node);
    }
  }
  flushInline();

  return parts.join("\n\n");
}

/** Konwertuje pojedynczy blok. Zwraca null gdy blok jest pusty. */
function _blockToMd(el) {
  switch (el.tagName) {
    case "H1":
      return "# " + _inlineChildren(el);
    case "H2":
      return "## " + _inlineChildren(el);
    case "H3":
      return "### " + _inlineChildren(el);
    case "HR":
      return "---";
    case "PRE": {
      const code = el.textContent.replace(/\n$/, "");
      const lang =
        el.querySelector("code")?.getAttribute("data-language") ?? "";
      const fence = code.includes("```") ? "````" : "```";
      return `${fence}${lang}\n${code}\n${fence}`;
    }
    case "UL":
    case "OL":
      return _listToMd(el, "");
    case "BLOCKQUOTE":
      return _blockquoteToMd(el);
    case "DETAILS":
      return _detailsToMd(el);
    case "P":
    case "DIV":
    default: {
      const text = _inlineChildren(el).trim();
      return text ? text : null;
    }
  }
}

/** UL/OL → linie listy; indent to prefiks wcięcia dla tego poziomu. */
function _listToMd(list, indent) {
  const ordered = list.tagName === "OL";
  const checklist = list.getAttribute("data-list") === "checklist";
  const start = parseInt(list.getAttribute("start") ?? "1", 10) || 1;

  const lines = [];
  let n = start;

  for (const li of Array.from(list.children)) {
    if (li.tagName !== "LI") continue;

    let marker;
    if (checklist) {
      const checked = li.getAttribute("data-checked") === "true";
      marker = checked ? "- [x] " : "- [ ] ";
    } else if (ordered) {
      marker = `${n}. `;
      n++;
    } else {
      marker = "- ";
    }

    // Treść li: inline + ewentualne zagnieżdżone listy
    const inlineParts = [];
    const sublists = [];
    for (const child of Array.from(li.childNodes)) {
      if (
        child.nodeType === 1 &&
        (child.tagName === "UL" || child.tagName === "OL")
      ) {
        sublists.push(child);
      } else if (child.nodeType === 1 && child.tagName === "P") {
        // Defensywnie — <p> w li traktuj jak inline
        inlineParts.push(_inlineChildren(child));
      } else {
        inlineParts.push(_inline(child));
      }
    }
    const text = inlineParts.join("").trim();
    lines.push(indent + marker + text);

    // Wcięcie kontynuacji = szerokość markera (CommonMark), checklist jak "- "
    const childIndent = indent + " ".repeat(checklist ? 2 : marker.length);
    for (const sub of sublists) {
      lines.push(_listToMd(sub, childIndent));
    }
  }

  return lines.join("\n");
}

/** BLOCKQUOTE → "> …"; z data-callout → "> [!TYPE]" w pierwszej linii. */
function _blockquoteToMd(bq) {
  const inner = _serializeBlocks(Array.from(bq.childNodes));
  const lines = inner.split("\n").map((l) => (l ? "> " + l : ">"));

  const callout = bq.getAttribute("data-callout");
  if (callout) {
    const label = bq.getAttribute("data-callout-label");
    const head = `> [!${callout.toUpperCase()}]` + (label ? ` ${label}` : "");
    lines.unshift(head);
  }

  return lines.join("\n");
}

/** DETAILS/SUMMARY → blok <details> (poprawny w GFM). */
function _detailsToMd(details) {
  const summary = details.querySelector(":scope > summary");
  const summaryText = summary ? _inlineChildren(summary).trim() : "";
  const rest = Array.from(details.childNodes).filter((n) => n !== summary);
  const body = _serializeBlocks(rest);

  return [
    "<details>",
    `<summary>${summaryText}</summary>`,
    "",
    body,
    "",
    "</details>",
  ].join("\n");
}

/* ── Inline ──────────────────────────────────────── */

function _inlineChildren(el) {
  return Array.from(el.childNodes).map(_inline).join("");
}

function _inline(node) {
  if (node.nodeType === 3 /* TEXT_NODE */) {
    // Newlines wewnątrz tekstu nie mają znaczenia w HTML — spłaszcz
    return node.textContent.replace(/\s*\n\s*/g, " ");
  }
  if (node.nodeType !== 1) return "";

  switch (node.tagName) {
    case "BR":
      // Twarde łamanie linii — dwie spacje przed \n
      return "  \n";
    case "STRONG":
    case "B":
      return _wrap(node, "**");
    case "EM":
    case "I":
      return _wrap(node, "*");
    case "S":
    case "STRIKE":
      return _wrap(node, "~~");
    case "U": {
      const inner = _inlineChildren(node);
      return inner.trim() ? `<u>${inner}</u>` : inner;
    }
    case "CODE": {
      const text = node.textContent;
      if (!text) return "";
      // Backtick w treści → podwójny delimiter ze spacjami
      return text.includes("`") ? `\`\` ${text} \`\`` : `\`${text}\``;
    }
    case "A": {
      const text = _inlineChildren(node) || node.getAttribute("href") || "";
      const href = node.getAttribute("href") ?? "";
      return `[${text}](${href})`;
    }
    default:
      return _inlineChildren(node);
  }
}

/**
 * Owija inline treść markerem, przenosząc skrajne spacje na zewnątrz —
 * "**tekst **" jest niepoprawny w CommonMark.
 */
function _wrap(node, marker) {
  const inner = _inlineChildren(node);
  const m = inner.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!m[2]) return inner; // sam whitespace — bez markerów
  return m[1] + marker + m[2] + marker + m[3];
}

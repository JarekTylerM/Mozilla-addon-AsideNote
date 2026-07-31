// @ts-check
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

// safeHref jest czysty (URL API + regex, zero DOM), więc import nie psuje
// testowalności tego modułu w Node. Jedna definicja blokowanych schematów.
import { safeHref } from "./sanitize.js";

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

/**
 * Serializuje listę węzłów jako sekwencję bloków rozdzieloną pustą linią.
 * @param {Node[]} nodes
 * @returns {string}
 */
function _serializeBlocks(nodes) {
  const parts = [];
  /** @type {Node[]} */
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
      BLOCK_TAGS.has(/** @type {Element} */ (node).tagName)
    ) {
      flushInline();
      const block = _blockToMd(/** @type {Element} */ (node));
      if (block !== null) parts.push(block);
    } else {
      inlineRun.push(node);
    }
  }
  flushInline();

  return parts.join("\n\n");
}

/**
 * Konwertuje pojedynczy blok. Zwraca null gdy blok jest pusty.
 * @param {Element} el
 * @returns {string|null}
 */
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

/**
 * UL/OL → linie listy; indent to prefiks wcięcia dla tego poziomu.
 * @param {Element} list
 * @param {string} indent
 * @returns {string}
 */
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
    /** @type {string[]} */
    const inlineParts = [];
    /** @type {Element[]} */
    const sublists = [];
    for (const child of Array.from(li.childNodes)) {
      const childEl = /** @type {Element} */ (child);
      if (
        child.nodeType === 1 &&
        (childEl.tagName === "UL" || childEl.tagName === "OL")
      ) {
        sublists.push(childEl);
      } else if (child.nodeType === 1 && childEl.tagName === "P") {
        // Defensywnie — <p> w li traktuj jak inline
        inlineParts.push(_inlineChildren(childEl));
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

/**
 * BLOCKQUOTE → "> …"; z data-callout → "> [!TYPE]" w pierwszej linii.
 * @param {Element} bq
 * @returns {string}
 */
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

/**
 * DETAILS/SUMMARY → blok <details> (poprawny w GFM).
 * @param {Element} details
 * @returns {string}
 */
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

/** @param {Element} el @returns {string} */
function _inlineChildren(el) {
  return Array.from(el.childNodes).map(_inline).join("");
}

/** @param {Node} node @returns {string} */
function _inline(node) {
  if (node.nodeType === 3 /* TEXT_NODE */) {
    // Newlines wewnątrz tekstu nie mają znaczenia w HTML — spłaszcz
    return (node.textContent ?? "").replace(/\s*\n\s*/g, " ");
  }
  if (node.nodeType !== 1) return "";

  const el = /** @type {Element} */ (node);
  switch (el.tagName) {
    case "BR":
      // Twarde łamanie linii — dwie spacje przed \n
      return "  \n";
    case "STRONG":
    case "B":
      return _wrap(el, "**");
    case "EM":
    case "I":
      return _wrap(el, "*");
    case "S":
    case "STRIKE":
      return _wrap(el, "~~");
    case "U": {
      const inner = _inlineChildren(el);
      return inner.trim() ? `<u>${inner}</u>` : inner;
    }
    case "CODE": {
      const text = el.textContent;
      if (!text) return "";
      // Backtick w treści → podwójny delimiter ze spacjami
      return text.includes("`") ? `\`\` ${text} \`\`` : `\`${text}\``;
    }
    case "A": {
      const text = _inlineChildren(el) || el.getAttribute("href") || "";
      const href = el.getAttribute("href") ?? "";
      return `[${text}](${href})`;
    }
    default:
      return _inlineChildren(el);
  }
}

/**
 * Owija inline treść markerem, przenosząc skrajne spacje na zewnątrz —
 * "**tekst **" jest niepoprawny w CommonMark.
 */
/** @param {Element} node @param {string} marker @returns {string} */
function _wrap(node, marker) {
  const inner = _inlineChildren(node);
  const m = inner.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!m || !m[2]) return inner; // sam whitespace — bez markerów
  return m[1] + marker + m[2] + marker + m[3];
}

/* ══════════════════════════════════════════════════════════════
   Kierunek odwrotny: Markdown → HTML (wklejanie)

   Powód: htmlToMarkdown pozwalał skopiować notatkę jako Markdown, ale
   wklejenie Markdownu dawało dosłowny tekst "## Tytuł". Obieg działał
   tylko w jedną stronę.

   Czysta transformacja string → string. Wynik i tak przechodzi przez
   sanitizeHTML w handlerze paste (defense in depth), ale tekst escapujemy
   już tutaj — moduł nigdy nie produkuje znaczników, których nie zamierzał.

   Zakres = to, co edytor umie pokazać (ALLOWED_TAGS w sanitize.js).
   Nagłówki H4-H6 spłaszczamy do H3, bo wyżej ich nie ma. Tabele i obrazy
   zostają tekstem — świadomie, patrz komentarz przy whiteliście.
   ══════════════════════════════════════════════════════════════ */

/**
 * Escapuje tekst do wstawienia w HTML — również w atrybut.
 *
 * Apostrof jest tu celowo, mimo że wszystkie atrybuty budujemy
 * w cudzysłowach podwójnych: to założenie nie jest nigdzie wymuszone
 * i pierwsza zmiana na `href='…'` zrobiłaby z tego wyjście z atrybutu.
 *
 * @param {string} s
 */
function _esc(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CALLOUT_TYPES = ["note", "tip", "important", "warning", "caution"];

const RX_FENCE = /^[ \t]*(```|~~~)[ \t]*(\w+)?[ \t]*$/;
const RX_HR = /^[ \t]*([-*_])[ \t]*\1[ \t]*\1[-*_ \t]*$/;
const RX_HEADING = /^[ \t]*(#{1,6})[ \t]+(.*)$/;
const RX_QUOTE = /^[ \t]*>/;
const RX_LINK = /\[[^\]]*\]\([^\s)]+\)/;

/**
 * Czy tekst wygląda na Markdown na tyle, żeby go konwertować.
 *
 * Wymagamy sygnału BLOKOWEGO na początku linii (nagłówek, lista, cytat,
 * płot kodu, linia pozioma) albo linku. Samo `*coś*` w zdaniu nie
 * wystarcza — inaczej zwykły tekst z gwiazdkami zamieniałby się przy
 * wklejeniu w kursywę, o co nikt nie prosił.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeMarkdown(text) {
  if (!text) return false;
  const block =
    /^[ \t]*(#{1,6}[ \t]+\S|[-*+][ \t]+\S|\d+[.)][ \t]+\S|>[ \t]?\S|```|~~~)/m;
  return block.test(text) || RX_HR.test(text) || RX_LINK.test(text);
}

/**
 * Zamienia Markdown na HTML zgodny z edytorem.
 * @param {string} text
 * @returns {string}
 */
export function markdownToHtml(text) {
  const lines = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  /** @type {string[]} */
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const fence = line.match(RX_FENCE);
    if (fence) {
      const marker = fence[1];
      const lang = fence[2] ?? "";
      /** @type {string[]} */
      const body = [];
      i++;
      while (i < lines.length && lines[i].trim() !== marker) {
        body.push(lines[i]);
        i++;
      }
      i++; // zamykający płot (albo koniec tekstu)
      const attr = lang ? ` data-language="${_esc(lang)}"` : "";
      out.push(`<pre><code${attr}>${_esc(body.join("\n"))}</code></pre>`);
      continue;
    }

    if (RX_HR.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }

    const h = line.match(RX_HEADING);
    if (h) {
      const level = Math.min(h[1].length, 3); // H4-H6 → H3
      out.push(`<h${level}>${_inlineMd(h[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    if (RX_QUOTE.test(line)) {
      /** @type {string[]} */
      const body = [];
      while (i < lines.length && RX_QUOTE.test(lines[i])) {
        body.push(lines[i].replace(/^[ \t]*>[ \t]?/, ""));
        i++;
      }
      const cal = (body[0] ?? "").match(/^\[!(\w+)\][ \t]*(.*)$/);
      if (cal && CALLOUT_TYPES.includes(cal[1].toLowerCase())) {
        const label = cal[2].trim();
        const rest = body.slice(1);
        if (label) rest.unshift(label);
        const attr = label ? ` data-callout-label="${_esc(label)}"` : "";
        out.push(
          `<blockquote data-callout="${cal[1].toLowerCase()}"${attr}>${_paras(rest)}</blockquote>`,
        );
      } else {
        out.push(`<blockquote>${_paras(body)}</blockquote>`);
      }
      continue;
    }

    if (_listMatch(line)) {
      const built = _buildList(lines, i);
      out.push(built.html);
      i = built.next;
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    /** @type {string[]} */
    const para = [];
    while (i < lines.length && lines[i].trim() && !_startsBlock(lines[i])) {
      para.push(lines[i].trim());
      i++;
    }
    out.push(`<p>${para.map(_inlineMd).join("<br>")}</p>`);
  }

  return out.join("");
}

/** Czy linia otwiera nowy blok — akapit musi się na niej urwać. @param {string} l */
function _startsBlock(l) {
  return (
    !!_listMatch(l) ||
    RX_QUOTE.test(l) ||
    RX_HEADING.test(l) ||
    RX_FENCE.test(l) ||
    RX_HR.test(l)
  );
}

/** Akapity wewnątrz cytatu — puste linie rozdzielają. @param {string[]} lines */
function _paras(lines) {
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  let buf = [];
  const flush = () => {
    if (buf.length) out.push(`<p>${buf.map(_inlineMd).join("<br>")}</p>`);
    buf = [];
  };
  for (const l of lines) {
    if (l.trim()) buf.push(l.trim());
    else flush();
  }
  flush();
  return out.join("") || "<p><br></p>";
}

/**
 * Rozpoznaje element listy.
 * @param {string} line
 * @returns {{ indent: number, ordered: boolean, start: number, checked: boolean|null, text: string } | null}
 */
function _listMatch(line) {
  const m = line.match(/^([ \t]*)(?:([-*+])|(\d+)[.)])[ \t]+(.*)$/);
  if (!m) return null;
  const task = m[4].match(/^\[([ xX])\][ \t]+(.*)$/);
  return {
    indent: m[1].replace(/\t/g, "  ").length,
    ordered: !m[2],
    start: m[3] ? parseInt(m[3], 10) : 1,
    checked: task ? task[1].toLowerCase() === "x" : null,
    text: task ? task[2] : m[4],
  };
}

/**
 * Buduje listę (z zagnieżdżeniem po wcięciu) od lines[start].
 * @param {string[]} lines @param {number} start
 * @returns {{ html: string, next: number }}
 */
function _buildList(lines, start) {
  const first = /** @type {NonNullable<ReturnType<typeof _listMatch>>} */ (
    _listMatch(lines[start])
  );
  const isChecklist = first.checked !== null;
  const tag = first.ordered ? "ol" : "ul";
  /** @type {string[]} */
  const items = [];
  let i = start;

  while (i < lines.length) {
    const m = _listMatch(lines[i]);
    if (!m || m.indent < first.indent) break;

    if (m.indent > first.indent) {
      const nested = _buildList(lines, i);
      // Podlista należy do POPRZEDNIEGO punktu. Wstawiona jako osobny <li>
      // dałaby punkt bez własnej treści — czyli element nieedytowalny.
      if (items.length) {
        items[items.length - 1] = items[items.length - 1].replace(
          /<\/li>$/,
          `${nested.html}</li>`,
        );
      } else {
        items.push(`<li><br>${nested.html}</li>`);
      }
      i = nested.next;
      continue;
    }

    // Zmiana rodzaju listy na tym samym poziomie kończy tę listę
    if (m.ordered !== first.ordered || (m.checked !== null) !== isChecklist) break;

    const attr = m.checked === null ? "" : ` data-checked="${m.checked}"`;
    items.push(`<li${attr}>${_inlineMd(m.text)}</li>`);
    i++;
  }

  const attrs =
    (isChecklist ? ' data-list="checklist"' : "") +
    (first.ordered && first.start !== 1 ? ` start="${first.start}"` : "");
  return { html: `<${tag}${attrs}>${items.join("")}</${tag}>`, next: i };
}

/**
 * Inline: kod, linki, pogrubienie, kursywa, przekreślenie.
 *
 * Kod i escapowane znaki chowamy pod placeholdery, zanim ruszymy resztę —
 * `*` w bloku kodu nie jest kursywą, a `\*` to literalna gwiazdka.
 *
 * @param {string} raw
 * @returns {string}
 */
function _inlineMd(raw) {
  /** @type {string[]} */
  const stash = [];
  // Znak NUL jako ogranicznik placeholdera — nie da się go wpisać z
  // klawiatury ani wkleić z sensownego zrodla, wiec nie zderzy sie z trescia.
  // Zapisany jako sekwencja ucieczki, nie surowy bajt w pliku.
  const SENT = "\u0000";
  const keep = (/** @type {string} */ html) =>
    SENT + (stash.push(html) - 1) + SENT;

  let s = String(raw);
  s = s.split(SENT).join(""); // wklejony NUL nie może udawać placeholdera

  // 1. kod inline — pierwszy, chroni swoją treść przed dalszymi regułami
  s = s.replace(/`([^`]+)`/g, (_m, c) => keep(`<code>${_esc(c)}</code>`));
  // 2. escapowane znaki markdown → literał (też odkładany na bok)
  s = s.replace(/\\([\\`*_~[\]()#+\-.!>])/g, (_m, c) => keep(_esc(c)));
  // 3. dopiero teraz reszta jest bezpieczna do escapowania HTML
  s = _esc(s);
  // 4. linki — schemat walidujemy TUTAJ, nie tylko w sanitizeHTML.
  // Wcześniej bezpieczeństwo opierało się na tym, że każdy caller pamięta
  // o sanitizerze; to był kontrakt nigdzie niezapisany. Odrzucony URL
  // (javascript:, data:, …) zostaje zwykłym tekstem, nie linkiem.
  s = s.replace(/\[([^\]]*)\]\(([^\s)]+)\)/g, (_m, t, href) => {
    const safe = safeHref(href);
    if (!safe) return t || href;
    return `<a href="${_esc(safe)}">${t || _esc(safe)}</a>`;
  });
  // 5. emfaza — od najdłuższych markerów do najkrótszych
  s = s.replace(/\*\*\*(\S(?:[^*]*\S)?)\*\*\*/g, "<strong><em>$1</em></strong>");
  s = s.replace(/___(\S(?:[^_]*\S)?)___/g, "<strong><em>$1</em></strong>");
  s = s.replace(/\*\*(\S(?:[^*]*\S)?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__(\S(?:[^_]*\S)?)__/g, "<strong>$1</strong>");
  s = s.replace(/~~(\S(?:[^~]*\S)?)~~/g, "<s>$1</s>");
  s = s.replace(/\*(\S(?:[^*]*\S)?)\*/g, "<em>$1</em>");
  s = s.replace(/(^|[^\w_])_(\S(?:[^_]*\S)?)_(?![\w_])/g, "$1<em>$2</em>");

  const restore = new RegExp(SENT + "(\\d+)" + SENT, "g");
  return s.replace(restore, (_m, n) => stash[Number(n)]);
}

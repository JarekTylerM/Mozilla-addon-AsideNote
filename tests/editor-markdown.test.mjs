/**
 * editor-markdown.test.mjs — testy serializacji HTML → Markdown
 *
 * Uruchomienie: node tests/editor-markdown.test.mjs
 */

import { test, expect, results } from "./_runner.mjs";
import { createEditorDOM } from "./dom-harness.mjs";
import {
  htmlToMarkdown,
  markdownToHtml,
  looksLikeMarkdown,
} from "../scripts/editor-markdown.js";

/** Helper: renderuje HTML w edytorze i zwraca markdown */
function md(html) {
  const { editor } = createEditorDOM(html);
  return htmlToMarkdown(editor);
}

console.log("[bloki]");

test("pusty edytor → pusty string", () => {
  expect(md("")).toBe("");
});

test("pojedynczy akapit", () => {
  expect(md("<p>Hello world</p>")).toBe("Hello world");
});

test("dwa akapity rozdzielone pustą linią", () => {
  expect(md("<p>Pierwszy</p><p>Drugi</p>")).toBe("Pierwszy\n\nDrugi");
});

test("pusty akapit (<br>) jest pomijany", () => {
  expect(md("<p>A</p><p><br></p><p>B</p>")).toBe("A\n\nB");
});

test("nagłówki h1-h3", () => {
  expect(md("<h1>Tytuł</h1><h2>Sekcja</h2><h3>Podsekcja</h3>")).toBe(
    "# Tytuł\n\n## Sekcja\n\n### Podsekcja",
  );
});

test("hr → ---", () => {
  expect(md("<p>A</p><hr><p>B</p>")).toBe("A\n\n---\n\nB");
});

test("blok kodu → fenced code", () => {
  expect(md("<pre><code>const x = 1;\nconst y = 2;</code></pre>")).toBe(
    "```\nconst x = 1;\nconst y = 2;\n```",
  );
});

test("blok kodu z ``` w treści → dłuższy fence", () => {
  expect(md("<pre><code>```md</code></pre>")).toBe("````\n```md\n````");
});

test("blok kodu z data-language → fence z językiem", () => {
  expect(md('<pre><code data-language="js">const x = 1;</code></pre>')).toBe(
    "```js\nconst x = 1;\n```",
  );
});

console.log("\n[inline]");

test("bold", () => {
  expect(md("<p>To jest <strong>ważne</strong></p>")).toBe("To jest **ważne**");
});

test("bold przez <b>", () => {
  expect(md("<p><b>gruby</b></p>")).toBe("**gruby**");
});

test("italic", () => {
  expect(md("<p><em>kursywa</em> i <i>też</i></p>")).toBe("*kursywa* i *też*");
});

test("strikethrough", () => {
  expect(md("<p><s>skreślone</s></p>")).toBe("~~skreślone~~");
});

test("underline → <u> (brak odpowiednika w md)", () => {
  expect(md("<p><u>podkreślone</u></p>")).toBe("<u>podkreślone</u>");
});

test("kod inline", () => {
  expect(md("<p>Użyj <code>npm install</code></p>")).toBe("Użyj `npm install`");
});

test("kod inline z backtickiem → podwójny delimiter", () => {
  expect(md("<p><code>a ` b</code></p>")).toBe("`` a ` b ``");
});

test("link", () => {
  expect(md('<p><a href="https://example.com">strona</a></p>')).toBe(
    "[strona](https://example.com)",
  );
});

test("zagnieżdżone bold+italic", () => {
  expect(md("<p><strong><em>oba</em></strong></p>")).toBe("***oba***");
});

test("spacje na krawędzi bolda wychodzą poza markery", () => {
  expect(md("<p>a<strong> b </strong>c</p>")).toBe("a **b** c");
});

test("br → twarde łamanie linii (dwie spacje)", () => {
  expect(md("<p>linia1<br>linia2</p>")).toBe("linia1  \nlinia2");
});

console.log("\n[listy]");

test("lista punktowana", () => {
  expect(md("<ul><li>a</li><li>b</li></ul>")).toBe("- a\n- b");
});

test("lista numerowana", () => {
  expect(md("<ol><li>a</li><li>b</li></ol>")).toBe("1. a\n2. b");
});

test("lista numerowana z atrybutem start", () => {
  expect(md('<ol start="3"><li>a</li><li>b</li></ol>')).toBe("3. a\n4. b");
});

test("checklista → - [ ] / - [x]", () => {
  expect(
    md(
      '<ul data-list="checklist"><li data-checked="false">todo</li><li data-checked="true">done</li></ul>',
    ),
  ).toBe("- [ ] todo\n- [x] done");
});

test("lista zagnieżdżona w ul → wcięcie 2 spacje", () => {
  expect(md("<ul><li>a<ul><li>a1</li></ul></li><li>b</li></ul>")).toBe(
    "- a\n  - a1\n- b",
  );
});

test("lista zagnieżdżona w ol → wcięcie do szerokości markera", () => {
  expect(md("<ol><li>a<ul><li>a1</li></ul></li></ol>")).toBe("1. a\n   - a1");
});

test("formatowanie inline wewnątrz li", () => {
  expect(md("<ul><li><strong>bold</strong> item</li></ul>")).toBe(
    "- **bold** item",
  );
});

console.log("\n[blockquote / callout]");

test("zwykły cytat", () => {
  expect(md("<blockquote><p>cytat</p></blockquote>")).toBe("> cytat");
});

test("cytat wieloakapitowy", () => {
  expect(md("<blockquote><p>a</p><p>b</p></blockquote>")).toBe("> a\n>\n> b");
});

test("callout note → > [!NOTE]", () => {
  expect(md('<blockquote data-callout="note"><p>treść</p></blockquote>')).toBe(
    "> [!NOTE]\n> treść",
  );
});

test("callout z własną etykietą", () => {
  expect(
    md(
      '<blockquote data-callout="warning" data-callout-label="Uwaga!"><p>x</p></blockquote>',
    ),
  ).toBe("> [!WARNING] Uwaga!\n> x");
});

console.log("\n[details / toggle list]");

test("details/summary → blok <details> (GFM)", () => {
  expect(
    md("<details open><summary>Tytuł</summary><p>Ukryta treść</p></details>"),
  ).toBe("<details>\n<summary>Tytuł</summary>\n\nUkryta treść\n\n</details>");
});

console.log("\n[edge cases]");

test("luźny tekst bez wrappera → akapit", () => {
  expect(md("luźny tekst")).toBe("luźny tekst");
});

test("luźny inline między blokami", () => {
  expect(md("<h1>T</h1>tekst<p>P</p>")).toBe("# T\n\ntekst\n\nP");
});

test("null root → pusty string", () => {
  expect(htmlToMarkdown(null)).toBe("");
});

test("pełna notatka — struktura mieszana", () => {
  const out = md(
    "<h1>Plan</h1>" +
      "<p>Wstęp z <strong>boldem</strong>.</p>" +
      '<ul data-list="checklist"><li data-checked="true">zrobione</li></ul>' +
      '<blockquote data-callout="tip"><p>wskazówka</p></blockquote>' +
      "<hr>" +
      "<pre><code>kod</code></pre>",
  );
  expect(out).toBe(
    "# Plan\n\nWstęp z **boldem**.\n\n- [x] zrobione\n\n> [!TIP]\n> wskazówka\n\n---\n\n```\nkod\n```",
  );
});

// ══════════════════════════════════════════════════════════════
// Kierunek odwrotny: Markdown → HTML (wklejanie)
// ══════════════════════════════════════════════════════════════

console.log("\n[looksLikeMarkdown]");

test("sygnał blokowy → tak", () => {
  for (const s of ["# Tytuł", "- punkt", "1. raz", "> cytat", "```js", "---"]) {
    if (!looksLikeMarkdown(s)) throw new Error("nie wykryto: " + s);
  }
});

test("link → tak", () => {
  expect(looksLikeMarkdown("zobacz [tu](https://a.pl)")).toBe(true);
});

test("zwykłe zdanie → nie", () => {
  expect(looksLikeMarkdown("po prostu tekst notatki")).toBe(false);
});

test("sama emfaza w zdaniu → nie (za mało sygnału)", () => {
  // Inaczej każdy tekst z gwiazdkami zmieniałby się przy wklejeniu
  expect(looksLikeMarkdown("mnożenie 5 * 3 i *nacisk*")).toBe(false);
});

test("pusty tekst → nie", () => {
  expect(looksLikeMarkdown("")).toBe(false);
  expect(looksLikeMarkdown(null)).toBe(false);
});

console.log("\n[markdownToHtml — bloki]");

const mdh = (s) => markdownToHtml(s);

test("nagłówki H1-H3", () => {
  expect(mdh("# a")).toBe("<h1>a</h1>");
  expect(mdh("## a")).toBe("<h2>a</h2>");
  expect(mdh("### a")).toBe("<h3>a</h3>");
});

test("H4-H6 spłaszczone do H3 (wyżej nie ma czego pokazać)", () => {
  expect(mdh("#### a")).toBe("<h3>a</h3>");
  expect(mdh("###### a")).toBe("<h3>a</h3>");
});

test("lista punktowana i numerowana", () => {
  expect(mdh("- a\n- b")).toBe("<ul><li>a</li><li>b</li></ul>");
  expect(mdh("1. a\n2. b")).toBe("<ol><li>a</li><li>b</li></ol>");
});

test("numeracja od innej liczby zachowuje start", () => {
  expect(mdh("5. a\n6. b")).toBe('<ol start="5"><li>a</li><li>b</li></ol>');
});

test("checklista z zaznaczeniem", () => {
  expect(mdh("- [ ] a\n- [x] b")).toBe(
    '<ul data-list="checklist"><li data-checked="false">a</li>' +
      '<li data-checked="true">b</li></ul>',
  );
});

test("zagnieżdżenie po wcięciu trafia do POPRZEDNIEGO punktu", () => {
  // Podlista jako osobny <li> dałaby punkt bez treści — nieedytowalny
  expect(mdh("- a\n  - a1\n- b")).toBe(
    "<ul><li>a<ul><li>a1</li></ul></li><li>b</li></ul>",
  );
});

test("cytat", () => {
  expect(mdh("> a")).toBe("<blockquote><p>a</p></blockquote>");
});

test("callout z etykietą", () => {
  expect(mdh("> [!WARNING] Uwaga\n> tekst")).toBe(
    '<blockquote data-callout="warning" data-callout-label="Uwaga">' +
      "<p>Uwaga<br>tekst</p></blockquote>",
  );
});

test("nieznany typ callouta zostaje zwykłym cytatem", () => {
  expect(mdh("> [!FOO] x")).toBe("<blockquote><p>[!FOO] x</p></blockquote>");
});

test("blok kodu z językiem, treść nietknięta", () => {
  expect(mdh("```js\nconst a = *1*;\n```")).toBe(
    '<pre><code data-language="js">const a = *1*;</code></pre>',
  );
});

test("linia pozioma", () => {
  expect(mdh("---")).toBe("<hr>");
  expect(mdh("***")).toBe("<hr>");
});

test("akapit łamany bez pustej linii → <br>", () => {
  expect(mdh("linia1\nlinia2")).toBe("<p>linia1<br>linia2</p>");
});

test("pusta linia rozdziela akapity", () => {
  expect(mdh("a\n\nb")).toBe("<p>a</p><p>b</p>");
});

console.log("\n[markdownToHtml — inline]");

test("emfaza i kod", () => {
  expect(mdh("**b** *i* ~~s~~ `c`")).toBe(
    "<p><strong>b</strong> <em>i</em> <s>s</s> <code>c</code></p>",
  );
});

test("potrójny marker → strong+em", () => {
  expect(mdh("***x***")).toBe("<p><strong><em>x</em></strong></p>");
});

test("podkreślnik w środku słowa nie robi kursywy", () => {
  expect(mdh("snake_case_name")).toBe("<p>snake_case_name</p>");
});

test("link", () => {
  expect(mdh("[t](https://a.pl)")).toBe('<p><a href="https://a.pl">t</a></p>');
});

test("escapowany marker zostaje literałem", () => {
  expect(mdh("a \\*nie kursywa\\* b")).toBe("<p>a *nie kursywa* b</p>");
});

test("markdown w kodzie inline nietknięty", () => {
  expect(mdh("`**nie bold**`")).toBe("<p><code>**nie bold**</code></p>");
});

console.log("\n[markdownToHtml — bezpieczeństwo]");

test("HTML w tekście jest escapowany, nie staje się znacznikiem", () => {
  expect(mdh("<script>alert(1)</script>")).toBe(
    "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
  );
});

test("HTML w bloku kodu też escapowany", () => {
  expect(mdh("```\n<b>x</b>\n```")).toBe(
    "<pre><code>&lt;b&gt;x&lt;/b&gt;</code></pre>",
  );
});

test("cudzysłów w treści nie rozbija atrybutu", () => {
  expect(mdh('# a"b')).toBe("<h1>a&quot;b</h1>");
});

test("wklejony znak NUL nie podszyje się pod placeholder", () => {
  // Placeholder używa NUL jako ogranicznika — wejście musi być z niego czyszczone
  const out = mdh("a 0 b `x`");
  expect(out).toContain("<code>x</code>");
  expect(out.includes(" ")).toBe(false);
});

test("groźny schemat URL nie tworzy linku — bez udziału sanitizera", () => {
  // markdownToHtml waliduje href sam, nie licząc na późniejszy sanitizeHTML.
  // Wcześniej bezpieczeństwo linków było niezapisanym kontraktem callera.
  for (const scheme of ["javascript:alert(1)", "data:text/html,x", "vbscript:x", "file:///etc/passwd"]) {
    const out = mdh(`[k](${scheme})`);
    if (out.includes("<a ")) throw new Error("powstał link dla " + scheme);
  }
});

test("wielkość liter nie omija filtru schematu", () => {
  expect(mdh("[k](JaVaScRiPt:alert(1))").includes("<a ")).toBe(false);
});

test("bezpieczne URL-e nadal działają", () => {
  for (const url of ["https://ok.pl", "http://ok.pl", "/wzgledny", "mailto:a@b.pl"]) {
    if (!mdh(`[k](${url})`).includes("<a ")) throw new Error("zablokowany: " + url);
  }
});

test("apostrof jest escapowany (atrybuty w pojedynczych cudzysłowach)", () => {
  expect(mdh("# it's")).toBe("<h1>it&#39;s</h1>");
});

console.log("\n[round-trip]");

test("markdown → html → markdown zachowuje strukturę", () => {
  const src = "# Plan\n\n- [x] zrobione\n\n> cytat";
  const { editor } = createEditorDOM(markdownToHtml(src));
  expect(htmlToMarkdown(editor)).toBe(src);
});

results();

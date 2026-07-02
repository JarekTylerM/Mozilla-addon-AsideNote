/**
 * editor-markdown.test.mjs — testy serializacji HTML → Markdown
 *
 * Uruchomienie: node tests/editor-markdown.test.mjs
 */

import { test, expect, results } from "./_runner.mjs";
import { createEditorDOM } from "./dom-harness.mjs";
import { htmlToMarkdown } from "../scripts/editor-markdown.js";

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

results();

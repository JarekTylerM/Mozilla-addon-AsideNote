// @ts-check
/**
 * editor-block-analyzer.js — czyste funkcje analizy kontekstu edytora
 *
 * ZASADA: Zero DOM, zero selection API, zero side effects.
 * Wejście: prosty obiekt kontekstu (zbudowany przez handler z DOM queries).
 * Wyjście: decyzja co zrobić — string lub obiekt z parametrami.
 *
 * Używane przez: editor.js (_handleEnter, _handleBackspace, _handleSpace)
 * Testowalne w: Node.js bez żadnego mock DOM
 */

/* ── detectSpaceTrigger ──────────────────────────────────────────
 *
 * Wykrywa markdown trigger wyzwalany spacją.
 *
 * @param {string} blockText   textContent bieżącego bloku
 * @param {string} textBefore  tekst w text node przed kursorem
 * @returns {{ trigger: string, ...params } | null}
 *
 * Triggery:
 *   checklist     -[ ]  lub  -[x]
 *   heading       # | ## | ###
 *   bullet        -  lub  *
 *   ordered       1.
 *   callout       >[!NOTE] itp.
 *   code-block    ```
 *   blockquote    >
 */
/** @param {string} blockText @param {string} textBefore */
export function detectSpaceTrigger(blockText, textBefore) {
  const text = blockText.trim();

  // Checklist: -[ ] lub -[x]/-[X]
  if (/^-\[ \]$/.test(text)) return { trigger: 'checklist', checked: false };
  if (/^-\[[xX]\]$/.test(text)) return { trigger: 'checklist', checked: true };

  // Nagłówki: # / ## / ###
  const hMatch = text.match(/^(#{1,3})$/);
  if (hMatch) return { trigger: 'heading', level: hMatch[1].length };

  // Bullet list: - lub *
  if (/^[-*]$/.test(text)) return { trigger: 'bullet' };

  // Numerowana lista: dowolna cyfra + kropka
  const orderedMatch = text.match(/^(\d+)\.$/);
  if (orderedMatch)
    return { trigger: 'ordered', start: parseInt(orderedMatch[1], 10) };

  // Callout blocks: >[!NOTE] itp. (używa textBefore — dokładniejsze niż blockText)
  const calloutMatch = textBefore
    .trim()
    .match(/^>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/i);
  if (calloutMatch)
    return { trigger: 'callout', type: calloutMatch[1].toLowerCase() };

  // Blok kodu: ``` lub ```język
  const codeMatch = text.match(/^```(\w*)$/);
  if (codeMatch)
    return { trigger: 'code-block', language: codeMatch[1] || null };
  if (/^>-$/.test(text)) return { trigger: 'toggle-list' };

  // Cytat: >
  if (/^>$/.test(text)) return { trigger: 'blockquote' };

  return null;
}

/* ── decideEnterAction ───────────────────────────────────────────
 *
 * Decyduje co Enter powinien zrobić na podstawie kontekstu.
 *
 * @param {object} ctx
 *   inPre            {boolean} kursor w <pre>/<code>
 *   preIsExiting     {boolean} dwa <br> na końcu pre → wyjście
 *   inHeading        {boolean} kursor w <h1>/<h2>/<h3>
 *   headingAtStart      {boolean} kursor przed całą treścią nagłówka
 *   headingHasTextAfter {boolean} za kursorem jest jeszcze treść nagłówka
 *   inChecklistLi    {boolean} kursor w <li> checklisty
 *   checklistEmpty   {boolean} li checklisty jest pusty
 *   inLi             {boolean} kursor w zwykłym <li>
 *   liEmpty          {boolean} li jest pusty
 *   liIsLast         {boolean} li jest ostatnim dzieckiem listy
 *   liIsNested       {boolean} lista jest zagnieżdżona w innym li
 *   inBlockquote     {boolean} kursor w <blockquote>
 *   bqLineEmpty      {boolean} bieżąca linia w blockquote pusta
 *   bqIsLastBlock    {boolean} jest ostatnim blokiem w blockquote
 *   bqPrevEmpty      {boolean} poprzedni blok w blockquote pusty
 *   isHrTrigger      {boolean} blok zawiera dokładnie "---"
 *
 * @returns {{ action: string, ...params }}
 */
/**
 * @typedef {object} EnterCtx
 * @property {boolean} inPre
 * @property {boolean} preIsExiting
 * @property {boolean} inSummary
 * @property {boolean} inDetailsContent
 * @property {boolean} detailsContentEmpty
 * @property {boolean} inHeading
 * @property {boolean} headingAtStart
 * @property {boolean} headingHasTextAfter
 * @property {boolean} inChecklistLi
 * @property {boolean} checklistEmpty
 * @property {boolean} inLi
 * @property {boolean} liEmpty
 * @property {boolean} liIsLast
 * @property {boolean} liIsNested
 * @property {boolean} inBlockquote
 * @property {boolean} bqLineEmpty
 * @property {boolean} bqIsLastBlock
 * @property {boolean} bqPrevEmpty
 * @property {boolean} isHrTrigger
 * @property {boolean} hasTrailingSpaces
 */

/** @param {EnterCtx} ctx */
export function decideEnterAction(ctx) {
  const {
    inPre,
    preIsExiting,
    inSummary,
    inDetailsContent,
    detailsContentEmpty,
    inHeading,
    headingAtStart,
    headingHasTextAfter,
    inChecklistLi,
    checklistEmpty,
    inLi,
    liEmpty,
    liIsLast,
    liIsNested,
    inBlockquote,
    bqLineEmpty,
    bqIsLastBlock,
    bqPrevEmpty,
    isHrTrigger,
    hasTrailingSpaces,
  } = ctx;

  if (inSummary) return { action: 'summary-to-content' };
  if (inDetailsContent && detailsContentEmpty)
    return { action: 'details-exit' };
  // ── Pre / code block ─────────────────────────────────────────
  if (inPre) {
    if (preIsExiting) return { action: 'pre-exit' };
    return { action: 'pre-linebreak' };
  }

  // ── Nagłówek ─────────────────────────────────────────────────
  // Na początku: pusty akapit nad nagłówkiem (kursor zostaje).
  // W środku: podział — tekst za kursorem wędruje do akapitu niżej.
  // Na końcu (lub pusty nagłówek): nowy akapit pod spodem.
  if (inHeading) {
    if (headingAtStart && headingHasTextAfter)
      return { action: 'heading-para-before' };
    if (headingHasTextAfter) return { action: 'heading-split' };
    return { action: 'heading-new-para' };
  }

  // ── Checklist ─────────────────────────────────────────────────
  if (inChecklistLi) {
    if (checklistEmpty) return { action: 'checklist-exit' };
    return { action: 'checklist-new-item' };
  }

  // ── Zwykła lista ─────────────────────────────────────────────
  if (inLi && liEmpty) {
    if (liIsLast && liIsNested) return { action: 'li-outdent' };
    if (liIsLast) return { action: 'li-exit' };
    return { action: 'li-split' };
  }

  // ── Blockquote ────────────────────────────────────────────────
  if (inBlockquote) {
    if (bqLineEmpty && bqIsLastBlock && bqPrevEmpty)
      return { action: 'blockquote-exit' };
    return { action: 'blockquote-new-para' };
  }

// ── HR trigger --- ────────────────────────────────────────────
  if (isHrTrigger) return { action: 'hr-insert' };

  // ── Hard line break — dwie spacje na końcu linii ──────────────
  if (hasTrailingSpaces) return { action: 'hard-break' };

  return { action: 'default' };
}

/* ── decideBackspaceAction ───────────────────────────────────────
 *
 * Decyduje co Backspace powinien zrobić na początku elementu.
 *
 * @param {object} ctx
 *   inChecklistLi    {boolean} kursor w <li> checklisty
 *   checklistAtStart {boolean} kursor na początku li
 *   checklistHasPrev {boolean} li ma poprzednie rodzeństwo
 *   inBlockquote     {boolean} kursor w <blockquote>
 *   bqAtStart        {boolean} kursor na początku pierwszego bloku blockquote
 *   inLi             {boolean} kursor w zwykłym <li>
 *   liAtStart        {boolean} kursor na początku li
 *   liHasPrev        {boolean} li ma poprzednie rodzeństwo
 *   liIsNested       {boolean} lista jest zagnieżdżona w innym li
 *
 * @returns {{ action: string } | null}  null = brak interceptu (default)
 */
/**
 * @typedef {object} BackspaceCtx
 * @property {boolean} inSummary
 * @property {boolean} summaryEmpty
 * @property {boolean} summaryAtStart
 * @property {boolean} inChecklistLi
 * @property {boolean} checklistAtStart
 * @property {boolean} checklistHasPrev
 * @property {boolean} inBlockquote
 * @property {boolean} bqAtStart
 * @property {boolean} inLi
 * @property {boolean} liAtStart
 * @property {boolean} liHasPrev
 * @property {boolean} liIsNested
 */

/** @param {BackspaceCtx} ctx */
export function decideBackspaceAction(ctx) {
  const {
    inSummary,
    summaryEmpty,
    summaryAtStart,
    inChecklistLi,
    checklistAtStart,
    checklistHasPrev,
    inBlockquote,
    bqAtStart,
    inLi,
    liAtStart,
    liHasPrev,
    liIsNested,
  } = ctx;

  if (inSummary && summaryAtStart && summaryEmpty)
    return { action: 'summary-unwrap' };

  // ── Checklist ─────────────────────────────────────────────────
  if (inChecklistLi && checklistAtStart) {
    if (checklistHasPrev) return { action: 'checklist-merge' };
    return { action: 'checklist-exit-to-p' };
  }

  // ── Blockquote ────────────────────────────────────────────────
  if (inBlockquote && bqAtStart) return { action: 'blockquote-unwrap' };

  // ── Zwykła lista ─────────────────────────────────────────────
  if (inLi && liAtStart) {
    if (liHasPrev) return { action: 'li-merge' };
    if (liIsNested) return { action: 'li-outdent' };
    return { action: 'li-exit-to-p' };
  }

  return null; // brak interceptu — browser obsłuży domyślnie
}

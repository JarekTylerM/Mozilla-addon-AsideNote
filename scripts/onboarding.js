// @ts-check
/* ══════════════════════════════════════════════════════════════
   onboarding.js — prowadzony tour po funkcjach AsideNotes

   7 lekcji, od podstaw do szczegółów — każda buduje na poprzedniej:
     1. Start                — pierwsza notatka, lista, edytor, notatka vs zadanie
                               (+ konwersja typu w obie strony)
     2. Formatowanie         — toolbar, slash menu, markdown, linki, kopiuj jako MD
     3. Zadania i terminy    — ważne i "w trakcie", date picker, powtarzanie
     4. Szybkie dodawanie    — pełna składnia capture, podgląd, skróty, popup
     5. Tryby skupienia      — zen (wł/wył), focus mode (wł/wył)
     6. Porządek             — szukanie, przełącznik typów, filtry, tagi
     7. Dane i skróty        — skróty globalne, ustawienia, backup, prywatność

   Zasada doboru kroków: tour ma pokrywać każdy stan, po którym da się
   potem filtrować. Lekcja 6 uczy filtrów "ważne" i "tylko w trakcie",
   więc lekcja 3 musi pokazać, czym się te stany nadaje — inaczej
   użytkownik uczy się filtrować po czymś, czego nie umie ustawić.

   Dlaczego składnia capture jest OSOBNĄ lekcją, i to po "Zadaniach":
   to jeden ekran gęstej wiedzy (priorytety, daty, godziny, cykliczność),
   który wcześniej rozłaziłby się po opisach przycisków. Idzie po lekcji 3,
   bo "!!raport w piątek 9:00" ma sens dopiero, gdy użytkownik wie, co to
   termin i co robi gwiazdka — inaczej uczyłby się skrótu do pojęć,
   których jeszcze nie zna. Lekcja 3 pokazuje te stany myszą, lekcja 4
   to samo z klawiatury.

   API publiczne:
     initOnboarding(uiSettings)  — wywołaj z boot po renderList()
     startStage(n)               — uruchom etap 1-7 (z panelu)
   ══════════════════════════════════════════════════════════════ */

import { t } from './i18n.js';
import { saveUiSettings } from './storage.js';

/**
 * @typedef {object} StepAwait
 * @property {string} type
 * @property {string} [selector]
 * @property {MutationObserverInit} [options]
 * @property {(muts: MutationRecord[], el: Element) => any} [check]
 */
/**
 * @typedef {object} Step
 * @property {number} stage
 * @property {number} idx
 * @property {string | (() => Element|null) | null} [target]
 * @property {string} [textKey]
 * @property {string} [textKeyFallback]
 * @property {() => boolean} [isFallback]
 * @property {string} [type]
 * @property {boolean} [focusTarget]
 * @property {StepAwait} [await]
 * @property {string} [side]
 * @property {string} [revealHidden]
 */

/** @param {string} id @returns {HTMLElement} */
const _byId = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/* ── Definicja kroków ────────────────────────────────────────── */

/* Await na dodanie elementu do listy — współdzielony przez kroki capture */
/** @type {StepAwait} */
const AWAIT_NOTE_ADDED = {
  type: 'mutation',
  selector: '#notesList',
  options: { childList: true, subtree: true },
  check: (muts) =>
    muts.some((m) =>
      [...m.addedNodes].some((n) =>
        /** @type {Element} */ (n).classList?.contains('note-item'),
      ),
    ),
};

/* Krok "otwórz notatkę z listy" — powtarza się w lekcjach 2 i 4 */
const noteItemTarget = () =>
  document.querySelector('#notesList .note-item') ??
  document.querySelector('.notes-empty');
const noteListEmpty = () => !document.querySelector('#notesList .note-item');

/** @type {Step[]} */
const STEPS = [
  // ── Lekcja 1: Start — pierwsza notatka i podstawowe pojęcia ──
  {
    stage: 1, idx: 0,
    target: '#quick-capture',
    textKey: 'ob_s1_1',
    type: 'try',
    focusTarget: true,
    await: AWAIT_NOTE_ADDED,
    side: 'bottom',
  },
  {
    stage: 1, idx: 1,
    target: noteItemTarget,
    textKey: 'ob_s1_2',
    textKeyFallback: 'ob_s1_2_empty',
    isFallback: noteListEmpty,
    type: 'try',
    await: { type: 'click', selector: '#notesList .note-item' },
    side: 'right',
  },
  {
    stage: 1, idx: 2,
    target: '#editor',
    textKey: 'ob_s1_3',
    type: 'show',
    side: 'top',
    focusTarget: true,
  },
  {
    stage: 1, idx: 3,
    target: null,
    textKey: 'ob_s1_4',
    type: 'show',
    side: 'bottom',
  },
  {
    // Konwersja typu tuż po wyjaśnieniu "notatka vs zadanie" — pojęcie
    // i przycisk, który je odwraca, w jednym miejscu. Przycisk jest
    // widoczny zawsze (tylko disabled), więc nie potrzebuje revealHidden.
    stage: 1, idx: 4,
    target: '#convert-type',
    textKey: 'ob_s1_convert',
    type: 'show',
    side: 'bottom',
  },
  {
    stage: 1, idx: 5,
    target: null,
    textKey: 'ob_done_s1',
    type: 'done',
    side: 'bottom',
  },

  // ── Lekcja 2: Formatowanie — toolbar, slash menu, markdown ──
  {
    stage: 2, idx: 0,
    target: noteItemTarget,
    textKey: 'ob_s2_1',
    textKeyFallback: 'ob_s2_1_empty',
    isFallback: noteListEmpty,
    type: 'try',
    await: { type: 'click', selector: '#notesList .note-item' },
    side: 'right',
  },
  {
    stage: 2, idx: 1,
    target: '#toolbar',
    textKey: 'ob_s2_2',
    type: 'show',
    side: 'bottom',
    revealHidden: '#toolbar',
  },
  {
    stage: 2, idx: 2,
    target: '#editor',
    textKey: 'ob_s2_3',
    type: 'try',
    focusTarget: true,
    await: {
      type: 'mutation',
      selector: '#slash-menu',
      options: { attributes: true, attributeFilter: ['hidden'] },
      check: (muts, el) => !(/** @type {HTMLElement} */ (el)).hidden,
    },
    side: 'top',
  },
  {
    stage: 2, idx: 3,
    target: '#editor',
    textKey: 'ob_s2_4',
    type: 'show',
    side: 'top',
  },
  {
    // revealHidden jak przy kroku toolbara — Alt+E mógł go schować
    stage: 2, idx: 4,
    target: '#link-btn',
    textKey: 'ob_s2_link',
    type: 'show',
    side: 'bottom',
    revealHidden: '#toolbar',
  },
  {
    stage: 2, idx: 5,
    target: '#copy-md-btn',
    textKey: 'ob_s2_5',
    type: 'show',
    side: 'bottom',
  },
  {
    stage: 2, idx: 6,
    target: null,
    textKey: 'ob_done_s2',
    type: 'done',
    side: 'bottom',
  },

  // ── Lekcja 3: Zadania i terminy ──────────────────────────────
  {
    stage: 3, idx: 0,
    target: '#quick-capture',
    textKey: 'ob_s3_1',
    type: 'try',
    focusTarget: true,
    await: AWAIT_NOTE_ADDED,
    side: 'bottom',
  },
  {
    stage: 3, idx: 1,
    target: noteItemTarget,
    textKey: 'ob_s3_2',
    textKeyFallback: 'ob_s3_2_empty',
    isFallback: noteListEmpty,
    type: 'try',
    await: { type: 'click', selector: '#notesList .note-item' },
    side: 'right',
  },
  // Oba przyciski są odsłaniane przez notes.js, gdy notatka jest otwarta
  // (importantBtn.hidden = !state.activeId) — poprzedni krok właśnie ją
  // otworzył, więc nie trzeba revealHidden. Typ 'show', nie 'try':
  // wymuszanie kliknięcia zmieniałoby stan notatki użytkownika.
  {
    stage: 3, idx: 2,
    target: '#important-btn',
    textKey: 'ob_s3_important',
    type: 'show',
    side: 'bottom',
  },
  {
    stage: 3, idx: 3,
    target: '#focus-btn',
    textKey: 'ob_s3_focus',
    type: 'show',
    side: 'bottom',
  },
  {
    stage: 3, idx: 4,
    target: '#due-display-btn',
    textKey: 'ob_s3_3',
    type: 'try',
    await: {
      type: 'mutation',
      selector: '#date-picker-popover',
      options: { attributes: true, attributeFilter: ['hidden'] },
      check: (muts, el) => !(/** @type {HTMLElement} */ (el)).hidden,
    },
    side: 'bottom',
    revealHidden: '#due-wrapper',
  },
  {
    stage: 3, idx: 5,
    target: '#date-picker-popover',
    textKey: 'ob_s3_4',
    type: 'show',
    side: 'bottom',
  },
  {
    stage: 3, idx: 6,
    target: '#notesList',
    textKey: 'ob_s3_5',
    type: 'show',
    side: 'bottom',
  },
  {
    stage: 3, idx: 7,
    target: null,
    textKey: 'ob_done_s3',
    type: 'done',
    side: 'bottom',
  },

  // ── Lekcja 4: Szybkie dodawanie — cała składnia capture ─────
  // Krok 0 jest interaktywny i celowo pokazuje cztery rzeczy naraz
  // (podgląd, !!, dzień tygodnia, godzina) — dalsze kroki tylko je
  // rozwijają. Reszta to 'show' na tym samym polu: nie ma sensu kazać
  // użytkownikowi dodawać pięciu zadań, żeby przeczytać składnię.
  {
    stage: 4, idx: 0,
    target: '#quick-capture',
    textKey: 'ob_s4_1',
    type: 'try',
    focusTarget: true,
    await: AWAIT_NOTE_ADDED,
    side: 'bottom',
  },
  {
    stage: 4, idx: 1,
    target: '#quick-capture',
    textKey: 'ob_s4_priority',
    type: 'show',
    side: 'bottom',
  },
  {
    stage: 4, idx: 2,
    target: '#quick-capture',
    textKey: 'ob_s4_dates',
    type: 'show',
    side: 'bottom',
  },
  {
    stage: 4, idx: 3,
    target: '#quick-capture',
    textKey: 'ob_s4_recurrence',
    type: 'show',
    side: 'bottom',
  },
  {
    stage: 4, idx: 4,
    target: null,
    textKey: 'ob_s4_shortcuts',
    type: 'show',
    side: 'bottom',
  },
  {
    stage: 4, idx: 5,
    target: null,
    textKey: 'ob_done_s4',
    type: 'done',
    side: 'bottom',
  },

  // ── Lekcja 5: Tryby skupienia — zen tam i z powrotem, ekran notatki ──
  // Klasa zen-mode żyje na #main-view (nie na body) — patrz notes.js renderList
  {
    stage: 5, idx: 0,
    target: '#zen-btn',
    textKey: 'ob_s5_1',
    type: 'try',
    await: {
      type: 'mutation',
      selector: '#main-view',
      options: { attributes: true, attributeFilter: ['class'] },
      check: (muts, el) => el.classList.contains('zen-mode'),
    },
    side: 'bottom',
  },
  {
    stage: 5, idx: 1,
    target: '#zen-btn',
    textKey: 'ob_s5_2',
    type: 'try',
    await: {
      type: 'mutation',
      selector: '#main-view',
      options: { attributes: true, attributeFilter: ['class'] },
      check: (muts, el) => !el.classList.contains('zen-mode'),
    },
    side: 'bottom',
  },
  {
    stage: 5, idx: 2,
    target: noteItemTarget,
    textKey: 'ob_s5_3',
    textKeyFallback: 'ob_s5_3_empty',
    isFallback: noteListEmpty,
    type: 'try',
    await: { type: 'click', selector: '#notesList .note-item' },
    side: 'right',
  },
  {
    // Notatka otwiera się na całą wysokość panelu (body.is-editing) —
    // krok uczy drogi powrotu: ← w nagłówku albo Esc
    stage: 5, idx: 3,
    target: '#back-btn',
    textKey: 'ob_s5_4',
    type: 'try',
    await: {
      type: 'mutation',
      selector: 'body',
      options: { attributes: true, attributeFilter: ['class'] },
      check: (muts, el) => !el.classList.contains('is-editing'),
    },
    side: 'bottom',
  },
  {
    stage: 5, idx: 4,
    target: null,
    textKey: 'ob_done_s5',
    type: 'done',
    side: 'bottom',
  },

  // ── Lekcja 5: Porządek — szukanie, typy, filtry, tagi ────────
  {
    stage: 6, idx: 0,
    target: '.search-wrapper',
    textKey: 'ob_s6_1',
    type: 'show',
    side: 'bottom',
  },
  {
    // revealHidden — wiersz typów mógł zostać schowany (stan zapamiętany)
    stage: 6, idx: 1,
    target: '#type-toggle',
    textKey: 'ob_s6_2',
    type: 'show',
    side: 'bottom',
    revealHidden: '#type-toggle',
  },
  {
    stage: 6, idx: 2,
    target: '#filter-btn',
    textKey: 'ob_s6_3',
    type: 'try',
    await: {
      type: 'mutation',
      selector: '#filter-bar',
      options: { attributes: true, attributeFilter: ['hidden'] },
      check: (muts, el) => !(/** @type {HTMLElement} */ (el)).hidden,
    },
    side: 'bottom',
  },
  {
    stage: 6, idx: 3,
    target: '#filter-bar',
    textKey: 'ob_s6_4',
    type: 'show',
    side: 'bottom',
    revealHidden: '#filter-bar',
  },
  {
    stage: 6, idx: 4,
    target: '#tag-selector',
    textKey: 'ob_s6_5',
    type: 'show',
    side: 'top',
  },
  {
    stage: 6, idx: 5,
    target: null,
    textKey: 'ob_done_s6',
    type: 'done',
    side: 'bottom',
  },

  // ── Lekcja 6: Dane i skróty — praca z przeglądarką, backup, prywatność ──
  {
    stage: 7, idx: 0,
    target: null,
    textKey: 'ob_s7_1',
    type: 'show',
    side: 'bottom',
  },
  {
    stage: 7, idx: 1,
    target: '#panel-btn',
    textKey: 'ob_s7_2',
    type: 'show',
    side: 'top',
  },
  {
    stage: 7, idx: 2,
    target: '#panel-btn',
    textKey: 'ob_s7_3',
    type: 'show',
    side: 'top',
  },
  {
    stage: 7, idx: 3,
    target: '#security-btn',
    textKey: 'ob_s7_4',
    type: 'show',
    side: 'top',
  },
  {
    stage: 7, idx: 4,
    target: null,
    textKey: 'ob_done_s7',
    type: 'done',
    side: 'bottom',
  },
];

/* ── Stałe ───────────────────────────────────────────────────── */

/** @type {Record<number, string>} */
const STAGE_LABELS = {
  1: 'ob_stage1_label',
  2: 'ob_stage2_label',
  3: 'ob_stage3_label',
  4: 'ob_stage4_label',
  5: 'ob_stage5_label',
  6: 'ob_stage6_label',
  7: 'ob_stage7_label',
};

/* ── Stan ────────────────────────────────────────────────────── */

// Elementy overlay są w sidebar.html — asercja obecności; guard w _buildOverlay
// nadal łapie ewentualny brak w runtime.
/** @type {HTMLElement} */ let _overlay;
/** @type {HTMLElement} */ let _tooltip;
/** @type {HTMLElement} */ let _backdrop;
/** @type {number | null} */ let _currentStep  = null;   // indeks w STEPS
/** @type {Record<number, boolean>} */ let _stagesDone = {}; // { 1: bool, … }
/** @type {(() => void) | null} */ let _cleanupAwait = null; // sprzątanie awaita
/** @type {Element | null} */ let _prevTarget = null;   // poprzednio podświetlony

/* ── Publiczne API ───────────────────────────────────────────── */

/**
 * Wersja numeracji lekcji zapisanej w uiSettings.onboardingStages.
 *   1 → 6 lekcji (przed wydzieleniem "Szybkiego dodawania")
 *   2 → 7 lekcji, capture jako osobna lekcja 4
 */
const STAGES_VERSION = 2;

/**
 * Przenosi znaczniki ukończenia na aktualną numerację lekcji.
 *
 * Wydzielenie capture na lekcję 4 przesunęło stare lekcje 4-6 na 5-7.
 * Bez tego użytkownik z ukończonym przewodnikiem zobaczyłby nową lekcję
 * jako zrobioną (bo pod numerem 4 leżał ptaszek po "Trybach skupienia"),
 * a ostatnią jako niezrobioną. Znaczniki to nie są dane użytkownika, ale
 * kłamią o tym, co przeczytał — a od tego zależy, czy wróci do lekcji.
 *
 * @param {{ onboardingStages?: Record<number, boolean>, onboardingStagesVersion?: number }} uiSettings
 * @returns {Record<number, boolean>}
 */
function _migrateStages(uiSettings) {
  const stages = uiSettings.onboardingStages ?? {};
  if (uiSettings.onboardingStagesVersion === STAGES_VERSION) return stages;

  /** @type {Record<number, boolean>} */
  const migrated = {};
  for (const [key, done] of Object.entries(stages)) {
    const n = Number(key);
    // Klucze z JSON są stringami; nierozpoznany klucz odpada, zamiast
    // wylądować pod NaN i zniknąć z panelu w niekontrolowany sposób.
    if (!Number.isInteger(n)) continue;
    migrated[n >= 4 ? n + 1 : n] = done;
  }

  // Zapisujemy też przy pustym zestawie — znacznik wersji ma powstać raz,
  // na pierwszym boocie, żeby migracja nie chodziła w kółko.
  saveUiSettings({
    onboardingStages: migrated,
    onboardingStagesVersion: STAGES_VERSION,
  });
  return migrated;
}

/** @param {{ onboardingStages?: Record<number, boolean>, onboardingStagesVersion?: number }} uiSettings */
export function initOnboarding(uiSettings) {
  _stagesDone = _migrateStages(uiSettings);
  _buildOverlay();

  // Pierwsze uruchomienie — etap 1 auto-start po krótkim delay
  if (!_stagesDone[1]) {
    setTimeout(() => startStage(1), 600);
  }
}

/** @param {number} stageNum */
export function startStage(stageNum) {
  const firstIdx = STEPS.findIndex(s => s.stage === stageNum);
  if (firstIdx === -1) return;
  // Zamknij panel jeśli otwarty
  const panelEl = /** @type {HTMLElement|null} */ (document.getElementById('panel'));
  if (panelEl && !panelEl.hidden) {
    document.getElementById('panel-btn')?.click();
  }
  setTimeout(() => _show(firstIdx), 150);
}

/* ── Budowanie overlay ───────────────────────────────────────── */

function _buildOverlay() {
  _overlay  = /** @type {HTMLElement} */ (document.getElementById('onboarding-overlay'));
  _backdrop = /** @type {HTMLElement} */ (document.getElementById('onboarding-backdrop'));
  _tooltip  = /** @type {HTMLElement} */ (document.getElementById('onboarding-tooltip'));
  if (!_overlay || !_tooltip) return;

  document.getElementById('onboarding-next')
    ?.addEventListener('click', () => _advance(1));
  document.getElementById('onboarding-prev')
    ?.addEventListener('click', () => _advance(-1));
  document.getElementById('onboarding-skip')
    ?.addEventListener('click', _close);
  document.getElementById('onboarding-settings')
    ?.addEventListener('click', () => {
      _close();
      document.getElementById('panel-btn')?.click();
    });

  document.addEventListener('keydown', (e) => {
    if (_overlay.hidden) return;
    if (e.key === 'Escape')     _close();
    if (e.key === 'ArrowRight') _advance(1);
    if (e.key === 'ArrowLeft')  _advance(-1);
  });
}

/* ── Silnik kroków ───────────────────────────────────────────── */

/** @param {number} stepIdx */
function _show(stepIdx) {
  if (stepIdx < 0 || stepIdx >= STEPS.length) {
    _finishStage();
    return;
  }

  const step = STEPS[stepIdx];

  // Jeśli zmieniamy etap
  if (_currentStep !== null && STEPS[_currentStep]?.stage !== step.stage) {
    _finishStage(STEPS[_currentStep]?.stage);
    return;
  }

  _cleanupAwait?.();
  _cleanupAwait = null;

  _currentStep = stepIdx;
  const stepsInStage = STEPS.filter((s) => s.stage === step.stage);
  const idxInStage   = step.idx;
  const total        = stepsInStage.length;

  // Odkryj hidden element jeśli krok tego wymaga
  if (step.revealHidden) {
    const revealEl = /** @type {HTMLElement|null} */ (document.querySelector(step.revealHidden));
    if (revealEl) revealEl.hidden = false;
  }

  // Resolve target — po revealHidden, żeby odkryty element miał już wymiary
  const resolved =
    typeof step.target === 'function'
      ? step.target()
      : step.target
        ? document.querySelector(step.target)
        : null;
  // Element istnieje, ale nie jest wyrenderowany (np. edytor schowany, gdy
  // lista zajmuje cały panel) — podświetlenie i tooltip trafiłyby w róg
  // ekranu (0,0). Krok pokazujemy wtedy wyśrodkowany, jak krok bez celu.
  const targetEl =
    resolved && resolved.getClientRects().length > 0 ? resolved : null;

  // Podświetl
  _highlight(targetEl);

  // Fokus na element jeśli krok tego wymaga
  if (step.focusTarget && targetEl) {
    setTimeout(() => /** @type {HTMLElement} */ (targetEl).focus(), 50);
  }

  // Tooltip — treść
  _byId('onboarding-stage-label').textContent = t(STAGE_LABELS[step.stage]);
  _byId('onboarding-progress').textContent = `${idxInStage + 1} / ${total}`;
  const useFallback = step.isFallback?.() && step.textKeyFallback;
  _byId('onboarding-text').textContent =
    t((useFallback ? step.textKeyFallback : step.textKey) ?? '');

  // Przyciski
  const prevBtn     = document.getElementById('onboarding-prev');
  const nextBtn     = document.getElementById('onboarding-next');
  const settingsBtn = document.getElementById('onboarding-settings');
  const skipBtn     = document.getElementById('onboarding-skip');
  if (prevBtn)     prevBtn.hidden     = (idxInStage === 0);
  if (nextBtn)     nextBtn.textContent =
    step.type === 'done' ? t('ob_btn_close') :
    idxInStage === total - 1 ? t('ob_btn_done') : t('ob_btn_next');
  if (settingsBtn) settingsBtn.hidden = step.type !== 'done';
  if (skipBtn)     skipBtn.hidden     = step.type === 'done';

  // Pokaż overlay
  _overlay.hidden = false;

  // Done step — wycentruj zawsze
  if (step.type === 'done') {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => _positionCenter())
    );
    return;
  }

  // Pozycjonuj tooltip
  if (targetEl) {
    targetEl.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    requestAnimationFrame(() =>
      requestAnimationFrame(() => _positionTooltip(targetEl, step.side))
    );
  } else {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => _positionCenter())
    );
  }

  // Auto-advance dla type: 'try'
  if (step.type === 'try' && step.await) {
    _cleanupAwait = _listenFor(step.await, () => {
      setTimeout(() => _advance(1), 350);
    });
  }
}

/** @param {number} dir */
function _advance(dir) {
  _cleanupAwait?.();
  _cleanupAwait = null;
  if (_currentStep === null) return;

  const next = _currentStep + dir;
  const cur  = STEPS[_currentStep];

  // Koniec etapu w przód
  if (dir > 0 && (next >= STEPS.length || STEPS[next]?.stage !== cur.stage)) {
    _finishStage(cur.stage);
    return;
  }
  // Cofanie poza początek etapu
  if (dir < 0 && (next < 0 || STEPS[next]?.stage !== cur.stage)) return;

  _show(next);
}

/** @param {number} [stageNum] */
function _finishStage(stageNum) {
  if (stageNum) {
    _stagesDone[stageNum] = true;
    saveUiSettings({ onboardingStages: { ..._stagesDone } });
    _refreshPanelButtons();
  }
  _close();
}

function _close() {
  _cleanupAwait?.();
  _cleanupAwait = null;
  _unhighlight();
  if (_overlay) _overlay.hidden = true;
  _currentStep = null;
}

/* ── Highlight ───────────────────────────────────────────────── */

/** @param {Element|null} el */
function _highlight(el) {
  _unhighlight();
  if (!el) return;
  el.classList.add('is-onboarding-target');
  _prevTarget = el;
}

function _unhighlight() {
  _prevTarget?.classList.remove('is-onboarding-target');
  _prevTarget = null;
}

/* ── Pozycjonowanie tooltipa ─────────────────────────────────── */

/** @param {Element} targetEl @param {string} [side] */
function _positionTooltip(targetEl, side = 'bottom') {
  _tooltip.style.transform = '';

  const rect = targetEl.getBoundingClientRect();
  const tw   = _tooltip.offsetWidth  || 260;
  const th   = _tooltip.offsetHeight || 120;

  if (rect.width === 0 && rect.height === 0) {
    _positionCenter();
    return;
  }

  const gap = 10;
  const vw  = window.innerWidth;
  const vh  = window.innerHeight;
  let top, left;

  if (side === 'bottom' && rect.bottom + th + gap < vh) {
    top  = rect.bottom + gap;
    left = rect.left;
  } else if (side === 'top' && rect.top - th - gap > 0) {
    top  = rect.top - th - gap;
    left = rect.left;
  } else if (rect.bottom + th + gap < vh) {
    top  = rect.bottom + gap;
    left = rect.left;
  } else {
    top  = rect.top - th - gap;
    left = rect.left;
  }

  left = Math.max(8, Math.min(left, vw - tw - 8));
  top  = Math.max(4, Math.min(top,  vh - th - 4));

  _tooltip.style.top  = `${top}px`;
  _tooltip.style.left = `${left}px`;
}

function _positionCenter() {
  _tooltip.style.top       = '50%';
  _tooltip.style.left      = '50%';
  _tooltip.style.transform = 'translate(-50%, -50%)';
}

/* ── Oczekiwanie na akcję użytkownika ────────────────────────── */

/** @param {StepAwait} spec @param {() => void} onMatch */
function _listenFor({ type, selector, options, check }, onMatch) {
  if (type === 'click') {
    /** @param {Event} e */
    const handler = (e) => {
      const tgt = /** @type {Element|null} */ (e.target);
      if (selector && tgt?.closest(selector)) {
        document.removeEventListener('click', handler, true);
        onMatch();
      }
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }

  if (type === 'mutation') {
    const target = selector === 'body'
      ? document.body
      : selector ? document.querySelector(selector) : null;
    if (!target) return () => {};
    const obs = new MutationObserver((muts) => {
      if (check?.(muts, target)) {
        obs.disconnect();
        onMatch();
      }
    });
    obs.observe(target, options);
    return () => obs.disconnect();
  }

  return () => {};
}

/* ── Panel — przyciski etapów ────────────────────────────────── */

function _refreshPanelButtons() {
  const container = document.getElementById('onboarding-panel-stages');
  if (!container) return;
  container.querySelectorAll('[data-ob-stage]').forEach((btn) => {
    const n    = Number(/** @type {HTMLElement} */ (btn).dataset.obStage);
    btn.classList.toggle('onboarding-stage-btn--done', !!_stagesDone[n]);
    const mark = /** @type {HTMLElement|null} */ (btn.querySelector('.onboarding-stage-btn__check'));
    if (mark) mark.hidden = !_stagesDone[n];
  });
}

export function initOnboardingPanel() {
  const container = document.getElementById('onboarding-panel-stages');
  if (!container) return;
  _refreshPanelButtons();
  container.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement|null} */ (
      (/** @type {Element|null} */ (e.target))?.closest('[data-ob-stage]') ?? null
    );
    if (!btn) return;
    startStage(Number(btn.dataset.obStage));
  });
}
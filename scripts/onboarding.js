/* ══════════════════════════════════════════════════════════════
   onboarding.js — prowadzony tour po funkcjach AsideNotes

   API publiczne:
     initOnboarding(uiSettings)  — wywołaj z boot po renderList()
     startStage(n)               — uruchom etap 1-4 (z panelu)
   ══════════════════════════════════════════════════════════════ */

import { t } from './i18n.js';
import { saveUiSettings } from './storage.js';

/* ── Definicja kroków ────────────────────────────────────────── */

const STEPS = [
// ── Etap 1: Start ─────────────────────────────────────────
  {
    stage: 1, idx: 0,
    target: '#quick-capture',
    textKey: 'ob_s1_1',
    type: 'try',
    focusTarget: true,
    await: {
      type: 'mutation',
      selector: '#notesList',
      options: { childList: true, subtree: true },
      check: (muts) =>
        muts.some((m) =>
          [...m.addedNodes].some((n) => n.classList?.contains('note-item')),
        ),
    },
    side: 'bottom',
  },
  {
    stage: 1, idx: 1,
    target: () =>
      document.querySelector('#notesList .note-item') ??
      document.querySelector('.notes-empty'),
    textKey: 'ob_s1_2',
    textKeyFallback: 'ob_s1_2_empty',
    isFallback: () => !document.querySelector('#notesList .note-item'),
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
    target: '#editor',
    textKey: 'ob_s1_4',
    type: 'try',
    await: {
      type: 'mutation',
      selector: '#slash-menu',
      options: { attributes: true, attributeFilter: ['hidden'] },
      check: (muts, el) => !el.hidden,
    },
    side: 'top',
  },
  {
    stage: 1, idx: 4,
    target: null,
    textKey: 'ob_s1_5',
    type: 'show',
    side: 'bottom',
  },
  {
    stage: 1, idx: 5,
    target: null,
    textKey: 'ob_s1_6',
    type: 'show',
    side: 'bottom',
  },
  {
    stage: 1, idx: 6,
    target: null,
    textKey: 'ob_done_s1',
    type: 'done',
    side: 'bottom',
  },

  // ── Etap 2: Zadania i terminy ──────────────────────────────
  {
    stage: 2, idx: 0,
    target: '#quick-capture',
    textKey: 'ob_s2_1',
    type: 'try',
    await: {
      type: 'mutation',
      selector: '#notesList',
      options: { childList: true, subtree: true },
      check: (muts) =>
        muts.some((m) =>
          [...m.addedNodes].some((n) => n.classList?.contains('note-item')),
        ),
    },
    side: 'bottom',
  },
  {
    stage: 2, idx: 1,
    target: () =>
      document.querySelector('#notesList .note-item') ??
      document.querySelector('.notes-empty'),
    textKey: 'ob_s2_2',
    textKeyFallback: 'ob_s2_2_empty',
    isFallback: () => !document.querySelector('#notesList .note-item'),
    type: 'try',
    await: { type: 'click', selector: '#notesList .note-item' },
    side: 'right',
  },
  {
    stage: 2, idx: 2,
    target: '#due-display-btn',
    textKey: 'ob_s2_3',
    type: 'try',
    await: {
      type: 'mutation',
      selector: '#date-picker-popover',
      options: { attributes: true, attributeFilter: ['hidden'] },
      check: (muts, el) => !el.hidden,
    },
    side: 'bottom',
    revealHidden: '#due-wrapper',
  },
  {
    stage: 2, idx: 3,
    target: '#date-picker-popover',
    textKey: 'ob_s2_4_rec',
    type: 'show',
    side: 'bottom',
  },
  {
    stage: 2, idx: 4,
    target: '#notesList',
    textKey: 'ob_s2_5',
    type: 'show',
    side: 'bottom',
  },
  {
    stage: 2, idx: 5,
    target: null,
    textKey: 'ob_done_s2',
    type: 'done',
    side: 'bottom',
  },

  // ── Etap 3: Tryby skupienia ────────────────────────────────
  {
    stage: 3, idx: 0,
    target: '#type-toggle',
    textKey: 'ob_s3_1',
    type: 'try',
    await: {
      type: 'mutation',
      selector: 'body',
      options: { attributes: true, attributeFilter: ['class'] },
      check: (muts, el) => el.classList.contains('zen-mode'),
    },
    side: 'bottom',
  },
  {
    stage: 3, idx: 1,
    target: '#type-toggle',
    textKey: 'ob_s3_2',
    type: 'try',
    await: {
      type: 'mutation',
      selector: 'body',
      options: { attributes: true, attributeFilter: ['class'] },
      check: (muts, el) => !el.classList.contains('zen-mode'),
    },
    side: 'bottom',
  },
  {
    stage: 3, idx: 2,
    target: '#editor-container',
    textKey: 'ob_s3_3',
    type: 'try',
    await: {
      type: 'mutation',
      selector: 'body',
      options: { attributes: true, attributeFilter: ['class'] },
      check: (muts, el) => el.classList.contains('is-focus-mode'),
    },
    side: 'top',
  },
  {
    stage: 3, idx: 3,
    target: null,
    textKey: 'ob_done_s3',
    type: 'done',
    side: 'bottom',
  },

  // ── Etap 4: Zaawansowany ───────────────────────────────────
  {
    stage: 4, idx: 0,
    target: '#tag-selector',
    textKey: 'ob_s4_1',
    type: 'show',
    side: 'top',
  },
  {
    stage: 4, idx: 1,
    target: '#filter-bar',
    textKey: 'ob_s4_2',
    type: 'show',
    side: 'bottom',
    revealHidden: '#filter-bar',
  },
  {
    stage: 4, idx: 2,
    target: '#panel-tab-shortcuts',
    textKey: 'ob_s4_3',
    type: 'show',
    side: 'top',
  },
  {
    stage: 4, idx: 3,
    target: '#storage-usage',
    textKey: 'ob_s4_4',
    type: 'show',
    side: 'top',
  },
  {
    stage: 4, idx: 4,
    target: null,
    textKey: 'ob_done_s4',
    type: 'done',
    side: 'bottom',
  },
];

/* ── Stałe ───────────────────────────────────────────────────── */

const STAGE_LABELS = {
  1: 'ob_stage1_label',
  2: 'ob_stage2_label',
  3: 'ob_stage3_label',
  4: 'ob_stage4_label',
};

/* ── Stan ────────────────────────────────────────────────────── */

let _overlay      = null;
let _tooltip      = null;
let _backdrop     = null;
let _currentStep  = null;   // indeks w STEPS
let _stagesDone   = {};     // { 1: bool, … }
let _cleanupAwait = null;   // fn do sprzątania aktywnego awaita
let _prevTarget   = null;   // poprzednio podświetlony element

/* ── Publiczne API ───────────────────────────────────────────── */

export function initOnboarding(uiSettings) {
  _stagesDone = uiSettings.onboardingStages ?? {};
  _buildOverlay();

  // Pierwsze uruchomienie — etap 1 auto-start po krótkim delay
  if (!_stagesDone[1]) {
    setTimeout(() => startStage(1), 600);
  }
}

export function startStage(stageNum) {
  const firstIdx = STEPS.findIndex(s => s.stage === stageNum);
  if (firstIdx === -1) return;
  // Zamknij panel jeśli otwarty
  const panelEl = document.getElementById('panel');
  if (panelEl && !panelEl.hidden) {
    document.getElementById('panel-btn')?.click();
  }
  setTimeout(() => _show(firstIdx), 150);
}

/* ── Budowanie overlay ───────────────────────────────────────── */

function _buildOverlay() {
  _overlay  = document.getElementById('onboarding-overlay');
  _backdrop = document.getElementById('onboarding-backdrop');
  _tooltip  = document.getElementById('onboarding-tooltip');
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

  // Resolve target
  const targetEl = typeof step.target === 'function'
    ? step.target()
    : document.querySelector(step.target);

  // Odkryj hidden element jeśli krok tego wymaga
  if (step.revealHidden) {
    const revealEl = document.querySelector(step.revealHidden);
    if (revealEl) revealEl.hidden = false;
  }

  // Podświetl
  _highlight(targetEl);

  // Fokus na element jeśli krok tego wymaga
  if (step.focusTarget && targetEl) {
    setTimeout(() => targetEl.focus(), 50);
  }

  // Tooltip — treść
  document.getElementById('onboarding-stage-label').textContent =
    t(STAGE_LABELS[step.stage]);
  document.getElementById('onboarding-progress').textContent =
    `${idxInStage + 1} / ${total}`;
  const useFallback = step.isFallback?.() && step.textKeyFallback;
  document.getElementById('onboarding-text').textContent =
    t(useFallback ? step.textKeyFallback : step.textKey);

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

function _advance(dir) {
  _cleanupAwait?.();
  _cleanupAwait = null;

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

function _listenFor({ type, selector, options, check }, onMatch) {
  if (type === 'click') {
    const handler = (e) => {
      if (e.target.closest(selector)) {
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
      : document.querySelector(selector);
    if (!target) return () => {};
    const obs = new MutationObserver((muts) => {
      if (check(muts, target)) {
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
    const n    = Number(btn.dataset.obStage);
    btn.classList.toggle('onboarding-stage-btn--done', !!_stagesDone[n]);
    const mark = btn.querySelector('.onboarding-stage-btn__check');
    if (mark) mark.hidden = !_stagesDone[n];
  });
}

export function initOnboardingPanel() {
  const container = document.getElementById('onboarding-panel-stages');
  if (!container) return;
  _refreshPanelButtons();
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ob-stage]');
    if (!btn) return;
    startStage(Number(btn.dataset.obStage));
  });
}
// @ts-check
/* ══════════════════════════════════════════════════════════════
   onboarding-stages.js — znaczniki ukończonych lekcji przewodnika
   ──────────────────────────────────────────────────────────────
   Czysta logika bez DOM i `browser` (testowalna w Node). Przenosi
   uiSettings.onboardingStages na bieżącą numerację lekcji.

   Historia numeracji:
     1 → 6 lekcji (przed wydzieleniem "Szybkiego dodawania")
     2 → 7 lekcji: Start, Formatowanie, Zadania i terminy, Szybkie
         dodawanie, Tryby skupienia, Porządek w notatkach, Dane i skróty
     3 → 4 lekcje (wydanie 1.1): Start, Szybkie dodawanie, Notatka,
         Porządek i dane

   Najważniejsza własność: kto ukończył lekcję 1, ma ją ukończoną także po
   migracji. Od tego znacznika (i od onboardingDismissed, którego ten moduł
   nie dotyka) zależy, czy przewodnik wystartuje sam — zmiana listy lekcji
   nie może pokazać go od nowa komuś, kto go już widział.
   ══════════════════════════════════════════════════════════════ */

export const STAGES_VERSION = 3;

/** Liczba lekcji w bieżącej numeracji */
export const STAGE_COUNT = 4;

/**
 * Zostawia tylko wpisy "numer lekcji → true/false". Klucze z JSON są tekstem;
 * nierozpoznany klucz odpada, zamiast wylądować pod NaN.
 * @param {unknown} stages
 * @returns {Record<number, boolean>}
 */
function _normalize(stages) {
  /** @type {Record<number, boolean>} */
  const out = {};
  if (!stages || typeof stages !== 'object') return out;
  for (const [key, done] of Object.entries(stages)) {
    const n = Number(key);
    if (Number.isInteger(n) && n >= 1) out[n] = done === true;
  }
  return out;
}

/**
 * v1 → v2: wydzielenie "Szybkiego dodawania" na lekcję 4 przesunęło dawne
 * lekcje 4–6 na 5–7.
 * @param {Record<number, boolean>} stages
 */
function _v1ToV2(stages) {
  /** @type {Record<number, boolean>} */
  const out = {};
  for (const [key, done] of Object.entries(stages)) {
    const n = Number(key);
    out[n >= 4 ? n + 1 : n] = done;
  }
  return out;
}

/**
 * v2 → v3: siedem lekcji złożone w cztery. Nowa lekcja jest ukończona tylko
 * wtedy, gdy ukończone były WSZYSTKIE dawne, których treść przejęła —
 * znacznik ma mówić, co użytkownik przeczytał.
 *   1 Start             ← 1 Start
 *   2 Szybkie dodawanie ← 4 Szybkie dodawanie
 *   3 Notatka           ← 2 Formatowanie
 *   4 Porządek i dane   ← 5 Tryby skupienia + 7 Dane i skróty
 * Dawne lekcje 3 (Zadania i terminy) i 6 (Porządek w notatkach) nie mają
 * następcy: ich treść była oczywista z interfejsu i wypadła.
 * @param {Record<number, boolean>} stages
 */
function _v2ToV3(stages) {
  return {
    1: stages[1] === true,
    2: stages[4] === true,
    3: stages[2] === true,
    4: stages[5] === true && stages[7] === true,
  };
}

/**
 * @param {unknown} stages uiSettings.onboardingStages
 * @param {unknown} version uiSettings.onboardingStagesVersion (brak = 1)
 * @returns {{ stages: Record<number, boolean>, changed: boolean }}
 *   `changed` = trzeba zapisać wynik razem z STAGES_VERSION
 */
export function migrateStages(stages, version) {
  let current = _normalize(stages);
  const from = typeof version === 'number' && Number.isInteger(version) ? version : 1;

  // Numeracja nowsza niż ta, którą znamy (powrót do starszej wersji dodatku):
  // nie zgadujemy i niczego nie nadpisujemy.
  if (from >= STAGES_VERSION) {
    /** @type {Record<number, boolean>} */
    const known = {};
    for (let n = 1; n <= STAGE_COUNT; n++) if (n in current) known[n] = current[n];
    return { stages: known, changed: false };
  }

  if (from < 2) current = _v1ToV2(current);
  current = _v2ToV3(current);
  return { stages: current, changed: true };
}

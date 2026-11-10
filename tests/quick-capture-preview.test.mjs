/**
 * quick-capture-preview.test.mjs — testy opisu podglądu quick capture
 *
 * Podgląd był dotąd bez testów (żył w app.js i popup.js, obu bez pokrycia)
 * i cicho gubił połowę parsera: `!!`, `!>` i cykliczność nie pojawiały się
 * w tekście, a `!!` bez daty pokazywał zadanie bez terminu, choć powstawało
 * zadanie na dziś. Kluczowy test to ten na dole — porównuje podgląd z tym,
 * co faktycznie buduje buildItemFromCapture.
 */

import { test, expect, results } from './_runner.mjs';
import { describeCapture, formatCaptureDay } from './quick-capture-preview.mjs';
import { buildItemFromCapture, wantsFocusSeed } from './quick-capture-core.mjs';

// ── Fake locale ───────────────────────────────────────────────────
// Odwzorowuje _locales/en/messages.json. Brak klucza rzuca — literówka
// w nazwie klucza w module wywala test, zamiast po cichu zwrócić klucz.

const MESSAGES = {
  common_today: 'today',
  common_tomorrow: 'tomorrow',
  common_yesterday: 'yesterday',
  quickCapture_preview_note_empty: 'Adding a note',
  quickCapture_preview_note_titled: 'Adding note: $1',
  quickCapture_preview_task_empty: 'Adding a task',
  quickCapture_preview_task_titled: 'Adding task: $1',
  quickCapture_preview_task_dated: 'Adding task $1',
  quickCapture_preview_task_dated_titled: 'Adding task $1: $2',
  quickCapture_preview_date_time: '$1 at $2',
  quickCapture_preview_flag_important: 'Important',
  quickCapture_preview_flag_inProgress: 'In progress',
  quickCapture_preview_flags: '$1 · $2',
  quickCapture_preview_tag_new: '#$1 (new tag)',
  quickCapture_preview_needTitle: 'Add a title',
  recurrence_daily: 'Daily',
  recurrence_weekly: 'Weekly',
  recurrence_monthly: 'Monthly',
  recurrence_yearly: 'Yearly',
};

function t(key, subs) {
  const msg = MESSAGES[key];
  if (msg === undefined) throw new Error(`brak klucza locale: ${key}`);
  const arr = subs === undefined ? [] : Array.isArray(subs) ? subs : [subs];
  return msg.replace(/\$(\d)/g, (_, i) => arr[Number(i) - 1] ?? '');
}

// parseCapture liczy "jutro" na prawdziwym new Date() — nie da się go
// zamrozić. Dla ścieżek z datą względną env.now musi być realnym teraz,
// inaczej podgląd i parser rozjeżdżają się o różnicę zegarów.
const EN = { t, locale: 'en-US' };
const PL = { t, locale: 'pl' };

const at = (y, m, d) => new Date(y, m - 1, d).getTime();

// ── formatCaptureDay ──────────────────────────────────────────────

console.log('\n1. formatCaptureDay');

const NOW = at(2026, 6, 10); // środa

test('dziś → common_today', () => {
  expect(formatCaptureDay(at(2026, 6, 10), { ...EN, now: NOW })).toBe('today');
});

test('jutro → common_tomorrow', () => {
  expect(formatCaptureDay(at(2026, 6, 11), { ...EN, now: NOW })).toBe('tomorrow');
});

test('wczoraj → common_yesterday (jawna data wsteczna jest osiągalna)', () => {
  expect(formatCaptureDay(at(2026, 6, 9), { ...EN, now: NOW })).toBe('yesterday');
});

test('poza zakresem ±1 dzień → data dzienna z Intl', () => {
  const out = formatCaptureDay(at(2026, 6, 15), { ...EN, now: NOW });
  expect(out).toContain('15');
  expect(out).toMatch(/jun/i);
});

test('etykieta liczona po granicy doby, nie po różnicy 24h', () => {
  // 23:59 dziś i 00:01 jutro dzieli 2 minuty, ale to różne dni
  const lateToday = at(2026, 6, 10) + 23 * 3600000 + 59 * 60000;
  const earlyTomorrow = at(2026, 6, 11) + 60000;
  expect(formatCaptureDay(lateToday, { ...EN, now: NOW })).toBe('today');
  expect(formatCaptureDay(earlyTomorrow, { ...EN, now: NOW })).toBe('tomorrow');
});

// ── Pusty input ───────────────────────────────────────────────────

console.log('\n2. Pusty input');

test('pusty string → null (caller chowa kontener)', () => {
  expect(describeCapture('', EN)).toBeNull();
});

test('same białe znaki → null', () => {
  expect(describeCapture('   \t ', EN)).toBeNull();
});

test('samo "!" → null nie jest zwracane; to zadanie bez tytułu', () => {
  const d = describeCapture('!', EN);
  expect(d.type).toBe('task');
  expect(d.text).toBe('Adding a task');
});

// ── Notatki ───────────────────────────────────────────────────────

console.log('\n3. Notatki');

test('zwykły tekst → notatka z tytułem', () => {
  const d = describeCapture('Kup mleko', EN);
  expect(d.type).toBe('note');
  expect(d.text).toBe('Adding note: Kup mleko');
});

test('notatka nie dostaje flag ani daty', () => {
  // "tomorrow" bez "!" zostaje częścią tytułu — parser dat nie rusza notatek
  const d = describeCapture('call mom tomorrow', EN);
  expect(d.type).toBe('note');
  expect(d.text).toBe('Adding note: call mom tomorrow');
});

// ── Zadania: data i godzina ───────────────────────────────────────

console.log('\n4. Zadania — data i godzina');

test('zadanie bez daty → sam tytuł', () => {
  const d = describeCapture('!check email', EN);
  expect(d.type).toBe('task');
  expect(d.text).toBe('Adding task: check email');
});

test('zadanie na jutro', () => {
  const d = describeCapture('!call mom tomorrow', { ...EN, now: Date.now() });
  expect(d.text).toBe('Adding task tomorrow: call mom');
});

test('zadanie z datą i godziną', () => {
  const d = describeCapture('!call mom tomorrow 15:00', { ...EN, now: Date.now() });
  expect(d.text).toBe('Adding task tomorrow at 15:00: call mom');
});

test('sama godzina → termin dziś', () => {
  const d = describeCapture('!standup 09:30', { ...EN, now: Date.now() });
  expect(d.text).toBe('Adding task today at 09:30: standup');
});

test('data bez tytułu → wariant "dated" bez dwukropka', () => {
  const d = describeCapture('!tomorrow', { ...EN, now: Date.now() });
  expect(d.text).toBe('Adding task tomorrow');
});

// ── Flagi: !! / !> / cykliczność ──────────────────────────────────

console.log('\n5. Flagi');

test('!! → flagi Important ORAZ In progress', () => {
  // `!!` zasiewa focusIds tak samo jak `!>` — podgląd musi to powiedzieć
  const d = describeCapture('!!Hotfix', { ...EN, now: Date.now() });
  expect(d.text).toBe('Adding task today: Hotfix · Important · In progress');
});

test('!> → flaga In progress, bez Important', () => {
  const d = describeCapture('!>Refactor parser', { ...EN, now: Date.now() });
  expect(d.text).toBe('Adding task today: Refactor parser · In progress');
});

test('!!> → to samo co !!, bo > nie dokłada już nic', () => {
  const now = Date.now();
  const a = describeCapture('!!Deadline', { ...EN, now });
  const b = describeCapture('!!>Deadline', { ...EN, now });
  expect(b.text).toBe(a.text);
  expect(b.text).toBe('Adding task today: Deadline · Important · In progress');
});

test('zwykłe zadanie nie dostaje żadnej z tych flag', () => {
  const d = describeCapture('!check email', EN);
  expect(d.text).toBe('Adding task: check email');
});

test('cykliczność trafia do flag, a bez daty dostaje termin dziś', () => {
  const d = describeCapture('!standup daily', EN);
  expect(d.text).toBe('Adding task today: standup · Daily');
});

test('nowy tag jest oznaczony, żeby literówka nie przeszła niezauważona', () => {
  const env = { ...EN, tags: [{ name: 'Work' }] };
  expect(describeCapture('idea #Wrok', env).text).toBe('Adding note: idea · #Wrok (new tag)');
});

test('istniejący tag bez oznaczenia, bez względu na wielkość liter', () => {
  const env = { ...EN, tags: [{ name: 'Work' }] };
  expect(describeCapture('idea #work', env).text).toBe('Adding note: idea · #work');
});

test('tag pasuje mimo myślnika zamiast spacji', () => {
  const env = { ...EN, tags: [{ name: 'Home office' }] };
  expect(describeCapture('idea #home-office', env).text).toBe('Adding note: idea · #home-office');
});

test('tagi idą za flagami zadania', () => {
  const env = { ...EN, tags: [{ name: 'home' }] };
  expect(describeCapture('!walk weekly #home', env).text).toBe(
    'Adding task today: walk · Weekly · #home',
  );
});

test('sam tag: podgląd prosi o tytuł, bo Enter nic nie doda', () => {
  expect(describeCapture('#work', EN).text).toBe('Add a title');
  expect(describeCapture('!#work', EN).text).toBe('Add a title');
  expect(describeCapture('!#work', EN).type).toBe('task');
});

test('bez listy tagów każdy wygląda na nowy', () => {
  expect(describeCapture('x #a', EN).text).toBe('Adding note: x · #a (new tag)');
});

test('każdy rodzaj cykliczności ma swoją etykietę', () => {
  expect(describeCapture('!x weekly', EN).text).toContain('Weekly');
  expect(describeCapture('!x monthly', EN).text).toContain('Monthly');
  expect(describeCapture('!x yearly', EN).text).toContain('Yearly');
});

test('bez flag nie doklejamy separatora', () => {
  expect(describeCapture('!check email', EN).text).toBe('Adding task: check email');
  expect(describeCapture('Kup mleko', EN).text).toBe('Adding note: Kup mleko');
});

test('flagi łączą się z datą i tytułem', () => {
  const d = describeCapture('!!>ship it tomorrow 08:00 daily', { ...EN, now: Date.now() });
  expect(d.text).toBe(
    'Adding task tomorrow at 08:00: ship it · Important · In progress · Daily',
  );
});

// ── Locale ────────────────────────────────────────────────────────

console.log('\n6. Locale');

test('locale idzie do parsera — PL rozpoznaje DD.MM', () => {
  const d = describeCapture('!spotkanie 15.06.2030', { ...PL, now: NOW });
  expect(d.text).toContain('15');
  expect(d.text).toContain('spotkanie');
  expect(d.text).toMatch(/cze/i);
});

test('ten sam input w EN nie jest datą — zostaje w tytule', () => {
  const d = describeCapture('!meeting 15.06.2030', { ...EN, now: NOW });
  expect(d.text).toBe('Adding task: meeting 15.06.2030');
});

test('EN rozpoznaje MM/DD', () => {
  const d = describeCapture('!package 06/15/2030', { ...EN, now: NOW });
  expect(d.text).toContain('15');
  expect(d.text).toContain('package');
});

// ── Zgodność z tym, co faktycznie powstaje ────────────────────────

console.log('\n7. Podgląd vs. zapisywany element');

// To jest powód istnienia tego pliku: podgląd i builder muszą mówić to samo.
// Regułę "!!/!> bez daty ⇒ dziś" trzyma jedna funkcja (captureDue), więc
// obie ścieżki nie mogą się rozjechać po cichu.

const sameDay = (a, b) => {
  const s = (ts) => {
    const d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  return s(a) === s(b);
};

test('!! bez daty: builder daje termin na dziś, podgląd też go pokazuje', () => {
  const item = buildItemFromCapture('!!Hotfix', 'en-US');
  expect(item.type).toBe('task');
  expect(item.important).toBe(true);
  expect(sameDay(item.due, Date.now())).toBeTruthy();
  expect(describeCapture('!!Hotfix', { ...EN, now: Date.now() }).text).toContain('today');
});

test('!> bez daty: to samo dla "w trakcie"', () => {
  const item = buildItemFromCapture('!>Refactor', 'en-US');
  expect(sameDay(item.due, Date.now())).toBeTruthy();
  expect(describeCapture('!>Refactor', { ...EN, now: Date.now() }).text).toContain('today');
});

test('zwykłe zadanie bez daty: builder nie zmyśla terminu, podgląd milczy', () => {
  const item = buildItemFromCapture('!check email', 'en-US');
  expect(item.due).toBeNull();
  expect(describeCapture('!check email', EN).text).toBe('Adding task: check email');
});

test('jawna data wygrywa nad regułą "!! ⇒ dziś" w obu ścieżkach', () => {
  const item = buildItemFromCapture('!!audit 06/15/2030', 'en-US');
  expect(sameDay(item.due, at(2030, 6, 15))).toBeTruthy();
  const d = describeCapture('!!audit 06/15/2030', { ...EN, now: NOW });
  expect(d.text).toContain('15');
  expect(d.text).toContain('Important');
});

test('flaga "w trakcie" w podglądzie = wantsFocusSeed na zbudowanym elemencie', () => {
  // Jedna reguła (wantsFocusSeed) po stronie zapisu, jedna po stronie
  // podglądu — ten test pilnuje, że mówią to samo dla każdego prefiksu.
  for (const raw of ['!zwykłe', '!!ważne', '!>wtrakcie', '!!>oba']) {
    const item = buildItemFromCapture(raw, 'en-US');
    const shown = describeCapture(raw, { ...EN, now: Date.now() }).text.includes(
      'In progress',
    );
    if (shown !== wantsFocusSeed(item)) {
      throw new Error(
        `"${raw}": podgląd ${shown ? 'pokazuje' : 'ukrywa'} "w trakcie", ` +
          `a zapis ${wantsFocusSeed(item) ? 'zasiewa' : 'nie zasiewa'} focusIds`,
      );
    }
  }
});

test('!! i !!> zapisują identyczny element', () => {
  const strip = (raw) => {
    const { id, created, ...rest } = buildItemFromCapture(raw, 'en-US');
    return rest;
  };
  expect(strip('!!>oba')).toEqual({ ...strip('!!oba'), focus: true });
});

test('tytuł w podglądzie jest tym samym tytułem, który zapisze builder', () => {
  const raw = '!!>ship it tomorrow 08:00 daily';
  const item = buildItemFromCapture(raw, 'en-US');
  expect(item.title).toBe('ship it');
  expect(describeCapture(raw, { ...EN, now: Date.now() }).text).toContain('ship it');
  expect(item.recurrence).toBe('daily');
  expect(item.time).toBe('08:00');
});

await results();

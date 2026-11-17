import { test, expect, results } from './_runner.mjs';
import { parseCapture } from './parser.mjs';

const PL = 'pl';
const EN = 'en-US';

function daysFromToday(ts) {
  if (ts === null || ts === undefined) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.round((ts - today.getTime()) / 86400000);
}
function isDate(ts, day, month, year) {
  if (!ts) return false;
  const d = new Date(ts);
  return d.getFullYear()===year && d.getMonth()===month-1 && d.getDate()===day;
}
function nextWeekday(targetDay) {
  const diff = (targetDay - new Date().getDay() + 7) % 7;
  return diff === 0 ? 7 : diff;
}
/** Rok, w którym data bez roku wypada najbliżej: minęła → przyszły rok. */
function upcomingYear(day, month) {
  const today = new Date(); today.setHours(0,0,0,0);
  const y = today.getFullYear();
  return new Date(y, month-1, day) < today ? y+1 : y;
}
function isUpcoming(ts, day, month) {
  return isDate(ts, day, month, upcomingYear(day, month));
}

// ── 1. Notatka vs zadanie ─────────────────────────────────────────
console.log('\n1. Notatka vs zadanie');
test('pusta linia → notatka', () => { const r=parseCapture('',PL); expect(r.isTask).toBe(false); expect(r.title).toBe(''); expect(r.due).toBeNull(); });
test('bez ! → notatka', () => { const r=parseCapture('memo',PL); expect(r.isTask).toBe(false); expect(r.title).toBe('memo'); });
test('! → zadanie', () => { const r=parseCapture('!standup',PL); expect(r.isTask).toBe(true); expect(r.title).toBe('standup'); });
test('! + spacja → trim tytułu', () => { const r=parseCapture('! raport',PL); expect(r.isTask).toBe(true); expect(r.title).toBe('raport'); });
test('notatka z "jutro" → data ignorowana', () => { const r=parseCapture('spotkanie jutro',PL); expect(r.isTask).toBe(false); expect(r.due).toBeNull(); });

// ── 2. Czas ───────────────────────────────────────────────────────
console.log('\n2. Czas');
test('9:00 → 09:00', () => { expect(parseCapture('!x 9:00',PL).time).toBe('09:00'); });
test('14:30 → 14:30', () => { expect(parseCapture('!x 14:30',PL).time).toBe('14:30'); });
test('0:00 → 00:00', () => { expect(parseCapture('!x 0:00',PL).time).toBe('00:00'); });
test('23:59 → 23:59', () => { expect(parseCapture('!x 23:59',PL).time).toBe('23:59'); });
test('25:00 → null, w tytule', () => { const r=parseCapture('!x 25:00',PL); expect(r.time).toBeNull(); expect(r.title).toContain('25:00'); });
test('12:99 → null, w tytule', () => { const r=parseCapture('!x 12:99',PL); expect(r.time).toBeNull(); expect(r.title).toContain('12:99'); });
test('czas bez daty → due=dziś', () => { const r=parseCapture('!standup 9:00',PL); expect(daysFromToday(r.due)).toBe(0); });
test('czas środkowy → pojedyncza spacja w tytule', () => { expect(parseCapture('!standup 9:00 z teamem',PL).title).toBe('standup z teamem'); });

// ── 3. PL słowa kluczowe ──────────────────────────────────────────
console.log('\n3. PL słowa kluczowe');
test('jutro → +1 dzień', () => { const r=parseCapture('!spotkanie jutro',PL); expect(daysFromToday(r.due)).toBe(1); expect(r.title).toBe('spotkanie'); });
test('dziś → due=dziś', () => { const r=parseCapture('!raport dziś',PL); expect(daysFromToday(r.due)).toBe(0); expect(r.title).toBe('raport'); });
test('dzisiaj → due=dziś', () => { expect(daysFromToday(parseCapture('!x dzisiaj',PL).due)).toBe(0); });
test('JUTRO → działa case-insensitive', () => { expect(daysFromToday(parseCapture('!x JUTRO',PL).due)).toBe(1); });
test('jutro + czas → +1 dzień + time', () => { const r=parseCapture('!standup jutro 9:00',PL); expect(daysFromToday(r.due)).toBe(1); expect(r.time).toBe('09:00'); });
test('jutro środkowy → pojedyncza spacja', () => { expect(parseCapture('!raport jutro wieczorem',PL).title).toBe('raport wieczorem'); });

// ── 4. EN słowa kluczowe ──────────────────────────────────────────
console.log('\n4. EN słowa kluczowe');
test('tomorrow → +1 dzień', () => { const r=parseCapture('!standup tomorrow',EN); expect(daysFromToday(r.due)).toBe(1); expect(r.title).toBe('standup'); });
test('today → dziś', () => { expect(daysFromToday(parseCapture('!x today',EN).due)).toBe(0); });
test('TOMORROW → case-insensitive', () => { expect(daysFromToday(parseCapture('!x TOMORROW',EN).due)).toBe(1); });
test('tomorrow + czas', () => { const r=parseCapture('!x tomorrow 9:00',EN); expect(daysFromToday(r.due)).toBe(1); expect(r.time).toBe('09:00'); });

// ── 5. PL dni tygodnia ────────────────────────────────────────────
console.log('\n5. PL dni tygodnia');
const PL_WD = [{n:'niedziela',d:0},{n:'poniedziałek',d:1},{n:'wtorek',d:2},{n:'środa',d:3},{n:'czwartek',d:4},{n:'piątek',d:5},{n:'sobota',d:6}];
for (const {n,d} of PL_WD) {
  test(`${n} → następny`, () => { const r=parseCapture(`!x ${n}`,PL); expect(daysFromToday(r.due)).toBe(nextWeekday(d)); expect(r.title).toBe('x'); });
}
test('ten sam dzień → za 7 dni', () => { const n=PL_WD.find(w=>w.d===new Date().getDay()).n; expect(daysFromToday(parseCapture(`!x ${n}`,PL).due)).toBe(7); });
test('sroda (bez ś) → działa', () => { expect(daysFromToday(parseCapture('!x sroda',PL).due)).toBe(nextWeekday(3)); });

// ── 6. EN dni tygodnia ────────────────────────────────────────────
console.log('\n6. EN dni tygodnia');
const EN_WD = [{n:'sunday',d:0},{n:'monday',d:1},{n:'tuesday',d:2},{n:'wednesday',d:3},{n:'thursday',d:4},{n:'friday',d:5},{n:'saturday',d:6}];
for (const {n,d} of EN_WD) {
  test(`${n} → następny`, () => { expect(daysFromToday(parseCapture(`!x ${n}`,EN).due)).toBe(nextWeekday(d)); });
}

// ── 7. PL daty DD.MM ─────────────────────────────────────────────
console.log('\n7. PL daty DD.MM');
test('1.6 → 1 czerwca', () => { expect(isUpcoming(parseCapture('!x 1.6',PL).due,1,6)).toBe(true); });
test('15.08 → 15 sierpnia', () => { expect(isUpcoming(parseCapture('!x 15.08',PL).due,15,8)).toBe(true); });
test('31.12.2026', () => { expect(isDate(parseCapture('!x 31.12.2026',PL).due,31,12,2026)).toBe(true); });
test('30.02 overflow → null', () => { const r=parseCapture('!x 30.02',PL); expect(r.due).toBeNull(); expect(r.title).toContain('30.02'); });
test('31.11 overflow → null', () => { expect(parseCapture('!x 31.11',PL).due).toBeNull(); });
test('29.02.2028 rok przestępny → ok', () => { expect(isDate(parseCapture('!x 29.02.2028',PL).due,29,2,2028)).toBe(true); });
test('29.02.2027 nieprzestępny → null', () => { expect(parseCapture('!x 29.02.2027',PL).due).toBeNull(); });
test('data środkowa → pojedyncza spacja', () => { expect(parseCapture('!raport 15.08 do szefa',PL).title).toBe('raport do szefa'); });

// ── 8. EN daty MM/DD ─────────────────────────────────────────────
console.log('\n8. EN daty MM/DD');
test('6/1 → 1 czerwca (month-first)', () => { expect(isUpcoming(parseCapture('!x 6/1',EN).due,1,6)).toBe(true); });
test('12/31/2026', () => { expect(isDate(parseCapture('!x 12/31/2026',EN).due,31,12,2026)).toBe(true); });
test('2/30 overflow → null', () => { expect(parseCapture('!x 2/30',EN).due).toBeNull(); });
test('EN nie parsuje DD.MM', () => { const r=parseCapture('!x 15.08',EN); expect(r.due).toBeNull(); expect(r.title).toContain('15.08'); });
test('PL nie parsuje MM/DD', () => { const r=parseCapture('!x 6/15',PL); expect(r.due).toBeNull(); expect(r.title).toContain('6/15'); });

// ── 9. Priorytety ─────────────────────────────────────────────────
console.log('\n9. Priorytety');
test('jutro > data numeryczna', () => { const r=parseCapture('!x jutro 15.06',PL); expect(daysFromToday(r.due)).toBe(1); expect(r.title).toContain('15.06'); });
test('dziś > data numeryczna', () => { const r=parseCapture('!x dziś 20.08',PL); expect(daysFromToday(r.due)).toBe(0); expect(r.title).toContain('20.08'); });
test('weekday > data numeryczna', () => { const r=parseCapture('!x wtorek 15.06',PL); expect(daysFromToday(r.due)).toBe(nextWeekday(2)); expect(r.title).toContain('15.06'); });
test('tomorrow > date EN', () => { const r=parseCapture('!x tomorrow 6/15',EN); expect(daysFromToday(r.due)).toBe(1); expect(r.title).toContain('6/15'); });

// ── 10. Kombinacje ────────────────────────────────────────────────
console.log('\n10. Kombinacje');
test('jutro 9:00 → +1 dzień + time + czysty tytuł', () => { const r=parseCapture('!standup jutro 9:00',PL); expect(daysFromToday(r.due)).toBe(1); expect(r.time).toBe('09:00'); expect(r.title).toBe('standup'); });
test('15.08 14:30 → data + czas', () => { const r=parseCapture('!deploy 15.08 14:30',PL); expect(r.time).toBe('14:30'); expect(isUpcoming(r.due,15,8)).toBe(true); expect(r.title).toBe('deploy'); });
test('środa 10:00 → weekday + czas', () => { const r=parseCapture('!sprint środa 10:00',PL); expect(daysFromToday(r.due)).toBe(nextWeekday(3)); expect(r.time).toBe('10:00'); expect(r.title).toBe('sprint'); });
test('tytuł+jutro+czas → czysty tytuł', () => { const r=parseCapture('!napisz raport jutro 9:00 dla szefa',PL); expect(r.title).toBe('napisz raport dla szefa'); expect(r.time).toBe('09:00'); expect(daysFromToday(r.due)).toBe(1); });

// ── 11. Locale ────────────────────────────────────────────────────
console.log('\n11. Locale');
test('en → month-first', () => { expect(isUpcoming(parseCapture('!x 6/1','en').due,1,6)).toBe(true); });
test('en-US → month-first', () => { expect(isUpcoming(parseCapture('!x 6/1','en-US').due,1,6)).toBe(true); });
test('pl → day-first', () => { expect(isUpcoming(parseCapture('!x 15.06','pl').due,15,6)).toBe(true); });
test('en-GB → angielskie słowa, DD/MM', () => { expect(daysFromToday(parseCapture('!x tomorrow','en-GB').due)).toBe(1); expect(isUpcoming(parseCapture('!x 6/1','en-GB').due,6,1)).toBe(true); });
test('en-GB: zapis US 06/15 też przejdzie (jako DD/MM nie istnieje)', () => { expect(isUpcoming(parseCapture('!x 06/15','en-GB').due,15,6)).toBe(true); });
test('inny język (de) → angielskie słowa, nie polskie', () => { expect(daysFromToday(parseCapture('!x tomorrow','de').due)).toBe(1); expect(parseCapture('!x jutro','de').due).toBeNull(); expect(isUpcoming(parseCapture('!x 15.06','de').due,15,6)).toBe(true); });

// ── 12. Cykliczność ───────────────────────────────────────────────
console.log('\n12. Cykliczność');
test('codziennie PL → recurrence=daily', () => { expect(parseCapture('!x codziennie',PL).recurrence).toBe('daily'); });
test('co tydzień PL → recurrence=weekly', () => { expect(parseCapture('!x co tydzień',PL).recurrence).toBe('weekly'); });
test('co miesiąc PL → recurrence=monthly', () => { expect(parseCapture('!x co miesiąc',PL).recurrence).toBe('monthly'); });
test('co rok PL → recurrence=yearly', () => { expect(parseCapture('!x co rok',PL).recurrence).toBe('yearly'); });
test('daily EN → recurrence=daily', () => { expect(parseCapture('!x daily',EN).recurrence).toBe('daily'); });
test('weekly EN → recurrence=weekly', () => { expect(parseCapture('!x weekly',EN).recurrence).toBe('weekly'); });
test('recurrence usunięty z tytułu', () => { expect(parseCapture('!standup codziennie jutro',PL).title).toBe('standup'); });
test('brak słowa → recurrence=null', () => { expect(parseCapture('!x jutro',PL).recurrence).toBeNull(); });

// ── 13. Flagi isUrgent / isInProgress ────────────────────────────
console.log('\n13. Flagi isUrgent / isInProgress');
test('!! → isUrgent=true', () => { const r=parseCapture('!!pilne',PL); expect(r.isUrgent).toBe(true); expect(r.isInProgress).toBe(false); });
test('!> → isInProgress=true', () => { const r=parseCapture('!>bieżące',PL); expect(r.isInProgress).toBe(true); expect(r.isUrgent).toBe(false); });
test('!!> → oba true', () => { const r=parseCapture('!!>krytyczne',PL); expect(r.isUrgent).toBe(true); expect(r.isInProgress).toBe(true); });
test('! → oba false', () => { const r=parseCapture('!zwykłe',PL); expect(r.isUrgent).toBe(false); expect(r.isInProgress).toBe(false); });

// ── 14. Edge cases ────────────────────────────────────────────────
console.log('\n14. Edge cases');
test('tylko ! → puste zadanie', () => { const r=parseCapture('!',PL); expect(r.isTask).toBe(true); expect(r.title).toBe(''); });
test('#ID nie matchuje jako data', () => { const r=parseCapture('!ticket #1234',PL); expect(r.due).toBeNull(); expect(r.title).toBe('ticket #1234'); });
test('same whitespace → pusta notatka', () => { const r=parseCapture('   ',PL); expect(r.isTask).toBe(false); expect(r.title).toBe(''); });
test('! w środku → notatka', () => { expect(parseCapture('ważne! memo',PL).isTask).toBe(false); });
test('! na początku + ! w tytule', () => { const r=parseCapture('!ważne! zadanie',PL); expect(r.isTask).toBe(true); expect(r.title).toBe('ważne! zadanie'); });
test('null → zwraca pusty wynik (guard)', () => { const r=parseCapture(null,PL); expect(r.isTask).toBe(false); expect(r.title).toBe(''); expect(r.due).toBeNull(); });

// ── 15. Słowa wokół terminu ───────────────────────────────────────
console.log('\n15. Słowa wokół terminu');
test('"we wtorek" znika w całości', () => { const r=parseCapture('!raport we wtorek',PL); expect(r.title).toBe('raport'); expect(daysFromToday(r.due)).toBe(nextWeekday(2)); });
test('"na poniedziałek" i "o 10:30" nie zostawiają resztek', () => { const r=parseCapture('!spotkanie na poniedziałek z zespołem o 10:30',PL); expect(r.title).toBe('spotkanie z zespołem'); expect(r.time).toBe('10:30'); expect(daysFromToday(r.due)).toBe(nextWeekday(1)); });
test('"o godz. 9:00"', () => { const r=parseCapture('!lekarz jutro o godz. 9:00',PL); expect(r.title).toBe('lekarz'); expect(r.time).toBe('09:00'); });
test('"na jutro", "do jutra", "na dziś"', () => { expect(parseCapture('!x na jutro',PL).title).toBe('x'); expect(daysFromToday(parseCapture('!x do jutra',PL).due)).toBe(1); expect(parseCapture('!x na dziś',PL).title).toBe('x'); });
test('"na 15.08" i "o" w środku tytułu', () => { const r=parseCapture('!mapa na 15.08 o górach',PL); expect(r.title).toBe('mapa o górach'); expect(isUpcoming(r.due,15,8)).toBe(true); });
test('EN "on friday", "next friday", "at 9:00"', () => { const a=parseCapture('!tickets on friday at 9:00',EN); expect(a.title).toBe('tickets'); expect(a.time).toBe('09:00'); expect(parseCapture('!x next friday',EN).title).toBe('x'); expect(daysFromToday(parseCapture('!x next friday',EN).due)).toBe(nextWeekday(5)); });
test('słowa w środku innych słów nie są terminem', () => { expect(parseCapture('!wtorkowe spotkanie',PL).due).toBeNull(); expect(parseCapture('!poniedziałkowy raport',PL).due).toBeNull(); });

// ── 16. Odmiana dni i nowe terminy ────────────────────────────────
console.log('\n16. Odmiana dni i nowe terminy');
for (const [text, day] of [['w środę',3],['w srode',3],['do środy',3],['w sobotę',6],['do soboty',6],['w niedzielę',0],['do niedzieli',0],['od wtorku',2],['od kolejnego wtorku',2],['w następny piątek',5],['w przyszły czwartek',4],['do poniedziałku',1]]) {
  test(`"${text}" → dzień ${day}, czysty tytuł`, () => { const r=parseCapture(`!x ${text}`,PL); expect(daysFromToday(r.due)).toBe(nextWeekday(day)); expect(r.title).toBe('x'); });
}
test('pojutrze → +2, nie jutro', () => { const r=parseCapture('!x pojutrze',PL); expect(daysFromToday(r.due)).toBe(2); expect(r.title).toBe('x'); });
test('day after tomorrow → +2', () => { const r=parseCapture('!x the day after tomorrow',EN); expect(daysFromToday(r.due)).toBe(2); expect(r.title).toBe('x'); });
test('za tydzień → +7, nie cykl', () => { const r=parseCapture('!x za tydzień',PL); expect(daysFromToday(r.due)).toBe(7); expect(r.recurrence).toBeNull(); expect(r.title).toBe('x'); });
test('za 3 dni / in 3 days', () => { expect(daysFromToday(parseCapture('!x za 3 dni',PL).due)).toBe(3); expect(daysFromToday(parseCapture('!x in 3 days',EN).due)).toBe(3); });

// ── 17. Cykliczność z terminem ────────────────────────────────────
console.log('\n17. Cykliczność z terminem');
test('cykl bez daty dostaje termin dziś (inaczej by się nie powtarzał)', () => { const r=parseCapture('!raport co tydzień',PL); expect(r.recurrence).toBe('weekly'); expect(daysFromToday(r.due)).toBe(0); });
test('EN: cykl bez daty też', () => { expect(daysFromToday(parseCapture('!x daily',EN).due)).toBe(0); });
test('cykl z datą zachowuje datę', () => { const r=parseCapture('!x co tydzień jutro',PL); expect(daysFromToday(r.due)).toBe(1); expect(r.recurrence).toBe('weekly'); });
test('co tydzień od wtorku', () => { const r=parseCapture('!joga co tydzień od wtorku',PL); expect(r.recurrence).toBe('weekly'); expect(daysFromToday(r.due)).toBe(nextWeekday(2)); expect(r.title).toBe('joga'); });
for (const text of ['co wtorek','w każdy wtorek','każdy wtorek','we wtorki']) {
  test(`"${text}" → cykl tygodniowy od wtorku`, () => { const r=parseCapture(`!joga ${text}`,PL); expect(r.recurrence).toBe('weekly'); expect(daysFromToday(r.due)).toBe(nextWeekday(2)); expect(r.title).toBe('joga'); });
}
test('w każdą środę', () => { const r=parseCapture('!joga w każdą środę',PL); expect(r.recurrence).toBe('weekly'); expect(daysFromToday(r.due)).toBe(nextWeekday(3)); });
test('EN every tuesday / on tuesdays / every week', () => { expect(parseCapture('!x every tuesday',EN).recurrence).toBe('weekly'); expect(parseCapture('!x on tuesdays',EN).title).toBe('x'); expect(parseCapture('!x every week',EN).recurrence).toBe('weekly'); });

// ── 18. Daty, które nie są datami ─────────────────────────────────
console.log('\n18. Daty, które nie są datami');
test('wersja 1.10 zostaje w tytule', () => { const r=parseCapture('!sprawdź wersję 1.10 narzędzia',PL); expect(r.due).toBeNull(); expect(r.title).toBe('sprawdź wersję 1.10 narzędzia'); });
test('v1.10, 1.10.3 i 192.168.1.1 to nie daty', () => { expect(parseCapture('!x v1.10',PL).due).toBeNull(); expect(parseCapture('!x 1.10.3',PL).due).toBeNull(); expect(parseCapture('!x 192.168.1.1',PL).due).toBeNull(); });
test('zwykła data dalej działa', () => { expect(isUpcoming(parseCapture('!x 1.10',PL).due,1,10)).toBe(true); });

// ── 19. Cudzysłów ─────────────────────────────────────────────────
console.log('\n19. Cudzysłów');
test('sam cudzysłów → dosłowny tytuł bez znaków', () => { const r=parseCapture('!"sprawdź jutro 1.10 o 10:00"',PL); expect(r.title).toBe('sprawdź jutro 1.10 o 10:00'); expect(r.due).toBeNull(); expect(r.time).toBeNull(); });
test('polski cudzysłów', () => { const r=parseCapture('!„spotkanie w piątek” jutro',PL); expect(r.title).toBe('spotkanie w piątek'); expect(daysFromToday(r.due)).toBe(1); });
test('cudzysłów w środku zostaje częścią tytułu', () => { const r=parseCapture('!Przeczytać "Lalkę" jutro',PL); expect(r.title).toBe('Przeczytać "Lalkę"'); expect(daysFromToday(r.due)).toBe(1); });
test('tag w cudzysłowie to nie tag', () => { const r=parseCapture('!"sprzedaż #praca"',PL); expect(r.tagNames).toEqual([]); expect(r.title).toBe('sprzedaż #praca'); });
test('notatka zachowuje cudzysłów', () => { const r=parseCapture('"Cytat dnia" #myśli',PL); expect(r.title).toBe('"Cytat dnia"'); expect(r.tagNames).toEqual(['myśli']); });
test('niedomknięty cudzysłów nie chroni', () => { const r=parseCapture('!"coś jutro',PL); expect(daysFromToday(r.due)).toBe(1); });

// ── 20. Tagi ──────────────────────────────────────────────────────
console.log('\n20. Tagi');
test('tag w notatce', () => { const r=parseCapture('pomysł na prezent #Wellbefi',PL); expect(r.isTask).toBe(false); expect(r.title).toBe('pomysł na prezent'); expect(r.tagNames).toEqual(['Wellbefi']); });
test('tag w zadaniu, też w środku', () => { const r=parseCapture('!spacer #dom jutro',PL); expect(r.title).toBe('spacer'); expect(r.tagNames).toEqual(['dom']); expect(daysFromToday(r.due)).toBe(1); });
test('kilka tagów, polskie znaki, myślnik', () => { expect(parseCapture('!x #Łódź #praca-dom #a_b',PL).tagNames).toEqual(['Łódź','praca-dom','a_b']); });
test('duplikaty bez względu na wielkość liter', () => { expect(parseCapture('x #Dom #dom #DOM',PL).tagNames).toEqual(['Dom']); });
test('interpunkcja po tagu nie zostaje w tytule', () => { const r=parseCapture('x #a, #b.',PL); expect(r.title).toBe('x'); expect(r.tagNames).toEqual(['a','b']); });
test('#jutro to tag, a nie termin', () => { const r=parseCapture('!plan #jutro',PL); expect(r.due).toBeNull(); expect(r.title).toBe('plan'); expect(r.tagNames).toEqual(['jutro']); });
test('numer zgłoszenia, URL, C# i kolor zostają w tytule', () => { const text='!fix #12 https://x.pl/a#sekcja C# #1a2b3c'; const r=parseCapture(text,PL); expect(r.tagNames).toEqual([]); expect(r.title).toBe(text.slice(1)); });
test('samo # zostaje', () => { expect(parseCapture('x # y',PL).title).toBe('x # y'); });
test('za długa nazwa zostaje w tytule', () => { const long='#'+'a'.repeat(51); const r=parseCapture(`x ${long}`,PL); expect(r.tagNames).toEqual([]); expect(r.title).toContain(long); });
test('notatka bez tagów zachowuje odstępy w tytule', () => { expect(parseCapture('a  b',PL).title).toBe('a  b'); });
test('sam tag nie daje tytułu', () => { const r=parseCapture('#praca',PL); expect(r.title).toBe(''); expect(r.tagNames).toEqual(['praca']); });
test('każda ścieżka zwraca tagNames', () => { expect(parseCapture(null,PL).tagNames).toEqual([]); expect(parseCapture('x',PL).tagNames).toEqual([]); expect(parseCapture('!x',PL).tagNames).toEqual([]); });

// ── 21. Przykład z pomysłu na tagi ────────────────────────────────
console.log('\n21. Pełny przykład');
test('co tydzień + od kolejnego wtorku + cytat + tag', () => {
  const r=parseCapture('!co tydzień od kolejnego wtorku "Task na analityke dodawanie nowych placówek oświatowych" #Wellbefi',PL);
  expect(r.isTask).toBe(true);
  expect(r.title).toBe('Task na analityke dodawanie nowych placówek oświatowych');
  expect(r.recurrence).toBe('weekly');
  expect(daysFromToday(r.due)).toBe(nextWeekday(2));
  expect(r.tagNames).toEqual(['Wellbefi']);
});

// ── 22. Daty bez roku ─────────────────────────────────────────────
console.log('\n22. Daty bez roku');
function dayOffset(offset) { const d=new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()+offset); return d; }
const dm = (d) => `${d.getDate()}.${d.getMonth()+1}`;
test('wczorajsza data bez roku → przyszły rok', () => { const d=dayOffset(-1); const r=parseCapture(`!x ${dm(d)}`,PL); expect(new Date(r.due).getFullYear()).toBe(d.getFullYear()+1); expect(r.title).toBe('x'); });
test('dzisiejsza data bez roku zostaje dziś', () => { expect(daysFromToday(parseCapture(`!x ${dm(dayOffset(0))}`,PL).due)).toBe(0); });
test('jutrzejsza data bez roku zostaje w tym terminie', () => { expect(daysFromToday(parseCapture(`!x ${dm(dayOffset(1))}`,PL).due)).toBe(1); });
test('jawny rok w przeszłości jest brany dosłownie', () => { expect(isDate(parseCapture('!x 15.06.2020',PL).due,15,6,2020)).toBe(true); });
test('EN: minione MM/DD → przyszły rok', () => { const d=dayOffset(-1); const r=parseCapture(`!x ${d.getMonth()+1}/${d.getDate()}`,EN); expect(new Date(r.due).getFullYear()).toBe(d.getFullYear()+1); });
test('termin nigdy nie wypada w przeszłości bez jawnego roku', () => { for (let m=1;m<=12;m++) { const r=parseCapture(`!x 15.${m}`,PL); if (daysFromToday(r.due)<0) throw new Error(`15.${m} w przeszłości`); } });


// ── 23. Godzina bez minut i inne zapisy godziny ───────────────────
console.log('\n23. Godzina: o 18, o 10.30, 9am');
test('"o 18" na końcu → 18:00', () => { const r=parseCapture('!kawa ze znajomą o 18',PL); expect(r.time).toBe('18:00'); expect(r.title).toBe('kawa ze znajomą'); });
test('"o 18 jutro" i "jutro o 18" → to samo', () => { for (const s of ['!kino o 18 jutro','!kino jutro o 18']) { const r=parseCapture(s,PL); expect(r.time).toBe('18:00'); expect(daysFromToday(r.due)).toBe(1); expect(r.title).toBe('kino'); } });
test('"o 5" w środku zdania to nie godzina', () => { const r=parseCapture('!pomyśl o 5 pomysłach',PL); expect(r.time).toBeNull(); expect(r.title).toBe('pomyśl o 5 pomysłach'); });
test('"o 18 z Kasią" zostaje (za mało pewne)', () => { expect(parseCapture('!kawa o 18 z Kasią',PL).time).toBeNull(); });
test('"o 10.30" → godzina, nie 10 października', () => { const r=parseCapture('!fryzjer o 10.30',PL); expect(r.time).toBe('10:30'); expect(r.dateGiven).toBe(false); expect(r.title).toBe('fryzjer'); });
test('"do 10.05" zostaje datą', () => { const r=parseCapture('!x do 10.05',PL); expect(r.time).toBeNull(); expect(isUpcoming(r.due,10,5)).toBe(true); });
test('"o godzinie 9", "godz. 9"', () => { expect(parseCapture('!x o godzinie 9',PL).time).toBe('09:00'); expect(parseCapture('!x godz. 9',PL).time).toBe('09:00'); });
test('EN 9am, 5 pm, 5:30pm, 12am', () => { expect(parseCapture('!x 9am',EN).time).toBe('09:00'); expect(parseCapture('!x 5 pm',EN).time).toBe('17:00'); expect(parseCapture('!x at 5:30pm',EN).title).toBe('x'); expect(parseCapture('!x 5:30pm',EN).time).toBe('17:30'); expect(parseCapture('!x 12am',EN).time).toBe('00:00'); });
test('EN "at 7" na końcu, "tonight"', () => { expect(parseCapture('!dinner tonight at 7',EN).time).toBe('07:00'); expect(daysFromToday(parseCapture('!dinner tonight',EN).due)).toBe(0); });

// ── 24. Nazwy miesięcy ────────────────────────────────────────────
console.log('\n24. Nazwy miesięcy');
test('"15 sierpnia"', () => { const r=parseCapture('!koncert 15 sierpnia',PL); expect(isUpcoming(r.due,15,8)).toBe(true); expect(r.title).toBe('koncert'); });
test('"1 maja 2030 r."', () => { const r=parseCapture('!piknik 1 maja 2030 r.',PL); expect(isDate(r.due,1,5,2030)).toBe(true); expect(r.title).toBe('piknik'); });
test('"3 pazdziernika" bez polskich znaków', () => { expect(isUpcoming(parseCapture('!x 3 pazdziernika',PL).due,3,10)).toBe(true); });
test('EN "Aug 15", "15th of August", "on 15 Aug 2030"', () => { expect(isUpcoming(parseCapture('!x Aug 15',EN).due,15,8)).toBe(true); expect(isUpcoming(parseCapture('!x 15th of August',EN).due,15,8)).toBe(true); expect(isDate(parseCapture('!x on 15 Aug 2030',EN).due,15,8,2030)).toBe(true); });
test('"I may 2 go" to nie maj', () => { expect(parseCapture('!I may 2 go',EN).due).toBeNull(); });
test('"May 2" z wielkiej litery to maj', () => { expect(isUpcoming(parseCapture('!x May 2',EN).due,2,5)).toBe(true); });

// ── 25. Odstępy: tygodnie, miesiące, przyszły tydzień ─────────────
console.log('\n25. Odstępy');
test('za 2 tygodnie / za dwa tygodnie → +14', () => { expect(daysFromToday(parseCapture('!x za 2 tygodnie',PL).due)).toBe(14); expect(daysFromToday(parseCapture('!x za dwa tygodnie',PL).due)).toBe(14); });
test('za pięć dni / in two weeks', () => { expect(daysFromToday(parseCapture('!x za pięć dni',PL).due)).toBe(5); expect(daysFromToday(parseCapture('!x in two weeks',EN).due)).toBe(14); });
test('za miesiąc → ten sam dzień za miesiąc (lub koniec miesiąca)', () => { const r=parseCapture('!x za miesiąc',PL); const d=new Date(r.due); const t=new Date(); expect((d.getMonth()-t.getMonth()+12)%12).toBe(1); expect(d.getDate()<=t.getDate()).toBe(true); expect(r.title).toBe('x'); });
test('w przyszłym tygodniu / next week → najbliższy poniedziałek', () => { expect(daysFromToday(parseCapture('!x w przyszłym tygodniu',PL).due)).toBe(nextWeekday(1)); expect(daysFromToday(parseCapture('!x next week',EN).due)).toBe(nextWeekday(1)); });

// ── 26. Co parser zrozumiał, a czego nie ──────────────────────────
console.log('\n26. tokens / rejected / dateGiven');
test('tokens: rozpoznane fragmenty w formie wpisanej', () => { const r=parseCapture('!kino jutro o 18 #wolne',PL); expect(r.tokens.map(t=>t.text)).toEqual(['#wolne','jutro','o 18']); expect(r.tokens.map(t=>t.kind)).toEqual(['tag','date','time']); });
test('rejected: 25:00 i 30.02 zostają w tytule z powodem', () => { const r=parseCapture('!x 25:00 30.02',PL); expect(r.rejected).toEqual(['25:00','30.02']); expect(r.title).toBe('x 25:00 30.02'); });
test('rejected: "31 lutego", "13pm"', () => { expect(parseCapture('!x 31 lutego',PL).rejected).toEqual(['31 lutego']); expect(parseCapture('!x 13pm',EN).rejected).toEqual(['13pm']); });
test('kwota to nie data ani próba daty', () => { const r=parseCapture('!chleb 3.50 zł',PL); expect(r.due).toBeNull(); expect(r.rejected).toEqual([]); });
test('dateGiven: sama godzina → false, termin w tekście → true', () => { expect(parseCapture('!x o 18',PL).dateGiven).toBe(false); expect(parseCapture('!x jutro',PL).dateGiven).toBe(true); expect(parseCapture('!x co wtorek',PL).dateGiven).toBe(true); });
test('notatka zwraca tylko tokeny tagów', () => { const r=parseCapture('spacer jutro #dom',PL); expect(r.tokens).toEqual([{kind:'tag',text:'#dom'}]); expect(r.rejected).toEqual([]); });

// ── 27. Czytelny tytuł po wycięciu ────────────────────────────────
console.log('\n27. Czysty tytuł');
test('wycina dopasowane miejsce, nie pierwsze takie samo słowo', () => { expect(parseCapture('!jutro jutrzenka jutro',PL).title).toBe('jutrzenka jutro'); });
test('przecinek i myślnik przed terminem znikają', () => { expect(parseCapture('!kawa, jutro',PL).title).toBe('kawa'); expect(parseCapture('!kawa – jutro o 18',PL).title).toBe('kawa'); });
test('sam tag nie przycina interpunkcji', () => { expect(parseCapture('!plan: #dom',PL).title).toBe('plan:'); });

// ── 28. keep: fragmenty zostawione dosłownie ──────────────────────
console.log('\n28. keep');
test('keep chroni stary fragment, nowy działa', () => { const r=parseCapture('!Plan na jutro o 18',PL,{keep:['na jutro']}); expect(r.title).toBe('Plan na jutro'); expect(r.dateGiven).toBe(false); expect(r.time).toBe('18:00'); });
test('keep bez trafienia nic nie zmienia', () => { expect(daysFromToday(parseCapture('!x jutro',PL,{keep:['pojutrze']}).due)).toBe(1); });

// ── WYNIKI ────────────────────────────────────────────────────────
await results();

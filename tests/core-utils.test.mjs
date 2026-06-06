import { test, testAsync, expect, results } from './_runner.mjs';
import { newNoteId, buildItemFromCapture } from './quick-capture-core.mjs';
import { debounce } from './utils.mjs';

const PL = 'pl';
const EN = 'en-US';

// ── 1. newNoteId ──────────────────────────────────────────────────
console.log('\n1. newNoteId');
test('zwraca string', () => { expect(typeof newNoteId()).toBe('string'); });
test('format base36_suffix', () => {
  const id = newNoteId();
  if (!/^[a-z0-9]+_[a-z0-9]+$/.test(id)) throw new Error(`Nieprawidłowy format: "${id}"`);
});
test('100 wywołań → 100 unikalnych ID', () => {
  const ids = new Set(Array.from({length:100}, () => newNoteId()));
  if (ids.size !== 100) throw new Error(`Kolizja: ${ids.size}/100 unikalnych`);
});
test('brak spacji i znaków specjalnych', () => {
  for (let i=0; i<20; i++) {
    const id = newNoteId();
    if (/[^a-z0-9_]/.test(id)) throw new Error(`Niedozwolony znak w: "${id}"`);
  }
});

// ── 2. buildItemFromCapture — notatki ────────────────────────────
console.log('\n2. buildItemFromCapture — notatki');
test('tekst → type="note"', () => { const r=buildItemFromCapture('memo',PL); expect(r.type).toBe('note'); expect(r.title).toBe('memo'); });
test('notatka ma wymagane pola', () => {
  const r=buildItemFromCapture('test',PL);
  expect(typeof r.id).toBe('string');
  expect(r.content).toBe('');
  expect(typeof r.created).toBe('number');
  expect(r.tags).toEqual([]);
});
test('notatka nie ma pól task', () => {
  const r=buildItemFromCapture('memo',PL);
  if('completed' in r) throw new Error('"completed" nie powinno być w notatce');
  if('due' in r) throw new Error('"due" nie powinno być w notatce');
  if('time' in r) throw new Error('"time" nie powinno być w notatce');
  if('reminder' in r) throw new Error('"reminder" nie powinno być w notatce');
});
test('pusty string → null', () => { expect(buildItemFromCapture('',PL)).toBeNull(); });
test('sam ! → null', () => { expect(buildItemFromCapture('!',PL)).toBeNull(); });
test('whitespace → null', () => { expect(buildItemFromCapture('   ',PL)).toBeNull(); });
test('null → null (guard)', () => { expect(buildItemFromCapture(null,PL)).toBeNull(); });
test('created ≈ Date.now()', () => {
  const before=Date.now(); const r=buildItemFromCapture('test',PL); const after=Date.now();
  if(r.created < before || r.created > after) throw new Error(`created=${r.created} poza zakresem`);
});

// ── 3. buildItemFromCapture — zadania ────────────────────────────
console.log('\n3. buildItemFromCapture — zadania');
test('! → type="task"', () => { const r=buildItemFromCapture('!standup',PL); expect(r.type).toBe('task'); expect(r.title).toBe('standup'); });
test('zadanie ma pola task', () => {
  const r=buildItemFromCapture('!x',PL);
  expect(r.completed).toBe(false);
  expect(r.reminder).toBe(0);
  if(!('due' in r)) throw new Error('brak "due"');
  if(!('time' in r)) throw new Error('brak "time"');
});
test('bez daty → due=null, time=null', () => { const r=buildItemFromCapture('!x',PL); expect(r.due).toBeNull(); expect(r.time).toBeNull(); });
test('jutro → due ustawione', () => { const r=buildItemFromCapture('!standup jutro',PL); expect(r.due).toBeTruthy(); expect(r.title).toBe('standup'); });
test('data + czas → oba ustawione', () => { const r=buildItemFromCapture('!deploy 15.08 14:30',PL); expect(r.due).toBeTruthy(); expect(r.time).toBe('14:30'); expect(r.title).toBe('deploy'); });
test('tomorrow EN', () => { const r=buildItemFromCapture('!meeting tomorrow 9:00',EN); expect(r.type).toBe('task'); expect(r.time).toBe('09:00'); expect(r.due).toBeTruthy(); });
test('completed zawsze false', () => { expect(buildItemFromCapture('!x jutro',PL).completed).toBe(false); });
test('reminder zawsze 0', () => { expect(buildItemFromCapture('!x jutro 9:00',PL).reminder).toBe(0); });
test('dwa wywołania → różne ID', () => {
  const a=buildItemFromCapture('!a',PL), b=buildItemFromCapture('!b',PL);
  if(a.id===b.id) throw new Error('ID powinny być różne');
});
test('tags zawsze []', () => { expect(buildItemFromCapture('!x',PL).tags).toEqual([]); });

// ── 4. debounce (async) ───────────────────────────────────────────
console.log('\n4. debounce');
test('zwraca funkcję', () => {
  if(typeof debounce(()=>{},100) !== 'function') throw new Error('Expected function');
});
test('ma metodę cancel', () => {
  const fn = debounce(()=>{}, 100);
  if(typeof fn.cancel !== 'function') throw new Error('Expected cancel method');
});
testAsync('cancel() zatrzymuje wywołanie', () => new Promise(resolve => {
  let count = 0;
  const fn = debounce(() => { count++; }, 30);
  fn();
  fn.cancel();
  setTimeout(() => {
    if(count !== 0) throw new Error(`Expected 0 wywołań po cancel, got ${count}`);
    resolve();
  }, 60);
}));
testAsync('wywołana raz → odpala po opóźnieniu', () => new Promise(resolve => {
  let count=0;
  const fn=debounce(()=>{count++;},30);
  fn();
  setTimeout(()=>{ if(count!==1) throw new Error(`Expected 1, got ${count}`); resolve(); },60);
}));
testAsync('wielokrotne wywołania → jedno odpalenie', () => new Promise(resolve => {
  let count=0;
  const fn=debounce(()=>{count++;},30);
  fn(); fn(); fn(); fn(); fn();
  setTimeout(()=>{ if(count!==1) throw new Error(`Expected 1, got ${count}`); resolve(); },60);
}));
testAsync('po przerwie można wywołać ponownie', () => new Promise(resolve => {
  let count=0;
  const fn=debounce(()=>{count++;},30);
  fn();
  setTimeout(()=>{
    fn();
    setTimeout(()=>{ if(count!==2) throw new Error(`Expected 2, got ${count}`); resolve(); },60);
  },60);
}));

await results();

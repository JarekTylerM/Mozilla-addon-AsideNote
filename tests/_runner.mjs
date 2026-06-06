/**
 * _runner.mjs — współdzielony runner dla wszystkich test*.mjs
 * Synchroniczne testy uruchamiane natychmiast.
 * Asynchroniczne: użyj testAsync(name, asyncFn).
 */

export let passed = 0, failed = 0, bugged = 0;
export const failures = [], knownBugs = [];
export const _asyncQueue = [];

export function test(name, fn) {
  try { fn(); passed++; process.stdout.write('.'); }
  catch(e) { failed++; failures.push({name, error: e.message}); process.stdout.write('F'); }
}

export function testAsync(name, fn) {
  _asyncQueue.push({ name, fn });
}

export function testBug(id, name, fn) {
  try {
    fn();
    knownBugs.push({id, name, status:'NAPRAWIONY'});
    process.stdout.write('B');
  } catch(e) {
    bugged++;
    knownBugs.push({id, name, status:'aktywny'});
    process.stdout.write('b');
  }
}

export function expect(actual) { return {
  toBe(exp)          { if(actual!==exp) throw new Error(`Expected ${JSON.stringify(exp)}, got ${JSON.stringify(actual)}`); },
  toBeNull()         { if(actual!==null) throw new Error(`Expected null, got ${JSON.stringify(actual)}`); },
  toBeTruthy()       { if(!actual) throw new Error(`Expected truthy, got ${JSON.stringify(actual)}`); },
  toBeFalsy()        { if(actual) throw new Error(`Expected falsy, got ${JSON.stringify(actual)}`); },
  toContain(s)       { if(!String(actual).includes(s)) throw new Error(`"${actual}" does not contain "${s}"`); },
  toEqual(exp)       { const a=JSON.stringify(actual),b=JSON.stringify(exp); if(a!==b) throw new Error(`Expected ${b}, got ${a}`); },
  toBeGreaterThan(n) { if(actual<=n) throw new Error(`Expected ${actual} > ${n}`); },
  toMatch(rx)        { if(!rx.test(String(actual))) throw new Error(`"${actual}" does not match ${rx}`); },
}; }

export async function results(extraNotes = []) {
  // Uruchom async testy
  if (_asyncQueue.length > 0) {
    console.log('\n[async]');
    for (const {name, fn} of _asyncQueue) {
      try {
        await fn();
        passed++;
        process.stdout.write('.');
      } catch(e) {
        failed++;
        failures.push({name, error: e.message});
        process.stdout.write('F');
      }
    }
  }

  const total = passed + failed;
  const activeBugs = knownBugs.filter(b => b.status === 'aktywny').length;
  console.log('\n');
  console.log('─'.repeat(60));
  console.log(`Wyniki: ${passed}/${total} ✓  |  ${failed} ✗ nieoczekiwanych  |  ${activeBugs} 🐛 aktywnych bugów`);

  if (failures.length) {
    console.log('\n❌ NIEOCZEKIWANE FAILE:');
    for (const {name, error} of failures)
      console.log(`  ✗ ${name}\n    ${error}`);
  }

  if (knownBugs.length) {
    console.log('\n🐛 Śledzone bugi:');
    for (const {id, name, status} of knownBugs) {
      const icon = status === 'NAPRAWIONY' ? '✓ NAPRAWIONY' : '·';
      console.log(`  ${icon} [${id}] ${name}`);
    }
  }

  if (extraNotes.length) {
    console.log('\n📋 Notatki:');
    for (const n of extraNotes) console.log(`  ${n}`);
  }

  if (failed > 0) process.exit(1);
  else process.exit(0);
}

// School-day due dates: weekends don't count; due by 11:59:59 PM school time.
// Usage: node tests/schooldays.test.js   (no server needed)
const { schoolDueAt, localParts } = require('../src/schooldays');
let pass = 0, failN = 0;
const check = (n, c, x = '') => { c ? pass++ : failN++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };
const TZ = 'America/New_York';
// A moment given as Eastern wall-clock time.
const et = (iso) => { const [d, t = '12:00'] = iso.split(' '); const [y, m, dd] = d.split('-').map(Number); const [h, mi] = t.split(':').map(Number);
  let g = Date.UTC(y, m - 1, dd, h, mi); for (let i = 0; i < 3; i++) { const p = localParts(g, TZ); g += Date.UTC(y, m - 1, dd, h, mi) - Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi); } return g; };
const show = (ms) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date(ms));
const due = (when, days) => show(schoolDueAt(et(when), days, TZ));
const cases = [
  ['Monday + 1 school day -> end of Tuesday', '2026-11-16 09:00', 1, 'Tue, Nov 17, 11:59:59 PM'],
  ['Monday + 3 -> end of Thursday', '2026-11-16 15:30', 3, 'Thu, Nov 19, 11:59:59 PM'],
  ['Thursday + 2 skips the weekend -> end of Monday', '2026-11-19 10:00', 2, 'Mon, Nov 23, 11:59:59 PM'],
  ['Friday + 1 -> end of Monday', '2026-11-13 14:00', 1, 'Mon, Nov 16, 11:59:59 PM'],
  ['Friday + 5 -> end of next Friday', '2026-11-13 08:00', 5, 'Fri, Nov 20, 11:59:59 PM'],
  ['Saturday approval + 1 -> end of Monday', '2026-11-14 11:00', 1, 'Mon, Nov 16, 11:59:59 PM'],
  ['Sunday approval + 1 -> end of Monday', '2026-11-15 20:00', 1, 'Mon, Nov 16, 11:59:59 PM'],
  ['Late Friday night (after midnight UTC) still counts as Friday', '2026-11-13 22:30', 1, 'Mon, Nov 16, 11:59:59 PM'],
  ['Across the clocks going back (Nov 1)', '2026-10-30 12:00', 1, 'Mon, Nov 2, 11:59:59 PM'],
  ['Across the clocks going forward (Mar 8)', '2027-03-05 12:00', 1, 'Mon, Mar 8, 11:59:59 PM'],
  ['Over two weekends: Wednesday + 7', '2026-11-18 12:00', 7, 'Fri, Nov 27, 11:59:59 PM'],
];
for (const [name, when, days, want] of cases) { const got = due(when, days); check(name, got === want, got); }
let weekend = 0;
for (let i = 0; i < 400; i++) {
  const start = et('2026-01-01 12:00') + i * 6.5 * 3_600_000;
  for (const n of [1, 2, 3, 5, 10]) { const wd = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(new Date(schoolDueAt(start, n, TZ))); if (wd === 'Sat' || wd === 'Sun') weekend++; }
}
check('never due on a weekend (2,000 random approvals)', weekend === 0, `${weekend} on weekends`);
console.log(`\n${pass} passed, ${failN} failed`);

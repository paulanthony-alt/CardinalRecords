// Studio time requests: ask, rules, who sees what, approve/decline/cancel, no-show fee + undo, export, report.
// Usage: PGURL=postgres://... node tests/studio.test.js OUTDIR   (fresh database, owner tester/0000)
const path = require('node:path');
const pg = require(require.resolve('pg', { paths: [path.join(__dirname, '..')] }));
const B = (process.env.BASE || 'http://localhost:3199'); const jars = {};
async function call(who, method, url, body) {
  const res = await fetch(B + url, { method, headers: { 'Content-Type': 'application/json', cookie: jars[who] || '' }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) jars[who] = sc.split(';')[0];
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null; try { json = JSON.parse(buf.toString()); } catch {} return { status: res.status, json, buf };
}
let pass = 0, failN = 0;
const check = (n, c, x = '') => { c ? pass++ : failN++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };
const H = 3_600_000, D = 24 * H;

(async () => {
  const db = new pg.Client({ connectionString: process.env.PGURL }); await db.connect();
  await call('o', 'POST', '/api/login', { username: 'tester', pin: '0000' });
  const g = (await call('o', 'POST', '/api/games', { name: 'Studio Test', durationDays: 90 })).json.id;
  const made = await call('o', 'POST', `/api/games/${g}/players/bulk`, { entries: ['Ana Ruiz', 'Ben Cho', 'Cy Diaz'].map((n) => ({ displayName: n })) });
  const id = {}; for (const c of made.json.created) { const k = c.displayName.split(' ')[0].toLowerCase(); id[k] = c.id; await call(k, 'POST', '/api/claim', { username: c.username, code: c.claimCode, pin: '1234' }); }
  const S = async (who) => (await call(who, 'GET', `/api/games/${g}/state`)).json;
  const ask = (who, b) => call(who, 'POST', `/api/games/${g}/studio`, { startsAt: Date.now() + D, minutes: 60, purpose: 'Lead vocals', guests: '', ...b });

  check('closed before the season starts', (await ask('ana', {})).status === 400);
  await call('o', 'POST', `/api/games/${g}/phase`, { phase: 'active' });
  check('owners do not request', (await ask('o', {})).status === 403);
  check('time in the past refused', (await ask('ana', { startsAt: Date.now() - 2 * H })).status === 400);
  check('odd length refused', (await ask('ana', { minutes: 50 })).status === 400);
  check('more than 120 days ahead refused', (await ask('ana', { startsAt: Date.now() + 130 * D })).status === 400);
  check('needs to say what for', (await ask('ana', { purpose: 'x' })).status === 400);
  const r1 = await ask('ana', { startsAt: Date.now() + D, minutes: 90, purpose: 'Lead vocals for my single', guests: 'Ben (engineer)' });
  check('student requests studio time', r1.status === 200);
  const b1 = r1.json.id;

  let st = await S('ben');
  check("others don't see a pending request", !st.bookings.some((b) => b.id === b1));
  st = await S('ana');
  const mine = st.bookings.find((b) => b.id === b1);
  check('student sees their own request, waiting', mine && mine.status === 'pending' && mine.purpose === 'Lead vocals for my single' && mine.minutes === 90);
  st = await S('o');
  check('owners see it with the details', st.bookings.find((b) => b.id === b1)?.guests === 'Ben (engineer)');

  check('students cannot approve', (await call('ana', 'POST', `/api/studio/${b1}/decide`, { action: 'approve' })).status === 403);
  check('owner approves with a note', (await call('o', 'POST', `/api/studio/${b1}/decide`, { action: 'approve', note: 'Bring your session files' })).status === 200);
  check('cannot answer twice', (await call('o', 'POST', `/api/studio/${b1}/decide`, { action: 'decline' })).status === 400);
  st = await S('ana');
  check('student sees Approved and the note', st.bookings.find((b) => b.id === b1).status === 'approved' && st.bookings.find((b) => b.id === b1).note === 'Bring your session files');
  st = await S('cy');
  const sched = st.bookings.find((b) => b.id === b1);
  check('everyone sees approved sessions on the schedule, without private details', sched && sched.status === 'approved' && sched.purpose === '' && sched.note === '' && sched.userId === id.ana);

  const r2 = (await ask('ben', { startsAt: Date.now() + 2 * D, purpose: 'Beat recording' })).json.id;
  check('owner declines with a reason', (await call('o', 'POST', `/api/studio/${r2}/decide`, { action: 'decline', note: 'Studio is booked then. Try Thursday?' })).status === 200);
  check('student sees Declined and the reason', (await S('ben')).bookings.find((b) => b.id === r2).note === 'Studio is booked then. Try Thursday?');
  const r3 = (await ask('ben', { startsAt: Date.now() + 3 * D, purpose: 'Mixing' })).json.id;
  check('others cannot cancel it', (await call('cy', 'POST', `/api/studio/${r3}/cancel`)).status === 403);
  check('student cancels their own request', (await call('ben', 'POST', `/api/studio/${r3}/cancel`)).status === 200);
  for (let i = 0; i < 5; i++) await ask('cy', { startsAt: Date.now() + (5 + i) * D, purpose: `Session ${i}` });
  check('5 waiting requests max', (await ask('cy', { startsAt: Date.now() + 20 * D, purpose: 'One more' })).status === 400);
  const r4 = (await S('cy')).bookings.find((b) => b.purpose === 'Session 0').id;
  await call('o', 'POST', `/api/studio/${r4}/decide`, { action: 'approve' });
  check('owner can cancel an approved session', (await call('o', 'POST', `/api/studio/${r4}/decide`, { action: 'cancel', note: 'Studio closed that day' })).status === 200);

  // no-show
  check('no-show only after the start time', (await call('o', 'POST', `/api/studio/${b1}/noshow`)).status === 400);
  await db.query('UPDATE studio_bookings SET starts_at = $1 WHERE id = $2', [Date.now() - 2 * H, b1]);
  await call('ana', 'PUT', '/api/me', { displayName: 'Ana Ruiz', roleTitle: '', bio: '', color: '#123456' }); // any change reloads the shared copy
  check('student cannot cancel a session that already started', (await call('ana', 'POST', `/api/studio/${b1}/cancel`)).status === 400);
  const before = (await S('o')).roster.find((p) => p.id === id.ana).stats.balance;
  const ns = await call('o', 'POST', `/api/studio/${b1}/noshow`);
  check('no-show charges the rate sheet fee', ns.status === 200 && ns.json.fee === 25 && (await S('o')).roster.find((p) => p.id === id.ana).stats.balance === before - 25);
  st = await S('o');
  check('marked as a no-show', st.bookings.find((b) => b.id === b1).status === 'noshow');
  const fine = st.ledger.find((l) => l.userId === id.ana && l.kind === 'fine' && /no-show/i.test(l.memo));
  check('the no-show fee can be undone', fine && (await call('o', 'POST', `/api/ledger/${fine.id}/reverse`)).status === 200);
  check('students cannot mark no-shows', (await call('ben', 'POST', `/api/studio/${b1}/noshow`)).status === 403);

  const ex = (await call('ben', 'GET', `/api/games/${g}/export.json`)).json;
  check("student download has only their own requests", ex.studio_bookings.length === 2 && ex.studio_bookings.every((b) => b.user_id === id.ben));
  const exo = (await call('o', 'GET', `/api/games/${g}/export.json`)).json;
  check('owner download has every request (8)', exo.studio_bookings.length === 8, String(exo.studio_bookings.length));
  const rep = await call('o', 'GET', `/api/games/${g}/report.pdf`);
  check('grading report still builds', rep.status === 200 && rep.buf.slice(0, 5).toString() === '%PDF-');
  await db.end();
  console.log(`\n${pass} passed, ${failN} failed`);
})().catch((e) => { console.error(e); process.exit(1); });

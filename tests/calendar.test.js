// Label calendar: owners add dates (events, deadlines, showcases, no-school days); everyone sees them;
// no-school days push deal due dates back like a weekend.
// Usage: PGURL=postgres://... node tests/calendar.test.js OUTDIR   (fresh database, owner tester/0000)
const path = require('node:path');
const pg = require(require.resolve('pg', { paths: [path.join(__dirname, '..')] }));
const { schoolDueAt, noSchoolSet } = require('../src/schooldays');
const B = (process.env.BASE || 'http://localhost:3199'); const jars = {};
async function call(who, method, url, body) {
  const res = await fetch(B + url, { method, headers: { 'Content-Type': 'application/json', cookie: jars[who] || '' }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) jars[who] = sc.split(';')[0];
  let json = null; try { json = await res.json(); } catch {} return { status: res.status, json };
}
let pass = 0, failN = 0;
const check = (n, c, x = '') => { c ? pass++ : failN++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };
const DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

(async () => {
  const db = new pg.Client({ connectionString: process.env.PGURL }); await db.connect();
  await call('o', 'POST', '/api/login', { username: 'tester', pin: '0000' });
  const g = (await call('o', 'POST', '/api/games', { name: 'Calendar Test', durationDays: 90 })).json.id;
  const made = await call('o', 'POST', `/api/games/${g}/players/bulk`, { entries: ['Ada Lin', 'Bo Kim'].map((n) => ({ displayName: n })) });
  const id = {}; for (const c of made.json.created) { const k = c.displayName.split(' ')[0].toLowerCase(); id[k] = c.id; await call(k, 'POST', '/api/claim', { username: c.username, code: c.claimCode, pin: '1234' }); }
  const S = async (who) => (await call(who, 'GET', `/api/games/${g}/state`)).json;
  const add = (b) => call('o', 'POST', `/api/games/${g}/calendar`, { title: 'Winter Showcase', kind: 'showcase', day: iso(Date.now() + 10 * DAY), time: '18:30', details: 'Auditorium', ...b });

  // ---- validation and permissions
  check('students cannot add dates', (await call('ada', 'POST', `/api/games/${g}/calendar`, { title: 'Party', day: iso(Date.now()) })).status === 403);
  check('needs a real day', (await add({ day: '2026-02-30' })).status === 400);
  check('unknown type refused', (await add({ kind: 'party' })).status === 400);
  check('bad time refused', (await add({ time: '25:00' })).status === 400);
  check('last day before first day refused', (await add({ day: '2026-12-10', endDay: '2026-12-01' })).status === 400);
  check('more than 60 days refused', (await add({ day: '2026-12-01', endDay: '2027-03-01' })).status === 400);
  const show = await add({});
  check('owner adds a showcase (works before the season starts)', show.status === 200);
  let st = await S('ada');
  let x = st.calendar.find((e) => e.id === show.json.id);
  check('students see it', x && x.title === 'Winter Showcase' && x.kind === 'showcase' && x.time === '18:30' && x.endDay === x.day && x.details === 'Auditorium');
  check('lobby announces it', st.feed.some((f) => f.kind === 'calendar' && /On the calendar: Winter Showcase, .* at 6:30 PM\./.test(f.message)), st.feed.map((f) => f.message).join(' | '));
  const quiet = await add({ title: 'Mix notes due', kind: 'deadline', time: '', announce: false });
  st = await S('ada');
  check('"announce" off: no lobby post', quiet.status === 200 && !st.feed.some((f) => /Mix notes due/.test(f.message)));
  check('all-day by default (no time)', st.calendar.find((e) => e.id === quiet.json.id).time === '');
  check('lobby setting covers calendar posts', st.lobby.categories.some((c) => c.id === 'calendar'));

  // ---- edit / delete
  check('students cannot edit', (await call('ada', 'PATCH', `/api/calendar/${show.json.id}`, { title: 'Mine now' })).status === 403);
  check('owner edits (only what changed)', (await call('o', 'PATCH', `/api/calendar/${show.json.id}`, { title: 'Winter Showcase (moved)', endDay: iso(Date.now() + 11 * DAY) })).status === 200);
  x = (await S('bo')).calendar.find((e) => e.id === show.json.id);
  check('edit saved, other fields kept', x.title === 'Winter Showcase (moved)' && x.time === '18:30' && x.details === 'Auditorium' && x.endDay > x.day);
  check('students cannot delete', (await call('ada', 'DELETE', `/api/calendar/${quiet.json.id}`)).status === 403);
  check('owner deletes', (await call('o', 'DELETE', `/api/calendar/${quiet.json.id}`)).status === 200 && !(await S('o')).calendar.some((e) => e.id === quiet.json.id));
  check('deleting again: gone', (await call('o', 'DELETE', `/api/calendar/${quiet.json.id}`)).status === 404);

  // ---- no-school days push due dates back
  await call('o', 'POST', `/api/games/${g}/phase`, { phase: 'active' });
  const deal = (await call('ada', 'POST', `/api/games/${g}/contracts`, { sellerId: id.bo, jobId: 'lyricist', quantity: 1, dueDays: 2 })).json.id;
  await call('bo', 'POST', `/api/contracts/${deal}/action`, { action: 'accept' });
  check('deal approved', (await call('o', 'POST', `/api/contracts/${deal}/action`, { action: 'approve' })).status === 200);
  const approvedAt = Number((await db.query('SELECT approved_at FROM contracts WHERE id = $1', [deal])).rows[0].approved_at);
  const before = (await S('bo')).contracts.find((c) => c.id === deal).dueAt;
  check('due date before any no-school days: 2 school days', before === schoolDueAt(approvedAt, 2));
  // Make the school day the deal is due a no-school day: it moves to the next school day.
  const dueDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(before));
  const snow = await add({ title: 'Snow day', kind: 'noschool', day: dueDay, time: '14:00' });
  check('owner marks a no-school day', snow.status === 200);
  st = await S('bo');
  const after = st.contracts.find((c) => c.id === deal).dueAt;
  check('no-school days ignore the time', st.calendar.find((e) => e.id === snow.json.id).time === '');
  check('the due date moved back a school day', after > before && after === schoolDueAt(approvedAt, 2, undefined, new Set([dueDay])), `${new Date(before).toISOString()} -> ${new Date(after).toISOString()}`);
  check('lobby says due dates skip it', st.feed.some((f) => /no school .*Deal due dates skip it/.test(f.message)));
  await call('o', 'DELETE', `/api/calendar/${snow.json.id}`);
  check('deleting the no-school day puts the due date back', (await S('bo')).contracts.find((c) => c.id === deal).dueAt === before);
  check('noSchoolSet expands ranges', [...noSchoolSet([{ kind: 'noschool', day: '2026-12-24', end_day: '2026-12-27' }, { kind: 'event', day: '2026-12-01', end_day: '2026-12-01' }])].join() === '2026-12-24,2026-12-25,2026-12-26,2026-12-27');

  // ---- export, archive, offload
  const ex = (await call('o', 'GET', `/api/games/${g}/export.json`)).json;
  check('calendar in the data download', ex.calendar_events.some((e) => e.title === 'Winter Showcase (moved)'));
  check('artists get it in their download too', (await call('ada', 'GET', `/api/games/${g}/export.json`)).json.calendar_events.length === 1);
  const other = (await call('o', 'POST', '/api/games', { name: 'Other Season', durationDays: 30 })).json.id;
  check('another season does not see this calendar', (await call('o', 'GET', `/api/games/${other}/state`)).json.calendar.length === 0);
  await call('o', 'POST', `/api/games/${g}/phase`, { phase: 'ended' }).catch(() => {});
  await db.query("UPDATE games SET status = 'archived' WHERE id = $1", [g]);
  await call('o', 'POST', `/api/games/${other}/calendar`, { title: 'Bump', day: iso(Date.now()) }); // any write refreshes the shared copy
  check('archived season: no changes', (await call('o', 'PATCH', `/api/calendar/${show.json.id}`, { title: 'x y' })).status === 400
    && (await add({ title: 'Late add' })).status === 400);
  await db.end();
  console.log(`\n${pass} passed, ${failN} failed`);
})().catch((e) => { console.error(e); process.exit(1); });

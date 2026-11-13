// Studio challenges with an owner-chosen date range: create/validate, entries, hidden-until-closed,
// end now, winners and prizes, undo a prize, cancel, edit, export, lobby, report.
// Usage: node tests/challenges.test.js OUTDIR   (fresh database, owner tester/0000)
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
  await call('o', 'POST', '/api/login', { username: 'tester', pin: '0000' });
  const g = (await call('o', 'POST', '/api/games', { name: 'Challenge Test', durationDays: 90 })).json.id;
  const made = await call('o', 'POST', `/api/games/${g}/players/bulk`, { entries: ['Lia Ray', 'Max Fox', 'Ivy Moon'].map((n) => ({ displayName: n })) });
  const id = {}; for (const c of made.json.created) { const k = c.displayName.split(' ')[0].toLowerCase(); id[k] = c.id; await call(k, 'POST', '/api/claim', { username: c.username, code: c.claimCode, pin: '1234' }); }
  await call('o', 'POST', `/api/games/${g}/phase`, { phase: 'active' });
  const S = async (who) => (await call(who, 'GET', `/api/games/${g}/state`)).json;
  const now = Date.now();
  const make = (b) => call('o', 'POST', `/api/games/${g}/challenges`, { title: 'Best hook', description: '8 bars', startsAt: now - H, endsAt: now + 2 * D, prizes: [100, 50], ...b });

  // ---- create + validate
  check('students cannot create', (await call('lia', 'POST', `/api/games/${g}/challenges`, { title: 'x', startsAt: now, endsAt: now + D, prizes: [1] })).status === 403);
  check('end before start refused', (await make({ endsAt: now - 2 * H })).status === 400);
  check('longer than a year refused', (await make({ endsAt: now + 400 * D })).status === 400);
  check('already over refused', (await make({ startsAt: now - 3 * D, endsAt: now - D })).status === 400);
  check('1st prize required', (await make({ prizes: [] })).status === 400);
  check('prizes in order (no gaps)', (await make({ prizes: [100, null, 25] })).status === 400);
  const c1 = await make({});
  check('owner creates a challenge for a date range', c1.status === 200);
  const cid = c1.json.id;
  let st = await S('lia');
  let ch = st.challenges.find((c) => c.id === cid);
  check('everyone sees it with dates and prizes', ch && ch.startsAt === now - H && ch.endsAt === now + 2 * D && ch.prizes.join() === '100,50');
  check('lobby announces it', st.feed.some((f) => f.kind === 'challenge' && /New studio challenge: "Best hook"/.test(f.message)));
  const up = (await make({ title: 'Future one', startsAt: now + 3 * D, endsAt: now + 10 * D, prizes: [25] })).json.id;
  check('upcoming challenge announced as coming up', (await S('lia')).feed.some((f) => /Coming up: the "Future one"/.test(f.message)));
  check('no entries before the start date', (await call('lia', 'PUT', `/api/challenges/${up}/entry`, { url: 'https://soundcloud.com/a' })).status === 400);

  // ---- entries
  check('owners do not enter', (await call('o', 'PUT', `/api/challenges/${cid}/entry`, { url: 'https://x.com' })).status === 403);
  check('bad link refused', (await call('lia', 'PUT', `/api/challenges/${cid}/entry`, { url: 'javascript:alert(1)' })).status === 400);
  check('student enters', (await call('lia', 'PUT', `/api/challenges/${cid}/entry`, { url: 'soundcloud.com/lia/hook', note: 'my hook' })).status === 200);
  check('entry can be updated', (await call('lia', 'PUT', `/api/challenges/${cid}/entry`, { url: 'https://soundcloud.com/lia/hook-v2', note: 'v2' })).status === 200);
  await call('max', 'PUT', `/api/challenges/${cid}/entry`, { url: 'https://youtu.be/max', note: '' });
  await call('ivy', 'PUT', `/api/challenges/${cid}/entry`, { url: 'https://drive.google.com/ivy' });
  check('withdraw', (await call('ivy', 'DELETE', `/api/challenges/${cid}/entry`)).status === 200);
  ch = (await S('max')).challenges.find((c) => c.id === cid);
  check('while open: students see only their own entry, plus the count', ch.entries.length === 1 && ch.entries[0].userId === id.max && ch.entryCount === 2);
  ch = (await S('o')).challenges.find((c) => c.id === cid);
  check('owners see every entry', ch.entries.length === 2 && ch.entries.some((x) => x.url === 'https://soundcloud.com/lia/hook-v2' && x.note === 'v2'));
  const ex = (await call('max', 'GET', `/api/games/${g}/export.json`)).json;
  check("student download hides others' entries while open", ex.challenges.length === 2 && ex.challenge_entries.every((x) => x.user_id === id.max));

  // ---- winners
  check('no winners before the end date', (await call('o', 'POST', `/api/challenges/${cid}/winners`, { places: [id.lia] })).status === 400);
  check('end now', (await call('o', 'POST', `/api/challenges/${cid}/end`)).status === 200);
  check('no new entries once ended', (await call('ivy', 'PUT', `/api/challenges/${cid}/entry`, { url: 'https://x.com/late' })).status === 400);
  ch = (await S('ivy')).challenges.find((c) => c.id === cid);
  check('once ended, everyone sees the entries', ch.entries.length === 2);
  check('winner must have entered', (await call('o', 'POST', `/api/challenges/${cid}/winners`, { places: [id.ivy] })).status === 400);
  check('same artist cannot win twice', (await call('o', 'POST', `/api/challenges/${cid}/winners`, { places: [id.lia, id.lia] })).status === 400);
  check('no more places than prizes', (await call('o', 'POST', `/api/challenges/${cid}/winners`, { places: [id.lia, id.max, id.ivy] })).status === 400);
  check('students cannot pick winners', (await call('lia', 'POST', `/api/challenges/${cid}/winners`, { places: [id.lia] })).status === 403);
  const before = Object.fromEntries((await S('o')).roster.map((p) => [p.id, p.stats.balance]));
  check('owner picks 1st and 2nd', (await call('o', 'POST', `/api/challenges/${cid}/winners`, { places: [id.max, id.lia] })).status === 200);
  st = await S('o');
  check('prizes paid', st.roster.find((p) => p.id === id.max).stats.balance === before[id.max] + 100 && st.roster.find((p) => p.id === id.lia).stats.balance === before[id.lia] + 50);
  ch = st.challenges.find((c) => c.id === cid);
  check('places recorded, status judged', ch.status === 'judged' && ch.entries.find((x) => x.userId === id.max).place === 1 && ch.entries.find((x) => x.userId === id.lia).place === 2);
  check('lobby announces winners', st.feed.some((f) => /"Best hook" winners! 1st: Max Fox \(\$100\), 2nd: Lia Ray \(\$50\)/.test(f.message)));
  check('cannot judge twice', (await call('o', 'POST', `/api/challenges/${cid}/winners`, { places: [id.lia] })).status === 400);
  check('cannot edit after judging', (await call('o', 'PATCH', `/api/challenges/${cid}`, { title: 'Changed' })).status === 400);
  const prizeRow = st.ledger.find((l) => l.userId === id.max && /Challenge prize: Best hook \(1st place\)/.test(l.memo));
  check('a prize can be undone', prizeRow && (await call('o', 'POST', `/api/ledger/${prizeRow.id}/reverse`)).status === 200);

  // ---- edit, cancel
  check('edit dates and prize before it starts', (await call('o', 'PATCH', `/api/challenges/${up}`, { startsAt: now - H, endsAt: now + 5 * D, prizes: [40, 20, 10] })).status === 200);
  ch = (await S('lia')).challenges.find((c) => c.id === up);
  check('edit applied (now open)', ch.startsAt === now - H && ch.prizes.join() === '40,20,10');
  check('entries open after moving the start date', (await call('lia', 'PUT', `/api/challenges/${up}/entry`, { url: 'https://soundcloud.com/lia/2' })).status === 200);
  check('cancel', (await call('o', 'POST', `/api/challenges/${up}/cancel`)).status === 200);
  check('no entries on a cancelled challenge', (await call('max', 'PUT', `/api/challenges/${up}/entry`, { url: 'https://x.com' })).status === 400);

  // ---- lobby toggle, report
  await call('o', 'PUT', `/api/games/${g}/lobby`, { show: { challenge: false } });
  check('owners can hide challenge posts from students', !(await S('lia')).feed.some((f) => f.kind === 'challenge'));
  const rep = await call('o', 'GET', `/api/games/${g}/report.pdf`);
  check('grading report still builds', rep.status === 200 && rep.buf.slice(0, 5).toString() === '%PDF-');
  console.log(`\n${pass} passed, ${failN} failed`);
})().catch((e) => { console.error(e); process.exit(1); });

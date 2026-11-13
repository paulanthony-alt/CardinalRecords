// Label jobs: owners post paid work (volunteering, studio assistant); artists raise a hand; owners pick and pay.
// Usage: PGURL=postgres://... node tests/label-jobs.test.js OUTDIR   (fresh database, owner tester/0000)
const path = require('node:path');
const pg = require(require.resolve('pg', { paths: [path.join(__dirname, '..')] }));
const B = (process.env.BASE || 'http://localhost:3199'); const jars = {};
async function call(who, method, url, body) {
  const res = await fetch(B + url, { method, headers: { 'Content-Type': 'application/json', cookie: jars[who] || '' }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) jars[who] = sc.split(';')[0];
  let json = null; try { json = await res.json(); } catch {} return { status: res.status, json };
}
let pass = 0, failN = 0;
const check = (n, c, x = '') => { c ? pass++ : failN++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };

(async () => {
  const db = new pg.Client({ connectionString: process.env.PGURL }); await db.connect();
  await call('o', 'POST', '/api/login', { username: 'tester', pin: '0000' });
  const g = (await call('o', 'POST', '/api/games', { name: 'Label Jobs Test', durationDays: 90 })).json.id;
  const made = await call('o', 'POST', `/api/games/${g}/players/bulk`, { entries: ['Ada Lin', 'Bo Kim', 'Cal Ruiz'].map((n) => ({ displayName: n })) });
  const id = {}; for (const c of made.json.created) { const k = c.displayName.split(' ')[0].toLowerCase(); id[k] = c.id; await call(k, 'POST', '/api/claim', { username: c.username, code: c.claimCode, pin: '1234' }); }
  const S = async (who) => (await call(who, 'GET', `/api/games/${g}/state`)).json;
  const post = (b) => call('o', 'POST', `/api/games/${g}/label-jobs`, { payoutId: 'volunteer', quantity: 2, spots: 2, whenText: 'Tuesday, 3rd period', details: 'Help in EMusic 1', ...b });

  check('not before the season starts', (await post({})).status === 400);
  await call('o', 'POST', `/api/games/${g}/phase`, { phase: 'active' });
  check('students cannot post label jobs', (await call('ada', 'POST', `/api/games/${g}/label-jobs`, { payoutId: 'volunteer', quantity: 1 })).status === 403);
  check('automatic payouts (Game Bonus) are not jobs', (await post({ payoutId: 'hire-bonus' })).status === 400);
  check('studio assistant pay below the minimum refused', (await post({ payoutId: 'studio-assistant', amount: 10 })).status === 400);
  const j = await post({});
  check('owner posts a volunteer job (2 class blocks, 2 artists)', j.status === 200);
  const jid = j.json.id;
  const sa = (await post({ payoutId: 'studio-assistant', amount: 20, spots: 1, whenText: 'Friday after school', details: 'Studio setup' })).json.id;
  let st = await S('ada');
  let q = st.requests.find((x) => x.id === jid);
  check('everyone sees it with pay from the rate sheet', q && q.kind === 'label' && q.amount === 80 && q.spots === 2 && q.whenText === 'Tuesday, 3rd period');
  check('studio assistant pays the amount set', st.requests.find((x) => x.id === sa).amount === 20);
  check('lobby announces it', st.feed.some((f) => f.kind === 'request' && /The label is looking for 2 artists: Volunteer/.test(f.message)));

  for (const k of ['ada', 'bo', 'cal']) await call(k, 'POST', `/api/requests/${jid}/apply`, { note: `${k} can help` });
  q = (await S('bo')).requests.find((x) => x.id === jid);
  check('students see the count, not who', q.applicantCount === 3 && q.applicants === undefined && q.applied === true && q.myStatus === 'applied');
  q = (await S('o')).requests.find((x) => x.id === jid);
  check('owners see everyone who raised a hand', q.applicants.length === 3 && q.applicants.every((a) => a.status === 'applied'));
  check('the artist "pick" route is not for label jobs', (await call('o', 'POST', `/api/requests/${jid}/hire`, { userId: id.ada })).status === 400);
  check('students cannot pick', (await call('ada', 'POST', `/api/requests/${jid}/pick`, { userId: id.ada })).status === 403);
  check('pick Ada', (await call('o', 'POST', `/api/requests/${jid}/pick`, { userId: id.ada })).status === 200);
  check('pick Bo', (await call('o', 'POST', `/api/requests/${jid}/pick`, { userId: id.bo })).status === 200);
  check('no more than the spots', (await call('o', 'POST', `/api/requests/${jid}/pick`, { userId: id.cal })).status === 400);
  st = await S('ada'); q = st.requests.find((x) => x.id === jid);
  check('job shows as filled, picked artists listed', q.status === 'filled' && q.picked.length === 2 && q.myStatus === 'picked');
  check('a picked artist cannot just lower their hand', (await call('ada', 'DELETE', `/api/requests/${jid}/apply`)).status === 400);
  check('remove a pick: the spot opens again', (await call('o', 'POST', `/api/requests/${jid}/unpick`, { userId: id.bo })).status === 200 && (await S('o')).requests.find((x) => x.id === jid).status === 'open');
  await call('o', 'POST', `/api/requests/${jid}/pick`, { userId: id.cal });

  // pay
  const before = (await S('o')).roster.find((p) => p.id === id.ada).stats.balance;
  check('students cannot pay', (await call('ada', 'POST', `/api/requests/${jid}/pay`, { userId: id.ada })).status === 403);
  check('cannot pay someone who was not picked', (await call('o', 'POST', `/api/requests/${jid}/pay`, { userId: id.bo })).status === 400);
  check('pay Ada', (await call('o', 'POST', `/api/requests/${jid}/pay`, { userId: id.ada })).status === 200);
  st = await S('o');
  check('Ada paid $80', st.roster.find((p) => p.id === id.ada).stats.balance === before + 80);
  check('marked paid', st.requests.find((x) => x.id === jid).applicants.find((a) => a.userId === id.ada).status === 'paid');
  check('cannot pay twice', (await call('o', 'POST', `/api/requests/${jid}/pay`, { userId: id.ada })).status === 400);
  check('lobby announces the payment', st.feed.some((f) => f.kind === 'grant' && /paid Ada Lin \$80 for volunteer/.test(f.message)));
  const row = st.ledger.find((l) => l.userId === id.ada && l.kind === 'grant' && /Volunteer/.test(l.memo));
  check('payment can be undone', row && (await call('o', 'POST', `/api/ledger/${row.id}/reverse`)).status === 200);
  check('Ada sees Paid', (await S('ada')).requests.find((x) => x.id === jid).myStatus === 'paid');

  // close, then still pay; stays visible while someone is waiting to be paid
  check('owner closes the job', (await call('o', 'POST', `/api/requests/${jid}/close`)).status === 200);
  check('no new hands once closed', (await call('bo', 'POST', `/api/requests/${jid}/apply`, {})).status === 400);
  await db.query('UPDATE job_requests SET updated_at = $1 WHERE id = $2', [Date.now() - 30 * 86_400_000, jid]);
  await call('o', 'POST', `/api/requests/${sa}/close`); // any change reloads the shared copy
  check('an old closed job stays listed while a picked artist is unpaid', (await S('o')).requests.some((x) => x.id === jid));
  check('pay after closing', (await call('o', 'POST', `/api/requests/${jid}/pay`, { userId: id.cal })).status === 200);
  check("label jobs don't count toward an artist's 3 open requests", (await call('ada', 'POST', `/api/games/${g}/requests`, { jobId: 'lyricist', quantity: 1 })).status === 200);
  const ex = (await call('o', 'GET', `/api/games/${g}/export.json`)).json;
  check('label jobs in the data download', ex.job_requests.some((x) => x.kind === 'label' && x.payout_id === 'volunteer' && x.spots === 2));
  await db.end();
  console.log(`\n${pass} passed, ${failN} failed`);
})().catch((e) => { console.error(e); process.exit(1); });

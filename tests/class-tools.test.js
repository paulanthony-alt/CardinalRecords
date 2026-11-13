// Job board, deal deadlines, grading report, class mode taps, undo, paste-in roster.
// Usage: PGURL=postgres://... node tests/class-tools.test.js OUTDIR
//   (fresh database, owner tester/0000; PGURL lets the test move a deal's approval date back in time)
const path = require('node:path');
const pg = require(require.resolve('pg', { paths: [path.join(__dirname, '..')] }));
const B = (process.env.BASE || 'http://localhost:3199'); const jars = {};
async function call(who, method, url, body) {
  const res = await fetch(B + url, { method, headers: { 'Content-Type': 'application/json', cookie: jars[who] || '' }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) jars[who] = sc.split(';')[0];
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null; try { json = JSON.parse(buf.toString()); } catch {} return { status: res.status, json, buf, type: res.headers.get('content-type') };
}
let pass = 0, failN = 0;
const check = (n, c, x = '') => { c ? pass++ : failN++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };
const DAY = 86_400_000;

(async () => {
  const db = new pg.Client({ connectionString: process.env.PGURL }); await db.connect();
  await call('o', 'POST', '/api/login', { username: 'tester', pin: '0000' });
  const g = (await call('o', 'POST', '/api/games', { name: 'Tools Test', durationDays: 90 })).json.id;
  const S = async (who) => (await call(who, 'GET', `/api/games/${g}/state`)).json;

  // ================= 13. paste-in roster =================
  const list = [{ displayName: 'Maria Garcia', roleTitle: 'Vocalist' }, { displayName: 'Devon Reed', roleTitle: 'Producer' }, { displayName: 'Sam Lee' },
    { displayName: 'José Núñez' }, { displayName: 'Ava Brooks' }];
  const dry = await call('o', 'POST', `/api/games/${g}/players/bulk`, { entries: list, dryRun: true });
  check('paste: preview suggests usernames', dry.status === 200 && dry.json.entries.every((e) => /^[a-z]{3,15}\d{2}$/.test(e.username) && !e.problems.length), dry.json?.entries.map((e) => e.username).join(','));
  check('paste: usernames are not full names', dry.json.entries[0].username.startsWith('mariag') && !dry.json.entries[0].username.includes('garcia'));
  check('paste: accents folded', dry.json.entries[3].username.startsWith('josen'));
  check('paste: preview creates nobody', (await S('o')).roster.length === 0);
  const dup = await call('o', 'POST', `/api/games/${g}/players/bulk`, { entries: [{ displayName: 'A', username: 'same1' }, { displayName: 'B', username: 'same1' }], dryRun: true });
  check('paste: duplicate usernames flagged', dup.json.entries[1].problems.length === 1);
  check('paste: players cannot use it', (await call('x', 'POST', `/api/games/${g}/players/bulk`, { entries: list })).status === 401);
  const made = await call('o', 'POST', `/api/games/${g}/players/bulk`, { entries: dry.json.entries.map(({ displayName, roleTitle, username }) => ({ displayName, roleTitle, username })) });
  check('paste: signs everyone at once', made.status === 200 && made.json.created.length === 5 && made.json.created.every((c) => /^[A-Z2-9]{6}$/.test(c.claimCode)));
  let st = await S('o');
  check('paste: one lobby post, not five', st.feed.filter((f) => f.kind === 'join').length === 1);
  const again = await call('o', 'POST', `/api/games/${g}/players/bulk`, { entries: [{ displayName: 'X', username: made.json.created[0].username }] });
  check('paste: taken username refused, nothing created', again.status === 400 && (await S('o')).roster.length === 5);
  const id = {}; const user = {};
  for (const c of made.json.created) {
    const key = c.displayName.split(' ')[0].toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
    id[key] = c.id; user[key] = c.username;
    await call(key, 'POST', '/api/claim', { username: c.username, code: c.claimCode, pin: '1234' });
  }
  check('paste: students claim with their codes', (await S('maria')).roster.length === 5);
  await call('o', 'PATCH', `/api/games/${g}`, { maxPlayers: 6 });
  const full = await call('o', 'POST', `/api/games/${g}/players/bulk`, { entries: [{ displayName: 'One More' }, { displayName: 'Two More' }] });
  check('paste: refuses more than the roster has room for', full.status === 400 && /spot/.test(full.json.error), full.json?.error);

  // ================= 2. job board =================
  check('job board: closed before the season starts', (await call('maria', 'POST', `/api/games/${g}/requests`, { jobId: 'beat-maker', quantity: 2 })).status === 400);
  await call('o', 'POST', `/api/games/${g}/phase`, { phase: 'active' });
  check('job board: owners do not post requests', (await call('o', 'POST', `/api/games/${g}/requests`, { jobId: 'beat-maker', quantity: 2 })).status === 403);
  const rq = await call('maria', 'POST', `/api/games/${g}/requests`, { jobId: 'beat-maker', quantity: 2, dueDays: 3, details: 'Trap beat for my single' });
  check('job board: student posts a request', rq.status === 200);
  const rid = rq.json.id;
  st = await S('devon');
  let q = st.requests.find((x) => x.id === rid);
  check('job board: everyone sees it with the rate-sheet price', q && q.amount === 80 && q.status === 'open' && q.applicants === undefined);
  check('job board: lobby announces it', st.feed.some((f) => f.kind === 'request' && /Maria Garcia is looking for a Beat Maker/.test(f.message)));
  check('job board: bad job refused', (await call('maria', 'POST', `/api/games/${g}/requests`, { jobId: 'nope', quantity: 1 })).status === 400);
  check('job board: cannot raise a hand on your own', (await call('maria', 'POST', `/api/requests/${rid}/apply`, {})).status === 400);
  check('job board: raise a hand with a note', (await call('devon', 'POST', `/api/requests/${rid}/apply`, { note: 'I make trap beats' })).status === 200);
  await call('sam', 'POST', `/api/requests/${rid}/apply`, {});
  await call('ava', 'POST', `/api/requests/${rid}/apply`, {});
  check('job board: lower a hand', (await call('ava', 'DELETE', `/api/requests/${rid}/apply`)).status === 200);
  q = (await S('sam')).requests.find((x) => x.id === rid);
  check('job board: others see the count, not who', q.applicantCount === 2 && q.applied === true && q.applicants === undefined);
  q = (await S('maria')).requests.find((x) => x.id === rid);
  check('job board: poster sees who and their notes', q.applicants.length === 2 && q.applicants.some((a) => a.note === 'I make trap beats'));
  check('job board: only the poster picks', (await call('devon', 'POST', `/api/requests/${rid}/hire`, { userId: id.devon })).status === 403);
  check('job board: cannot pick someone who did not raise a hand', (await call('maria', 'POST', `/api/requests/${rid}/hire`, { userId: id.ava })).status === 400);
  const hire = await call('maria', 'POST', `/api/requests/${rid}/hire`, { userId: id.devon });
  check('job board: picking makes a deal', hire.status === 200 && hire.json.contractId);
  st = await S('o');
  const deal = st.contracts.find((c) => c.id === hire.json.contractId);
  check('job board: deal goes straight to owner review, escrow held', deal.status === 'review' && deal.escrow === 80 && deal.sellerId === id.devon && deal.dueDays === 3 && deal.terms === 'Trap beat for my single');
  check('job board: request marked filled', st.requests.find((x) => x.id === rid).status === 'filled');
  check('job board: no more hands once filled', (await call('ava', 'POST', `/api/requests/${rid}/apply`, {})).status === 400);
  for (let i = 0; i < 3; i++) await call('sam', 'POST', `/api/games/${g}/requests`, { jobId: 'lyricist', pricing: 'project' });
  check('job board: 3 open requests max', (await call('sam', 'POST', `/api/games/${g}/requests`, { jobId: 'lyricist', pricing: 'project' })).status === 400);
  const samReq = (await S('sam')).requests.find((x) => x.userId === id.sam && x.status === 'open').id;
  check('job board: owner can close any request', (await call('o', 'POST', `/api/requests/${samReq}/close`)).status === 200);
  check('job board: others cannot close it', (await call('ava', 'POST', `/api/requests/${samReq}/close`)).status === 403);
  // can't afford it at pick time: the request stays open
  await call('o', 'POST', `/api/games/${g}/grants`, { amount: -5000, memo: 'test', userIds: [id.jose] });
  const poor = (await call('jose', 'POST', `/api/games/${g}/requests`, { jobId: 'rapper', pricing: 'project' })).json.id;
  await call('ava', 'POST', `/api/requests/${poor}/apply`, {});
  const broke = await call('jose', 'POST', `/api/requests/${poor}/hire`, { userId: id.ava });
  check('job board: picking needs the cash, request stays open', broke.status === 400 && (await S('o')).requests.find((x) => x.id === poor).status === 'open', broke.json?.error);
  const exp = (await call('ava', 'GET', `/api/games/${g}/export.json`)).json;
  check('job board: in the data download', exp.job_requests.length >= 5);

  // ================= 6. deadlines =================
  await call('o', 'POST', `/api/contracts/${deal.id}/action`, { action: 'approve' });
  let c = (await S('devon')).contracts.find((x) => x.id === deal.id);
  const { schoolDueAt } = require(path.join(__dirname, '..', 'src', 'schooldays'));
  const approvedAt = (await db.query('SELECT approved_at FROM contracts WHERE id = $1', [deal.id])).rows[0].approved_at;
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(new Date(c.dueAt));
  check('deadline: 3 school days after approval, weekends skipped', c.dueAt === schoolDueAt(Number(approvedAt), 3) && !['Sat', 'Sun'].includes(wd) && c.overdue === false, wd);
  await db.query('UPDATE contracts SET approved_at = $1, updated_at = $2 WHERE id = $3', [Date.now() - 10 * DAY, Date.now(), deal.id]);
  await call('maria', 'POST', `/api/games/${g}/feed`, { message: 'nudge' }); // any change reloads the shared copy
  c = (await S('maria')).contracts.find((x) => x.id === deal.id);
  check('deadline: overdue once the date passes', c.overdue === true && c.late === true);
  await call('devon', 'POST', `/api/contracts/${deal.id}/action`, { action: 'deliver' });
  c = (await S('o')).contracts.find((x) => x.id === deal.id);
  check('deadline: delivered late is remembered', c.overdue === false && c.late === true && c.deliveredAt);
  check('deadline: late fee once', (await call('o', 'POST', `/api/contracts/${deal.id}/action`, { action: 'late_fee' })).status === 200
    && (await call('o', 'POST', `/api/contracts/${deal.id}/action`, { action: 'late_fee' })).status === 409);
  const ontime = (await call('ava', 'POST', `/api/games/${g}/contracts`, { sellerId: id.sam, jobId: 'lyricist', quantity: 1, dueDays: 5 })).json.id;
  await call('sam', 'POST', `/api/contracts/${ontime}/action`, { action: 'accept' });
  await call('o', 'POST', `/api/contracts/${ontime}/action`, { action: 'approve' });
  await call('sam', 'POST', `/api/contracts/${ontime}/action`, { action: 'deliver' });
  c = (await S('ava')).contracts.find((x) => x.id === ontime);
  check('deadline: on-time delivery', c.late === false && c.deliveredAt);

  // ================= 10 + 12. class mode taps and undo =================
  const before = (await S('o')).roster.find((p) => p.id === id.ava).stats.balance;
  const tap = await call('o', 'POST', `/api/games/${g}/charges`, { itemId: 'tardy', userIds: [id.ava], quantity: 1 });
  check('class mode: one tap charges the tardy fee', tap.status === 200 && tap.json.charged[0].amount === 67);
  st = await S('o');
  const fineRow = st.ledger.find((l) => l.userId === id.ava && l.kind === 'fine');
  check('undo: players cannot undo', (await call('ava', 'POST', `/api/ledger/${fineRow.id}/reverse`)).status === 403);
  check('undo: owner undoes the fine', (await call('o', 'POST', `/api/ledger/${fineRow.id}/reverse`)).status === 200);
  st = await S('o');
  check('undo: balance back to where it was', st.roster.find((p) => p.id === id.ava).stats.balance === before);
  check('undo: original marked undone, reversal linked', st.ledger.find((l) => l.id === fineRow.id).undone === true && st.ledger.some((l) => l.reverses === fineRow.id && l.amount === 67));
  check('undo: only once', (await call('o', 'POST', `/api/ledger/${fineRow.id}/reverse`)).status === 409);
  const rev = st.ledger.find((l) => l.reverses === fineRow.id);
  check('undo: cannot undo an undo', (await call('o', 'POST', `/api/ledger/${rev.id}/reverse`)).status === 400);
  await call('o', 'POST', `/api/games/${g}/charges`, { itemId: 'volunteer', userIds: [id.sam], quantity: 1 });
  const payRow = (await S('o')).ledger.find((l) => l.userId === id.sam && l.kind === 'grant' && /Volunteer/.test(l.memo));
  check('undo: a payout can be undone too', (await call('o', 'POST', `/api/ledger/${payRow.id}/reverse`)).status === 200);
  const adv = (await S('o')).ledger.find((l) => l.kind === 'advance');
  check('undo: deal money and advances are not undone here', (await call('o', 'POST', `/api/ledger/${adv.id}/reverse`)).status === 400);
  check('undo: student sees both entries in their own ledger', (await S('ava')).ledger.filter((l) => l.kind === 'fine').length === 2 && (await S('ava')).ledger.every((l) => l.by === undefined));

  // ================= 9. grading report =================
  const rep = await call('o', 'GET', `/api/games/${g}/report.pdf?tz=America/New_York`);
  check('report: whole class PDF', rep.status === 200 && rep.type === 'application/pdf' && rep.buf.slice(0, 5).toString() === '%PDF-', `${rep.buf.length} bytes`);
  const one = await call('o', 'GET', `/api/games/${g}/report.pdf?player=${id.maria}`);
  check('report: one student PDF', one.status === 200 && one.buf.slice(0, 5).toString() === '%PDF-' && one.buf.length < rep.buf.length);
  check('report: students cannot download it', (await call('maria', 'GET', `/api/games/${g}/report.pdf`)).status === 403);
  check('report: unknown student refused', (await call('o', 'GET', `/api/games/${g}/report.pdf?player=999999`)).status === 404);
  require('node:fs').writeFileSync(path.join(process.argv[2] || '.', 'report.pdf'), rep.buf);

  // ================= moving an artist closes their requests =================
  const g2 = (await call('o', 'POST', '/api/games', { name: 'Other Season', durationDays: 30 })).json.id;
  await call('ava', 'POST', `/api/contracts/${ontime}/action`, { action: 'confirm', rating: 5 }); // no open deals, so she can move
  const avaReq = (await call('ava', 'POST', `/api/games/${g}/requests`, { jobId: 'lyricist', quantity: 1 })).json.id;
  await call('o', 'PATCH', `/api/players/${id.ava}`, { gameId: g2 });
  check('move: their open requests close', (await S('o')).requests.find((x) => x.id === avaReq)?.status === 'closed');

  await db.end();
  console.log(`\n${pass} passed, ${failN} failed`);
})().catch((e) => { console.error(e); process.exit(1); });

// Reminders: owners nudge whoever a deal is waiting on; artists see their own until they tap "Got it".
// Usage: PGURL=postgres://... node tests/reminders.test.js OUTDIR   (fresh database, owner tester/0000)
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
const DAY = 86_400_000;

(async () => {
  const db = new pg.Client({ connectionString: process.env.PGURL }); await db.connect();
  await call('o', 'POST', '/api/login', { username: 'tester', pin: '0000' });
  const g = (await call('o', 'POST', '/api/games', { name: 'Reminders Test', durationDays: 90 })).json.id;
  const made = await call('o', 'POST', `/api/games/${g}/players/bulk`, { entries: ['Ada Lin', 'Bo Kim', 'Cal Ruiz'].map((n) => ({ displayName: n })) });
  const id = {}; for (const c of made.json.created) { const k = c.displayName.split(' ')[0].toLowerCase(); id[k] = c.id; await call(k, 'POST', '/api/claim', { username: c.username, code: c.claimCode, pin: '1234' }); }
  const S = async (who) => (await call(who, 'GET', `/api/games/${g}/state`)).json;
  const remind = (ids, note) => call('o', 'POST', `/api/games/${g}/reminders`, { contractIds: ids, note });

  await call('o', 'POST', `/api/games/${g}/phase`, { phase: 'active' });
  const deal = async (buyer, seller, dueDays = 2) => (await call(buyer, 'POST', `/api/games/${g}/contracts`, { sellerId: id[seller], jobId: 'lyricist', quantity: 1, dueDays })).json.id;
  // offered: Ada -> Bo (waiting on Bo to sign)
  const offered = await deal('ada', 'bo');
  // review: Ada -> Cal, signed (waiting on the teacher)
  const review = await deal('ada', 'cal'); await call('cal', 'POST', `/api/contracts/${review}/action`, { action: 'accept' });
  // active and overdue: Bo -> Cal
  const active = await deal('bo', 'cal'); await call('cal', 'POST', `/api/contracts/${active}/action`, { action: 'accept' }); await call('o', 'POST', `/api/contracts/${active}/action`, { action: 'approve' });
  await db.query('UPDATE contracts SET approved_at = $1 WHERE id = $2', [Date.now() - 20 * DAY, active]);
  // delivered: Cal -> Ada delivered (waiting on Cal to confirm)
  const delivered = await deal('cal', 'ada'); await call('ada', 'POST', `/api/contracts/${delivered}/action`, { action: 'accept' });
  await call('o', 'POST', `/api/contracts/${delivered}/action`, { action: 'approve' }); await call('ada', 'POST', `/api/contracts/${delivered}/action`, { action: 'deliver' });

  check('students cannot send reminders', (await call('ada', 'POST', `/api/games/${g}/reminders`, { contractIds: [offered] })).status === 403);
  check('needs at least one deal', (await remind([])).status === 400);
  const r = await remind([offered, review, active, delivered], 'Please wrap up by Friday.');
  check('reminders sent for the three deals waiting on an artist', r.status === 200 && r.json.sent.length === 3, JSON.stringify(r.json));
  check('a deal waiting on the teacher is skipped', r.json.skipped.some((x) => x.id === review));
  const to = Object.fromEntries(r.json.sent.map((x) => [x.id, x.userId]));
  check('each goes to the right artist (sign: seller, finish: seller, confirm: client)', to[offered] === id.bo && to[active] === id.cal && to[delivered] === id.cal);
  check('one per deal per hour (no double sends)', (await remind([active])).json.sent.length === 0);

  let st = await S('cal');
  const calR = st.reminders;
  check('Cal sees their two reminders', calR.length === 2 && calR.every((x) => x.userId === id.cal && !x.seenAt));
  const fin = calR.find((x) => x.contractId === active);
  check('"finish your job" message, says overdue, with the note', /^Finish your job: .* for Bo Kim, then mark it delivered\. It is overdue\. Please wrap up by Friday\.$/.test(fin.message), fin.message);
  check('confirm & pay message', /Ada Lin delivered .*confirm & pay/.test(calR.find((x) => x.contractId === delivered).message));
  st = await S('bo');
  check('Bo sees only their own (sign the offer)', st.reminders.length === 1 && /wants to hire you .*Sign the contract/.test(st.reminders[0].message));
  check('Ada has none', (await S('ada')).reminders.length === 0);
  check('owners see every reminder (to show "reminded")', (await S('o')).reminders.length === 3);
  check('nothing goes in the lobby', !(await S('o')).feed.some((f) => /Finish your job|Please wrap up/.test(f.message)));

  // Got it
  check('others cannot mark it seen', (await call('ada', 'POST', `/api/reminders/${fin.id}/seen`)).status === 404);
  check('Cal taps Got it', (await call('cal', 'POST', `/api/reminders/${fin.id}/seen`)).status === 200);
  check('marked seen (owners see that too)', (await S('cal')).reminders.find((x) => x.id === fin.id).seenAt > 0 && (await S('o')).reminders.find((x) => x.id === fin.id).seenAt > 0);

  // a due date in the future: says when
  const fresh = await deal('ada', 'bo', 3); await call('bo', 'POST', `/api/contracts/${fresh}/action`, { action: 'accept' }); await call('o', 'POST', `/api/contracts/${fresh}/action`, { action: 'approve' });
  await remind([fresh]);
  check('not overdue: the reminder says when it is due', /It's due \w+day, \w{3} \d+\./.test((await S('bo')).reminders.find((x) => x.contractId === fresh).message));
  // after an hour, it can be sent again
  await db.query('UPDATE reminders SET created_at = created_at - $1 WHERE contract_id = $2', [2 * 3_600_000, active]);
  check('after an hour it can be sent again', (await remind([active])).json.sent.length === 1);
  check('deals from another season are ignored', (await call('o', 'POST', `/api/games/${(await call('o', 'POST', '/api/games', { name: 'Other', durationDays: 30 })).json.id}/reminders`, { contractIds: [active] })).status === 400);
  // not before the season starts or once archived
  await db.query("UPDATE games SET status = 'archived' WHERE id = $1", [g]);
  await call('o', 'POST', `/api/games/${g}/calendar`, { title: 'bump', day: '2026-12-01' }).catch(() => {});
  check('archived: no reminders', (await remind([offered])).status === 400);
  await db.end();
  console.log(`\n${pass} passed, ${failN} failed`);
})().catch((e) => { console.error(e); process.exit(1); });

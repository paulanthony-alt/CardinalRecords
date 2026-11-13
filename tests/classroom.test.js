// Classroom-style end-to-end run of the main flows. Usage: node t5.js OUTDIR
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const out = process.argv[2];
const B = (process.env.BASE || 'http://localhost:3199');
const jars = {};
async function call(who, method, path, body) {
  const res = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', cookie: jars[who] || '' }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) jars[who] = sc.split(';')[0];
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null; try { json = JSON.parse(buf.toString()); } catch {}
  return { status: res.status, json, buf };
}

// Sign-up codes: owners see them in the roster; students need one to claim.
async function codeFor(owner, gameId, username) {
  const s = (await call(owner, 'GET', `/api/games/${gameId}/state`)).json;
  return s.roster.find((p) => p.username.toLowerCase() === username.toLowerCase())?.claimCode;
}
async function claim(who, owner, gameId, username, pin) {
  return call(who, 'POST', '/api/claim', { username, pin, code: await codeFor(owner, gameId, username) });
}
let pass = 0, failN = 0;
const check = (name, cond, extra = '') => { if (cond) pass++; else failN++; if (!cond || process.env.V) console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
const st = async (who, g) => (await call(who, 'GET', `/api/games/${g}/state`)).json;
const bal = (s, id) => s.roster.find((p) => p.id === id)?.stats.balance;

(async () => {
  // ---- owners
  const o1 = await call('bf', 'POST', '/api/login', { username: 'BFreeds', pin: '1234' });
  check('owner signs in', o1.status === 200);
  const me0 = (await call('bf', 'GET', '/api/me')).json;
  check('starting PIN flagged', me0.user.startingPin === true);
  check('owner PIN change', (await call('bf', 'PUT', '/api/me/pin', { currentPin: '1234', newPin: '8642' })).status === 200);
  check('old owner PIN refused', (await call('x', 'POST', '/api/login', { username: 'BFreeds', pin: '1234' })).status === 401);
  check('new owner PIN works', (await call('bf', 'POST', '/api/login', { username: 'bfreeds', pin: '8642' })).status === 200, 'case-insensitive username');
  await call('jp', 'POST', '/api/login', { username: 'JPolise', pin: '1234' });

  // ---- season + 30 students
  const g = (await call('bf', 'POST', '/api/games', { name: 'Period 3', durationDays: 120 })).json.id;
  check('season defaults: $1,000 advance, 0% cut', (await st('bf', g)).game.starting_balance === 1000 && (await st('bf', g)).game.label_cut_pct === 0);
  const ids = [];
  for (let i = 1; i <= 30; i++) {
    const r = await call(i % 2 ? 'bf' : 'jp', 'POST', `/api/games/${g}/players`, { username: `kid${i}`, displayName: `Kid ${i}`, roleTitle: 'Producer' });
    ids.push(r.json?.id);
  }
  check('30 students signed (both owners)', ids.every(Boolean));
  check('31st refused (roster full)', (await call('bf', 'POST', `/api/games/${g}/players`, { username: 'kid31' })).status === 400);
  check('duplicate username refused', (await call('bf', 'POST', `/api/games/${g}/players`, { username: 'KID1' })).status === 400);
  // lookup + claim
  const lk = (await call('k1', 'POST', '/api/login/lookup', { username: 'kid1' })).json;
  check('lookup shows unclaimed', lk.claimed === false);
  check('bad PIN on claim refused', (await claim('k1', 'bf', g, 'kid1', '12')).status === 400);
  for (let i = 1; i <= 30; i++) await claim(`k${i}`, 'bf', g, `kid${i}`, String(4000 + i));
  check('claim twice refused', (await call('zz', 'POST', '/api/claim', { username: 'kid1', pin: '9999', code: 'ABCDEF' })).status === 409);
  check('player blocked from owner routes', (await call('k1', 'POST', `/api/games/${g}/phase`, { phase: 'active' })).status === 403);
  check('deal before season starts refused', (await call('k1', 'POST', `/api/games/${g}/contracts`, { sellerId: ids[1], jobId: 'lyricist', quantity: 1 })).status === 400);

  // ---- start
  check('season starts', (await call('jp', 'POST', `/api/games/${g}/phase`, { phase: 'active' })).status === 200);
  let s = await st('bf', g);
  check('everyone got $1,000', s.roster.every((p) => p.stats.balance === 1000));
  const ps = await st('k1', g);
  check('players never see PINs', ps.roster.every((p) => p.pin === undefined));
  check('owner sees PINs', s.roster.every((p) => p.pin));
  check('late signing gets advance', true);

  // ---- hire flow: kid1 hires kid2 for 3 hours of beat making ($120)
  const c1 = (await call('k1', 'POST', `/api/games/${g}/contracts`, { sellerId: ids[1], jobId: 'beat-maker', quantity: 3, terms: 'three beats' })).json.id;
  s = await st('bf', g);
  check('price from rate sheet ($40 x 3)', s.contracts.find((c) => c.id === c1).amount === 120);
  check('escrow held', bal(s, ids[0]) === 880);
  check('self-hire refused', (await call('k1', 'POST', `/api/games/${g}/contracts`, { sellerId: ids[0], jobId: 'lyricist', quantity: 1 })).status === 400);
  check('overspend refused', (await call('k1', 'POST', `/api/games/${g}/contracts`, { sellerId: ids[2], jobId: 'rapper', quantity: 100 })).status === 400);
  check('inactive job refused', (await call('k1', 'POST', `/api/games/${g}/contracts`, { sellerId: ids[2], jobId: 'nope', quantity: 1 })).status === 400);
  check('wrong person cannot accept', (await call('k3', 'POST', `/api/contracts/${c1}/action`, { action: 'accept' })).status === 403);
  check('seller accepts', (await call('k2', 'POST', `/api/contracts/${c1}/action`, { action: 'accept' })).status === 200);
  check('player cannot approve', (await call('k1', 'POST', `/api/contracts/${c1}/action`, { action: 'approve' })).status === 403);
  check('either owner approves', (await call('jp', 'POST', `/api/contracts/${c1}/action`, { action: 'approve' })).status === 200);
  check('deliver', (await call('k2', 'POST', `/api/contracts/${c1}/action`, { action: 'deliver', note: 'sent' })).status === 200);
  check('revise', (await call('k1', 'POST', `/api/contracts/${c1}/action`, { action: 'revise' })).status === 200);
  await call('k2', 'POST', `/api/contracts/${c1}/action`, { action: 'deliver' });
  check('confirm with rating', (await call('k1', 'POST', `/api/contracts/${c1}/action`, { action: 'confirm', rating: 5 })).status === 200);
  s = await st('bf', g);
  check('seller paid $120', bal(s, ids[1]) === 1120);
  check('confirm twice refused', (await call('k1', 'POST', `/api/contracts/${c1}/action`, { action: 'confirm' })).status === 403);
  // project pricing + game bonus after 2 different hires
  const c2 = (await call('k1', 'POST', `/api/games/${g}/contracts`, { sellerId: ids[2], jobId: 'graphic-designer', pricing: 'project' })).json.id;
  await call('k3', 'POST', `/api/contracts/${c2}/action`, { action: 'accept' });
  await call('bf', 'POST', `/api/contracts/${c2}/action`, { action: 'approve' });
  await call('bf', 'POST', `/api/contracts/${c2}/action`, { action: 'complete' });
  s = await st('bf', g);
  check('project rate $500 + $40 game bonus', bal(s, ids[0]) === 1000 - 120 - 500 + 40, `balance ${bal(s, ids[0])}`);
  check('bonus announced', s.feed.some((f) => /Game Bonus/.test(f.message)));
  // decline / withdraw / reject refund
  const c3 = (await call('k4', 'POST', `/api/games/${g}/contracts`, { sellerId: ids[4], jobId: 'lyricist', quantity: 1 })).json.id;
  await call('k5', 'POST', `/api/contracts/${c3}/action`, { action: 'decline' });
  const c4 = (await call('k4', 'POST', `/api/games/${g}/contracts`, { sellerId: ids[4], jobId: 'lyricist', quantity: 1 })).json.id;
  await call('k4', 'POST', `/api/contracts/${c4}/action`, { action: 'withdraw' });
  const c5 = (await call('k4', 'POST', `/api/games/${g}/contracts`, { sellerId: ids[4], jobId: 'lyricist', quantity: 1 })).json.id;
  await call('k5', 'POST', `/api/contracts/${c5}/action`, { action: 'accept' });
  await call('bf', 'POST', `/api/contracts/${c5}/action`, { action: 'reject' });
  s = await st('bf', g);
  check('decline/withdraw/reject all refund', bal(s, ids[3]) === 1000 && s.roster.find((p) => p.id === ids[3]).stats.escrow === 0);
  // undone fine
  const c6 = (await call('k6', 'POST', `/api/games/${g}/contracts`, { sellerId: ids[6], jobId: 'lyricist', quantity: 1 })).json.id;
  await call('k7', 'POST', `/api/contracts/${c6}/action`, { action: 'accept' });
  await call('bf', 'POST', `/api/contracts/${c6}/action`, { action: 'approve' });
  await call('bf', 'POST', `/api/contracts/${c6}/action`, { action: 'undone' });
  s = await st('bf', g);
  check('undone: artist fined $100, client refunded', bal(s, ids[6]) === 900 && bal(s, ids[5]) === 1000);

  // ---- treasury
  check('per-item fine (2 songs mixing)', (await call('bf', 'POST', `/api/games/${g}/charges`, { itemId: 'mixing-time', quantity: 2, userIds: [ids[7]] })).json?.charged?.[0]?.amount === 200);
  check('min fine below minimum refused', (await call('bf', 'POST', `/api/games/${g}/charges`, { itemId: 'general', amount: 10, userIds: [ids[8]] })).status === 400);
  check('percent fine 50%', (await call('bf', 'POST', `/api/games/${g}/charges`, { itemId: 'cheating', percent: 50, userIds: [ids[9]] })).json?.charged?.[0]?.amount === 500);
  check('volunteer payout to all', (await call('jp', 'POST', `/api/games/${g}/charges`, { itemId: 'volunteer', quantity: 1, userIds: 'all' })).json?.charged?.length === 30);
  check('custom grant', (await call('bf', 'POST', `/api/games/${g}/grants`, { amount: 25, memo: 'best mix', userIds: [ids[10]] })).status === 200);
  check('fine can go below $0', (await call('bf', 'POST', `/api/games/${g}/grants`, { amount: -5000, memo: 'test', userIds: [ids[11]] })).status === 200);
  s = await st('bf', g);
  check('fines not in lobby', !s.feed.some((f) => /Cheating|Mixing time|-\$5,000/.test(f.message)));
  const k10 = await st('k10', g);
  check('student sees own fine only', k10.ledger.some((l) => l.kind === 'fine') && k10.ledger.every((l) => l.userId === ids[9]));
  check('broke student cannot hire', (await call('k12', 'POST', `/api/games/${g}/contracts`, { sellerId: ids[0], jobId: 'lyricist', quantity: 1 })).status === 400);

  // ---- rates + settings
  check('owner edits rate', (await call('bf', 'PUT', `/api/games/${g}/rates`, { jobs: { lyricist: { unitRate: 45, projectRate: 450 } } })).status === 200);
  const c7 = (await call('k14', 'POST', `/api/games/${g}/contracts`, { sellerId: ids[14], jobId: 'lyricist', quantity: 2 })).json.id;
  check('new rate applies', (await st('bf', g)).contracts.find((c) => c.id === c7).amount === 90);
  check('player cannot edit rates', (await call('k1', 'PUT', `/api/games/${g}/rates`, {})).status === 403);
  check('settings save', (await call('jp', 'PATCH', `/api/games/${g}`, { name: 'Period 3', durationDays: 150 })).status === 200);

  // ---- social, profile, guide
  check('lobby chat', (await call('k1', 'POST', `/api/games/${g}/feed`, { message: 'hi label <script>x</script>' })).status === 200);
  check('profile save', (await call('k1', 'PUT', '/api/me', { displayName: 'Kid One', roleTitle: 'Producer', bio: 'hey', color: '#123456' })).status === 200);
  check('student PIN change', (await call('k1', 'PUT', '/api/me/pin', { currentPin: '4001', newPin: '5555' })).status === 200);
  check('Release Guide hidden until opened', (await call('k1', 'PUT', '/api/me/tutorial', { step: 'master', done: true })).status === 403);
  check('owner opens the Release Guide', (await call('bf', 'POST', `/api/games/${g}/guide`, { open: true })).status === 200);
  check('tutorial step', (await call('k1', 'PUT', '/api/me/tutorial', { step: 'master', done: true })).status === 200);
  check('cannot see another season', (await call('k1', 'GET', `/api/games/${g + 999}/state`)).status === 404);

  // ---- lockout
  for (let i = 0; i < 5; i++) await call('bad', 'POST', '/api/login', { username: 'kid20', pin: '0000' });
  check('5 wrong PINs locks out', (await call('bad', 'POST', '/api/login', { username: 'kid20', pin: '4020' })).status === 429);

  // ---- owner tools on students
  check('reset PIN', (await call('bf', 'POST', `/api/players/${ids[21]}/reset-pin`)).status === 200);
  check('reset student re-claims', (await claim('k22', 'bf', g, 'kid22', '7777')).status === 200);
  check('remove student', (await call('bf', 'PATCH', `/api/players/${ids[22]}`, { active: false })).status === 200);
  check('removed student signed out', (await call('k23', 'GET', '/api/me')).status === 401);

  // ---- load: 30 students polling at once, and a double-spend race
  let t = Date.now();
  const polls = await Promise.all(Array.from({ length: 30 }, (_, i) => call(`k${i + 1}`, 'GET', i === 22 ? '/api/me' : `/api/games/${g}/state`)));
  check('30 simultaneous polls', polls.filter((p, i) => i !== 22).every((p) => p.status === 200), `${Date.now() - t}ms total`);
  // kid16 has $1,040; fire 5 offers of $750 at once: only one may succeed
  const race = await Promise.all(Array.from({ length: 5 }, (_, i) => call('k16', 'POST', `/api/games/${g}/contracts`, { sellerId: ids[17 + i], jobId: 'rapper', pricing: 'project' })));
  s = await st('bf', g);
  check('no double spend under race', race.filter((r) => r.status === 200).length === 1 && bal(s, ids[15]) >= 0, `${race.filter((r) => r.status === 200).length} accepted, balance ${bal(s, ids[15])}`);

  // ---- showcase + exports
  await call('bf', 'POST', `/api/games/${g}/phase`, { phase: 'showcase' });
  check('sharing closed until opened', (await call('k1', 'POST', `/api/games/${g}/tracks`, { url: 'https://soundcloud.com/a/b', title: 'x' })).status === 400);
  await call('bf', 'POST', `/api/games/${g}/uploads`, { open: true });
  const tr = await call('k1', 'POST', `/api/games/${g}/tracks`, { url: 'soundcloud.com/a/b', title: 'Night Drive' });
  check('share link (https added)', tr.status === 200);
  check('javascript: link refused', (await call('k1', 'POST', `/api/games/${g}/tracks`, { url: 'javascript:alert(1)', title: 'x' })).status === 400);
  check('like', (await call('k2', 'POST', `/api/tracks/${tr.json.id}/like`)).json?.liked === true);
  check('cannot like own', (await call('k1', 'POST', `/api/tracks/${tr.json.id}/like`)).status === 400);
  await call('k2', 'POST', `/api/tracks/${tr.json.id}/play`);
  const zip = await call('k5', 'GET', `/api/games/${g}/export.zip`);
  fs.writeFileSync(`${out}/p.zip`, zip.buf);
  let zipOk = false; try { const l = execFileSync('unzip', ['-l', `${out}/p.zip`]).toString(); zipOk = /data\.json/.test(l) && /csv\/ledger\.csv/.test(l); } catch {}
  check('student ZIP is valid', zipOk);
  const pdf = await call('jp', 'GET', `/api/games/${g}/backup.pdf?pins=1`);
  fs.writeFileSync(`${out}/p3.pdf`, pdf.buf);
  check('owner PDF backup', pdf.status === 200 && pdf.buf.slice(0, 5).toString() === '%PDF-');
  await call('bf', 'POST', `/api/games/${g}/phase`, { phase: 'archived' });
  check('archived: no chat', (await call('k1', 'POST', `/api/games/${g}/feed`, { message: 'x' })).status === 400);
  check('archived: data still downloads', (await call('k1', 'GET', `/api/games/${g}/export.json`)).status === 200);
  console.log(`\n${pass} passed, ${failN} failed`);
})().catch((e) => { console.error(e); process.exit(1); });

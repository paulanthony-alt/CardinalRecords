// Sign-up codes and deleting never-started seasons. Usage: node t7.js OUTDIR
const B = (process.env.BASE || 'http://localhost:3199'); const jars = {};
async function call(who, method, path, body) {
  const res = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', cookie: jars[who] || '' }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) jars[who] = sc.split(';')[0];
  let json = null; try { json = await res.json(); } catch {} return { status: res.status, json };
}
let pass = 0, failN = 0;
const check = (n, c, x = '') => { c ? pass++ : failN++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };
(async () => {
  await call('o', 'POST', '/api/login', { username: 'tester', pin: '0000' });
  const g = (await call('o', 'POST', '/api/games', { name: 'Codes Test', durationDays: 30 })).json.id;
  const a = (await call('o', 'POST', `/api/games/${g}/players`, { username: 'amy', displayName: 'Amy' })).json.id;
  await call('o', 'POST', `/api/games/${g}/players`, { username: 'ben', displayName: 'Ben' });
  let s = (await call('o', 'GET', `/api/games/${g}/state`)).json;
  const code = s.roster.find((p) => p.id === a).claimCode;
  check('owner sees a 6-character code', /^[A-HJ-NP-Z2-9]{6}$/.test(code || ''), code);
  check('codes differ per student', s.roster[0].claimCode !== s.roster[1].claimCode);
  const look = (await call('x', 'POST', '/api/login/lookup', { username: 'amy' })).json;
  check('lookup does not reveal the code', look.claimCode === undefined && look.claimed === false);
  check('claim without code refused', (await call('x', 'POST', '/api/claim', { username: 'amy', pin: '1111' })).status === 401);
  check('claim with wrong code refused', (await call('x', 'POST', '/api/claim', { username: 'amy', pin: '1111', code: 'ZZZZZZ' })).status === 401);
  check('check with wrong code refused', (await call('x', 'POST', '/api/claim/check', { username: 'amy', code: 'ZZZZZZ' })).status === 401);
  const messy = `${code.slice(0, 3).toLowerCase()}- ${code.slice(3)}`;
  check('code check ignores case, spaces, dashes', (await call('a', 'POST', '/api/claim/check', { username: 'amy', code: messy })).status === 200, messy);
  check('claim with code works', (await call('a', 'POST', '/api/claim', { username: 'amy', pin: '1111', code: messy })).status === 200);
  check('signed in after claim', (await call('a', 'GET', '/api/me')).json?.user?.username === 'amy');
  check('code is single-use', (await call('y', 'POST', '/api/claim', { username: 'amy', pin: '2222', code })).status === 409);
  s = (await call('o', 'GET', `/api/games/${g}/state`)).json;
  check('code gone once claimed', s.roster.find((p) => p.id === a).claimCode === null);
  const ps = (await call('a', 'GET', `/api/games/${g}/state`)).json;
  check('students never see codes', ps.roster.every((p) => p.claimCode === undefined));
  const pe = (await call('a', 'GET', `/api/games/${g}/export.json`)).json;
  check('student export has no codes', pe.players.every((p) => p.claim_code === undefined));
  const oe = (await call('o', 'GET', `/api/games/${g}/export.json`)).json;
  check('owner export has unclaimed codes', oe.players.some((p) => p.claim_code));
  // lockout on guessing
  for (let i = 0; i < 5; i++) await call('z', 'POST', '/api/claim/check', { username: 'ben', code: 'AAAAAA' });
  const benCode = s.roster.find((p) => p.username === 'ben').claimCode;
  check('5 wrong codes locks out (even the right one)', (await call('z', 'POST', '/api/claim/check', { username: 'ben', code: benCode })).status === 429);
  // reset issues a fresh code
  const r = await call('o', 'POST', `/api/players/${a}/reset-pin`);
  check('reset gives a new code', /^[A-HJ-NP-Z2-9]{6}$/.test(r.json?.claimCode || '') && r.json.claimCode !== code);
  check('reset signs the student out', (await call('a', 'GET', '/api/me')).status === 401);
  check('old PIN no longer works', (await call('a', 'POST', '/api/login', { username: 'amy', pin: '1111' })).status === 409);
  check('re-claim with the new code', (await call('a', 'POST', '/api/claim', { username: 'amy', pin: '3333', code: r.json.claimCode })).status === 200);
  check('players cannot reset', (await call('a', 'POST', `/api/players/${a}/reset-pin`)).status === 403);
  // race: two claims with the right code at once, only one wins
  const c2 = (await call('o', 'POST', `/api/games/${g}/players`, { username: 'cal' })).json.id;
  const calCode = (await call('o', 'GET', `/api/games/${g}/state`)).json.roster.find((p) => p.id === c2).claimCode;
  const race = await Promise.all([call('r1', 'POST', '/api/claim', { username: 'cal', pin: '1212', code: calCode }), call('r2', 'POST', '/api/claim', { username: 'cal', pin: '3434', code: calCode })]);
  check('two claims at once: only one wins', race.filter((x) => x.status === 200).length === 1, race.map((x) => x.status).join('/'));
  // PDF with pins shows codes
  const pdf = await fetch(`${B}/api/games/${g}/backup.pdf?pins=1`, { headers: { cookie: jars.o } });
  check('PDF with PINs downloads', pdf.status === 200);

  // ---- delete never-started season
  check('players cannot delete', (await call('a', 'DELETE', `/api/games/${g}`, { confirm: 'Codes Test' })).status === 403);
  check('delete needs the name', (await call('o', 'DELETE', `/api/games/${g}`, { confirm: 'nope' })).status === 400);
  const d = await call('o', 'DELETE', `/api/games/${g}`, { confirm: 'codes test' });
  check('delete a never-started season', d.status === 200 && d.json.artistsRemoved === 3, JSON.stringify(d.json));
  check('season is gone', (await call('o', 'GET', `/api/games/${g}/state`)).status === 404);
  check('its artists are gone', (await call('q', 'POST', '/api/login/lookup', { username: 'amy' })).status === 404);
  check('usernames free again', (await call('o', 'POST', '/api/games', { name: 'Real Season', durationDays: 90 })).status === 200);
  const g2 = (await call('o', 'GET', '/api/me')).json.games.find((x) => x.name === 'Real Season').id;
  check('reuse username', (await call('o', 'POST', `/api/games/${g2}/players`, { username: 'amy' })).status === 200);
  await call('o', 'POST', `/api/games/${g2}/phase`, { phase: 'active' });
  check('started season cannot be deleted', (await call('o', 'DELETE', `/api/games/${g2}`, { confirm: 'Real Season' })).status === 400);
  console.log(`\n${pass} passed, ${failN} failed`);
})().catch((e) => { console.error(e); process.exit(1); });

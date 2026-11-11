// Artist profile links: set, validate, show, lobby post, owner removal, export, PDF.
// Usage: node tests/profiles.test.js OUTDIR   (fresh database, owner tester/0000)
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
  const g = (await call('o', 'POST', '/api/games', { name: 'Profiles Test', durationDays: 30 })).json.id;
  for (const u of ['ava', 'ben']) await call('o', 'POST', `/api/games/${g}/players`, { username: u, displayName: u.toUpperCase() });
  let st = (await call('o', 'GET', `/api/games/${g}/state`)).json;
  const id = {}; for (const p of st.roster) { id[p.username] = p.id; await call(p.username, 'POST', '/api/claim', { username: p.username, code: p.claimCode, pin: '1234' }); }
  const prof = (b) => ({ displayName: 'AVA', roleTitle: 'Producer', bio: 'Beats and mixes', color: '#123456', ...b });
  const slides = 'https://docs.google.com/presentation/d/1AbCdEf/edit?usp=sharing';
  check('profiles work before the season starts', (await call('ava', 'PUT', '/api/me', prof({ profileUrl: slides }))).status === 200);
  st = (await call('ben', 'GET', `/api/games/${g}/state`)).json;
  check('labelmates see the link', st.roster.find((p) => p.id === id.ava).profileUrl === slides);
  check('lobby announces it', st.feed.some((f) => f.kind === 'profile' && /AVA shared their artist profile/.test(f.message)));
  for (const [label, url] of [['YouTube', 'https://youtube.com/watch?v=x'], ['javascript:', 'javascript:alert(1)'], ['look-alike host', 'https://docs.google.com.evil.example/x'], ['plain text', 'my profile']]) {
    check(`refuses ${label}`, (await call('ava', 'PUT', '/api/me', prof({ profileUrl: url }))).status === 400);
  }
  check('link unchanged after refused tries', (await call('ben', 'GET', `/api/games/${g}/state`)).json.roster.find((p) => p.id === id.ava).profileUrl === slides);
  check('accepts Google Docs', (await call('ava', 'PUT', '/api/me', prof({ profileUrl: 'docs.google.com/document/d/9xYz/edit' }))).status === 200);
  st = (await call('ben', 'GET', `/api/games/${g}/state`)).json;
  check('adds https:// when missing', st.roster.find((p) => p.id === id.ava).profileUrl === 'https://docs.google.com/document/d/9xYz/edit');
  check('lobby says "updated" the second time', st.feed.some((f) => /AVA updated their artist profile/.test(f.message)));
  check('accepts Drive and Sites', (await call('ben', 'PUT', '/api/me', prof({ displayName: 'BEN', profileUrl: 'https://drive.google.com/file/d/1/view' }))).status === 200
    && (await call('ben', 'PUT', '/api/me', prof({ displayName: 'BEN', profileUrl: 'https://sites.google.com/view/ben-music' }))).status === 200);
  check('saving the profile without the field keeps the link', (await call('ben', 'PUT', '/api/me', { displayName: 'BEN', roleTitle: '', bio: '', color: '#222222' })).status === 200
    && (await call('o', 'GET', `/api/games/${g}/state`)).json.roster.find((p) => p.id === id.ben).profileUrl === 'https://sites.google.com/view/ben-music');
  check('student can remove their own link', (await call('ben', 'PUT', '/api/me', prof({ displayName: 'BEN', profileUrl: '' }))).status === 200
    && (await call('o', 'GET', `/api/games/${g}/state`)).json.roster.find((p) => p.id === id.ben).profileUrl === null);
  check('students cannot remove someone else\'s link', (await call('ben', 'PATCH', `/api/players/${id.ava}`, { profileUrl: '' })).status === 403);
  const ex = (await call('ben', 'GET', `/api/games/${g}/export.json`)).json;
  check('in the data download', ex.players.find((p) => p.id === id.ava).profile_url.startsWith('https://docs.google.com/document'));
  const pdf = await fetch(`${B}/api/games/${g}/backup.pdf`, { headers: { cookie: jars.o } });
  check('PDF backup still builds', pdf.status === 200);
  check('owner can remove a link', (await call('o', 'PATCH', `/api/players/${id.ava}`, { profileUrl: '' })).status === 200
    && (await call('ben', 'GET', `/api/games/${g}/state`)).json.roster.find((p) => p.id === id.ava).profileUrl === null);
  check('owner can hide profile posts in the lobby', (await call('o', 'PUT', `/api/games/${g}/lobby`, { show: { profile: false } })).status === 200
    && !(await call('ben', 'GET', `/api/games/${g}/state`)).json.feed.some((f) => f.kind === 'profile'));
  console.log(`\n${pass} passed, ${failN} failed`);
})().catch((e) => { console.error(e); process.exit(1); });

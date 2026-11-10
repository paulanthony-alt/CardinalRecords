// Lobby controls: hide/show, pin, delete, mute, chat modes, what students see, clear chat.
// Usage: node tests/lobby.test.js OUTDIR   (expects a fresh database, owner tester/0000)
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
  const g = (await call('o', 'POST', '/api/games', { name: 'Lobby Test', durationDays: 30 })).json.id;
  for (const u of ['ana', 'bob', 'cyd']) await call('o', 'POST', `/api/games/${g}/players`, { username: u, displayName: u.toUpperCase() });
  let st = (await call('o', 'GET', `/api/games/${g}/state`)).json;
  const id = {}; for (const p of st.roster) { id[p.username] = p.id; await call(p.username, 'POST', '/api/claim', { username: p.username, code: p.claimCode, pin: '1234' }); }
  await call('o', 'POST', `/api/games/${g}/phase`, { phase: 'active' });
  const S = async (who) => (await call(who, 'GET', `/api/games/${g}/state`)).json;
  const msgs = async (who) => (await S(who)).feed.filter((f) => f.kind === 'chat').map((f) => f.message);

  st = await S('ana');
  check('defaults: chat open, everything shown', st.lobby.chat === 'open' && Object.values(st.lobby.show).every(Boolean) && st.lobby.categories.length === 9);
  check('student can chat', (await call('ana', 'POST', `/api/games/${g}/feed`, { message: 'hello from ana' })).status === 200);
  await call('bob', 'POST', `/api/games/${g}/feed`, { message: 'rude message from bo' });
  await call('cyd', 'POST', `/api/games/${g}/feed`, { message: 'cy says hi' });
  const rude = (await S('o')).feed.find((f) => f.message === 'rude message from bo').id;

  // hide / show
  check('players cannot moderate', (await call('ana', 'POST', `/api/feed/${rude}/moderate`, { action: 'hide' })).status === 403);
  check('owner hides a message', (await call('o', 'POST', `/api/feed/${rude}/moderate`, { action: 'hide' })).status === 200);
  check('students no longer see it', !(await msgs('ana')).includes('rude message from bo') && !(await msgs('bob')).includes('rude message from bo'));
  const of = (await S('o')).feed.find((f) => f.id === rude);
  check('owner still sees it, marked hidden', of && of.hidden === true);
  check('students never get the hidden flag', (await S('ana')).feed.every((f) => f.hidden === undefined));
  const ex = (await call('ana', 'GET', `/api/games/${g}/export.json`)).json;
  check("student's download leaves it out", !ex.feed.some((f) => f.id === rude) && ex.feed.every((f) => f.hidden === undefined));
  await call('o', 'POST', `/api/feed/${rude}/moderate`, { action: 'show' });
  check('show brings it back', (await msgs('cyd')).includes('rude message from bo'));

  // pin
  const hi = (await S('o')).feed.find((f) => f.message === 'cy says hi').id;
  await call('o', 'POST', `/api/feed/${hi}/moderate`, { action: 'pin' });
  check('pinned post reaches students', (await S('ana')).lobby.pinned?.id === hi);
  await call('o', 'POST', `/api/feed/${hi}/moderate`, { action: 'hide' });
  check('a hidden pinned post is not shown to students', (await S('ana')).lobby.pinned === null && (await S('o')).lobby.pinned?.id === hi);
  await call('o', 'POST', `/api/feed/${hi}/moderate`, { action: 'show' });

  // delete
  check('players cannot delete', (await call('bob', 'DELETE', `/api/feed/${hi}`)).status === 403);
  check('owner deletes a message', (await call('o', 'DELETE', `/api/feed/${hi}`)).status === 200);
  check('deleted for everyone, pin cleared', !(await msgs('o')).includes('cy says hi') && (await S('o')).lobby.pinned === null);

  // mute
  check('mute a student', (await call('o', 'PATCH', `/api/players/${id.bob}`, { muted: true })).status === 200);
  const mp = await call('bob', 'POST', `/api/games/${g}/feed`, { message: 'can I post?' });
  check('muted student cannot post', mp.status === 403, mp.json?.error);
  st = await S('bob');
  check('muted student is told, and can still read', st.lobby.mutedMe === true && st.feed.length > 0);
  check('other students do not see who is muted', (await S('ana')).roster.every((p) => p.muted === undefined) && (await S('ana')).lobby.mutedMe === false);
  check('owners see the muted flag', (await S('o')).roster.find((p) => p.id === id.bob).muted === true);
  await call('o', 'PATCH', `/api/players/${id.bob}`, { muted: false });
  check('unmuted student can post again', (await call('bob', 'POST', `/api/games/${g}/feed`, { message: 'thanks' })).status === 200);

  // chat modes
  check('bad chat setting refused', (await call('o', 'PUT', `/api/games/${g}/lobby`, { chat: 'party' })).status === 400);
  check('players cannot change lobby settings', (await call('ana', 'PUT', `/api/games/${g}/lobby`, { chat: 'open' })).status === 403);
  await call('o', 'PUT', `/api/games/${g}/lobby`, { chat: 'announce' });
  check('announcements only: students cannot post', (await call('ana', 'POST', `/api/games/${g}/feed`, { message: 'x' })).status === 403);
  check('announcements only: owners can', (await call('o', 'POST', `/api/games/${g}/feed`, { message: 'Class starts at 9' })).status === 200);
  check('announcements only: students still read', (await S('ana')).feed.some((f) => f.message === 'Class starts at 9'));
  await call('o', 'PUT', `/api/games/${g}/lobby`, { chat: 'off' });
  st = await S('ana');
  check('lobby hidden: students get no lobby at all', st.lobby.chat === 'off' && st.feed.length === 0 && st.lobby.pinned === null);
  check('lobby hidden: student download has no lobby', (await call('ana', 'GET', `/api/games/${g}/export.json`)).json.feed.length === 0);
  check('lobby hidden: owners still see it', (await S('o')).feed.length > 0);
  check('lobby hidden: students cannot post', (await call('ana', 'POST', `/api/games/${g}/feed`, { message: 'x' })).status === 403);
  await call('o', 'PUT', `/api/games/${g}/lobby`, { chat: 'open' });

  // what students see
  await call('o', 'PUT', `/api/games/${g}/lobby`, { show: { join: false, phase: false } });
  st = await S('ana');
  check('hidden categories disappear for students', !st.feed.some((f) => ['join', 'phase'].includes(f.kind)) && st.lobby.show.join === false);
  check('other categories stay', st.feed.some((f) => f.kind === 'chat'));
  check('owners still see hidden categories', (await S('o')).feed.some((f) => f.kind === 'join'));
  await call('o', 'PUT', `/api/games/${g}/lobby`, { show: { join: true } });
  check('turning one back on keeps the others as set', (await S('ana')).lobby.show.join === true && (await S('ana')).lobby.show.phase === false);

  // clear chat
  const cc = await call('o', 'POST', `/api/games/${g}/lobby/clear-chat`);
  st = await S('o');
  check('clear chat deletes all student chat', cc.json?.deleted >= 3 && !st.feed.some((f) => f.kind === 'chat'), JSON.stringify(cc.json));
  check('announcements stay after clearing chat', st.feed.some((f) => f.kind === 'announcement'));
  check('players cannot clear chat', (await call('ana', 'POST', `/api/games/${g}/lobby/clear-chat`)).status === 403);
  console.log(`\n${pass} passed, ${failN} failed`);
})().catch((e) => { console.error(e); process.exit(1); });

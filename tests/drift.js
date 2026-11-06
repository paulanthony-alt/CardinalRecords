// "save": read state through the warm cache; "compare": after a restart (cold cache, read straight from DB), the same.
const fs = require('node:fs');
const [mode, out] = process.argv.slice(2);
const B = (process.env.BASE || 'http://localhost:3199'); const jars = {};
async function call(who, method, path, body) {
  const res = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', cookie: jars[who] || '' }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) jars[who] = sc.split(';')[0];
  return res.json();
}
const norm = (s) => { delete s.rev; delete s.serverTime; s.roster.forEach((p) => delete p.lastSeen); return JSON.stringify(s); };
(async () => {
  await call('o', 'POST', '/api/login', { username: 'BFreeds', pin: '8642' });
  await call('k', 'POST', '/api/login', { username: 'kid2', pin: '4002' });
  const g = (await call('o', 'GET', '/api/me')).games[0].id;
  const o = norm(await call('o', 'GET', `/api/games/${g}/state`)), k = norm(await call('k', 'GET', `/api/games/${g}/state`));
  if (mode === 'save') { fs.writeFileSync(`${out}/drift.json`, JSON.stringify({ o, k })); console.log(`saved (${(o.length / 1024).toFixed(0)} KB owner view)`); return; }
  const prev = JSON.parse(fs.readFileSync(`${out}/drift.json`, 'utf8'));
  console.log(prev.o === o && prev.k === k ? 'PASS cached state is identical to a fresh read from the database' : 'FAIL cached state differs from a fresh read');
  if (prev.o !== o) { const a = JSON.parse(prev.o), b = JSON.parse(o); for (const key of Object.keys(b)) if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) console.log('  differs:', key); }
})();

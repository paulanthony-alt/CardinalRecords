// 30 students chatting, hiring and refreshing at once for ~15s on the t5 season (reopened), then the drift check runs.
const B = (process.env.BASE || 'http://localhost:3199'); const jars = {};
async function call(who, method, path, body) {
  const res = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', cookie: jars[who] || '' }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) jars[who] = sc.split(';')[0];
  try { return { status: res.status, json: await res.json() }; } catch { return { status: res.status }; }
}
(async () => {
  await call('o', 'POST', '/api/login', { username: 'BFreeds', pin: '8642' });
  const g = (await call('o', 'GET', '/api/me')).json.games[0].id;
  await call('o', 'POST', `/api/games/${g}/phase`, { phase: 'showcase' });
  await call('o', 'PATCH', `/api/games/${g}`, { durationDays: 300 });
  await call('o', 'POST', `/api/games/${g}/phase`, { phase: 'active' });
  const st = (await call('o', 'GET', `/api/games/${g}/state`)).json;
  const kids = st.roster.filter((p) => p.active);
  await call('o', 'POST', `/api/games/${g}/grants`, { amount: 3000, userIds: 'all', memo: 'stress' });
  const pins = { kid1: '5555', kid22: '7777' };
  for (const p of kids) await call(p.username, 'POST', '/api/login', { username: p.username, pin: pins[p.username] || String(4000 + Number(p.username.slice(3))) });
  const end = Date.now() + 15000; let ops = 0, errs = 0;
  await Promise.all(kids.map(async (p, i) => {
    while (Date.now() < end) {
      const r = Math.random();
      let res;
      if (r < 0.3) res = await call(p.username, 'POST', `/api/games/${g}/feed`, { message: `stress ${i}` });
      else if (r < 0.5) {
        const seller = kids[(i + 1 + Math.floor(Math.random() * 5)) % kids.length];
        res = await call(p.username, 'POST', `/api/games/${g}/contracts`, { sellerId: seller.id, jobId: 'lyricist', quantity: 1 });
        if (res.json?.id) { await call(seller.username, 'POST', `/api/contracts/${res.json.id}/action`, { action: 'accept' }); await call('o', 'POST', `/api/contracts/${res.json.id}/action`, { action: 'approve' }); if (Math.random() < 0.5) await call('o', 'POST', `/api/contracts/${res.json.id}/action`, { action: 'complete' }); }
      } else res = await call(p.username, 'GET', `/api/games/${g}/state`);
      ops++; if (res.status >= 500) errs++;
    }
  }));
  console.log(`${ops} operations by ${kids.length} students in 15s, ${errs} server errors`);
})();

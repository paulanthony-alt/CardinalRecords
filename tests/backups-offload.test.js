// End-to-end checks for the bug fixes, PDF backups and offload. Usage: node t2.js OUTDIR
const fs = require('node:fs');
const out = process.argv[2];
const B = (process.env.BASE || 'http://localhost:3199');
const jars = {};
async function call(who, method, path, body) {
  const res = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', cookie: jars[who] || '' }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) jars[who] = sc.split(';')[0];
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null; try { json = JSON.parse(buf.toString()); } catch {}
  return { status: res.status, json, buf, type: res.headers.get('content-type') };
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
const check = (name, cond, extra = '') => { if (cond) pass++; else failN++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };

(async () => {
  await call('o', 'POST', '/api/login', { username: 'tester', pin: '0000' });
  const s1 = (await call('o', 'POST', '/api/games', { name: 'Fall 2026', durationDays: 90 })).json.id;
  const s2 = (await call('o', 'POST', '/api/games', { name: 'Spring 2027', durationDays: 90 })).json.id;
  // 30 artists in season 1 (a full class), 25 in season 2; one with an accented name
  const ids1 = [], ids2 = [];
  for (let i = 1; i <= 30; i++) {
    const u = `s1kid${i}`;
    ids1.push((await call('o', 'POST', `/api/games/${s1}/players`, { username: u, displayName: i === 3 ? 'José Peña 🎤' : `Fall Artist ${i}`, roleTitle: i % 2 ? 'Producer' : 'Vocalist' })).json.id);
    await claim(u, 'o', s1, u, String(1000 + i));
  }
  for (let i = 1; i <= 25; i++) {
    const u = `s2kid${i}`;
    ids2.push((await call('o', 'POST', `/api/games/${s2}/players`, { username: u, displayName: `Spring Artist ${i}` })).json.id);
    await claim(u, 'o', s2, u, String(2000 + i));
  }
  await call('o', 'POST', `/api/games/${s1}/phase`, { phase: 'active' });
  await call('o', 'POST', `/api/games/${s2}/phase`, { phase: 'active' });

  // some activity in season 1
  await call('o', 'POST', `/api/games/${s1}/charges`, { itemId: 'tardy', userIds: [ids1[0]], memo: 'late to class' });
  let lastC;
  for (let i = 1; i < 30; i++) {
    const buyer = `s1kid${i}`, seller = ids1[i % 30];
    const c = (await call(buyer, 'POST', `/api/games/${s1}/contracts`, { sellerId: seller, jobId: 'lyricist', quantity: 2, terms: `PRIVATE TERMS ${i}` })).json.id;
    await call(`s1kid${(i % 30) + 1}`, 'POST', `/api/contracts/${c}/action`, { action: 'accept' });
    await call('o', 'POST', `/api/contracts/${c}/action`, { action: 'approve' });
    if (i <= 20) {
      await call(`s1kid${(i % 30) + 1}`, 'POST', `/api/contracts/${c}/action`, { action: 'deliver' });
      await call(buyer, 'POST', `/api/contracts/${c}/action`, { action: 'confirm', rating: 5 });
    }
    lastC = c;
  }
  const offer = (await call('s1kid5', 'POST', `/api/games/${s1}/contracts`, { sellerId: ids1[9], jobId: 'rapper', pricing: 'project', terms: 'SECRET OFFER' })).json.id;

  // ---- bug 1: player export privacy
  const ex = (await call('s1kid30', 'GET', `/api/games/${s1}/export.json`)).json;
  const me30 = ids1[29];
  check('player export: only own ledger rows', ex.ledger.every((l) => l.user_id === me30), `${ex.ledger.length} rows`);
  check('player export: no one else\'s fines', !ex.ledger.some((l) => l.kind === 'fine'));
  check('player export: private offer between others is hidden', !ex.contracts.some((c) => c.id === offer));
  check('player export: no private terms of others\' deals', ex.contracts.every((c) => c.buyer_id === me30 || c.seller_id === me30 || c.terms === ''));
  check('player export: own deal terms kept', ex.contracts.some((c) => (c.buyer_id === me30 || c.seller_id === me30) && c.terms.startsWith('PRIVATE')));
  check('player export: only own deals\' events', ex.contract_events.every((e) => ex.contracts.find((c) => c.id === e.contract_id && (c.buyer_id === me30 || c.seller_id === me30))));
  check('player export: no PINs', ex.players.every((p) => p.pin === undefined));
  const exo = (await call('o', 'GET', `/api/games/${s1}/export.json`)).json;
  check('owner export: everything', exo.ledger.some((l) => l.kind === 'fine') && exo.contracts.some((c) => c.id === offer) && exo.players.every((p) => p.pin));

  // ---- bug 2: moving an artist with open deals
  const mv = await call('o', 'PATCH', `/api/players/${ids1[4]}`, { gameId: s2 });
  check('move blocked while artist has open deals', mv.status === 400 && /open deal/.test(mv.json.error), mv.json?.error);
  const mvOk = await call('o', 'PATCH', `/api/players/${ids1[29]}`, { gameId: s1 });
  check('editing without moving still works', mvOk.status === 200);

  // ---- bug 3: track limit per season
  await call('o', 'POST', `/api/games/${s1}/phase`, { phase: 'showcase' });
  await call('o', 'POST', `/api/games/${s1}/uploads`, { open: true });
  for (let i = 0; i < 10; i++) await call('s1kid2', 'POST', `/api/games/${s1}/tracks`, { url: `https://soundcloud.com/x/t${i}`, title: `Track ${i}` });
  const eleventh = await call('s1kid2', 'POST', `/api/games/${s1}/tracks`, { url: 'https://soundcloud.com/x/t11', title: 'T11' });
  check('11th track in one season refused', eleventh.status === 400);

  // ---- bug 4: late fee only once
  const lf1 = await call('o', 'POST', `/api/contracts/${lastC}/action`, { action: 'late_fee' });
  const lf2 = await call('o', 'POST', `/api/contracts/${lastC}/action`, { action: 'late_fee' });
  check('late fee charged once', lf1.status === 200 && lf2.status === 409, `${lf1.status}/${lf2.status}`);

  // ---- PDF backups
  const pPdf = await call('s1kid1', 'GET', `/api/games/${s1}/backup.pdf`);
  check('players cannot download the PDF backup', pPdf.status === 403);
  let t = Date.now();
  const pdf1 = await call('o', 'GET', `/api/games/${s1}/backup.pdf?pins=0&tz=America/New_York`);
  check('season PDF downloads', pdf1.status === 200 && pdf1.type === 'application/pdf' && pdf1.buf.slice(0, 5).toString() === '%PDF-', `${pdf1.buf.length} bytes in ${Date.now() - t}ms`);
  fs.writeFileSync(`${out}/fall.pdf`, pdf1.buf);
  t = Date.now();
  const pdfAll = await call('o', 'GET', `/api/backup.pdf?pins=1&tz=America/New_York`);
  check('all-seasons PDF downloads', pdfAll.status === 200 && pdfAll.buf.slice(0, 5).toString() === '%PDF-', `${pdfAll.buf.length} bytes in ${Date.now() - t}ms`);
  fs.writeFileSync(`${out}/all.pdf`, pdfAll.buf);
  const bad = await call('o', 'GET', `/api/games/${s1}/backup.pdf?tz=Not/AZone`);
  check('bad time zone falls back safely', bad.status === 200);

  // ---- offload
  const early = await call('o', 'POST', `/api/games/${s1}/offload`, { confirm: 'Fall 2026' });
  check('offload refused before archiving', early.status === 400 && /Archive/.test(early.json.error));
  await call('o', 'POST', `/api/games/${s1}/phase`, { phase: 'archived' });
  const noBackup = await call('o', 'POST', `/api/games/${s1}/offload`, { confirm: 'Fall 2026' });
  check('offload refused without a backup after archiving', noBackup.status === 400 && /backup/.test(noBackup.json.error), noBackup.json?.error);
  await call('o', 'GET', `/api/games/${s1}/backup.pdf`);
  const wrongName = await call('o', 'POST', `/api/games/${s1}/offload`, { confirm: 'Fall' });
  check('offload refused with the wrong name', wrongName.status === 400);
  const pOff = await call('s1kid1', 'POST', `/api/games/${s1}/offload`, { confirm: 'Fall 2026' });
  check('players cannot offload', pOff.status === 403);
  const off = await call('o', 'POST', `/api/games/${s1}/offload`, { confirm: 'fall 2026' });
  check('offload works', off.status === 200 && off.json.artistsRemoved === 30, JSON.stringify(off.json));
  const after = await call('o', 'GET', `/api/games/${s1}/state`);
  check('offloaded season has no state', after.status === 410);
  const me = (await call('o', 'GET', '/api/me')).json;
  const g1 = me.games.find((g) => g.id === s1);
  check('season stays listed with a summary', g1.status === 'offloaded' && g1.summary.artists === 30 && g1.summary.deals === 20, JSON.stringify(g1.summary));
  const kidLogin = await call('z', 'POST', '/api/login', { username: 's1kid1', pin: '1001' });
  check('offloaded artists are gone', kidLogin.status === 404);
  const reuse = await call('o', 'POST', `/api/games/${s2}/players`, { username: 's1kid1', displayName: 'New kid' });
  check('their usernames free up', reuse.status === 200);
  const s2state = (await call('o', 'GET', `/api/games/${s2}/state`)).json;
  check('other season untouched', s2state.roster.length === 26 && s2state.roster.every((p) => p.stats.balance === 1000), `${s2state.roster.length} artists`);
  const del2 = await call('o', 'DELETE', `/api/games/${s2}`);
  check('cannot remove a season that has data', del2.status === 400);
  const del1 = await call('o', 'DELETE', `/api/games/${s1}`);
  check('remove an offloaded season from the list', del1.status === 200);
  console.log(`\n${pass} passed, ${failN} failed`);
})().catch((e) => { console.error(e); process.exit(1); });

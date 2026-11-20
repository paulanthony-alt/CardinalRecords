// Owner-added rate sheet items: a job artists hire for, paid work from the label (posted as a label job), a fee.
// Usage: node tests/rate-items.test.js OUTDIR   (fresh database, owner tester/0000)
const B = (process.env.BASE || 'http://localhost:3199'); const jars = {};
async function call(who, method, url, body) {
  const res = await fetch(B + url, { method, headers: { 'Content-Type': 'application/json', cookie: jars[who] || '' }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) jars[who] = sc.split(';')[0];
  let json = null; try { json = await res.json(); } catch {} return { status: res.status, json };
}
let pass = 0, failN = 0;
const check = (n, c, x = '') => { c ? pass++ : failN++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };

(async () => {
  await call('o', 'POST', '/api/login', { username: 'tester', pin: '0000' });
  const g = (await call('o', 'POST', '/api/games', { name: 'Rate Items Test', durationDays: 60 })).json.id;
  const made = await call('o', 'POST', `/api/games/${g}/players/bulk`, { entries: ['Ada Lin', 'Bo Kim'].map((n) => ({ displayName: n })) });
  const id = {}; for (const c of made.json.created) { const k = c.displayName.split(' ')[0].toLowerCase(); id[k] = c.id; await call(k, 'POST', '/api/claim', { username: c.username, code: c.claimCode, pin: '1234' }); }
  const S = async (who) => (await call(who, 'GET', `/api/games/${g}/state`)).json;
  const add = (b) => call('o', 'POST', `/api/games/${g}/rates/items`, b);

  // ---- validation and permissions
  check('students cannot add items', (await call('ada', 'POST', `/api/games/${g}/rates/items`, { section: 'payouts', name: 'Free money', amount: 500 })).status === 403);
  check('needs a section', (await add({ section: 'stuff', name: 'Thing', amount: 5 })).status === 400);
  check('needs a name', (await add({ section: 'payouts', name: 'x', amount: 5 })).status === 400);
  check('no duplicate names (case-insensitive)', (await add({ section: 'jobs', name: 'LYRICIST', unitRate: 10 })).status === 400);
  check('no negative or fractional amounts', (await add({ section: 'payouts', name: 'Crew', amount: -5 })).status === 400 && (await add({ section: 'payouts', name: 'Crew', amount: 2.5 })).status === 400);
  check('"per" items need what they are per', (await add({ section: 'fines', name: 'Gum', type: 'per', amount: 5 })).status === 400);
  check('a job needs a rate or a project rate', (await add({ section: 'jobs', name: 'Nothing job', unitRate: 0, projectRate: 0 })).status === 400);

  // ---- add one of each
  const crew = await add({ section: 'payouts', name: 'Concert stage crew', type: 'fixed', amount: 60, note: 'Set up and strike the stage for the winter concert.' });
  check('owner adds paid work from the label ($60)', crew.status === 200 && /^custom-/.test(crew.json.id));
  const video = await add({ section: 'jobs', name: 'Video editor', unit: 'item', unitRate: 60, projectRate: 300, note: 'Cuts a music video.' });
  const gum = await add({ section: 'fines', name: 'Gum in the studio', type: 'per', per: 'piece', amount: 5 });
  const tips = await add({ section: 'payouts', name: 'Tutoring', type: 'min', amount: 20, announce: false });
  let st = await S('ada');
  const r = st.rates;
  check('students see all of them on the rate sheet', r.payouts.some((p) => p.id === crew.json.id && p.amount === 60 && p.custom && p.note)
    && r.jobs.some((j) => j.id === video.json.id && j.unitRate === 60 && j.projectRate === 300 && j.unit === 'item' && j.active)
    && r.fines.some((f) => f.id === gum.json.id && f.type === 'per' && f.per === 'piece'));
  check('lobby announces new jobs and label pay', st.feed.some((f) => /New on the rate sheet: Video editor, \$60 per item or \$300 per project/.test(f.message))
    && st.feed.some((f) => /New on the rate sheet: Concert stage crew \(the label pays \$60\)/.test(f.message)));
  check('fees are not announced; "announce" off is respected', !st.feed.some((f) => /Gum in the studio|Tutoring/.test(f.message)));

  // ---- use them
  await call('o', 'POST', `/api/games/${g}/phase`, { phase: 'active' });
  const lj = await call('o', 'POST', `/api/games/${g}/label-jobs`, { payoutId: crew.json.id, spots: 2, whenText: 'Dec 12 after school', details: 'Wear black' });
  check('post a label job from the new item', lj.status === 200);
  st = await S('ada');
  const q = st.requests.find((x) => x.id === lj.json.id);
  check('label job pays the item\'s amount', q && q.amount === 60 && q.payoutId === crew.json.id);
  check('lobby: the label is looking for 2 artists', st.feed.some((f) => /looking for 2 artists: Concert stage crew .*paying \$60 each/.test(f.message)));
  const tj = await call('o', 'POST', `/api/games/${g}/label-jobs`, { payoutId: tips.json.id, amount: 35 });
  check('a "minimum" item: the owner sets the pay (at least the minimum)', tj.status === 200 && (await call('o', 'POST', `/api/games/${g}/label-jobs`, { payoutId: tips.json.id, amount: 10 })).status === 400);
  const before = (await S('o')).roster.find((p) => p.id === id.ada).stats.balance;
  await call('ada', 'POST', `/api/requests/${lj.json.id}/apply`, {});
  await call('o', 'POST', `/api/requests/${lj.json.id}/pick`, { userId: id.ada });
  check('pick and pay', (await call('o', 'POST', `/api/requests/${lj.json.id}/pay`, { userId: id.ada })).status === 200);
  check('Ada paid $60', (await S('o')).roster.find((p) => p.id === id.ada).stats.balance === before + 60);
  const deal = await call('ada', 'POST', `/api/games/${g}/contracts`, { sellerId: id.bo, jobId: video.json.id, pricing: 'project', terms: 'Music video' });
  check('artists can hire for the new job at its project rate', deal.status === 200 && (await S('ada')).contracts.find((c) => c.id === deal.json.id)?.amount === 300, JSON.stringify(deal.json));
  const fine = await call('o', 'POST', `/api/games/${g}/charges`, { itemId: gum.json.id, quantity: 3, userIds: [id.bo] });
  check('charge the new fee (3 pieces = $15)', fine.status === 200 && fine.json.charged[0].amount === 15);
  check('Treasury can pay the new label item too', (await call('o', 'POST', `/api/games/${g}/charges`, { itemId: crew.json.id, userIds: [id.bo] })).json.charged[0].amount === 60);

  // ---- edit
  check('students cannot edit', (await call('ada', 'PATCH', `/api/games/${g}/rates/items/${crew.json.id}`, { section: 'payouts', amount: 999 })).status === 403);
  check('built-in items cannot be edited this way', (await call('o', 'PATCH', `/api/games/${g}/rates/items/volunteer`, { section: 'payouts', amount: 99 })).status === 404);
  check('owner edits the amount', (await call('o', 'PATCH', `/api/games/${g}/rates/items/${crew.json.id}`, { section: 'payouts', amount: 75 })).status === 200);
  st = await S('o');
  const crewNow = st.rates.payouts.find((p) => p.id === crew.json.id);
  check('new amount, name and note kept', crewNow.amount === 75 && crewNow.name === 'Concert stage crew' && /winter concert/.test(crewNow.note));
  check('the posted label job keeps the amount it was posted at', st.requests.find((x) => x.id === lj.json.id).amount === 60);
  // the normal "edit amounts" form still works with added items in it
  const put = await call('o', 'PUT', `/api/games/${g}/rates`, { payouts: { [crew.json.id]: { amount: 80 }, volunteer: { amount: 45 } }, jobs: { [video.json.id]: { unitRate: 70, projectRate: 300, active: true } } });
  st = await S('o');
  check('Admin → Rate sheet saves added items and keeps them', put.status === 200 && st.rates.payouts.find((p) => p.id === crew.json.id).amount === 80
    && st.rates.payouts.find((p) => p.id === 'volunteer').amount === 45 && st.rates.jobs.find((j) => j.id === video.json.id).unitRate === 70 && st.rates.fines.some((f) => f.id === gum.json.id));
  check('changing an item\'s price type works', (await call('o', 'PATCH', `/api/games/${g}/rates/items/${gum.json.id}`, { section: 'fines', type: 'fixed', amount: 10 })).status === 200
    && !('per' in (await S('o')).rates.fines.find((f) => f.id === gum.json.id)));

  // ---- remove
  check('students cannot remove', (await call('ada', 'DELETE', `/api/games/${g}/rates/items/${crew.json.id}?section=payouts`)).status === 403);
  check('owner removes', (await call('o', 'DELETE', `/api/games/${g}/rates/items/${crew.json.id}?section=payouts`)).status === 200);
  st = await S('ada');
  check('gone from the rate sheet, name kept for old jobs', !st.rates.payouts.some((p) => p.id === crew.json.id) && st.rates.retired.some((x) => x.id === crew.json.id && x.name === 'Concert stage crew'));
  check('can\'t post new label jobs with it', (await call('o', 'POST', `/api/games/${g}/label-jobs`, { payoutId: crew.json.id })).status === 400);
  await call('bo', 'POST', `/api/requests/${lj.json.id}/apply`, {});
  await call('o', 'POST', `/api/requests/${lj.json.id}/pick`, { userId: id.bo });
  check('a job already posted can still be paid', (await call('o', 'POST', `/api/requests/${lj.json.id}/pay`, { userId: id.bo })).status === 200
    && (await S('o')).feed.some((f) => /paid Bo Kim \$60 for concert stage crew/.test(f.message)));
  check('removing twice: not found', (await call('o', 'DELETE', `/api/games/${g}/rates/items/${crew.json.id}?section=payouts`)).status === 404);
  check('the name can be used again after removing', (await add({ section: 'payouts', name: 'Concert stage crew', amount: 50 })).status === 200);

  // ---- other seasons, export
  const other = (await call('o', 'POST', '/api/games', { name: 'Other', durationDays: 30 })).json.id;
  check('items belong to one season', !(await call('o', 'GET', `/api/games/${other}/state`)).json.rates.jobs.some((j) => j.custom));
  const ex = (await call('o', 'GET', `/api/games/${g}/export.json`)).json;
  check('added items are in the data download', ex.rate_sheet.jobs.some((j) => j.id === video.json.id) && ex.rate_sheet.fines.some((f) => f.id === gum.json.id));
  console.log(`\n${pass} passed, ${failN} failed`);
})().catch((e) => { console.error(e); process.exit(1); });

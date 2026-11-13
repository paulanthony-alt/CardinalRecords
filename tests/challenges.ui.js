// Browser: owner creates a challenge with From/To dates, a student enters on a phone, owner ends it and picks the winner.
// Usage: node tests/challenges.ui.js OUTDIR
const { chromium } = require('playwright');
const out = process.argv[2]; const B = (process.env.BASE || 'http://localhost:3199');
let pass = 0, failN = 0;
const check = (n, c, x = '') => { c ? pass++ : failN++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
(async () => {
  const browser = await chromium.launch(); const errors = [];
  const ctxO = await browser.newContext({ viewport: { width: 1366, height: 900 } }); const o = await ctxO.newPage();
  o.on('pageerror', (e) => errors.push('owner: ' + e.message));
  const r = ctxO.request;
  await r.post(`${B}/api/login`, { data: { username: 'tester', pin: '0000' } });
  const g = (await (await r.post(`${B}/api/games`, { data: { name: 'Period 6', durationDays: 60 } })).json()).id;
  const made = await (await r.post(`${B}/api/games/${g}/players/bulk`, { data: { entries: [{ displayName: 'Nova Lane' }, { displayName: 'Kai Stone' }] } })).json();
  for (const c of made.created) await fetch(`${B}/api/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: c.username, code: c.claimCode, pin: '2468' }) });
  await r.post(`${B}/api/games/${g}/phase`, { data: { phase: 'active' } });
  await o.goto(B); await o.evaluate((id) => localStorage.setItem('cr.game', id), g);

  // owner creates a challenge with a date range
  await o.goto(`${B}/#/challenges`); await o.reload(); await o.waitForSelector('button[data-act="challenge-new"]');
  check('Challenges in the menu', (await o.locator('.menu .mi', { hasText: 'Challenges' }).count()) === 1);
  await o.click('button[data-act="challenge-new"]');
  const from = new Date(); const to = new Date(Date.now() + 9 * 86_400_000);
  await o.fill('form[data-form="challenge"] input[name="title"]', 'Remix Week');
  await o.fill('form[data-form="challenge"] textarea[name="description"]', 'Remix any track from the Showcase.');
  await o.fill('form[data-form="challenge"] input[name="from"]', ymd(from));
  await o.fill('form[data-form="challenge"] input[name="to"]', ymd(to));
  await o.fill('form[data-form="challenge"] input[name="p1"]', '150');
  await o.fill('form[data-form="challenge"] input[name="p2"]', '75');
  await o.screenshot({ path: `${out}/challenge-form.png` });
  await o.click('form[data-form="challenge"] button.primary'); await o.waitForTimeout(900);
  check('challenge shows as open with its dates', (await o.locator('.challenge.ph-open', { hasText: 'Remix Week' }).count()) === 1);
  const st = await (await r.get(`${B}/api/games/${g}/state`)).json();
  const ch = st.challenges[0];
  const endDay = new Date(ch.endsAt);
  check('dates saved as start of first day to end of last day', new Date(ch.startsAt).getHours() === 0 && endDay.getHours() === 23 && endDay.getMinutes() === 59 && ymd(endDay) === ymd(to));

  // student enters on a phone
  const s = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  s.on('pageerror', (e) => errors.push('student: ' + e.message));
  const nova = made.created.find((c) => c.displayName === 'Nova Lane');
  await s.goto(B); await s.fill('input[name="username"]', nova.username); await s.keyboard.press('Enter'); await s.waitForTimeout(300);
  for (const d of '2468') await s.keyboard.press(d); await s.keyboard.press('Enter'); await s.waitForSelector('.menu .mi'); await s.waitForTimeout(500);
  check('student menu shows a count to enter', (await s.locator('.menu .mi', { hasText: 'Challenges' }).locator('.count').count()) === 1);
  await s.goto(`${B}/#/challenges`); await s.waitForSelector('form[data-form="challenge-entry"]');
  await s.fill('form[data-form="challenge-entry"] input[name="url"]', 'https://soundcloud.com/nova/remix');
  await s.fill('form[data-form="challenge-entry"] input[name="note"]', 'Lo-fi flip');
  await s.click('form[data-form="challenge-entry"] button.primary'); await s.waitForTimeout(900);
  check('entry saved, can update or withdraw', (await s.locator('button[data-act="entry-withdraw"]').count()) === 1 && (await s.locator('form[data-form="challenge-entry"] button.primary').innerText()).includes('Update'));
  const over = await s.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check('phone: no sideways scroll', over <= 2, `${over}px`);
  await s.screenshot({ path: `${out}/challenge-phone.png`, fullPage: true });

  // owner ends it and picks the winner
  await o.reload(); await o.waitForSelector('button[data-act="challenge-end"]');
  check('owner sees the entry while open', (await o.locator('.entry', { hasText: 'Lo-fi flip' }).count()) === 1);
  await o.click('button[data-act="challenge-end"]'); await o.click('button[data-act="confirm-ok"]'); await o.waitForTimeout(900);
  check('admin bar asks to judge', (await o.locator('.admin-bar .ab-item', { hasText: 'To judge' }).count()) === 1);
  await o.click('button[data-act="challenge-winners"]');
  await o.click('form[data-form="challenge-winners"] button.primary'); await o.waitForTimeout(1000);
  check('winners announced', (await o.locator('.challenge.ph-judged .entry.won', { hasText: 'Nova Lane' }).count()) === 1);
  await s.reload(); await s.waitForTimeout(1200);
  check('student sees the medal', (await s.locator('.entry.won .medal').count()) === 1);
  await o.screenshot({ path: `${out}/challenge-owner.png`, fullPage: true });
  check('no JS errors', errors.length === 0, errors.join(' | '));
  console.log(`\n${pass} passed, ${failN} failed`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

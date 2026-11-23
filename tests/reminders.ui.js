// Browser: the owner's Close out deals page and reminders; an artist sees reminders on a phone and taps Got it.
// Usage: PGURL=postgres://... node tests/reminders.ui.js OUTDIR
const path = require('node:path');
const pg = require(require.resolve('pg', { paths: [path.join(__dirname, '..')] }));
const { chromium } = require('playwright');
const out = process.argv[2]; const B = (process.env.BASE || 'http://localhost:3199');
let pass = 0, failN = 0;
const check = (n, c, x = '') => { c ? pass++ : failN++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };
const DAY = 86_400_000;
(async () => {
  const db = new pg.Client({ connectionString: process.env.PGURL }); await db.connect();
  const browser = await chromium.launch(); const errors = [];
  const ctxO = await browser.newContext({ viewport: { width: 1366, height: 900 } }); const o = await ctxO.newPage();
  o.on('pageerror', (e) => errors.push('owner: ' + e.message));
  const r = ctxO.request;
  await r.post(`${B}/api/login`, { data: { username: 'tester', pin: '0000' } });
  const g = (await (await r.post(`${B}/api/games`, { data: { name: 'Period 11', durationDays: 60 } })).json()).id;
  const made = await (await r.post(`${B}/api/games/${g}/players/bulk`, { data: { entries: [{ displayName: 'Rae Fox' }, { displayName: 'Sol Diaz' }] } })).json();
  for (const c of made.created) await fetch(`${B}/api/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: c.username, code: c.claimCode, pin: '2468' }) });
  await r.post(`${B}/api/games/${g}/phase`, { data: { phase: 'active' } });
  const [rae, sol] = made.created;
  const jar = async (u) => { const c = await browser.newContext(); await c.request.post(`${B}/api/login`, { data: { username: u.username, pin: '2468' } }); return c.request; };
  const rr = await jar(rae); const sr = await jar(sol);
  const hire = async (buyer, seller, dueDays) => (await (await buyer.post(`${B}/api/games/${g}/contracts`, { data: { sellerId: seller.id, jobId: 'lyricist', quantity: 1, dueDays } })).json()).id;
  // 1. overdue: Sol hired Rae
  const late = await hire(sr, rae, 2); await rr.post(`${B}/api/contracts/${late}/action`, { data: { action: 'accept' } }); await r.post(`${B}/api/contracts/${late}/action`, { data: { action: 'approve' } });
  await db.query('UPDATE contracts SET approved_at = $1 WHERE id = $2', [Date.now() - 20 * DAY, late]);
  // 2. delivered 3 days ago, Sol hasn't confirmed: Sol hired Rae
  const conf = await hire(sr, rae, 5); await rr.post(`${B}/api/contracts/${conf}/action`, { data: { action: 'accept' } }); await r.post(`${B}/api/contracts/${conf}/action`, { data: { action: 'approve' } });
  await rr.post(`${B}/api/contracts/${conf}/action`, { data: { action: 'deliver' } });
  await db.query('UPDATE contracts SET updated_at = $1 WHERE id = $2', [Date.now() - 3 * DAY, conf]);
  await db.query('UPDATE contract_events SET created_at = $1 WHERE contract_id = $2', [Date.now() - 3 * DAY, conf]);
  // 3. an offer to Rae from 4 days ago, never signed
  const unsigned = await hire(sr, rae, 3);
  await db.query('UPDATE contracts SET updated_at = $1, created_at = $1 WHERE id = $2', [Date.now() - 4 * DAY, unsigned]);
  await db.query('UPDATE contract_events SET created_at = $1 WHERE contract_id = $2', [Date.now() - 4 * DAY, unsigned]);
  // 4. a fresh offer (not stuck yet) so the close-out page leaves it alone
  const freshOffer = await hire(rr, sol, 3);
  await r.post(`${B}/api/games/${g}/calendar`, { data: { title: 'refresh', day: '2026-12-01', announce: false } }); // any write reloads the shared copy

  await o.goto(B); await o.evaluate((id) => localStorage.setItem('cr.game', id), g); await o.goto(`${B}/#/hq`); await o.reload();
  await o.waitForSelector('.admin-bar');
  check('admin bar: Close out 3', /Close out\s*3/.test(await o.locator('.admin-bar .ab-item', { hasText: 'Close out' }).innerText()));
  await o.click('.admin-bar .ab-item:has-text("Close out")'); await o.waitForSelector('.co-group');
  check('three groups: overdue, delivered not confirmed, offers nobody signed', (await o.locator('.co-overdue .co-row').count()) === 1 && (await o.locator('.co-confirm .co-row').count()) === 1 && (await o.locator('.co-unsigned .co-row').count()) === 1);
  check('a fresh offer is not listed', !(await o.locator(`.co-row a[href="#/contract/${freshOffer}"]`).count()));
  check('rows say who it is waiting on', /Waiting on Sol to confirm/.test(await o.locator('.co-confirm .co-row').innerText()) && /Waiting on Rae to deliver/.test(await o.locator('.co-overdue .co-row').innerText()));
  check('the right buttons: Remind Rae / Remind Sol, Pay out, Void', (await o.locator('.co-overdue button[data-act="remind"]', { hasText: 'Remind Rae' }).count()) === 1
    && (await o.locator('.co-confirm button[data-a="complete"]').count()) === 1 && (await o.locator('.co-unsigned button[data-a="cancel"]').count()) === 1);
  await o.click('.co-overdue button[data-act="remind"]'); await o.waitForTimeout(900);
  check('reminded: shows when', /Reminded Rae/.test(await o.locator('.co-overdue .co-row').innerText()));
  // remind everyone with a note
  await o.click('.card button[data-act="remind-all"]');
  await o.fill('form[data-form="remind-all"] input[name="note"]', 'Close these out by Friday please.');
  await o.click('form[data-form="remind-all"] button.primary'); await o.waitForTimeout(900);
  check('remind everyone: the other two get one, the one just reminded is skipped', /2 reminders sent · 1 skipped/.test(await o.locator('.toast').last().innerText()), await o.locator('.toast').last().innerText());
  await o.screenshot({ path: `${out}/closeout-owner.png`, fullPage: true });

  // ---- Rae on a phone
  const s = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  s.on('pageerror', (e) => errors.push('student: ' + e.message));
  await s.goto(B); await s.fill('input[name="username"]', rae.username); await s.keyboard.press('Enter'); await s.waitForTimeout(300);
  for (const d of '2468') await s.keyboard.press(d); await s.keyboard.press('Enter'); await s.waitForSelector('.menu .mi');
  await s.waitForSelector('.reminders');
  check('teacher reminders on top, from Tester', (await s.locator('.reminders li.rm-teacher').count()) === 2 && /From Tester: Finish your job/.test(await s.locator('.reminders').innerText()));
  check('teacher note included', /Close these out by Friday please/.test(await s.locator('.reminders').innerText()));
  const over = await s.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check('phone: no sideways scroll', over <= 2, `${over}px`);
  await s.screenshot({ path: `${out}/reminders-phone.png`, fullPage: true });
  await s.goto(`${B}/#/rates`); await s.waitForSelector('.reminders');
  check('reminders show on every page', (await s.locator('.reminders li.rm-teacher').count()) === 2);
  await s.click('.reminders li.rm-teacher button[data-act="remind-seen"]'); await s.waitForTimeout(800);
  await s.click('.reminders li.rm-teacher button[data-act="remind-seen"]'); await s.waitForTimeout(800);
  check('Got it clears them; the overdue job still shows on its own', (await s.locator('.reminders li.rm-teacher').count()) === 0 && (await s.locator('.reminders li.rm-over', { hasText: 'Overdue' }).count()) === 1);
  check('the unsigned offer shows as an automatic reminder', (await s.locator('.reminders li', { hasText: 'wants to hire you' }).count()) === 1);
  await s.click('button[data-act="remind-hide"]'); await s.waitForTimeout(300);
  check('Hide for today: overdue work still shows, the rest hides', (await s.locator('.reminders li.rm-over').count()) === 1 && !(await s.locator('.reminders li', { hasText: 'wants to hire you' }).count()));
  // the owner sees the reminders were seen
  await o.reload(); await o.waitForSelector('.co-group');
  check('owner sees "seen"', /seen/.test(await o.locator('.co-overdue .co-row').innerText()));
  // Sol (the client) gets an automatic "confirm & pay"
  const s2 = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  s2.on('pageerror', (e) => errors.push('sol: ' + e.message));
  await s2.goto(B); await s2.fill('input[name="username"]', sol.username); await s2.keyboard.press('Enter'); await s2.waitForTimeout(300);
  for (const d of '2468') await s2.keyboard.press(d); await s2.keyboard.press('Enter'); await s2.waitForSelector('.reminders');
  check('the client is reminded to confirm & pay', (await s2.locator('.reminders', { hasText: 'Close these out by Friday' }).count()) === 1 && /delivered .*confirm & pay/i.test(await s2.locator('.reminders').innerText()));
  // owners: season ends -> banner
  await r.post(`${B}/api/games/${g}/phase`, { data: { phase: 'showcase' } });
  await o.goto(`${B}/#/hq`); await o.reload(); await o.waitForSelector('.banner');
  check('season over: banner to close out every open deal', (await o.locator('.banner', { hasText: "Close out the season's deals" }).count()) === 1);
  await o.click('.banner a[href="#/admin/closeout"]'); await o.waitForSelector('.co-group');
  const listed = await o.waitForSelector(`.co-row a[href="#/contract/${freshOffer}"]`, { timeout: 5000 }).then(() => true).catch(() => false);
  check('season over: the fresh offer is listed too', listed);
  await o.click('.co-confirm button[data-a="complete"]'); await o.waitForTimeout(400);
  if (await o.locator('button[data-act="confirm-ok"]').count()) await o.click('button[data-act="confirm-ok"]');
  else if (await o.locator('.modal form button.primary, .modal form button.green').count()) await o.click('.modal form button.primary, .modal form button.green');
  await o.waitForTimeout(900);
  check('Pay out from the list closes it', !(await o.locator('.co-confirm').count()));
  check('no JS errors', errors.length === 0, errors.join(' | '));
  await db.end();
  console.log(`\n${pass} passed, ${failN} failed`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

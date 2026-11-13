// Browser: an owner posts a label job, a student raises a hand on a phone, the owner picks and pays.
// Usage: node tests/label-jobs.ui.js OUTDIR
const { chromium } = require('playwright');
const out = process.argv[2]; const B = (process.env.BASE || 'http://localhost:3199');
let pass = 0, failN = 0;
const check = (n, c, x = '') => { c ? pass++ : failN++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };
(async () => {
  const browser = await chromium.launch(); const errors = [];
  const ctxO = await browser.newContext({ viewport: { width: 1366, height: 900 } }); const o = await ctxO.newPage();
  o.on('pageerror', (e) => errors.push('owner: ' + e.message));
  const r = ctxO.request;
  await r.post(`${B}/api/login`, { data: { username: 'tester', pin: '0000' } });
  const g = (await (await r.post(`${B}/api/games`, { data: { name: 'Period 8', durationDays: 60 } })).json()).id;
  const made = await (await r.post(`${B}/api/games/${g}/players/bulk`, { data: { entries: [{ displayName: 'Uma Reed' }] } })).json();
  const kid = made.created[0];
  await fetch(`${B}/api/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: kid.username, code: kid.claimCode, pin: '2468' }) });
  await r.post(`${B}/api/games/${g}/phase`, { data: { phase: 'active' } });

  await o.goto(B); await o.evaluate((id) => localStorage.setItem('cr.game', id), g); await o.goto(`${B}/#/jobs`); await o.reload();
  await o.waitForSelector('button[data-act="label-job-new"]');
  await o.click('button[data-act="label-job-new"]');
  await o.selectOption('#label-job-form select[name="payoutId"]', 'volunteer');
  await o.fill('#label-job-form input[name="quantity"]', '2'); await o.waitForTimeout(200);
  check('pay updates as you type (2 class blocks = $80)', (await o.locator('#lj-total').innerText()) === '$80');
  await o.selectOption('#label-job-form select[name="payoutId"]', 'studio-assistant'); await o.waitForTimeout(200);
  check('studio assistant asks for an amount (min $15)', !(await o.locator('#lj-amt').isHidden()) && (await o.locator('#lj-qty').isHidden()) && (await o.locator('#lj-total').innerText()) === '$15');
  await o.fill('#label-job-form input[name="amount"]', '20');
  await o.fill('#label-job-form input[name="whenText"]', 'Friday after school');
  await o.fill('#label-job-form textarea[name="details"]', 'Set up mics for the EMusic 2 session');
  await o.screenshot({ path: `${out}/label-job-form.png` });
  await o.click('#label-job-form button.primary'); await o.waitForTimeout(900);
  check('job shows under From the label', (await o.locator('.label-jobs .request.label-job', { hasText: 'Studio Assistant' }).count()) === 1);

  const s = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  s.on('pageerror', (e) => errors.push('student: ' + e.message));
  await s.goto(B); await s.fill('input[name="username"]', kid.username); await s.keyboard.press('Enter'); await s.waitForTimeout(300);
  for (const d of '2468') await s.keyboard.press(d); await s.keyboard.press('Enter'); await s.waitForSelector('.menu .mi');
  await s.goto(`${B}/#/jobs`); await s.waitForSelector('.label-job');
  await s.click('.label-job button[data-act="request-apply"]');
  await s.fill('form[data-form="request-apply"] input[name="note"]', 'Free after school Friday');
  await s.click('form[data-form="request-apply"] button.primary'); await s.waitForTimeout(800);
  check('student raised a hand', (await s.locator('.label-job button[data-act="request-unapply"]').count()) === 1);
  const over = await s.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check('phone: no sideways scroll', over <= 2, `${over}px`);

  await o.reload(); await o.waitForSelector('.label-job .hand');
  await o.click('.label-job button[data-act="label-pick"]'); await o.waitForTimeout(800);
  check('picked; admin bar asks to pay', (await o.locator('.label-job button[data-act="label-pay"]').count()) === 1 && (await o.locator('.admin-bar .ab-item', { hasText: 'Label jobs to pay' }).count()) === 1);
  await o.screenshot({ path: `${out}/label-job-owner.png` });
  await o.click('.label-job button[data-act="label-pay"]'); await o.click('button[data-act="confirm-ok"]'); await o.waitForTimeout(900);
  check('paid', (await o.locator('.label-job .chip', { hasText: 'Paid' }).count()) === 1);
  await s.reload(); await s.waitForTimeout(1200);
  check('student sees Paid and the money', (await s.locator('.label-job .chip', { hasText: 'Paid' }).count()) === 1);
  await s.screenshot({ path: `${out}/label-job-phone.png`, fullPage: true });
  check('no JS errors', errors.length === 0, errors.join(' | '));
  console.log(`\n${pass} passed, ${failN} failed`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

// Browser: an owner adds their own items to the rate sheet and posts a custom label job; a student sees them on a phone.
// Usage: node tests/rate-items.ui.js OUTDIR
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
  const g = (await (await r.post(`${B}/api/games`, { data: { name: 'Period 10', durationDays: 60 } })).json()).id;
  const made = await (await r.post(`${B}/api/games/${g}/players/bulk`, { data: { entries: [{ displayName: 'Ivy Moss' }] } })).json();
  const kid = made.created[0];
  await fetch(`${B}/api/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: kid.username, code: kid.claimCode, pin: '2468' }) });
  await r.post(`${B}/api/games/${g}/phase`, { data: { phase: 'active' } });

  // ---- add a fee from the Rate Sheet page
  await o.goto(B); await o.evaluate((id) => localStorage.setItem('cr.game', id), g); await o.goto(`${B}/#/rates`); await o.reload();
  await o.waitForSelector('.page-head button[data-act="rate-item-new"]');
  await o.click('.page-head button[data-act="rate-item-new"]');
  await o.check('#rate-item-form input[name="section"][value="fines"]');
  check('a fee: no lobby announcement option', await o.locator('#rate-item-form .ri-announce').isHidden());
  await o.selectOption('#rate-item-form select[name="type"]', 'per');
  check('"per" asks what it is per', !(await o.locator('#ri-per').isHidden()));
  await o.fill('#rate-item-form input[name="name"]', 'Gum in the studio');
  await o.fill('#rate-item-form input[name="amount"]', '5');
  await o.fill('#rate-item-form input[name="per"]', 'piece');
  await o.click('#rate-item-form button.primary'); await o.waitForTimeout(800);
  check('the fee is on the rate sheet, marked Added, with Edit', (await o.locator('tr', { hasText: 'Gum in the studio' }).locator('button[data-act="rate-item-edit"]').count()) === 1
    && /\$5 per piece/.test(await o.locator('tr', { hasText: 'Gum in the studio' }).innerText()));
  // a job artists hire for
  await o.click('.page-head button[data-act="rate-item-new"]');
  await o.check('#rate-item-form input[name="section"][value="jobs"]');
  check('a job asks for its rates', !(await o.locator('#rate-item-form .ri-job').isHidden()) && await o.locator('#rate-item-form .ri-money').isHidden());
  await o.fill('#rate-item-form input[name="name"]', 'Video editor');
  await o.selectOption('#rate-item-form select[name="unit"]', 'item');
  await o.fill('#rate-item-form input[name="unitRate"]', '60');
  await o.fill('#rate-item-form input[name="projectRate"]', '300');
  await o.screenshot({ path: `${out}/rate-item-form.png` });
  await o.click('#rate-item-form button.primary'); await o.waitForTimeout(800);
  check('the job is listed under jobs', (await o.locator('tr', { hasText: 'Video editor' }).count()) === 1);
  // edit it
  await o.click('tr:has-text("Video editor") button[data-act="rate-item-edit"]');
  await o.fill('#rate-item-form input[name="unitRate"]', '65');
  await o.click('#rate-item-form button.primary'); await o.waitForTimeout(800);
  check('edited', /\$65/.test(await o.locator('tr', { hasText: 'Video editor' }).innerText()));

  // ---- custom label job straight from "Post a label job"
  await o.goto(`${B}/#/jobs`); await o.waitForSelector('button[data-act="label-job-new"]');
  await o.click('button[data-act="label-job-new"]');
  await o.click('#label-job-form button[data-act="rate-item-new"]');
  check('the add form opens on "Paid work from the label"', await o.locator('#rate-item-form input[name="section"][value="payouts"]').isChecked());
  await o.fill('#rate-item-form input[name="name"]', 'Concert stage crew');
  await o.fill('#rate-item-form input[name="amount"]', '60');
  await o.fill('#rate-item-form textarea[name="note"]', 'Set up and strike the stage.');
  await o.click('#rate-item-form button.primary'); await o.waitForSelector('#label-job-form');
  check('back to posting, with the new job picked', (await o.locator('#label-job-form select[name="payoutId"] option:checked').innerText()).startsWith('Concert stage crew')
    && (await o.locator('#lj-total').innerText()) === '$60');
  await o.fill('#label-job-form input[name="whenText"]', 'Dec 12 after school');
  await o.screenshot({ path: `${out}/rate-item-label-job.png` });
  await o.click('#label-job-form button.primary'); await o.waitForTimeout(900);
  check('posted on the Job Board', (await o.locator('.label-job', { hasText: 'Concert stage crew' }).count()) === 1);
  // admin rate sheet tab has the add button and the added items
  await o.goto(`${B}/#/admin/rates`); await o.waitForSelector('form[data-form="rates-edit"]');
  check('Admin → Rate sheet: add button and the added items', (await o.locator('button[data-act="rate-item-new"]').count()) >= 1 && (await o.locator('form[data-form="rates-edit"] tr', { hasText: 'Concert stage crew' }).count()) === 1);
  await o.click('form[data-form="rates-edit"] button.primary'); await o.waitForTimeout(700);
  // remove the fee
  await o.goto(`${B}/#/rates`); await o.waitForSelector('tr:has-text("Gum in the studio")');
  await o.click('tr:has-text("Gum in the studio") button[data-act="rate-item-remove"]'); await o.click('button[data-act="confirm-ok"]'); await o.waitForTimeout(800);
  check('removed', (await o.locator('tr', { hasText: 'Gum in the studio' }).count()) === 0 && (await o.locator('tr', { hasText: 'Concert stage crew' }).count()) === 1);
  await o.screenshot({ path: `${out}/rate-items-owner.png`, fullPage: true });

  // ---- student on a phone
  const s = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  s.on('pageerror', (e) => errors.push('student: ' + e.message));
  await s.goto(B); await s.fill('input[name="username"]', kid.username); await s.keyboard.press('Enter'); await s.waitForTimeout(300);
  for (const d of '2468') await s.keyboard.press(d); await s.keyboard.press('Enter'); await s.waitForSelector('.menu .mi');
  await s.goto(`${B}/#/rates`); await s.waitForSelector('tr:has-text("Video editor")');
  check('student sees the new items, no Edit buttons', (await s.locator('tr', { hasText: 'Concert stage crew' }).count()) === 1 && (await s.locator('button[data-act="rate-item-edit"]').count()) === 0);
  check('student can hire for the new job', (await s.locator('tr:has-text("Video editor") button[data-act="hire"]').count()) === 1);
  const over = await s.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check('phone: no sideways scroll', over <= 2, `${over}px`);
  await s.screenshot({ path: `${out}/rate-items-phone.png`, fullPage: true });
  await s.goto(`${B}/#/jobs`); await s.waitForSelector('.label-job');
  check('student sees the custom label job', (await s.locator('.label-job', { hasText: 'Concert stage crew' }).count()) === 1);
  check('no JS errors', errors.length === 0, errors.join(' | '));
  console.log(`\n${pass} passed, ${failN} failed`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

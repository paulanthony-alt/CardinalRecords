// Browser: paste a class list, job board end to end, deadline badges, class mode + undo, grading report download.
// Usage: node tests/class-tools.ui.js OUTDIR
const { chromium } = require('playwright');
const out = process.argv[2]; const B = (process.env.BASE || 'http://localhost:3199');
let pass = 0, failN = 0;
const check = (n, c, x = '') => { c ? pass++ : failN++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };
const signIn = async (page, u, pin) => {
  await page.goto(B); await page.fill('input[name="username"]', u); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  for (const d of pin) await page.keyboard.press(d); await page.keyboard.press('Enter'); await page.waitForSelector('.taskbar .btn.start');
};
(async () => {
  const browser = await chromium.launch(); const errors = [];
  const ctxO = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true }); const o = await ctxO.newPage();
  o.on('pageerror', (e) => errors.push('owner: ' + e.message));
  const r = ctxO.request;
  await r.post(`${B}/api/login`, { data: { username: 'tester', pin: '0000' } });
  const g = (await (await r.post(`${B}/api/games`, { data: { name: 'Period 4', durationDays: 60 } })).json()).id;
  await o.goto(B); await o.evaluate((id) => localStorage.setItem('cr.game', id), g);

  // ---- paste a class list
  await o.goto(`${B}/#/admin/roster`); await o.reload(); await o.waitForSelector('button[data-act="paste-roster"]');
  await o.click('button[data-act="paste-roster"]');
  await o.fill('form[data-form="paste-preview"] textarea', 'Rosa Diaz, Vocalist\nMilo Park, Producer\nJune Kim');
  await o.click('form[data-form="paste-preview"] button');
  await o.waitForSelector('form[data-form="paste-create"]');
  const names = await o.locator('form[data-form="paste-create"] input').evaluateAll((els) => els.map((e) => e.value));
  check('paste: usernames suggested', names.length === 3 && names.every((n) => /^[a-z]+\d{2}$/.test(n)), names.join(','));
  await o.locator('form[data-form="paste-create"] input').first().fill('rosad01');
  await o.screenshot({ path: `${out}/paste.png` });
  await o.click('form[data-form="paste-create"] button.primary');
  await o.waitForSelector('text=3 artists signed');
  check('paste: codes shown with a print button', (await o.locator('.modal button[data-act="print-slips"]').count()) === 1);
  await o.click('.modal button[data-act="close-modal"]');
  const st = await (await r.get(`${B}/api/games/${g}/state`)).json();
  check('paste: edited username kept', st.roster.some((p) => p.username === 'rosad01'));
  for (const p of st.roster) await fetch(`${B}/api/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: p.username, code: p.claimCode, pin: '1357' }) });
  await r.post(`${B}/api/games/${g}/phase`, { data: { phase: 'active' } });
  const milo = st.roster.find((p) => p.displayName === 'Milo Park');

  // ---- job board: Rosa posts on a phone, Milo raises a hand, Rosa picks him
  const rosa = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  rosa.on('pageerror', (e) => errors.push('rosa: ' + e.message));
  await signIn(rosa, 'rosad01', '1357');
  await rosa.goto(`${B}/#/jobs`); await rosa.waitForSelector('button[data-act="request-new"]');
  check('job board: in the menu', (await rosa.locator('.menu .mi', { hasText: 'Job Board' }).count()) === 1);
  await rosa.click('button[data-act="request-new"]');
  await rosa.selectOption('#hire-form select[name="jobId"]', 'beat-maker');
  await rosa.fill('#hire-form input[name="quantity"]', '2');
  await rosa.fill('#hire-form textarea[name="details"]', 'Need a lo-fi beat');
  check('job board: form shows the rate-sheet total', (await rosa.locator('#hire-total').innerText()) === '$80');
  await rosa.click('#hire-form button.primary'); await rosa.waitForTimeout(900);
  check('job board: request shows on the board', (await rosa.locator('.request', { hasText: 'Need a lo-fi beat' }).count()) === 1);
  const over = await rosa.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check('job board: phone, no sideways scroll', over <= 2, `${over}px`);
  const miloP = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  miloP.on('pageerror', (e) => errors.push('milo: ' + e.message));
  await signIn(miloP, milo.username, '1357');
  await miloP.goto(`${B}/#/jobs`); await miloP.waitForSelector('button[data-act="request-apply"]');
  await miloP.click('button[data-act="request-apply"]'); await miloP.fill('form[data-form="request-apply"] input[name="note"]', 'Lo-fi is my thing');
  await miloP.click('form[data-form="request-apply"] button.primary'); await miloP.waitForTimeout(800);
  check('job board: hand raised', (await miloP.locator('button[data-act="request-unapply"]').count()) === 1);
  await rosa.reload(); await rosa.waitForSelector('button[data-act="request-hire"]');
  check('job board: poster sees the note', (await rosa.locator('.hand', { hasText: 'Lo-fi is my thing' }).count()) === 1);
  check('job board: menu count for the poster', (await rosa.locator('.menu .mi', { hasText: 'Job Board' }).locator('.count').count()) === 1);
  await rosa.screenshot({ path: `${out}/jobs-phone.png`, fullPage: true });
  await rosa.click('button[data-act="request-hire"]'); await rosa.click('button[data-act="confirm-ok"]');
  await rosa.waitForURL(/#\/contract\//, { timeout: 8000 }).catch(() => {});
  check('job board: picking opens the new deal', /#\/contract\//.test(rosa.url()));

  // ---- deadlines: owner approves, badge shows
  const deal = (await (await r.get(`${B}/api/games/${g}/state`)).json()).contracts[0];
  await r.post(`${B}/api/contracts/${deal.id}/action`, { data: { action: 'approve' } });
  await o.goto(`${B}/#/contract/${deal.id}`); await o.reload(); await o.waitForSelector('.due');
  check('deadline: badge on the deal', /Due in 7 days/.test(await o.locator('.due').first().innerText()));

  // ---- class mode + undo
  await o.goto(`${B}/#/admin/class`); await o.waitForSelector('.class-row');
  check('class mode: one row per student', (await o.locator('.class-row').count()) === 3);
  const row = o.locator('.class-row', { hasText: 'June Kim' });
  const cashBefore = await row.locator('.cr-who small').innerText();
  await row.locator('button[data-item="tardy"]').click(); await o.waitForTimeout(900);
  check('class mode: tap adds today\'s chip', (await o.locator('.class-row', { hasText: 'June Kim' }).locator('.today-chip').count()) === 1);
  check('class mode: cash updated', (await o.locator('.class-row', { hasText: 'June Kim' }).locator('.cr-who small').innerText()) !== cashBefore);
  await o.screenshot({ path: `${out}/class-mode.png` });
  await o.locator('.class-row', { hasText: 'June Kim' }).locator('button[data-act="undo"]').click(); await o.waitForTimeout(900);
  check('undo: chip shows undone, cash restored', (await o.locator('.class-row', { hasText: 'June Kim' }).locator('.today-chip.undone').count()) === 1
    && (await o.locator('.class-row', { hasText: 'June Kim' }).locator('.cr-who small').innerText()) === cashBefore);
  await o.locator('.class-row', { hasText: 'Milo Park' }).locator('button[data-item="volunteer"]').click(); await o.waitForTimeout(900);
  await o.goto(`${B}/#/admin/treasury`); await o.waitForSelector('.tx-row');
  check('undo: button in Treasury', (await o.locator('.tx-row button[data-act="undo"]').count()) >= 1 && (await o.locator('.tx-row .tag', { hasText: 'Undone' }).count()) >= 1);

  // ---- grading report download
  await o.goto(`${B}/#/admin/roster`); await o.waitForSelector('button[data-act="report"]');
  const [dl] = await Promise.all([o.waitForEvent('download'), o.click('.card-head button[data-act="report"]')]);
  check('report: class PDF downloads', /grading-report-.*\.pdf$/.test(dl.suggestedFilename()) && !(await dl.failure()), dl.suggestedFilename());
  const [dl2] = await Promise.all([o.waitForEvent('download'), o.locator('tr', { hasText: 'June Kim' }).locator('button[data-act="report"]').click()]);
  check('report: one-student PDF downloads', /grading-report-.*\.pdf$/.test(dl2.suggestedFilename()));
  check('no JS errors', errors.length === 0, errors.join(' | '));
  console.log(`\n${pass} passed, ${failN} failed`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

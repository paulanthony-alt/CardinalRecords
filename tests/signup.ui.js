// Browser: student signs up with a code, owner prints slips and deletes an unused season. Usage: node ui7.js OUTDIR
const { chromium } = require('playwright');
const out = process.argv[2]; const B = (process.env.BASE || 'http://localhost:3199');
(async () => {
  const browser = await chromium.launch(); const errors = [];
  const ctxO = await browser.newContext({ viewport: { width: 1366, height: 800 } }); const o = await ctxO.newPage();
  o.on('pageerror', (e) => errors.push('owner: ' + e.message));
  const r = ctxO.request;
  await r.post(`${B}/api/login`, { data: { username: 'tester', pin: '0000' } });
  const g = (await (await r.post(`${B}/api/games`, { data: { name: 'UI Season', durationDays: 30 } })).json()).id;
  for (const u of ['dana', 'eli', 'fay']) await r.post(`${B}/api/games/${g}/players`, { data: { username: u, displayName: u.toUpperCase() } });
  const unused = (await (await r.post(`${B}/api/games`, { data: { name: 'Oops Season', durationDays: 30 } })).json()).id;
  await o.goto(`${B}/`); await o.evaluate((id) => localStorage.setItem('cr.game', id), g);
  await o.goto(`${B}/#/admin/roster`); await o.reload(); await o.waitForSelector('.code-chip');
  const chip = await o.locator('.code-chip').first().innerText();
  console.log('roster shows codes:', await o.locator('.code-chip').count(), 'e.g.', chip);
  await o.screenshot({ path: `${out}/roster-codes.png` });
  const [popup] = await Promise.all([o.waitForEvent('popup'), o.click('button[data-act="print-slips"]')]);
  await popup.waitForLoadState(); console.log('sign-up slips:', await popup.locator('.slip').count()); await popup.screenshot({ path: `${out}/slips.png` }); await popup.close();
  const state = await (await r.get(`${B}/api/games/${g}/state`)).json();
  const dana = state.roster.find((p) => p.username === 'dana');

  // student signs up on a phone
  const s = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  s.on('pageerror', (e) => errors.push('student: ' + e.message));
  await s.goto(B); await s.fill('input[name="username"]', 'dana'); await s.keyboard.press('Enter');
  await s.waitForSelector('input[name="code"]');
  await s.fill('input[name="code"]', 'WRONG1'); await s.keyboard.press('Enter'); await s.waitForTimeout(500);
  console.log('wrong code message:', await s.locator('.pin-err').innerText());
  await s.fill('input[name="code"]', `${dana.claimCode.slice(0, 3).toLowerCase()}-${dana.claimCode.slice(3).toLowerCase()}`);
  await s.screenshot({ path: `${out}/code-step.png` });
  await s.keyboard.press('Enter'); await s.waitForSelector('#pin-dots');
  console.log('after code:', await s.locator('.login-card h2').innerText());
  for (const d of '2468') await s.keyboard.press(d); await s.keyboard.press('Enter'); await s.waitForTimeout(300);
  for (const d of '2468') await s.keyboard.press(d); await s.keyboard.press('Enter');
  await s.waitForSelector('.taskbar .btn.start', { timeout: 8000 }); await s.waitForTimeout(500);
  console.log('student signed in:', !(await s.locator('input[name="username"]').count()));

  // owner deletes the unused season from All seasons
  await o.goto(`${B}/#/admin/seasons`); await o.waitForTimeout(600);
  await o.click(`button[data-act="delete-season"][data-id="${unused}"]`);
  await o.fill('form[data-form="delete-season"] input[name="confirm"]', 'Oops Season');
  await o.click('form[data-form="delete-season"] button.danger'); await o.waitForTimeout(900);
  const names = await o.locator('table.t tbody tr td:first-child b').allInnerTexts();
  console.log('seasons after delete:', names);
  console.log('JS errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

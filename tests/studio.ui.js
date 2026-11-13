// Browser: a student requests studio time on a phone; the owner sees it, gets an overlap warning, approves or declines.
// Usage: node tests/studio.ui.js OUTDIR
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
  const g = (await (await r.post(`${B}/api/games`, { data: { name: 'Period 7', durationDays: 60 } })).json()).id;
  const made = await (await r.post(`${B}/api/games/${g}/players/bulk`, { data: { entries: [{ displayName: 'Iris Vale' }, { displayName: 'Tom Hart' }] } })).json();
  for (const c of made.created) await fetch(`${B}/api/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: c.username, code: c.claimCode, pin: '2468' }) });
  await r.post(`${B}/api/games/${g}/phase`, { data: { phase: 'active' } });
  const [iris, tom] = made.created;
  const day = new Date(Date.now() + 2 * 86_400_000);

  const s = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  s.on('pageerror', (e) => errors.push('student: ' + e.message));
  await s.goto(B); await s.fill('input[name="username"]', iris.username); await s.keyboard.press('Enter'); await s.waitForTimeout(300);
  for (const d of '2468') await s.keyboard.press(d); await s.keyboard.press('Enter'); await s.waitForSelector('.menu .mi'); await s.waitForTimeout(400);
  check('Studio in the student menu', (await s.locator('.menu .mi', { hasText: 'Studio' }).count()) === 1);
  await s.goto(`${B}/#/studio`); await s.waitForSelector('form[data-form="studio-request"]');
  await s.fill('form[data-form="studio-request"] input[name="day"]', ymd(day));
  await s.fill('form[data-form="studio-request"] input[name="time"]', '14:00');
  await s.selectOption('form[data-form="studio-request"] select[name="minutes"]', '90');
  await s.fill('form[data-form="studio-request"] input[name="purpose"]', 'Lead vocals for my single');
  await s.fill('form[data-form="studio-request"] input[name="guests"]', 'Tom (engineer)');
  await s.click('form[data-form="studio-request"] button.primary'); await s.waitForTimeout(900);
  check('request shows as waiting for a teacher', (await s.locator('.booking.st-pending', { hasText: 'Lead vocals for my single' }).count()) === 1);
  check('time saved as chosen (2:00–3:30)', /2:00\s?PM.3:30\s?PM/.test(await s.locator('.booking.st-pending .bk-when b').innerText()), await s.locator('.booking.st-pending .bk-when b').innerText());
  const over = await s.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check('phone: no sideways scroll', over <= 2, `${over}px`);
  await s.screenshot({ path: `${out}/studio-phone.png`, fullPage: true });

  // a second, overlapping request from Tom (through the API)
  const tomJar = await browser.newContext(); const tr = tomJar.request;
  await tr.post(`${B}/api/login`, { data: { username: tom.username, pin: '2468' } });
  const startTom = new Date(`${ymd(day)}T15:00:00`).getTime();

  await o.goto(B); await o.evaluate((id) => localStorage.setItem('cr.game', id), g); await o.goto(`${B}/#/studio`); await o.reload(); await o.waitForSelector('.booking');
  check('admin bar counts studio requests', (await o.locator('.admin-bar .ab-item', { hasText: 'Studio requests' }).count()) === 1);
  check('owner sees the details', (await o.locator('.booking', { hasText: 'Tom (engineer)' }).count()) === 1);
  await o.click('button[data-act="studio-decide"][data-a="approve"]');
  await o.fill('form[data-form="studio-decide"] input[name="note"]', 'Bring your session files');
  await o.click('form[data-form="studio-decide"] button.primary'); await o.waitForTimeout(900);
  check('approved session on the schedule', (await o.locator('.booking.st-approved', { hasText: 'Iris Vale' }).count()) >= 1);
  await tr.post(`${B}/api/games/${g}/studio`, { data: { startsAt: startTom, minutes: 60, purpose: 'Beat recording' } });
  await o.reload(); await o.waitForSelector('.booking.st-pending');
  check('overlap with an approved session is flagged', /Overlaps Iris Vale/.test(await o.locator('.booking.st-pending .bk-clash').innerText()));
  await o.screenshot({ path: `${out}/studio-owner.png`, fullPage: true });
  await o.click('.booking.st-pending button[data-a="decline"]');
  await o.fill('form[data-form="studio-decide"] input[name="note"]', 'Iris has the studio then. Try 4:00?');
  await o.click('form[data-form="studio-decide"] button.danger'); await o.waitForTimeout(900);
  check('declined', (await o.locator('.booking.st-declined', { hasText: 'Tom Hart' }).count()) === 1);
  await s.reload(); await s.waitForTimeout(1200);
  check('student sees Approved with the teacher note', (await s.locator('.booking.st-approved .bk-note', { hasText: 'Bring your session files' }).count()) >= 1);
  check('no JS errors', errors.length === 0, errors.join(' | '));
  console.log(`\n${pass} passed, ${failN} failed`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

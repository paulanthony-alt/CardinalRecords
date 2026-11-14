// Browser: a student requests studio time on a phone; the owner sees it, gets an overlap warning, approves or declines.
// Usage: node tests/studio.ui.js OUTDIR
const { chromium } = require('playwright');
const out = process.argv[2]; const B = (process.env.BASE || 'http://localhost:3199');
let pass = 0, failN = 0;
const check = (n, c, x = '') => { c ? pass++ : failN++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// Move the calendar forward (up to 2 weeks) until a session block matching `sel` shows.
async function findBlock(page, sel) {
  await page.click('button[data-act="cal-week"][data-d="0"]').catch(() => {});
  for (let i = 0; i < 3; i++) {
    if (await page.locator(sel).count()) return true;
    await page.click('button[data-act="cal-week"][data-d="1"]'); await page.waitForTimeout(250);
  }
  return false;
}
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
  // calendar: tap an open time next week -> the form is filled in
  check('calendar shows on the Studio page', (await s.locator('.studio-cal .cal-col').count()) >= 5);
  await s.click('button[data-act="cal-week"][data-d="1"]'); await s.waitForTimeout(250);
  const colInfo = await s.locator('.cal-col').first().evaluate((el) => ({ day: Number(el.dataset.day), h0: Number(el.dataset.h0) }));
  await s.locator('.cal-col').first().click({ position: { x: 20, y: 44 * 3 + 30 } }); await s.waitForTimeout(400);
  const filled = await s.evaluate(() => { const f = document.querySelector('#studio-form'); return { day: f.day.value, time: f.time.value }; });
  check('tapping an open time fills in the day and time (to the half hour)', filled.day === ymd(new Date(colInfo.day)) && filled.time === `${String(colInfo.h0 + 3).padStart(2, '0')}:30`, JSON.stringify(filled));
  await s.fill('form[data-form="studio-request"] input[name="day"]', ymd(day));
  await s.fill('form[data-form="studio-request"] input[name="time"]', '14:00');
  await s.selectOption('form[data-form="studio-request"] select[name="minutes"]', '90');
  await s.fill('form[data-form="studio-request"] input[name="purpose"]', 'Lead vocals for my single');
  await s.fill('form[data-form="studio-request"] input[name="guests"]', 'Tom (engineer)');
  await s.click('form[data-form="studio-request"] button.primary'); await s.waitForTimeout(900);
  check('request shows as waiting for a teacher', (await s.locator('.booking.st-pending', { hasText: 'Lead vocals for my single' }).count()) === 1);
  check('my waiting request shows on the calendar', await findBlock(s, '.cal-block.st-pending.mine'));
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
  check('calendar: approved session and waiting request on the same day, side by side', (await findBlock(o, '.cal-block.st-approved'))
    && (await o.locator('.cal-block.st-pending').count()) === 1
    && (await o.locator('.cal-block.st-approved').evaluate((a) => a.parentElement === document.querySelector('.cal-block.st-pending').parentElement)));
  const boxes = await o.evaluate(() => ['.cal-block.st-approved', '.cal-block.st-pending'].map((q) => { const r = document.querySelector(q).getBoundingClientRect(); return [r.left, r.right, r.top]; }));
  check('overlapping sessions do not cover each other', boxes[0][1] <= boxes[1][0] + 1 || boxes[1][1] <= boxes[0][0] + 1, JSON.stringify(boxes));
  check('later start sits lower on the calendar', boxes[1][2] > boxes[0][2]);
  await o.click('.cal-block.st-pending'); await o.waitForSelector('.modal .booking');
  check('tapping a session opens it with Approve / Decline', (await o.locator('.modal button[data-a="approve"]').count()) === 1);
  await o.screenshot({ path: `${out}/studio-calendar.png` });
  await o.click('.modal button[data-act="close-modal"]');
  check('overlap with an approved session is flagged', /Overlaps Iris Vale/.test(await o.locator('.booking.st-pending .bk-clash').innerText()));
  await o.screenshot({ path: `${out}/studio-owner.png`, fullPage: true });
  await o.click('.booking.st-pending button[data-a="decline"]');
  await o.fill('form[data-form="studio-decide"] input[name="note"]', 'Iris has the studio then. Try 4:00?');
  await o.click('form[data-form="studio-decide"] button.danger'); await o.waitForTimeout(900);
  check('declined', (await o.locator('.booking.st-declined', { hasText: 'Tom Hart' }).count()) === 1);
  await s.reload(); await s.waitForTimeout(1200);
  check('student calendar shows their approved session', await findBlock(s, '.cal-block.st-approved.mine'));
  await s.screenshot({ path: `${out}/studio-calendar-phone.png` });
  check('student sees Approved with the teacher note', (await s.locator('.booking.st-approved .bk-note', { hasText: 'Bring your session files' }).count()) >= 1);
  check('no JS errors', errors.length === 0, errors.join(' | '));
  console.log(`\n${pass} passed, ${failN} failed`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

// Browser: an owner adds dates to the label calendar; a student sees everything on a phone (month + week views).
// Usage: node tests/calendar.ui.js OUTDIR
const { chromium } = require('playwright');
const out = process.argv[2]; const B = (process.env.BASE || 'http://localhost:3199');
let pass = 0, failN = 0;
const check = (n, c, x = '') => { c ? pass++ : failN++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** A weekday at least `n` days from now (so the test doesn't depend on what day it runs). */
const weekdayAhead = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); while (d.getDay() % 6 === 0) d.setDate(d.getDate() + 1); return d; };
(async () => {
  const browser = await chromium.launch(); const errors = [];
  const ctxO = await browser.newContext({ viewport: { width: 1366, height: 900 } }); const o = await ctxO.newPage();
  o.on('pageerror', (e) => errors.push('owner: ' + e.message));
  const r = ctxO.request;
  await r.post(`${B}/api/login`, { data: { username: 'tester', pin: '0000' } });
  const g = (await (await r.post(`${B}/api/games`, { data: { name: 'Period 9', durationDays: 60 } })).json()).id;
  const made = await (await r.post(`${B}/api/games/${g}/players/bulk`, { data: { entries: [{ displayName: 'Nia Cole' }, { displayName: 'Leo Park' }] } })).json();
  for (const c of made.created) await fetch(`${B}/api/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: c.username, code: c.claimCode, pin: '2468' }) });
  await r.post(`${B}/api/games/${g}/phase`, { data: { phase: 'active' } });
  const [nia, leo] = made.created;
  // Nia hires Leo (due in 3 school days), and books studio time tomorrow-ish.
  const niaCtx = await browser.newContext(); const nr = niaCtx.request; await nr.post(`${B}/api/login`, { data: { username: nia.username, pin: '2468' } });
  const leoCtx = await browser.newContext(); const lr = leoCtx.request; await lr.post(`${B}/api/login`, { data: { username: leo.username, pin: '2468' } });
  const deal = (await (await nr.post(`${B}/api/games/${g}/contracts`, { data: { sellerId: leo.id, jobId: 'lyricist', quantity: 1, dueDays: 3, terms: 'Hook lyrics' } })).json()).id;
  await lr.post(`${B}/api/contracts/${deal}/action`, { data: { action: 'accept' } });
  await r.post(`${B}/api/contracts/${deal}/action`, { data: { action: 'approve' } });
  const sess = weekdayAhead(2); sess.setHours(15, 0, 0, 0);
  await nr.post(`${B}/api/games/${g}/studio`, { data: { startsAt: sess.getTime(), minutes: 60, purpose: 'Vocals' } });
  const show = weekdayAhead(4);

  // ---- owner adds a showcase from the calendar
  await o.goto(B); await o.evaluate((id) => localStorage.setItem('cr.game', id), g); await o.goto(`${B}/#/calendar`); await o.reload();
  await o.waitForSelector('.month-grid');
  check('Calendar in the menu', (await o.locator('.menu .mi', { hasText: 'Calendar' }).count()) === 1);
  check('month view: deal due date and studio request on the calendar', (await o.locator('.mc-chip.t-deals').count()) >= 1 && (await o.locator('.mc-chip.t-studio.pending').count()) >= 1);
  check('season start on the calendar', (await o.locator('.mc-chip.t-season', { hasText: 'Season starts' }).count()) === 1);
  await o.click('.page-head button[data-act="cal-new"]');
  await o.fill('#cal-form input[name="title"]', 'Winter Showcase');
  await o.selectOption('#cal-form select[name="kind"]', 'showcase');
  await o.fill('#cal-form input[name="day"]', ymd(show));
  await o.fill('#cal-form input[name="time"]', '18:30');
  await o.fill('#cal-form textarea[name="details"]', 'Auditorium. One track each.');
  await o.screenshot({ path: `${out}/calendar-add.png` });
  await o.click('#cal-form button.primary'); await o.waitForTimeout(900);
  if (!(await o.locator('.mc-chip.t-events', { hasText: 'Winter Showcase' }).count())) await o.click('button[data-act="cal-step"][data-d="1"]');
  check('showcase shows on its day', (await o.locator(`.mc-cell[data-day="${ymd(show)}"] .mc-chip.t-events`, { hasText: 'Winter Showcase' }).count()) === 1);
  // a no-school day: the time box hides, the day is shaded
  const off = weekdayAhead(5);
  await o.click(`.mc-cell[data-day="${ymd(off)}"]`).catch(async () => { await o.click('button[data-act="cal-step"][data-d="1"]'); await o.click(`.mc-cell[data-day="${ymd(off)}"]`); });
  await o.click('.cal-agenda button[data-act="cal-new"]');
  check('"Add a date" from a day fills in that day', (await o.inputValue('#cal-form input[name="day"]')) === ymd(off));
  await o.selectOption('#cal-form select[name="kind"]', 'noschool');
  check('no-school days hide the time', await o.locator('#cal-time').isHidden());
  await o.fill('#cal-form input[name="title"]', 'Teacher workday');
  await o.click('#cal-form button.primary'); await o.waitForTimeout(900);
  check('no-school day shaded', (await o.locator(`.mc-cell.noschool[data-day="${ymd(off)}"]`).count()) === 1);
  // edit through the details window
  await o.click(`.mc-cell[data-day="${ymd(off)}"]`);
  await o.click('.cal-agenda .cal-item.t-noschool'); await o.waitForSelector('.modal button[data-act="cal-edit"]');
  check('details window says due dates skip it', /deal due dates skip this day/i.test(await o.locator('.modal').innerText()));
  await o.click('.modal button[data-act="cal-edit"]');
  await o.fill('#cal-form input[name="title"]', 'Teacher workday (no classes)');
  await o.click('#cal-form button.primary'); await o.waitForTimeout(800);
  check('edited', (await o.locator('.cal-agenda .cal-item', { hasText: 'Teacher workday (no classes)' }).count()) === 1);
  // filters
  await o.click('button[data-act="cal-step"][data-d="0"]').catch(() => {});
  await o.click('button[data-act="cal-filter"][data-k="deals"]');
  check('filter hides deal due dates', (await o.locator('.mc-chip.t-deals').count()) === 0 && (await o.locator('.cal-filter.t-deals.off').count()) === 1);
  await o.click('button[data-act="cal-filter"][data-k="deals"]');
  await o.screenshot({ path: `${out}/calendar-owner-month.png`, fullPage: true });
  // week view
  await o.click('button[data-act="cal-view"][data-v="week"]');
  check('week view: 7 days', (await o.locator('.wk-day').count()) === 7);
  await o.screenshot({ path: `${out}/calendar-owner-week.png`, fullPage: true });
  await o.goto(`${B}/#/hq`); await o.waitForSelector('.hq-cal');
  check('owner HQ: Coming up card', (await o.locator('.hq-cal tr').count()) >= 1);

  // ---- student on a phone
  const s = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  s.on('pageerror', (e) => errors.push('student: ' + e.message));
  await s.goto(B); await s.fill('input[name="username"]', leo.username); await s.keyboard.press('Enter'); await s.waitForTimeout(300);
  for (const d of '2468') await s.keyboard.press(d); await s.keyboard.press('Enter'); await s.waitForSelector('.menu .mi');
  await s.goto(`${B}/#/hq`); await s.waitForSelector('.hq-cal');
  check('student HQ: Coming up shows their deal due date', (await s.locator('.hq-cal tr', { hasText: 'You deliver' }).count()) === 1);
  await s.screenshot({ path: `${out}/calendar-hq-phone.png`, fullPage: true });
  await s.goto(`${B}/#/calendar`); await s.waitForSelector('.month-grid');
  check('student has no Add button', (await s.locator('button[data-act="cal-new"]').count()) === 0);
  const over = await s.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check('phone: no sideways scroll (month)', over <= 2, `${over}px`);
  check('student does not see waiting studio requests from others', (await s.locator('.mc-chip.t-studio.pending').count()) === 0);
  if (!(await s.locator(`.mc-cell[data-day="${ymd(show)}"]`).count())) await s.click('button[data-act="cal-step"][data-d="1"]');
  await s.click(`.mc-cell[data-day="${ymd(show)}"]`);
  check('tap a day: its dates listed below', (await s.locator('.cal-agenda .cal-item', { hasText: 'Winter Showcase' }).count()) === 1);
  await s.click('.cal-agenda .cal-item.t-events'); await s.waitForSelector('.modal');
  check('student sees the details, no Edit/Delete', /One track each/.test(await s.locator('.modal').innerText()) && (await s.locator('.modal [data-act="cal-edit"]').count()) === 0);
  await s.screenshot({ path: `${out}/calendar-phone-month.png`, fullPage: true });
  await s.click('.modal button[data-act="close-modal"]');
  await s.click('button[data-act="cal-view"][data-v="week"]');
  const over2 = await s.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check('phone: no sideways scroll (week)', over2 <= 2, `${over2}px`);
  await s.screenshot({ path: `${out}/calendar-phone-week.png`, fullPage: true });
  check('no JS errors', errors.length === 0, errors.join(' | '));
  console.log(`\n${pass} passed, ${failN} failed`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

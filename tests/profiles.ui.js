// Browser: a student adds a profile link from Profile; it shows in the Showcase and on their artist page; an owner removes it.
// Usage: node tests/profiles.ui.js OUTDIR
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
  const g = (await (await r.post(`${B}/api/games`, { data: { name: 'Period 2', durationDays: 60 } })).json()).id;
  await r.post(`${B}/api/games/${g}/players`, { data: { username: 'nina', displayName: 'Nina Beats', roleTitle: 'Producer' } });
  const p = (await (await r.get(`${B}/api/games/${g}/state`)).json()).roster[0];
  await fetch(`${B}/api/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'nina', code: p.claimCode, pin: '2468' }) });
  await r.post(`${B}/api/games/${g}/phase`, { data: { phase: 'active' } });

  const s = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  s.on('pageerror', (e) => errors.push('student: ' + e.message));
  await s.goto(B); await s.fill('input[name="username"]', 'nina'); await s.keyboard.press('Enter'); await s.waitForTimeout(300);
  for (const d of '2468') await s.keyboard.press(d); await s.keyboard.press('Enter'); await s.waitForSelector('.taskbar .btn.start');
  await s.goto(`${B}/#/showcase`); await s.waitForSelector('.profiles');
  check('Showcase has Artist profiles mid-season (music still locked)', (await s.locator('.card.lock').count()) === 1 && (await s.locator('.profiles').count()) === 1);
  await s.goto(`${B}/#/profile`); await s.waitForSelector('input[name="profileUrl"]');
  await s.fill('input[name="profileUrl"]', 'https://www.youtube.com/watch?v=abc'); await s.click('form[data-form="profile"] button.primary'); await s.waitForTimeout(700);
  check('a non-Google link is refused with a clear message', (await s.locator('.toast.err').last().innerText()).includes('Google'));
  await s.fill('input[name="profileUrl"]', 'https://docs.google.com/presentation/d/1NinaDeck/edit'); await s.click('form[data-form="profile"] button.primary'); await s.waitForTimeout(900);
  await s.goto(`${B}/#/showcase`); await s.waitForSelector('.profile-card');
  const a = s.locator('.profile-card a[target="_blank"]').first();
  check('profile card links to the Slides in a new tab', (await a.getAttribute('href')) === 'https://docs.google.com/presentation/d/1NinaDeck/edit' && (await a.getAttribute('rel')).includes('noopener'));
  check('button says Google Slides', (await a.innerText()).includes('Google Slides'));
  const over = await s.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check('phone: no sideways scroll', over <= 2, `${over}px`);
  await s.screenshot({ path: `${out}/profiles-phone.png`, fullPage: true });

  await o.goto(B); await o.evaluate((id) => localStorage.setItem('cr.game', id), g); await o.goto(`${B}/#/artist/${p.id}`); await o.reload();
  await o.waitForSelector('.profile-hero');
  check('artist page shows the profile button', (await o.locator('.hero-actions a[target="_blank"]').count()) === 1);
  await o.goto(`${B}/#/showcase`); await o.waitForSelector('.profile-card');
  await o.screenshot({ path: `${out}/profiles-owner.png` });
  await o.click('button[data-act="clear-profile"]'); await o.click('button[data-act="confirm-ok"]'); await o.waitForTimeout(900);
  check('owner removes it', (await o.locator('.profile-card').count()) === 0);
  check('no JS errors', errors.length === 0, errors.join(' | '));
  console.log(`\n${pass} passed, ${failN} failed`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

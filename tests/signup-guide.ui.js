// Owner sees the sign-up steps with live progress; students never do. Usage: node ui8.js OUTDIR
const { chromium } = require('playwright');
const out = process.argv[2]; const B = (process.env.BASE || 'http://localhost:3199');
(async () => {
  const browser = await chromium.launch(); const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } }); const o = await ctx.newPage();
  o.on('pageerror', (e) => errors.push(e.message));
  const r = ctx.request;
  await r.post(`${B}/api/login`, { data: { username: 'tester', pin: '0000' } });
  const g = (await (await r.post(`${B}/api/games`, { data: { name: 'Period 3', durationDays: 90 } })).json()).id;
  await o.goto(`${B}/#/admin/roster`); await o.waitForSelector('.signup-guide');
  console.log('empty roster:', await o.locator('.signup-guide summary .more').innerText());
  for (const u of ['jsmith27', 'mlee14', 'tkhan09']) await r.post(`${B}/api/games/${g}/players`, { data: { username: u } });
  const st = await (await r.get(`${B}/api/games/${g}/state`)).json();
  const p = st.roster[0];
  await fetch(`${B}/api/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: p.username, code: p.claimCode, pin: '1357' }) });
  await o.reload(); await o.waitForSelector('.signup-guide');
  console.log('progress:', await o.locator('.signup-guide summary .more').innerText(), '| ticked steps:', await o.locator('.step-mark.ok').count(), '| open:', await o.locator('.signup-guide[open]').count() === 1);
  await o.screenshot({ path: `${out}/guide.png`, fullPage: false });
  // a student can't see it, even by typing the address
  const s = await (await browser.newContext()).newPage();
  await s.goto(B); await s.fill('input[name="username"]', p.username); await s.keyboard.press('Enter'); await s.waitForTimeout(300);
  for (const d of '1357') await s.keyboard.press(d); await s.keyboard.press('Enter'); await s.waitForSelector('.taskbar .btn.start');
  await s.goto(`${B}/#/admin/roster`); await s.reload(); await s.waitForTimeout(1200);
  console.log('student sees the steps:', await s.locator('.signup-guide').count() > 0, '| student sees Admin menu:', await s.locator('.admin-btn').count() > 0);
  console.log('JS errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

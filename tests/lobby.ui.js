// Browser: owner admin bar + lobby moderation; students never see owner tools. Usage: node tests/lobby.ui.js OUTDIR
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
  const g = (await (await r.post(`${B}/api/games`, { data: { name: 'Period 5', durationDays: 60 } })).json()).id;
  for (const u of ['maya', 'theo']) await r.post(`${B}/api/games/${g}/players`, { data: { username: u, displayName: u[0].toUpperCase() + u.slice(1) } });
  const st = await (await r.get(`${B}/api/games/${g}/state`)).json();
  for (const p of st.roster) await fetch(`${B}/api/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: p.username, code: p.claimCode, pin: '2580' }) });
  await r.post(`${B}/api/games/${g}/phase`, { data: { phase: 'active' } });

  // student signs in on a phone
  const s = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  s.on('pageerror', (e) => errors.push('student: ' + e.message));
  await s.goto(B); await s.fill('input[name="username"]', 'theo'); await s.keyboard.press('Enter'); await s.waitForTimeout(300);
  for (const d of '2580') await s.keyboard.press(d); await s.keyboard.press('Enter'); await s.waitForSelector('.taskbar .btn.start');
  await s.goto(`${B}/#/lobby`); await s.waitForSelector('form[data-form="chat"]');
  await s.fill('form[data-form="chat"] input', 'this is a bad word message'); await s.keyboard.press('Enter'); await s.waitForTimeout(600);
  check('student sees no admin bar or tools', !(await s.locator('.admin-bar').count()) && !(await s.locator('.feed .mod').count()));

  // owner: admin bar + lobby tools
  await o.goto(B); await o.evaluate((id) => localStorage.setItem('cr.game', id), g); await o.goto(`${B}/#/lobby`); await o.reload();
  await o.waitForSelector('.admin-bar');
  check('owner sees the admin bar', await o.locator('.admin-bar').isVisible());
  check('admin bar shows the season', (await o.locator('.admin-bar .ab-season').innerText()).includes('Period 5'));
  await o.screenshot({ path: `${out}/admin-bar-lobby.png` });
  const row = o.locator('.feed li', { hasText: 'this is a bad word message' }).first();
  await row.locator('button[data-a="hide"]').click(); await o.waitForTimeout(800);
  check('owner hides it from the lobby page', await o.locator('.feed li.is-hidden', { hasText: 'bad word' }).count() === 1);
  check('admin bar counts hidden posts', (await o.locator('.admin-bar .ab-item', { hasText: 'Hidden posts' }).innerText()).includes('1'));
  await s.reload(); await s.waitForTimeout(1200);
  check('student no longer sees it', !(await s.locator('text=this is a bad word message').count()));
  // mute from the post
  await o.locator('.feed li', { hasText: 'bad word' }).first().locator('button[data-act="mute"]').click(); await o.waitForTimeout(800);
  await s.reload(); await s.waitForTimeout(1200);
  check('muted student sees the paused note, no chat box', (await s.locator('.note', { hasText: 'paused your chat' }).count()) === 1 && !(await s.locator('form[data-form="chat"]').count()));
  // chat mode from the admin bar
  await o.selectOption('.admin-bar select', 'off'); await o.waitForTimeout(1000);
  await s.reload(); await s.waitForTimeout(1200);
  const nav = await s.locator('.menu .mi').allInnerTexts();
  check('lobby hidden: gone from the student menu', !nav.includes('Lobby'), nav.join(','));
  await s.goto(`${B}/#/lobby`); await s.reload(); await s.waitForTimeout(800);
  check('lobby hidden: student sees "closed"', (await s.locator('text=The lobby is closed right now').count()) === 1);
  // Lobby controls tab
  await o.goto(`${B}/#/admin/lobby`); await o.waitForSelector('.radio-cards');
  await o.check('input[name="chatmode"][value="announce"]'); await o.waitForTimeout(900);
  check('chat mode set from Lobby controls', (await o.locator('.admin-bar select').inputValue()) === 'announce');
  await o.uncheck('form[data-form="lobby-show"] input[name="join"]'); await o.click('form[data-form="lobby-show"] button'); await o.waitForTimeout(900);
  await o.screenshot({ path: `${out}/lobby-controls.png`, fullPage: true });
  await s.goto(`${B}/#/lobby`); await s.reload(); await s.waitForTimeout(1200);
  check('announcements only: student reads, cannot post', (await s.locator('.note', { hasText: 'Only Record Owners' }).count()) === 1);
  check('hidden category gone for students', !(await s.locator('.feed li.k-join').count()));
  const over = await s.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check('student phone: no sideways scroll', over <= 2, `${over}px`);
  // owner on a phone: admin bar scrolls inside itself, not the page
  const op = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await op.goto(B); await op.fill('input[name="username"]', 'tester'); await op.keyboard.press('Enter'); await op.waitForTimeout(300);
  for (const d of '0000') await op.keyboard.press(d); await op.keyboard.press('Enter'); await op.waitForSelector('.admin-bar');
  await op.evaluate((id) => localStorage.setItem('cr.game', id), g); await op.reload(); await op.waitForSelector('.admin-bar'); await op.waitForTimeout(500);
  const overO = await op.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check('owner phone: admin bar fits (no page sideways scroll)', overO <= 2, `${overO}px`);
  await op.screenshot({ path: `${out}/admin-bar-phone.png` });
  check('no JS errors', errors.length === 0, errors.join(' | '));
  console.log(`\n${pass} passed, ${failN} failed`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

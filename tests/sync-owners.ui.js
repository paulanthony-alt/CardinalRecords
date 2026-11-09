// Revision only moves on real changes; two owners see each other's season changes. Usage: node t9.js OUTDIR
const { chromium } = require('playwright');
const B = (process.env.BASE || 'http://localhost:3199');
let pass = 0, failN = 0;
const check = (n, c, x = '') => { c ? pass++ : failN++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };
(async () => {
  const browser = await chromium.launch(); const errors = [];
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const A = await ctxA.newPage();
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const Bp = await ctxB.newPage();
  for (const [n, p] of [['A', A], ['B', Bp]]) p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`));
  const ra = ctxA.request, rb = ctxB.request;
  await ra.post(`${B}/api/login`, { data: { username: 'BFreeds', pin: '1234' } });
  await rb.post(`${B}/api/login`, { data: { username: 'JPolise', pin: '1234' } });
  const rev = async () => (await (await ra.get(`${B}/api/rev`)).json()).rev;
  const g = (await (await ra.post(`${B}/api/games`, { data: { name: 'Keep Me', durationDays: 30 } })).json()).id;
  await ra.post(`${B}/api/games/${g}/players`, { data: { username: 'stu1' } });
  const code = (await (await ra.get(`${B}/api/games/${g}/state`)).json()).roster[0].claimCode;
  // ---- revision
  let r0 = await rev();
  const s = await browser.newContext(); const sr = s.request;
  await sr.post(`${B}/api/login/lookup`, { data: { username: 'stu1' } });
  await sr.post(`${B}/api/claim/check`, { data: { username: 'stu1', code: 'WRONG1' } });
  await sr.post(`${B}/api/claim/check`, { data: { username: 'stu1', code } });
  check('lookup and code checks do not count as changes', (await rev()) === r0);
  await sr.post(`${B}/api/claim`, { data: { username: 'stu1', code, pin: '2468' } });
  const r1 = await rev();
  check('claiming an account does count (roster changes)', r1 !== r0);
  await sr.post(`${B}/api/logout`); await sr.post(`${B}/api/login`, { data: { username: 'stu1', pin: '2468' } });
  await sr.post(`${B}/api/login`, { data: { username: 'stu1', pin: '0000' } });
  check('sign-in, wrong PIN and sign-out do not count', (await rev()) === r1);
  await sr.put(`${B}/api/me/pin`, { data: { currentPin: '2468', newPin: '1357' } });
  check('changing your PIN does not count', (await rev()) === r1);
  await sr.post(`${B}/api/games/${g}/feed`, { data: { message: 'hi' } }).catch(() => {});
  // ---- two owners in browsers
  const temp = (await (await rb.post(`${B}/api/games`, { data: { name: 'Temp Season', durationDays: 30 } })).json()).id;
  await A.goto(B); await A.evaluate((id) => localStorage.setItem('cr.game', id), temp); await A.goto(`${B}/#/hq`); await A.reload();
  await A.waitForSelector('.season-pick'); await A.waitForTimeout(600);
  check('owner A has Temp Season open', (await A.locator('.season-pick').inputValue()) === String(temp));
  // owner B deletes it; A should move to another season by itself
  await rb.delete(`${B}/api/games/${temp}`, { data: { confirm: 'Temp Season' } });
  await A.mouse.move(10, 10); await A.mouse.down(); await A.mouse.up(); // counts as activity
  await A.waitForTimeout(11500);
  const picker = await A.locator('.season-pick option').allInnerTexts();
  check('A switched off the deleted season on its own', (await A.locator('.season-pick').inputValue()) === String(g) && !picker.includes('Temp Season'), picker.join(', '));
  // owner B creates a season; it appears in A's picker
  await rb.post(`${B}/api/games`, { data: { name: 'Brand New', durationDays: 30 } });
  await A.mouse.down(); await A.mouse.up();
  await A.waitForTimeout(11500);
  check("B's new season appears in A's picker", (await A.locator('.season-pick option').allInnerTexts()).includes('Brand New'));
  check('no JS errors', errors.length === 0, errors.join(' | '));
  console.log(`\n${pass} passed, ${failN} failed`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

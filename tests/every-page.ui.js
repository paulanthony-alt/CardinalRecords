// Visit every page as a student and an owner, on phone and laptop sizes. Usage: node ui5.js OUTDIR
const { chromium } = require('playwright');
const out = process.argv[2];
const B = (process.env.BASE || 'http://localhost:3199');
const ROUTES = ['hq', 'lobby', 'rates', 'contracts', 'jobs', 'challenges', 'contract/1', 'roster', 'artist/3', 'charts', 'showcase', 'guide', 'data', 'profile'];
const ADMIN = ['review', 'class', 'lobby', 'roster', 'treasury', 'rates', 'season', 'seasons', 'backups', 'new'];
(async () => {
  const browser = await chromium.launch();
  const problems = [];
  for (const [who, user, pin] of [['student', 'kid2', '4002'], ['owner', 'JPolise', '1234']]) {
    for (const vp of [{ width: 390, height: 844, n: 'phone' }, { width: 1366, height: 768, n: 'laptop' }]) {
      const ctx = await browser.newContext({ viewport: vp });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => problems.push(`${who}/${vp.n}: JS error ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error') problems.push(`${who}/${vp.n}: console ${m.text()}`); });
      // sign in through the real login screen
      await page.goto(B);
      await page.fill('input[name="username"]', user);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(400);
      for (const d of pin) await page.keyboard.press(d);
      await page.keyboard.press('Enter');
      await page.waitForSelector('.season-pick, .admin-btn, nav, .mi', { timeout: 8000 }).catch(() => problems.push(`${who}/${vp.n}: sign-in did not finish`));
      await page.waitForTimeout(800);
      const routes = [...ROUTES, ...(who === 'owner' ? ADMIN.map((a) => `admin/${a}`) : ['admin/review'])];
      for (const r of routes) {
        await page.goto(`${B}/#/${r}`);
        await page.waitForTimeout(350);
        const info = await page.evaluate(() => ({
          over: document.documentElement.scrollWidth - window.innerWidth,
          text: document.body.innerText.length,
          adminVisible: !!document.querySelector('.admin-btn'),
          undef: /\bundefined\b|\bNaN\b|\[object Object\]/.test(document.querySelector('main, #app, body').innerText),
        }));
        if (info.over > 2) problems.push(`${who}/${vp.n} #/${r}: page scrolls sideways by ${info.over}px`);
        if (info.text < 50) problems.push(`${who}/${vp.n} #/${r}: page looks empty`);
        if (info.undef) problems.push(`${who}/${vp.n} #/${r}: shows undefined/NaN`);
        if (who === 'student' && info.adminVisible) problems.push(`student sees the Admin menu on #/${r}`);
      }
      await page.goto(`${B}/#/hq`);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}/${who}-${vp.n}.png` });
      await ctx.close();
    }
  }
  console.log(problems.length ? problems.join('\n') : 'no problems');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

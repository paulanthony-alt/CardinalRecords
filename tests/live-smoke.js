// Live site smoke test: sign-in screen loads, privacy notice opens, no outside requests, no JS errors.
const { chromium } = require('playwright');
(async () => {
  const U = process.env.LIVE_URL || 'https://cardinal-records.onrender.com';
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const outside = [], errs = [];
  p.on('request', (r) => { if (!r.url().startsWith(U)) outside.push(r.url()); });
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(U, { timeout: 90000 }); await p.waitForSelector('input[name="username"]', { timeout: 60000 });
  const welcome = await p.locator('.welcome-banner').innerText().catch(() => '');
  await p.click('button[data-act="privacy"]'); await p.waitForSelector('.privacy');
  const fonts = await p.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter((f) => f.status === 'loaded').length; });
  console.log('sign-in screen: ok | welcome banner:', welcome.includes('WELCOME TO CARDINAL RECORDS') ? 'ok' : 'MISSING', '| privacy notice: ok | self-hosted fonts loaded:', fonts, '| outside requests:', outside.length ? outside : 'none', '| JS errors:', errs.length ? errs : 'none');
  await b.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });

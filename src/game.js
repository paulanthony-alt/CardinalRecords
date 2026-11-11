'use strict';
const { db, tx } = require('./db');
const { sheetFor, findItem } = require('./rates');

const DAY = 86_400_000;
const MAX_DAYS = 365;
const MAX_PLAYERS = 30;
const OPEN_STATUSES = ['offered', 'countered', 'review', 'active', 'delivered']; // 'countered' only on deals made before the rate sheet
const PUBLIC_STATUSES = ['active', 'delivered', 'completed'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (message, status = 400) => {
  throw new HttpError(status, message);
};

// ---------- validation ----------
function str(v, name, { min = 0, max = 200 } = {}) {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  if (s.length < min) fail(min === 1 ? `${name} is required` : `${name} must be at least ${min} characters`);
  if (s.length > max) fail(`${name} must be at most ${max} characters`);
  return s;
}
function int(v, name, { min = -Infinity, max = Infinity } = {}) {
  const n = Number(v);
  if (!Number.isInteger(n)) fail(`${name} must be a whole number`);
  if (n < min || n > max) fail(`${name} must be between ${min.toLocaleString()} and ${max.toLocaleString()}`);
  return n;
}
/** A public http(s) link, e.g. a Spotify or SoundCloud page. Adds https:// when it's missing. */
function httpUrl(v, name) {
  let s = str(v, name, { min: 1, max: 500 });
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  let u;
  try { u = new URL(s); } catch { fail(`${name} must be a link like https://open.spotify.com/…`); }
  if (!['https:', 'http:'].includes(u.protocol) || !u.hostname.includes('.')) fail(`${name} must be a link like https://open.spotify.com/…`);
  return u.href;
}
// Artist profiles are Google Slides, Docs, Drive files or Sites. Keeping to Google keeps the
// links school-friendly (students' school Google accounts) and predictable for teachers.
const PROFILE_HOSTS = ['docs.google.com', 'drive.google.com', 'sites.google.com'];
/** '' clears the link; anything else must be a Google Slides/Docs/Drive/Sites link. */
function profileUrl(v) {
  if (v == null || String(v).trim() === '') return null;
  const href = httpUrl(v, 'Artist profile link');
  const host = new URL(href).hostname.toLowerCase();
  if (!PROFILE_HOSTS.includes(host)) fail('Use a Google Slides, Google Docs, Google Drive or Google Sites link (it should start with https://docs.google.com/…)');
  return href.replace(/^http:/, 'https:');
}

const isPin = (p) => /^\d{4,6}$/.test(String(p ?? ''));

// Sign-up codes: 6 characters with no look-alikes (no 0/O, 1/I/L), shown as ABC-DEF.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newClaimCode = () => Array.from({ length: 6 }, () => CODE_ALPHABET[require('node:crypto').randomInt(CODE_ALPHABET.length)]).join('');
/** What the student typed, tidied: case, spaces and dashes don't matter. */
const tidyCode = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
const isUsername = (u) => /^[a-zA-Z0-9_.-]{3,24}$/.test(String(u ?? ''));

// Set by the server: called when a read request changes data (the season clock running out).
const hooks = { onChange: () => {} };

// ---------- feed ----------
async function post(gameId, kind, actorId, message) {
  await db.run('INSERT INTO feed (game_id, kind, actor_id, message, created_at) VALUES (?, ?, ?, ?, ?)',
    gameId, kind, actorId ?? null, message, Date.now()
  );
}

// ---------- games & clock ----------
async function getGame(id) {
  const g = await db.get('SELECT * FROM games WHERE id = ?', id);
  if (!g) fail('Game not found', 404);
  // The season wraps automatically when its last day passes.
  if (g.status === 'active' && g.started_at && Date.now() >= g.started_at + g.duration_days * DAY) {
    const endedAt = g.started_at + g.duration_days * DAY;
    // Concurrent requests can both see 'active'; only the one that flips it posts.
    const { changes } = await db.run("UPDATE games SET status = 'showcase', ended_at = ? WHERE id = ? AND status = 'active'", endedAt, g.id);
    if (changes) hooks.onChange();
    if (changes) await post(g.id, 'phase', null, "That is a wrap on the season! Get your music ready: sharing music to the Showcase opens once a Record Owner turns it on.");
    g.status = 'showcase';
    g.ended_at = endedAt;
  }
  return g;
}

function clock(g) {
  if (!g.started_at) return { day: 0, totalDays: g.duration_days, daysLeft: g.duration_days, endsAt: null, pct: 0 };
  const endsAt = g.started_at + g.duration_days * DAY;
  const ref = g.status === 'active' ? Date.now() : Math.min(g.ended_at || Date.now(), endsAt);
  const day = Math.min(g.duration_days, Math.max(1, Math.floor((ref - g.started_at) / DAY) + 1));
  const daysLeft = g.status === 'active' ? Math.max(0, Math.ceil((endsAt - Date.now()) / DAY)) : 0;
  return { day, totalDays: g.duration_days, daysLeft, endsAt, pct: Math.min(100, (day / g.duration_days) * 100) };
}

/** Cash an artist has in one season (artists can be moved between seasons). */
async function balanceOf(userId, gameId) {
  return (await db.get('SELECT COALESCE(SUM(amount), 0) AS b FROM ledger WHERE user_id = ? AND game_id = ?', userId, gameId)).b;
}

async function ledgerEntry(gameId, userId, amount, kind, { contractId = null, memo = '', by = null } = {}) {
  await db.run(
    'INSERT INTO ledger (game_id, user_id, amount, kind, contract_id, memo, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    gameId, userId, amount, kind, contractId, memo, by, Date.now()
  );
}

async function payAdvance(game, userId) {
  if (game.starting_balance <= 0) return;
  const paid = await db.get("SELECT 1 FROM ledger WHERE user_id = ? AND game_id = ? AND kind = 'advance'", userId, game.id);
  if (!paid) await ledgerEntry(game.id, userId, game.starting_balance, 'advance', { memo: 'Signing advance from the label' });
}

// ---------- progression ----------
const LEVEL_TITLES = [
  [1, 'Intern'], [2, 'Street Team'], [3, 'Session Player'], [5, 'Producer'], [7, 'A&R'],
  [10, 'Hitmaker'], [14, 'Executive'], [18, 'Mogul'], [25, 'Legend'],
];
const xpForLevel = (lvl) => 60 * (lvl - 1) ** 2;
function levelInfo(xp) {
  const level = Math.floor(Math.sqrt(xp / 60)) + 1;
  const title = LEVEL_TITLES.filter(([l]) => level >= l).pop()[1];
  const floor = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { level, title, xp, levelXp: xp - floor, levelSpan: next - floor };
}

/** Per-player money + progression stats for a game. */
async function playerStats(game) {
  const gid = game.id;
  const byUser = async (sql) => new Map((await db.all(sql, gid)).map((r) => [r.k, r]));

  const [players, bal, earned, granted, escrow, sold, bought, tracks, likes] = await Promise.all([
    db.all("SELECT * FROM users WHERE role = 'player' AND game_id = ? ORDER BY display_name", gid),
    byUser('SELECT user_id AS k, SUM(amount) AS v FROM ledger WHERE game_id = ? AND user_id IS NOT NULL GROUP BY user_id'),
    byUser("SELECT user_id AS k, SUM(amount) AS v FROM ledger WHERE game_id = ? AND kind = 'payment' GROUP BY user_id"),
    byUser("SELECT user_id AS k, SUM(amount) AS v FROM ledger WHERE game_id = ? AND kind IN ('advance','grant','bonus','fine') GROUP BY user_id"),
    byUser('SELECT buyer_id AS k, SUM(escrow) AS v FROM contracts WHERE game_id = ? GROUP BY buyer_id'),
    byUser("SELECT seller_id AS k, COUNT(*) AS v, AVG(rating) AS r FROM contracts WHERE game_id = ? AND status = 'completed' GROUP BY seller_id"),
    byUser("SELECT buyer_id AS k, COUNT(*) AS v, SUM(amount) AS s FROM contracts WHERE game_id = ? AND status = 'completed' GROUP BY buyer_id"),
    byUser('SELECT user_id AS k, COUNT(*) AS v, SUM(plays) AS p FROM tracks WHERE game_id = ? GROUP BY user_id'),
    byUser('SELECT t.user_id AS k, COUNT(*) AS v FROM track_likes l JOIN tracks t ON t.id = l.track_id WHERE t.game_id = ? GROUP BY t.user_id'),
  ]);

  return players.map((p) => {
    const g = (m, f = 'v') => (m.get(p.id)?.[f]) || 0;
    let tutorial = {};
    try { tutorial = JSON.parse(p.tutorial || '{}'); } catch {}
    const s = {
      balance: g(bal),
      escrow: g(escrow),
      earned: g(earned),
      granted: g(granted),
      spent: g(bought, 's'),
      dealsSold: g(sold),
      dealsBought: g(bought),
      rating: sold.get(p.id)?.r ? Math.round(sold.get(p.id).r * 10) / 10 : null,
      tracks: g(tracks),
      plays: g(tracks, 'p'),
      likes: g(likes),
      released: !!tutorial.completedAt,
    };
    s.netWorth = s.balance + s.escrow;
    const xp = s.dealsSold * 120 + s.dealsBought * 60 + s.tracks * 150 + s.likes * 10 +
      Math.floor(s.earned / 50) + (s.released ? 200 : 0);
    const badges = [];
    if (s.dealsSold + s.dealsBought >= 1) badges.push({ id: 'first-deal', name: 'First Deal', desc: 'Closed a contract' });
    if (s.dealsSold >= 5) badges.push({ id: 'hitmaker', name: 'Hitmaker', desc: 'Delivered 5 contracts' });
    if (s.spent >= 5000) badges.push({ id: 'big-spender', name: 'Big Spender', desc: 'Invested $5,000+ in other artists' });
    if (game.starting_balance > 0 && s.netWorth >= game.starting_balance * 2) badges.push({ id: 'double-up', name: 'Double Up', desc: 'Doubled the signing advance' });
    if (s.rating && s.rating >= 4.5 && s.dealsSold >= 3) badges.push({ id: 'five-star', name: 'Five Star', desc: '4.5+ rating across 3+ deals' });
    if (s.tracks >= 1) badges.push({ id: 'on-record', name: 'On the Record', desc: 'Shared music in the Showcase' });
    if (s.likes >= 10) badges.push({ id: 'fan-favorite', name: 'Fan Favorite', desc: '10+ likes on your music' });
    if (s.released) badges.push({ id: 'released', name: 'Out Now', desc: 'Finished the Release Guide' });
    return { player: p, stats: s, progress: levelInfo(xp), badges, tutorial };
  });
}

// ---------- contracts ----------
async function getContract(id) {
  const c = await db.get('SELECT * FROM contracts WHERE id = ?', id);
  if (!c) fail('Contract not found', 404);
  return c;
}
const nameOf = async (id) => (await db.get('SELECT display_name FROM users WHERE id = ?', id))?.display_name || 'Unknown';
const fmt$ = (n) => '$' + Number(n).toLocaleString('en-US');

async function contractEvent(contractId, actorId, action, note = '', amount = null) {
  await db.run('INSERT INTO contract_events (contract_id, actor_id, action, note, amount, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    contractId, actorId, action, note, amount, Date.now()
  );
}

/** Adjust the money the buyer has locked in escrow for this contract to `target`. */
async function setEscrow(c, target) {
  const delta = target - c.escrow;
  if (delta > 0) {
    if ((await balanceOf(c.buyer_id, c.game_id)) < delta) fail(`${await nameOf(c.buyer_id)} doesn't have enough cash for this deal`);
    await ledgerEntry(c.game_id, c.buyer_id, -delta, 'escrow_hold', { contractId: c.id, memo: `Escrow: ${c.title}` });
  } else if (delta < 0) {
    await ledgerEntry(c.game_id, c.buyer_id, -delta, 'escrow_refund', { contractId: c.id, memo: `Escrow returned: ${c.title}` });
  }
  c.escrow = target;
}

async function updateContract(c, fields) {
  const all = { ...fields, escrow: c.escrow, updated_at: Date.now() };
  const keys = Object.keys(all);
  await db.run(`UPDATE contracts SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
    ...keys.map((k) => all[k]), c.id
  );
  Object.assign(c, all);
}

/**
 * Price a job from the season's rate sheet. `unit` pricing is the hourly/class
 * (or per-item) rate times a quantity; `project` is the sheet's flat project rate.
 */
function priceJob(game, body) {
  const sheet = sheetFor(game);
  const j = findItem(sheet.jobs, String(body.jobId || ''));
  if (!j || !j.active) fail('Pick a job from the rate sheet');
  const pricing = body.pricing === 'project' ? 'project' : 'unit';
  if (pricing === 'project') {
    if (!j.projectRate) fail(`${j.name} has no project rate`);
    return { job: j, pricing, quantity: null, unitRate: j.projectRate, amount: j.projectRate };
  }
  if (!j.unitRate) fail(`${j.name} has no ${j.unit} rate`);
  const quantity = int(body.quantity, j.unit === 'item' ? 'Number of items' : 'Number of hours / class blocks', { min: 1, max: 100 });
  return { job: j, pricing, quantity, unitRate: j.unitRate, amount: j.unitRate * quantity };
}

async function createContract(game, buyer, body) {
  if (game.status !== 'active') fail('Deals can only be made while the season is live');
  const seller = await db.get("SELECT * FROM users WHERE id = ? AND role = 'player' AND game_id = ? AND active = 1", int(body.sellerId, 'Artist'), game.id);
  if (!seller) fail('That artist is not on this roster');
  if (seller.id === buyer.id) fail("You can't hire yourself");
  const price = priceJob(game, body);
  const title = str(body.title || price.job.name, 'Title', { min: 1, max: 100 });
  const terms = str(body.terms, 'Terms', { max: 2000 });
  const dueDays = body.dueDays ? int(body.dueDays, 'Due in (days)', { min: 1, max: MAX_DAYS }) : null;

  return tx(async () => {
    const now = Date.now();
    const { id } = await db.run(
      "INSERT INTO contracts (game_id, buyer_id, seller_id, title, terms, amount, due_days, status, job_id, pricing, quantity, unit_rate, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'offered', ?, ?, ?, ?, ?, ?) RETURNING id",
      game.id, buyer.id, seller.id, title, terms, price.amount, dueDays, price.job.id, price.pricing, price.quantity, price.unitRate, now, now
    );
    const c = await getContract(id);
    await setEscrow(c, price.amount);
    await updateContract(c, {});
    await contractEvent(c.id, buyer.id, 'offered', terms, price.amount);
    return c.id;
  });
}

/** The rate sheet's Game Bonus: one bonus for every two different people an artist has hired. */
async function payHireBonus(game, buyerId) {
  const bonus = findItem(sheetFor(game).payouts, 'hire-bonus');
  if (!bonus?.amount) return;
  const hired = (await db.get("SELECT COUNT(DISTINCT seller_id) AS n FROM contracts WHERE game_id = ? AND buyer_id = ? AND status = 'completed'", game.id, buyerId)).n;
  const paid = (await db.get("SELECT COUNT(*) AS n FROM ledger WHERE game_id = ? AND user_id = ? AND kind = 'bonus'", game.id, buyerId)).n;
  for (let i = paid; i < Math.floor(hired / 2); i++) {
    await ledgerEntry(game.id, buyerId, bonus.amount, 'bonus', { memo: `Game Bonus: hired ${(i + 1) * 2} different people` });
    await post(game.id, 'grant', buyerId, `${await nameOf(buyerId)} has hired ${(i + 1) * 2} different labelmates and earned a ${fmt$(bonus.amount)} Game Bonus.`);
  }
}

/**
 * State machine for contracts. Who can do what:
 *   seller: accept | decline (offered), deliver (active)
 *   buyer:  withdraw (offered), confirm | revise (delivered)
 *   owner:  approve | reject (review), cancel | complete (any open),
 *           late_fee (charge the artist the sheet's late fee), undone (fine the artist, refund the buyer)
 * Prices come from the rate sheet, so there are no counter offers.
 */
async function contractAction(user, contractId, body) {
  const action = String(body.action || '');
  const note = str(body.note, 'Note', { max: 1000 });
  return tx(async () => {
    const c = await getContract(contractId);
    const game = await getGame(c.game_id);
    const isOwner = user.role === 'owner';
    const isBuyer = user.id === c.buyer_id;
    const isSeller = user.id === c.seller_id;
    const need = (cond, msg = "You can't do that on this contract right now") => { if (!cond) fail(msg, 403); };
    const needLive = () => need(game.status === 'active', 'The season is over. Only a Record Owner can settle open deals now.');
    const buyerName = await nameOf(c.buyer_id);
    const sellerName = await nameOf(c.seller_id);

    switch (action) {
      case 'accept':
        need(isSeller && c.status === 'offered'); needLive();
        await updateContract(c, { status: 'review' });
        break;
      case 'decline':
        need(isSeller && ['offered', 'countered'].includes(c.status));
        await setEscrow(c, 0);
        await updateContract(c, { status: 'declined' });
        break;
      case 'withdraw':
        need(isBuyer && ['offered', 'countered'].includes(c.status));
        await setEscrow(c, 0);
        await updateContract(c, { status: 'cancelled' });
        break;
      case 'approve':
        need(isOwner && c.status === 'review');
        await updateContract(c, { status: 'active', approved_at: Date.now() });
        await post(c.game_id, 'deal', c.buyer_id, `${buyerName} signed ${sellerName} for "${c.title}": ${fmt$(c.amount)} deal approved by the label.`);
        break;
      case 'reject':
        need(isOwner && c.status === 'review');
        await setEscrow(c, 0);
        await updateContract(c, { status: 'rejected' });
        break;
      case 'deliver':
        need(isSeller && c.status === 'active');
        await updateContract(c, { status: 'delivered' });
        break;
      case 'revise':
        need(isBuyer && c.status === 'delivered');
        await updateContract(c, { status: 'active' });
        break;
      case 'confirm':
      case 'complete': {
        if (action === 'confirm') need(isBuyer && c.status === 'delivered');
        else need(isOwner && ['active', 'delivered'].includes(c.status));
        const rating = action === 'confirm' && body.rating ? int(body.rating, 'Rating', { min: 1, max: 5 }) : null;
        const fee = Math.round((c.escrow * game.label_cut_pct) / 100);
        const paid = c.escrow;
        await ledgerEntry(c.game_id, c.seller_id, paid - fee, 'payment', { contractId: c.id, memo: `Paid by ${buyerName}: ${c.title}` });
        if (fee) await ledgerEntry(c.game_id, null, fee, 'label_fee', { contractId: c.id, memo: `${game.label_cut_pct}% label cut: ${c.title}` });
        c.escrow = 0;
        await updateContract(c, { status: 'completed', completed_at: Date.now(), rating });
        await post(c.game_id, 'paid', c.seller_id, `${sellerName} delivered "${c.title}" for ${buyerName}. ${fmt$(paid - fee)} paid out${rating ? `, rated ${rating}/5` : ''}.`);
        await contractEvent(c.id, user.id, action, note, paid);
        await payHireBonus(game, c.buyer_id);
        return c.id;
      }
      // The rate sheet's late fee: the artist pays it, the client who hired them doesn't.
      case 'late_fee': {
        need(isOwner && ['active', 'delivered', 'completed'].includes(c.status));
        // Once per deal, so a double click can't charge the artist twice.
        if (await db.get("SELECT 1 FROM contract_events WHERE contract_id = ? AND action = 'late_fee'", c.id)) fail('The late fee was already charged on this deal', 409);
        const fine = findItem(sheetFor(game).fines, 'late-incomplete');
        await ledgerEntry(c.game_id, c.seller_id, -fine.amount, 'fine', { contractId: c.id, memo: `${fine.name}: ${c.title}`, by: user.id });
        await contractEvent(c.id, user.id, action, note, fine.amount);
        return c.id;
      }
      // Work never done: fine the artist and give the client their money back.
      case 'undone': {
        need(isOwner && ['active', 'delivered'].includes(c.status));
        const fine = findItem(sheetFor(game).fines, 'undone');
        await ledgerEntry(c.game_id, c.seller_id, -fine.amount, 'fine', { contractId: c.id, memo: `${fine.name}: ${c.title}`, by: user.id });
        await setEscrow(c, 0);
        await updateContract(c, { status: 'cancelled' });
        await contractEvent(c.id, user.id, action, note, fine.amount);
        return c.id;
      }
      case 'cancel':
        need(isOwner && OPEN_STATUSES.includes(c.status));
        await setEscrow(c, 0);
        await updateContract(c, { status: 'cancelled' });
        break;
      default:
        fail('Unknown action');
    }
    await contractEvent(c.id, user.id, action, note);
    return c.id;
  });
}

module.exports = {
  DAY, MAX_DAYS, MAX_PLAYERS, OPEN_STATUSES, PUBLIC_STATUSES,
  hooks, HttpError, fail, str, int, httpUrl, profileUrl, isPin, isUsername, newClaimCode, tidyCode,
  post, getGame, clock, balanceOf, ledgerEntry, payAdvance, playerStats, levelInfo,
  createContract, contractAction, nameOf, fmt$, sheetFor,
};

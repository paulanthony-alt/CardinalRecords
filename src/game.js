'use strict';
const { db, tx } = require('./db');

const DAY = 86_400_000;
const MAX_DAYS = 365;
const MAX_PLAYERS = 30;
const OPEN_STATUSES = ['offered', 'countered', 'review', 'active', 'delivered'];
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
const isPin = (p) => /^\d{4,6}$/.test(String(p ?? ''));
const isUsername = (u) => /^[a-zA-Z0-9_.-]{3,24}$/.test(String(u ?? ''));

// ---------- feed ----------
function post(gameId, kind, actorId, message) {
  db.prepare('INSERT INTO feed (game_id, kind, actor_id, message, created_at) VALUES (?, ?, ?, ?, ?)').run(
    gameId, kind, actorId ?? null, message, Date.now()
  );
}

// ---------- games & clock ----------
function getGame(id) {
  const g = db.prepare('SELECT * FROM games WHERE id = ?').get(id);
  if (!g) fail('Game not found', 404);
  // The season wraps automatically when its last day passes.
  if (g.status === 'active' && g.started_at && Date.now() >= g.started_at + g.duration_days * DAY) {
    const endedAt = g.started_at + g.duration_days * DAY;
    db.prepare("UPDATE games SET status = 'showcase', ended_at = ? WHERE id = ? AND status = 'active'").run(endedAt, g.id);
    post(g.id, 'phase', null, "That is a wrap on the season! Get your music ready: uploads to the Showcase open once a Record Owner activates them.");
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

function balanceOf(userId) {
  return db.prepare('SELECT COALESCE(SUM(amount), 0) AS b FROM ledger WHERE user_id = ?').get(userId).b;
}

function ledgerEntry(gameId, userId, amount, kind, { contractId = null, memo = '', by = null } = {}) {
  db.prepare(
    'INSERT INTO ledger (game_id, user_id, amount, kind, contract_id, memo, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(gameId, userId, amount, kind, contractId, memo, by, Date.now());
}

function payAdvance(game, userId) {
  if (game.starting_balance <= 0) return;
  const paid = db.prepare("SELECT 1 FROM ledger WHERE user_id = ? AND kind = 'advance'").get(userId);
  if (!paid) ledgerEntry(game.id, userId, game.starting_balance, 'advance', { memo: 'Signing advance from the label' });
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
function playerStats(game) {
  const gid = game.id;
  const players = db.prepare("SELECT * FROM users WHERE role = 'player' AND game_id = ? ORDER BY display_name").all(gid);
  const byUser = (sql) => new Map(db.prepare(sql).all(gid).map((r) => [r.k, r]));

  const bal = byUser('SELECT user_id AS k, SUM(amount) AS v FROM ledger WHERE game_id = ? AND user_id IS NOT NULL GROUP BY user_id');
  const earned = byUser("SELECT user_id AS k, SUM(amount) AS v FROM ledger WHERE game_id = ? AND kind = 'payment' GROUP BY user_id");
  const granted = byUser("SELECT user_id AS k, SUM(amount) AS v FROM ledger WHERE game_id = ? AND kind IN ('advance','grant','fine') GROUP BY user_id");
  const escrow = byUser('SELECT buyer_id AS k, SUM(escrow) AS v FROM contracts WHERE game_id = ? GROUP BY buyer_id');
  const sold = byUser("SELECT seller_id AS k, COUNT(*) AS v, AVG(rating) AS r FROM contracts WHERE game_id = ? AND status = 'completed' GROUP BY seller_id");
  const bought = byUser("SELECT buyer_id AS k, COUNT(*) AS v, SUM(amount) AS s FROM contracts WHERE game_id = ? AND status = 'completed' GROUP BY buyer_id");
  const tracks = byUser('SELECT user_id AS k, COUNT(*) AS v, SUM(plays) AS p FROM tracks WHERE game_id = ? GROUP BY user_id');
  const likes = byUser('SELECT t.user_id AS k, COUNT(*) AS v FROM track_likes l JOIN tracks t ON t.id = l.track_id WHERE t.game_id = ? GROUP BY t.user_id');
  const services = byUser('SELECT user_id AS k, COUNT(*) AS v FROM services WHERE game_id = ? AND active = 1 GROUP BY user_id');

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
      services: g(services),
      released: !!tutorial.completedAt,
    };
    s.netWorth = s.balance + s.escrow;
    const xp = s.dealsSold * 120 + s.dealsBought * 60 + s.tracks * 150 + s.likes * 10 + s.services * 20 +
      Math.floor(s.earned / 50) + (s.released ? 200 : 0);
    const badges = [];
    if (s.dealsSold + s.dealsBought >= 1) badges.push({ id: 'first-deal', name: 'First Deal', desc: 'Closed a contract' });
    if (s.dealsSold >= 5) badges.push({ id: 'hitmaker', name: 'Hitmaker', desc: 'Delivered 5 contracts' });
    if (s.spent >= 5000) badges.push({ id: 'big-spender', name: 'Big Spender', desc: 'Invested $5,000+ in other artists' });
    if (game.starting_balance > 0 && s.netWorth >= game.starting_balance * 2) badges.push({ id: 'double-up', name: 'Double Up', desc: 'Doubled the signing advance' });
    if (s.rating && s.rating >= 4.5 && s.dealsSold >= 3) badges.push({ id: 'five-star', name: 'Five Star', desc: '4.5+ rating across 3+ deals' });
    if (s.tracks >= 1) badges.push({ id: 'on-record', name: 'On the Record', desc: 'Uploaded music to the Showcase' });
    if (s.likes >= 10) badges.push({ id: 'fan-favorite', name: 'Fan Favorite', desc: '10+ likes on your music' });
    if (s.released) badges.push({ id: 'released', name: 'Out Now', desc: 'Finished the Release Guide' });
    return { player: p, stats: s, progress: levelInfo(xp), badges, tutorial };
  });
}

// ---------- contracts ----------
function getContract(id) {
  const c = db.prepare('SELECT * FROM contracts WHERE id = ?').get(id);
  if (!c) fail('Contract not found', 404);
  return c;
}
const nameOf = (id) => db.prepare('SELECT display_name FROM users WHERE id = ?').get(id)?.display_name || 'Unknown';
const fmt$ = (n) => '$' + Number(n).toLocaleString('en-US');

function contractEvent(contractId, actorId, action, note = '', amount = null) {
  db.prepare('INSERT INTO contract_events (contract_id, actor_id, action, note, amount, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    contractId, actorId, action, note, amount, Date.now()
  );
}

/** Adjust the money the buyer has locked in escrow for this contract to `target`. */
function setEscrow(c, target) {
  const delta = target - c.escrow;
  if (delta > 0) {
    if (balanceOf(c.buyer_id) < delta) fail(`${nameOf(c.buyer_id)} doesn't have enough cash for this deal`);
    ledgerEntry(c.game_id, c.buyer_id, -delta, 'escrow_hold', { contractId: c.id, memo: `Escrow: ${c.title}` });
  } else if (delta < 0) {
    ledgerEntry(c.game_id, c.buyer_id, -delta, 'escrow_refund', { contractId: c.id, memo: `Escrow returned: ${c.title}` });
  }
  c.escrow = target;
}

function updateContract(c, fields) {
  const all = { ...fields, escrow: c.escrow, updated_at: Date.now() };
  const keys = Object.keys(all);
  db.prepare(`UPDATE contracts SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
    ...keys.map((k) => all[k]), c.id
  );
  Object.assign(c, all);
}

function createContract(game, buyer, body) {
  if (game.status !== 'active') fail('Deals can only be made while the season is live');
  const seller = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'player' AND game_id = ? AND active = 1").get(int(body.sellerId, 'Artist'), game.id);
  if (!seller) fail('That artist is not on this roster');
  if (seller.id === buyer.id) fail("You can't hire yourself");
  let service = null;
  if (body.serviceId) {
    service = db.prepare('SELECT * FROM services WHERE id = ? AND game_id = ? AND active = 1').get(int(body.serviceId, 'Service'), game.id);
    if (!service || service.user_id !== seller.id) fail('That service is no longer available');
  }
  const title = str(body.title || service?.title, 'Title', { min: 1, max: 100 });
  const terms = str(body.terms, 'Terms', { max: 2000 });
  const amount = int(body.amount, 'Offer', { min: 1, max: 100_000_000 });
  const dueDays = body.dueDays ? int(body.dueDays, 'Due in (days)', { min: 1, max: MAX_DAYS }) : service?.turnaround_days ?? null;

  return tx(() => {
    const now = Date.now();
    const { lastInsertRowid } = db.prepare(
      "INSERT INTO contracts (game_id, buyer_id, seller_id, service_id, title, terms, amount, due_days, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'offered', ?, ?)"
    ).run(game.id, buyer.id, seller.id, service?.id ?? null, title, terms, amount, dueDays, now, now);
    const c = getContract(Number(lastInsertRowid));
    setEscrow(c, amount);
    updateContract(c, {});
    contractEvent(c.id, buyer.id, 'offered', terms, amount);
    return c.id;
  });
}

/**
 * State machine for contracts. Who can do what:
 *   seller: accept | decline | counter (offered), deliver (active)
 *   buyer:  accept_counter | withdraw (offered/countered), confirm | revise (delivered)
 *   owner:  approve | reject (review), cancel | complete (any open)
 */
function contractAction(user, contractId, body) {
  const action = String(body.action || '');
  const note = str(body.note, 'Note', { max: 1000 });
  return tx(() => {
    const c = getContract(contractId);
    const game = getGame(c.game_id);
    const isOwner = user.role === 'owner';
    const isBuyer = user.id === c.buyer_id;
    const isSeller = user.id === c.seller_id;
    const need = (cond, msg = "You can't do that on this contract right now") => { if (!cond) fail(msg, 403); };
    const needLive = () => need(game.status === 'active', 'The season is over. Only a Record Owner can settle open deals now.');
    const buyerName = nameOf(c.buyer_id);
    const sellerName = nameOf(c.seller_id);

    switch (action) {
      case 'accept':
        need(isSeller && c.status === 'offered'); needLive();
        updateContract(c, { status: 'review' });
        break;
      case 'decline':
        need(isSeller && ['offered', 'countered'].includes(c.status));
        setEscrow(c, 0);
        updateContract(c, { status: 'declined' });
        break;
      case 'counter': {
        need(isSeller && c.status === 'offered'); needLive();
        const amount = int(body.amount, 'Counter offer', { min: 1, max: 100_000_000 });
        if (amount === c.amount) fail('A counter offer needs a different amount');
        updateContract(c, { status: 'countered', amount });
        contractEvent(c.id, user.id, action, note, amount);
        return c.id;
      }
      case 'accept_counter':
        need(isBuyer && c.status === 'countered'); needLive();
        setEscrow(c, c.amount);
        updateContract(c, { status: 'review' });
        break;
      case 'withdraw':
        need(isBuyer && ['offered', 'countered'].includes(c.status));
        setEscrow(c, 0);
        updateContract(c, { status: 'cancelled' });
        break;
      case 'approve':
        need(isOwner && c.status === 'review');
        updateContract(c, { status: 'active', approved_at: Date.now() });
        post(c.game_id, 'deal', c.buyer_id, `${buyerName} signed ${sellerName} for "${c.title}": ${fmt$(c.amount)} deal approved by the label.`);
        break;
      case 'reject':
        need(isOwner && c.status === 'review');
        setEscrow(c, 0);
        updateContract(c, { status: 'rejected' });
        break;
      case 'deliver':
        need(isSeller && c.status === 'active');
        updateContract(c, { status: 'delivered' });
        break;
      case 'revise':
        need(isBuyer && c.status === 'delivered');
        updateContract(c, { status: 'active' });
        break;
      case 'confirm':
      case 'complete': {
        if (action === 'confirm') need(isBuyer && c.status === 'delivered');
        else need(isOwner && ['active', 'delivered'].includes(c.status));
        const rating = action === 'confirm' && body.rating ? int(body.rating, 'Rating', { min: 1, max: 5 }) : null;
        const fee = Math.round((c.escrow * game.label_cut_pct) / 100);
        const paid = c.escrow;
        ledgerEntry(c.game_id, c.seller_id, paid - fee, 'payment', { contractId: c.id, memo: `Paid by ${buyerName}: ${c.title}` });
        if (fee) ledgerEntry(c.game_id, null, fee, 'label_fee', { contractId: c.id, memo: `${game.label_cut_pct}% label cut: ${c.title}` });
        c.escrow = 0;
        updateContract(c, { status: 'completed', completed_at: Date.now(), rating });
        post(c.game_id, 'paid', c.seller_id, `${sellerName} delivered "${c.title}" for ${buyerName}. ${fmt$(paid - fee)} paid out${rating ? `, rated ${rating}/5` : ''}.`);
        contractEvent(c.id, user.id, action, note, paid);
        return c.id;
      }
      case 'cancel':
        need(isOwner && OPEN_STATUSES.includes(c.status));
        setEscrow(c, 0);
        updateContract(c, { status: 'cancelled' });
        break;
      default:
        fail('Unknown action');
    }
    contractEvent(c.id, user.id, action, note);
    return c.id;
  });
}

module.exports = {
  DAY, MAX_DAYS, MAX_PLAYERS, OPEN_STATUSES, PUBLIC_STATUSES,
  HttpError, fail, str, int, isPin, isUsername,
  post, getGame, clock, balanceOf, ledgerEntry, payAdvance, playerStats, levelInfo,
  createContract, contractAction, nameOf, fmt$,
};

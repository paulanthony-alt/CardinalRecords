'use strict';
const express = require('express');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, tx, migrate } = require('./src/db');
const { loadOwners, usingStartingPin } = require('./src/owners');
const { ZipWriter, toCsv } = require('./src/zip');
const G = require('./src/game');
const { fail, str, int } = G;

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const SESSION_DAYS = 30;
const MAX_TRACKS_PER_PLAYER = 10;
const COLORS = ['#E63946', '#F4A261', '#E9C46A', '#2A9D8F', '#48CAE4', '#7B2CBF', '#F72585', '#80ED99', '#FF7B00', '#4361EE'];

app.set('trust proxy', 1);
app.disable('x-powered-by');

// Health check for the host (Render). It skips the database on purpose so frequent probes
// don't keep Neon's compute from scaling to zero; the server only starts listening after
// migrate() has reached Postgres, so a bad DATABASE_URL still fails the deploy.
app.get('/healthz', (req, res) => res.json({ ok: true }));
app.use(express.json({ limit: '200kb' }));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  next();
});

// ---------- sessions ----------
function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

async function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.run('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)', token, userId, Date.now());
  const secure = req.secure ? '; Secure' : '';
  res.set('Set-Cookie', `cr_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}

app.use(async (req, res, next) => {
  const token = readCookie(req, 'cr_session');
  if (token) {
    const row = await db.get(
      'SELECT u.*, s.created_at AS session_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?',
      token
    );
    if (row && row.active && Date.now() - row.session_at < SESSION_DAYS * G.DAY) {
      req.user = row;
      req.token = token;
      if (!row.last_seen || Date.now() - row.last_seen > 60_000) {
        await db.run('UPDATE users SET last_seen = ? WHERE id = ?', Date.now(), row.id);
      }
    }
  }
  next();
});

const auth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Please sign in' }));
const ownerOnly = (req, res, next) =>
  req.user?.role === 'owner' ? next() : res.status(403).json({ error: 'Record Owners only' });

/** Loads the game from :gameId and checks the user belongs to it. */
async function gameFor(req) {
  const game = await G.getGame(int(req.params.gameId, 'Game'));
  if (req.user.role !== 'owner' && req.user.game_id !== game.id) fail('You are not on this label', 403);
  return game;
}

function publicUser(u, { withPin = false } = {}) {
  const out = {
    id: u.id, username: u.username, role: u.role, gameId: u.game_id, displayName: u.display_name,
    roleTitle: u.role_title, bio: u.bio, color: u.color, active: !!u.active, lastSeen: u.last_seen,
    claimed: u.pin != null, createdAt: u.created_at,
  };
  if (withPin) out.pin = u.pin;
  return out;
}

// ---------- login (username + PIN, with lockout) ----------
const attempts = new Map();
function checkLock(key) {
  const a = attempts.get(key);
  if (a && a.until > Date.now()) fail(`Too many wrong PINs. Try again in ${Math.ceil((a.until - Date.now()) / 60000)} min.`, 429);
}
function recordFail(key) {
  const a = attempts.get(key) || { n: 0, until: 0 };
  a.n += 1;
  if (a.n >= 5) { a.until = Date.now() + 5 * 60_000; a.n = 0; }
  attempts.set(key, a);
}

app.post('/api/login/lookup', async (req, res) => {
  const u = await db.get('SELECT * FROM users WHERE username = ? AND active = 1', str(req.body.username, 'Username', { min: 1, max: 40 }));
  if (!u) fail('No account with that username. Ask your Record Owner to sign you.', 404);
  res.json({ username: u.username, displayName: u.display_name, role: u.role, claimed: u.pin != null, color: u.color });
});

app.post('/api/login', async (req, res) => {
  const username = str(req.body.username, 'Username', { min: 1, max: 40 });
  const key = username.toLowerCase();
  checkLock(key);
  const u = await db.get('SELECT * FROM users WHERE username = ? AND active = 1', username);
  if (!u) fail('Unknown username', 404);
  if (u.pin == null) fail('This account has no PIN yet. Set one to claim it.', 409);
  const given = Buffer.from(String(req.body.pin ?? '').padEnd(6, ' '));
  const real = Buffer.from(String(u.pin).padEnd(6, ' '));
  if (given.length !== real.length || !crypto.timingSafeEqual(given, real)) {
    recordFail(key);
    fail('Wrong PIN', 401);
  }
  attempts.delete(key);
  await startSession(req, res, u.id);
  res.json({ ok: true });
});

// First sign-in: the player picks their own PIN.
app.post('/api/claim', async (req, res) => {
  const u = await db.get('SELECT * FROM users WHERE username = ? AND active = 1', str(req.body.username, 'Username', { min: 1, max: 40 }));
  if (!u) fail('Unknown username', 404);
  if (u.pin != null) fail('This account is already claimed. Sign in with your PIN.', 409);
  if (!G.isPin(req.body.pin)) fail('PIN must be 4 to 6 digits');
  await db.run('UPDATE users SET pin = ? WHERE id = ? AND pin IS NULL', String(req.body.pin), u.id);
  await startSession(req, res, u.id);
  res.json({ ok: true });
});

app.post('/api/logout', async (req, res) => {
  if (req.token) await db.run('DELETE FROM sessions WHERE token = ?', req.token);
  res.set('Set-Cookie', 'cr_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

// ---------- me ----------
app.get('/api/me', auth, async (req, res) => {
  const games = req.user.role === 'owner'
    ? await db.all('SELECT * FROM games ORDER BY created_at DESC')
    : await db.all('SELECT * FROM games WHERE id = ?', req.user.game_id ?? -1);
  res.json({
    user: { ...publicUser(req.user, { withPin: false }), startingPin: usingStartingPin(req.user) },
    games: await Promise.all(games.map(async (g) => { const gg = await G.getGame(g.id); return { ...gg, clock: G.clock(gg) }; })),
  });
});

app.put('/api/me', auth, async (req, res) => {
  const b = req.body;
  const displayName = str(b.displayName, 'Artist name', { min: 1, max: 40 });
  const roleTitle = str(b.roleTitle, 'Role', { max: 40 });
  const bio = str(b.bio, 'Bio', { max: 500 });
  const color = /^#[0-9a-fA-F]{6}$/.test(b.color || '') ? b.color : req.user.color;
  await db.run('UPDATE users SET display_name = ?, role_title = ?, bio = ?, color = ? WHERE id = ?', displayName, roleTitle, bio, color, req.user.id);
  res.json({ ok: true });
});

app.put('/api/me/pin', auth, async (req, res) => {
  if (String(req.body.currentPin) !== req.user.pin) fail('Current PIN is wrong', 401);
  if (!G.isPin(req.body.newPin)) fail('New PIN must be 4 to 6 digits');
  await db.run('UPDATE users SET pin = ? WHERE id = ?', String(req.body.newPin), req.user.id);
  await db.run('DELETE FROM sessions WHERE user_id = ? AND token != ?', req.user.id, req.token);
  res.json({ ok: true });
});

app.put('/api/me/tutorial', auth, async (req, res) => {
  let t = {};
  try { t = JSON.parse(req.user.tutorial || '{}'); } catch {}
  t.done = t.done || {};
  const step = str(req.body.step, 'Step', { min: 1, max: 40 });
  if (req.body.done) t.done[step] = Date.now(); else delete t.done[step];
  if (req.body.completed === true && !t.completedAt) {
    t.completedAt = Date.now();
    if (req.user.game_id) await G.post(req.user.game_id, 'release', req.user.id, `${req.user.display_name} finished the Release Guide and is ready to go live on streaming!`);
  }
  if (req.body.completed === false) delete t.completedAt;
  await db.run('UPDATE users SET tutorial = ? WHERE id = ?', JSON.stringify(t), req.user.id);
  res.json({ ok: true, tutorial: t });
});

// ---------- games (owner) ----------
function gameSettings(b, existing) {
  const out = {
    name: str(b.name ?? existing?.name, 'Label season name', { min: 1, max: 60 }),
    duration_days: int(b.durationDays ?? existing?.duration_days, 'Season length', { min: 1, max: G.MAX_DAYS }),
    starting_balance: int(b.startingBalance ?? existing?.starting_balance ?? 0, 'Signing advance', { min: 0, max: 100_000_000 }),
    label_cut_pct: int(b.labelCutPct ?? existing?.label_cut_pct ?? 10, 'Label cut', { min: 0, max: 50 }),
    max_players: int(b.maxPlayers ?? existing?.max_players ?? G.MAX_PLAYERS, 'Max players', { min: 1, max: G.MAX_PLAYERS }),
  };
  return out;
}

app.post('/api/games', auth, ownerOnly, async (req, res) => {
  const s = gameSettings(req.body);
  const { id } = await db.run(
    "INSERT INTO games (name, status, duration_days, starting_balance, label_cut_pct, max_players, created_by, created_at) VALUES (?, 'setup', ?, ?, ?, ?, ?, ?) RETURNING id",
    s.name, s.duration_days, s.starting_balance, s.label_cut_pct, s.max_players, req.user.id, Date.now()
  );
  await G.post(id, 'phase', req.user.id, `${s.name} has been founded. Signing artists now.`);
  res.json({ id });
});

app.patch('/api/games/:gameId', auth, ownerOnly, async (req, res) => {
  const game = await gameFor(req);
  const s = gameSettings(req.body, game);
  const playerCount = (await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'player' AND game_id = ? AND active = 1", game.id)).n;
  if (s.max_players < playerCount) fail(`There are already ${playerCount} artists on this roster`);
  if (game.status === 'active' && s.duration_days < G.clock(game).day) fail('The season is already past that day');
  await db.run('UPDATE games SET name = ?, duration_days = ?, starting_balance = ?, label_cut_pct = ?, max_players = ? WHERE id = ?', s.name, s.duration_days, s.starting_balance, s.label_cut_pct, s.max_players, game.id);
  if (s.duration_days !== game.duration_days) await G.post(game.id, 'phase', req.user.id, `The season is now ${s.duration_days} days long.`);
  res.json({ ok: true });
});

app.post('/api/games/:gameId/phase', auth, ownerOnly, async (req, res) => {
  const game = await gameFor(req);
  const phase = req.body.phase;
  const allowed = { setup: ['active'], active: ['showcase'], showcase: ['archived', 'active'], archived: ['showcase'] };
  if (!allowed[game.status]?.includes(phase)) fail(`Can't move from ${game.status} to ${phase}`);
  await tx(async () => {
    if (phase === 'active' && game.status === 'setup') {
      await db.run("UPDATE games SET status = 'active', started_at = ? WHERE id = ?", Date.now(), game.id);
      const players = await db.all("SELECT id FROM users WHERE role = 'player' AND game_id = ? AND active = 1", game.id);
      for (const p of players) await G.payAdvance(game, p.id);
      await G.post(game.id, 'phase', req.user.id, `Day 1. The season is LIVE${game.starting_balance ? `: every artist received a ${G.fmt$(game.starting_balance)} signing advance` : ''}. Make some deals.`);
    } else if (phase === 'active') {
      // Reopen a wrapped season: needs room left on the clock.
      if (Date.now() >= game.started_at + game.duration_days * G.DAY) fail('Extend the season length first, then reopen it');
      await db.run("UPDATE games SET status = 'active', ended_at = NULL WHERE id = ?", game.id);
      await G.post(game.id, 'phase', req.user.id, 'The season is back on. Deals are open again.');
    } else if (phase === 'showcase') {
      await db.run("UPDATE games SET status = 'showcase', ended_at = COALESCE(ended_at, ?) WHERE id = ?", Date.now(), game.id);
      await G.post(game.id, 'phase', req.user.id, game.status === 'archived' ? 'The Showcase has been reopened.' : "The Record Owner called the season. Get your music ready: uploads to the Showcase open once a Record Owner activates them.");
    } else if (phase === 'archived') {
      await db.run("UPDATE games SET status = 'archived', uploads_open = 0 WHERE id = ?", game.id);
      await G.post(game.id, 'phase', req.user.id, 'This season has been archived. Thanks for playing Cardinal Records.');
    }
  });
  res.json({ ok: true });
});

// Music uploads stay closed until a Record Owner opens them.
app.post('/api/games/:gameId/uploads', auth, ownerOnly, async (req, res) => {
  const game = await gameFor(req);
  const open = !!req.body.open;
  if (open && game.status === 'archived') fail('Reopen the Showcase before opening uploads');
  if (open === !!game.uploads_open) return res.json({ ok: true });
  await db.run('UPDATE games SET uploads_open = ? WHERE id = ?', open ? 1 : 0, game.id);
  await G.post(game.id, 'phase', req.user.id, open
    ? 'Music uploads are OPEN! Head to the Showcase and drop the tracks you made this season.'
    : 'Music uploads are closed for now.');
  res.json({ ok: true });
});

// ---------- roster (owner) ----------
app.post('/api/games/:gameId/players', auth, ownerOnly, async (req, res) => {
  const game = await gameFor(req);
  if (game.status === 'archived') fail('This season is archived');
  const username = str(req.body.username, 'Username', { min: 3, max: 24 });
  if (!G.isUsername(username)) fail('Usernames are 3-24 letters, numbers, dots, dashes or underscores');
  if (await db.get('SELECT 1 FROM users WHERE username = ?', username)) fail('That username is taken');
  const count = (await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'player' AND game_id = ? AND active = 1", game.id)).n;
  if (count >= game.max_players) fail(`Roster is full (${game.max_players} artists max)`);
  const displayName = str(req.body.displayName || username, 'Artist name', { min: 1, max: 40 });
  const roleTitle = str(req.body.roleTitle, 'Role', { max: 40 });
  const id = await tx(async () => {
    const { id: pid } = await db.run(
      "INSERT INTO users (username, role, game_id, display_name, role_title, color, created_at) VALUES (?, 'player', ?, ?, ?, ?, ?) RETURNING id",
      username, game.id, displayName, roleTitle, COLORS[count % COLORS.length], Date.now()
    );
    if (game.status === 'active') await G.payAdvance(game, pid);
    await G.post(game.id, 'join', pid, `${displayName} signed to the label${roleTitle ? ` as ${roleTitle}` : ''}.`);
    return pid;
  });
  res.json({ id });
});

async function ownedPlayer(req) {
  const p = await db.get("SELECT * FROM users WHERE id = ? AND role = 'player'", int(req.params.userId, 'Player'));
  if (!p) fail('Player not found', 404);
  return p;
}

app.patch('/api/players/:userId', auth, ownerOnly, async (req, res) => {
  const p = await ownedPlayer(req);
  const username = req.body.username != null ? str(req.body.username, 'Username', { min: 3, max: 24 }) : p.username;
  if (!G.isUsername(username)) fail('Usernames are 3-24 letters, numbers, dots, dashes or underscores');
  const clash = await db.get('SELECT id FROM users WHERE username = ? AND id != ?', username, p.id);
  if (clash) fail('That username is taken');
  const displayName = req.body.displayName != null ? str(req.body.displayName, 'Artist name', { min: 1, max: 40 }) : p.display_name;
  const roleTitle = req.body.roleTitle != null ? str(req.body.roleTitle, 'Role', { max: 40 }) : p.role_title;
  let active = p.active;
  if (req.body.active != null) {
    active = req.body.active ? 1 : 0;
    if (active && !p.active) {
      const g = await G.getGame(p.game_id);
      const count = (await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'player' AND game_id = ? AND active = 1", g.id)).n;
      if (count >= g.max_players) fail('Roster is full');
    }
  }
  await db.run('UPDATE users SET username = ?, display_name = ?, role_title = ?, active = ? WHERE id = ?', username, displayName, roleTitle, active, p.id);
  if (!active) await db.run('DELETE FROM sessions WHERE user_id = ?', p.id);
  res.json({ ok: true });
});

// Clears the PIN; the player sets a new one on next sign-in.
app.post('/api/players/:userId/reset-pin', auth, ownerOnly, async (req, res) => {
  const p = await ownedPlayer(req);
  await db.run('UPDATE users SET pin = NULL WHERE id = ?', p.id);
  await db.run('DELETE FROM sessions WHERE user_id = ?', p.id);
  res.json({ ok: true });
});

// ---------- treasury (owner) ----------
app.post('/api/games/:gameId/grants', auth, ownerOnly, async (req, res) => {
  const game = await gameFor(req);
  if (game.status === 'archived') fail('This season is archived');
  const amount = int(req.body.amount, 'Amount', { min: -100_000_000, max: 100_000_000 });
  if (amount === 0) fail('Amount cannot be zero');
  const memo = str(req.body.memo, 'Memo', { max: 140 });
  let ids = req.body.userIds === 'all'
    ? (await db.all("SELECT id FROM users WHERE role = 'player' AND game_id = ? AND active = 1", game.id)).map((r) => r.id)
    : (Array.isArray(req.body.userIds) ? req.body.userIds : []).map((v) => int(v, 'Player'));
  if (!ids.length) fail('Pick at least one artist');
  await tx(async () => {
    for (const id of ids) {
      const p = await db.get("SELECT * FROM users WHERE id = ? AND role = 'player' AND game_id = ?", id, game.id);
      if (!p) fail('One of those artists is not on this roster');
      if (amount < 0 && (await G.balanceOf(p.id)) + amount < 0) fail(`${p.display_name} only has ${G.fmt$(await G.balanceOf(p.id))}`);
      await G.ledgerEntry(game.id, p.id, amount, amount > 0 ? 'grant' : 'fine', { memo, by: req.user.id });
    }
    const who = req.body.userIds === 'all' ? 'every artist' : (await Promise.all(ids.map(G.nameOf))).join(', ');
    await G.post(game.id, amount > 0 ? 'grant' : 'fine', req.user.id,
      amount > 0 ? `The label granted ${G.fmt$(amount)} to ${who}${memo ? `: ${memo}` : ''}.`
                 : `The label fined ${who} ${G.fmt$(-amount)}${memo ? `: ${memo}` : ''}.`);
  });
  res.json({ ok: true });
});

// ---------- full game state ----------
app.get('/api/games/:gameId/state', auth, async (req, res) => {
  const game = await gameFor(req);
  const isOwner = req.user.role === 'owner';
  const me = req.user;

  const roster = (await G.playerStats(game)).map((r) => ({
    ...publicUser(r.player, { withPin: isOwner }), stats: r.stats, progress: r.progress, badges: r.badges,
    tutorial: r.player.id === me.id || isOwner ? r.tutorial : undefined,
  }));

  const services = (await db.all('SELECT * FROM services WHERE game_id = ? ORDER BY created_at DESC', game.id)).map((s) => ({
    id: s.id, userId: s.user_id, title: s.title, description: s.description, category: s.category,
    price: s.price, turnaroundDays: s.turnaround_days, active: !!s.active, createdAt: s.created_at,
  }));

  const pub = G.PUBLIC_STATUSES.map((s) => `'${s}'`).join(',');
  const contracts = (isOwner
    ? await db.all('SELECT * FROM contracts WHERE game_id = ? ORDER BY updated_at DESC', game.id)
    : await db.all(`SELECT * FROM contracts WHERE game_id = ? AND (buyer_id = ? OR seller_id = ? OR status IN (${pub})) ORDER BY updated_at DESC`, game.id, me.id, me.id)
  );
  // One query for every event on the label instead of one per contract.
  const events = new Map();
  for (const e of await db.all('SELECT e.* FROM contract_events e JOIN contracts c ON c.id = e.contract_id WHERE c.game_id = ? ORDER BY e.created_at, e.id', game.id)) {
    if (!events.has(e.contract_id)) events.set(e.contract_id, []);
    events.get(e.contract_id).push(e);
  }
  const contractsOut = contracts.map((c) => {
    const party = isOwner || c.buyer_id === me.id || c.seller_id === me.id;
    return {
      id: c.id, buyerId: c.buyer_id, sellerId: c.seller_id, serviceId: c.service_id, title: c.title,
      terms: party ? c.terms : '', amount: c.amount, escrow: c.escrow, dueDays: c.due_days, status: c.status,
      rating: c.rating, createdAt: c.created_at, updatedAt: c.updated_at, approvedAt: c.approved_at, completedAt: c.completed_at,
      events: party ? (events.get(c.id) || []).map((e) => ({ actorId: e.actor_id, action: e.action, note: e.note, amount: e.amount, at: e.created_at })) : [],
    };
  });

  const feed = (await db.all('SELECT * FROM feed WHERE game_id = ? ORDER BY created_at DESC, id DESC LIMIT 150', game.id))
    .map((f) => ({ id: f.id, kind: f.kind, actorId: f.actor_id, message: f.message, at: f.created_at }));

  const myLikes = new Set((await db.all('SELECT track_id FROM track_likes WHERE user_id = ?', me.id)).map((r) => r.track_id));
  const tracks = (await db.all(
    'SELECT t.*, (SELECT COUNT(*) FROM track_likes l WHERE l.track_id = t.id) AS likes FROM tracks t WHERE game_id = ? ORDER BY created_at DESC',
    game.id
  )).map((t) => ({
    id: t.id, userId: t.user_id, title: t.title, genre: t.genre, description: t.description, credits: t.credits,
    url: t.url, plays: t.plays, likes: t.likes, liked: myLikes.has(t.id), createdAt: t.created_at,
  }));

  const ledgerRows = isOwner
    ? await db.all('SELECT * FROM ledger WHERE game_id = ? ORDER BY id DESC LIMIT 500', game.id)
    : await db.all('SELECT * FROM ledger WHERE game_id = ? AND user_id = ? ORDER BY id DESC LIMIT 300', game.id, me.id);
  const vault = (await db.get('SELECT COALESCE(SUM(amount), 0) AS v FROM ledger WHERE game_id = ? AND user_id IS NULL', game.id)).v;
  const owners = (await db.all("SELECT id, display_name, color FROM users WHERE role = 'owner'"))
    .map((o) => ({ id: o.id, displayName: o.display_name, color: o.color }));

  res.json({
    game: { ...game, clock: G.clock(game) },
    roster, owners, services, contracts: contractsOut, feed, tracks, vault,
    ledger: ledgerRows.map((l) => ({ id: l.id, userId: l.user_id, amount: l.amount, kind: l.kind, contractId: l.contract_id, memo: l.memo, at: l.created_at })),
    serverTime: Date.now(),
  });
});

// ---------- lobby chat ----------
app.post('/api/games/:gameId/feed', auth, async (req, res) => {
  const game = await gameFor(req);
  if (game.status === 'archived') fail('This season is archived');
  const message = str(req.body.message, 'Message', { min: 1, max: 280 });
  const kind = req.user.role === 'owner' ? 'announcement' : 'chat';
  await G.post(game.id, kind, req.user.id, message);
  res.json({ ok: true });
});

// ---------- services ----------
const CATEGORIES = ['Production', 'Beat', 'Vocals', 'Songwriting', 'Mixing', 'Mastering', 'Instrument', 'Artwork', 'Video', 'Marketing', 'Other'];

function serviceFields(b, existing) {
  return {
    title: str(b.title ?? existing?.title, 'Service name', { min: 1, max: 80 }),
    description: str(b.description ?? existing?.description, 'Description', { max: 1000 }),
    category: CATEGORIES.includes(b.category) ? b.category : existing?.category || 'Other',
    price: int(b.price ?? existing?.price, 'Price', { min: 1, max: 100_000_000 }),
    turnaround_days: int(b.turnaroundDays ?? existing?.turnaround_days ?? 7, 'Turnaround', { min: 1, max: G.MAX_DAYS }),
  };
}

app.post('/api/games/:gameId/services', auth, async (req, res) => {
  const game = await gameFor(req);
  if (req.user.role !== 'player') fail('Only artists can list services', 403);
  if (!['setup', 'active'].includes(game.status)) fail('The marketplace is closed for this season');
  const count = (await db.get('SELECT COUNT(*) AS n FROM services WHERE user_id = ? AND active = 1', req.user.id)).n;
  if (count >= 12) fail('You can list up to 12 services');
  const s = serviceFields(req.body);
  const { id } = await db.run(
    'INSERT INTO services (game_id, user_id, title, description, category, price, turnaround_days, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
    game.id, req.user.id, s.title, s.description, s.category, s.price, s.turnaround_days, Date.now()
  );
  await G.post(game.id, 'service', req.user.id, `${req.user.display_name} is offering ${s.category.toLowerCase()}: "${s.title}" from ${G.fmt$(s.price)}.`);
  res.json({ id });
});

app.patch('/api/services/:serviceId', auth, async (req, res) => {
  const s = await db.get('SELECT * FROM services WHERE id = ?', int(req.params.serviceId, 'Service'));
  if (!s) fail('Service not found', 404);
  if (s.user_id !== req.user.id && req.user.role !== 'owner') fail('Not your service', 403);
  const f = serviceFields(req.body, s);
  const active = req.body.active != null ? (req.body.active ? 1 : 0) : s.active;
  await db.run('UPDATE services SET title = ?, description = ?, category = ?, price = ?, turnaround_days = ?, active = ? WHERE id = ?', f.title, f.description, f.category, f.price, f.turnaround_days, active, s.id);
  res.json({ ok: true });
});

// ---------- contracts ----------
app.post('/api/games/:gameId/contracts', auth, async (req, res) => {
  const game = await gameFor(req);
  if (req.user.role !== 'player') fail('Only artists can make offers', 403);
  res.json({ id: await G.createContract(game, req.user, req.body) });
});

app.post('/api/contracts/:contractId/action', auth, async (req, res) => {
  const c = await db.get('SELECT game_id FROM contracts WHERE id = ?', int(req.params.contractId, 'Contract'));
  if (!c) fail('Contract not found', 404);
  if (req.user.role !== 'owner' && req.user.game_id !== c.game_id) fail('Not your label', 403);
  res.json({ id: await G.contractAction(req.user, Number(req.params.contractId), req.body) });
});

// ---------- tracks / showcase ----------
// Artists share a link to their music on a streaming site; the app stores the link, not audio.
app.post('/api/games/:gameId/tracks', auth, async (req, res) => {
  const game = await gameFor(req);
  if (req.user.role !== 'player') fail('Only artists can share music', 403);
  if (!game.uploads_open || game.status === 'archived') fail("Music uploads aren't open yet. A Record Owner will open them.");
  const count = (await db.get('SELECT COUNT(*) AS n FROM tracks WHERE user_id = ?', req.user.id)).n;
  if (count >= MAX_TRACKS_PER_PLAYER) fail(`You can share up to ${MAX_TRACKS_PER_PLAYER} tracks`);
  const b = req.body;
  const url = G.httpUrl(b.url, 'Link');
  const title = str(b.title, 'Track title', { min: 1, max: 100 });
  const genre = str(b.genre, 'Genre', { max: 40 });
  const description = str(b.description, 'Description', { max: 1000 });
  const credits = str(b.credits, 'Credits', { max: 1000 });
  const { id } = await db.run(
    'INSERT INTO tracks (game_id, user_id, title, genre, description, credits, url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
    game.id, req.user.id, title, genre, description, credits, url, Date.now()
  );
  await G.post(game.id, 'track', req.user.id, `${req.user.display_name} dropped a new track: "${title}". Go give it a listen.`);
  res.json({ id });
});

async function trackFor(req) {
  const t = await db.get('SELECT * FROM tracks WHERE id = ?', int(req.params.trackId, 'Track'));
  if (!t) fail('Track not found', 404);
  if (req.user.role !== 'owner' && req.user.game_id !== t.game_id) fail('Not your label', 403);
  return t;
}

// Counts a listen each time someone other than the artist opens the track's link.
app.post('/api/tracks/:trackId/play', auth, async (req, res) => {
  const t = await trackFor(req);
  if (t.user_id !== req.user.id) await db.run('UPDATE tracks SET plays = plays + 1 WHERE id = ?', t.id);
  res.json({ ok: true });
});

app.post('/api/tracks/:trackId/like', auth, async (req, res) => {
  const t = await trackFor(req);
  if (t.user_id === req.user.id) fail("You can't like your own track");
  const had = await db.get('SELECT 1 FROM track_likes WHERE track_id = ? AND user_id = ?', t.id, req.user.id);
  if (had) await db.run('DELETE FROM track_likes WHERE track_id = ? AND user_id = ?', t.id, req.user.id);
  else await db.run('INSERT INTO track_likes (track_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING', t.id, req.user.id);
  res.json({ liked: !had });
});

app.delete('/api/tracks/:trackId', auth, async (req, res) => {
  const t = await trackFor(req);
  if (t.user_id !== req.user.id && req.user.role !== 'owner') fail('Not your track', 403);
  await db.run('DELETE FROM tracks WHERE id = ?', t.id);
  res.json({ ok: true });
});

// ---------- export (anyone on the label, any time) ----------
async function exportData(game, isOwner) {
  const users = await db.all("SELECT * FROM users WHERE role = 'player' AND game_id = ? ORDER BY id", game.id);
  const stats = new Map((await G.playerStats(game)).map((r) => [r.player.id, r]));
  return {
    exportedAt: new Date().toISOString(),
    game: { ...game, clock: G.clock(game) },
    players: users.map((u) => {
      const s = stats.get(u.id);
      const row = {
        id: u.id, username: u.username, display_name: u.display_name, role_title: u.role_title, bio: u.bio, active: u.active,
        balance: s.stats.balance, escrow: s.stats.escrow, net_worth: s.stats.netWorth, earned: s.stats.earned, spent: s.stats.spent,
        deals_sold: s.stats.dealsSold, deals_bought: s.stats.dealsBought, rating: s.stats.rating, level: s.progress.level,
        xp: s.progress.xp, title: s.progress.title, tracks: s.stats.tracks, likes: s.stats.likes,
        badges: s.badges.map((b) => b.name).join('; '), joined_at: new Date(u.created_at).toISOString(),
      };
      if (isOwner) row.pin = u.pin;
      return row;
    }),
    ledger: await db.all('SELECT * FROM ledger WHERE game_id = ? ORDER BY id', game.id),
    services: await db.all('SELECT * FROM services WHERE game_id = ? ORDER BY id', game.id),
    contracts: await db.all('SELECT * FROM contracts WHERE game_id = ? ORDER BY id', game.id),
    contract_events: await db.all('SELECT e.* FROM contract_events e JOIN contracts c ON c.id = e.contract_id WHERE c.game_id = ? ORDER BY e.id', game.id),
    feed: await db.all('SELECT * FROM feed WHERE game_id = ? ORDER BY id', game.id),
    tracks: await db.all('SELECT t.*, (SELECT COUNT(*) FROM track_likes l WHERE l.track_id = t.id) AS likes FROM tracks t WHERE game_id = ? ORDER BY id', game.id),
  };
}

const slug = (s) => String(s).replace(/[^a-zA-Z0-9 _-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'untitled';

app.get('/api/games/:gameId/export.json', auth, async (req, res) => {
  const game = await gameFor(req);
  res.set('Content-Disposition', `attachment; filename="cardinal-records-${slug(game.name)}-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(await exportData(game, req.user.role === 'owner'));
});

app.get('/api/games/:gameId/export.zip', auth, async (req, res) => {
  const game = await gameFor(req);
  const data = await exportData(game, req.user.role === 'owner');
  const base = `cardinal-records-${slug(game.name)}-${new Date().toISOString().slice(0, 10)}`;
  res.set('Content-Type', 'application/zip');
  res.set('Content-Disposition', `attachment; filename="${base}.zip"`);
  const zip = new ZipWriter(res);
  zip.add(`${base}/data.json`, JSON.stringify(data, null, 2));
  for (const table of ['players', 'ledger', 'services', 'contracts', 'contract_events', 'feed', 'tracks']) {
    zip.add(`${base}/csv/${table}.csv`, toCsv(data[table]));
  }
  zip.finish();
});

// ---------- static app ----------
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That request is too large' });
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

(async () => {
  await migrate();
  await loadOwners();
  app.listen(PORT, () => console.log(`Cardinal Records is live on http://localhost:${PORT}`));
})().catch((err) => {
  console.error('[startup] Could not connect to Postgres:', err.message);
  process.exit(1);
});

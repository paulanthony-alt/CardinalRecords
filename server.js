'use strict';
const express = require('express');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, tx, migrate } = require('./src/db');
const { loadOwners, usingStartingPin } = require('./src/owners');
const { ZipWriter, toCsv } = require('./src/zip');
const { writeBackupPdf, writeReportPdf } = require('./src/backup');
const SC = require('./src/statecache');
const LB = require('./src/lobby');
const compression = require('compression');
const G = require('./src/game');
const R = require('./src/rates');
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
// Health check (Render uses it) also says what's running, for the weekly status report.
// RENDER_GIT_COMMIT is set by Render on every deploy.
const VERSION = require('./package.json').version;
const STARTED = Date.now();
app.get('/healthz', (req, res) => res.json({ ok: true, version: VERSION, commit: (process.env.RENDER_GIT_COMMIT || '').slice(0, 7) || null, upSince: new Date(STARTED).toISOString() }));
app.use(express.json({ limit: '200kb' }));
app.use(compression());

// Any successful write moves the revision, so browsers know to reload. It's
// bumped just before the response goes out, so the writer's own reload sees it.
// Signing in and out changes nothing anyone else sees, so it doesn't count
// (otherwise 30 students signing in would reload every screen 30 times).
const NO_BUMP = new Set(['/api/login', '/api/login/lookup', '/api/logout', '/api/claim/check', '/api/me/pin']);
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && !NO_BUMP.has(req.path)) {
    const json = res.json.bind(res);
    res.json = (body) => { if (res.statusCode < 400) SC.bump(); return json(body); };
  }
  next();
});
G.hooks.onChange = SC.bump;

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

/** Loads the game from :gameId and checks the user belongs to it. Offloaded seasons have no data left. */
async function gameFor(req, { offloaded = false } = {}) {
  const game = await G.getGame(int(req.params.gameId, 'Game'));
  if (req.user.role !== 'owner' && req.user.game_id !== game.id) fail('You are not on this label', 403);
  if (game.status === 'offloaded' && !offloaded) fail("This season was offloaded. Its records are in the backup files you downloaded.", 410);
  return game;
}

function publicUser(u, { withPin = false } = {}) {
  const out = {
    id: u.id, username: u.username, role: u.role, gameId: u.game_id, displayName: u.display_name,
    roleTitle: u.role_title, bio: u.bio, color: u.color, active: !!u.active, lastSeen: u.last_seen,
    claimed: u.pin != null, createdAt: u.created_at, profileUrl: u.profile_url || null,
  };
  if (withPin) { out.pin = u.pin; out.claimCode = u.pin == null ? u.claim_code : null; out.muted = !!u.muted; }
  return out;
}

/** Constant-time check of a sign-up code. */
function codeMatches(user, given) {
  if (!user.claim_code) return false;
  const a = Buffer.from(G.tidyCode(given).padEnd(12, ' '));
  const b = Buffer.from(String(user.claim_code).padEnd(12, ' '));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- login (username + PIN, with lockout) ----------
const attempts = new Map();
function checkLock(key) {
  const a = attempts.get(key);
  if (a && a.until > Date.now()) fail(`Too many wrong tries. Try again in ${Math.ceil((a.until - Date.now()) / 60000)} min.`, 429);
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

// First sign-in: the player proves it's them with the sign-up code from their
// Record Owner, then picks their own PIN. Without the code, a classmate who knows
// the username can't grab the account first.
async function claimable(req) {
  const username = str(req.body.username, 'Username', { min: 1, max: 40 });
  const key = `claim:${username.toLowerCase()}`;
  checkLock(key);
  const u = await db.get('SELECT * FROM users WHERE username = ? AND active = 1', username);
  if (!u) fail('Unknown username', 404);
  if (u.pin != null) fail('This account is already claimed. Sign in with your PIN.', 409);
  if (!codeMatches(u, req.body.code)) {
    recordFail(key);
    fail("That sign-up code isn't right. Check the code your Record Owner gave you.", 401);
  }
  return { u, key };
}

app.post('/api/claim/check', async (req, res) => {
  await claimable(req);
  res.json({ ok: true });
});

app.post('/api/claim', async (req, res) => {
  const { u, key } = await claimable(req);
  if (!G.isPin(req.body.pin)) fail('PIN must be 4 to 6 digits');
  // Only the first claim wins, even if two arrive at once.
  const { changes } = await db.run('UPDATE users SET pin = ?, claim_code = NULL WHERE id = ? AND pin IS NULL AND claim_code = ?', String(req.body.pin), u.id, u.claim_code);
  if (!changes) fail('This account was just claimed. Sign in with your PIN.', 409);
  attempts.delete(key);
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
  const isOwner = req.user.role === 'owner';
  const games = isOwner
    ? await db.all(`SELECT g.id, u.display_name AS created_by_name,
        (SELECT COUNT(*) FROM users p WHERE p.game_id = g.id AND p.role = 'player' AND p.active = 1) AS players
        FROM games g LEFT JOIN users u ON u.id = g.created_by ORDER BY g.created_at DESC`)
    : await db.all('SELECT id FROM games WHERE id = ?', req.user.game_id ?? -1);
  res.json({
    user: { ...publicUser(req.user, { withPin: false }), startingPin: usingStartingPin(req.user) },
    games: await Promise.all(games.map(async (g) => {
      const gg = await G.getGame(g.id);
      const { rate_sheet, summary, lobby: _l, ...rest } = gg;
      let sum = null;
      try { sum = summary ? JSON.parse(summary) : null; } catch {}
      return { ...rest, summary: sum, clock: G.clock(gg), players: g.players, createdByName: g.created_by_name };
    })),
  });
});

app.put('/api/me', auth, async (req, res) => {
  const b = req.body;
  const displayName = str(b.displayName, 'Artist name', { min: 1, max: 40 });
  const roleTitle = str(b.roleTitle, 'Role', { max: 40 });
  const bio = str(b.bio, 'Bio', { max: 500 });
  const color = /^#[0-9a-fA-F]{6}$/.test(b.color || '') ? b.color : req.user.color;
  // Artist profile link: only players have one; leaving the field out keeps the current link.
  const profile = req.user.role === 'player' && b.profileUrl !== undefined ? G.profileUrl(b.profileUrl) : req.user.profile_url;
  await db.run('UPDATE users SET display_name = ?, role_title = ?, bio = ?, color = ?, profile_url = ? WHERE id = ?', displayName, roleTitle, bio, color, profile || null, req.user.id);
  if (profile && profile !== req.user.profile_url && req.user.game_id) {
    await G.post(req.user.game_id, 'profile', req.user.id, `${displayName} ${req.user.profile_url ? 'updated' : 'shared'} their artist profile. Check out what they're great at.`);
  }
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
  if (req.user.role === 'player') {
    const g = req.user.game_id ? await db.get('SELECT guide_open FROM games WHERE id = ?', req.user.game_id) : null;
    if (!g?.guide_open) fail("The Release Guide isn't open yet. A Record Owner will open it.", 403);
  }
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
    starting_balance: int(b.startingBalance ?? existing?.starting_balance ?? 1000, 'Signing advance', { min: 0, max: 100_000_000 }),
    label_cut_pct: int(b.labelCutPct ?? existing?.label_cut_pct ?? 0, 'Label cut', { min: 0, max: 50 }),
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
      await G.post(game.id, 'phase', req.user.id, game.status === 'archived' ? 'The Showcase has been reopened.' : "The Record Owner called the season. Get your music ready: sharing music to the Showcase opens once a Record Owner turns it on.");
    } else if (phase === 'archived') {
      await db.run("UPDATE games SET status = 'archived', uploads_open = 0, archived_at = ? WHERE id = ?", Date.now(), game.id);
      await G.post(game.id, 'phase', req.user.id, 'This season has been archived. Thanks for playing Cardinal Records.');
    }
  });
  res.json({ ok: true });
});

// Sharing music to the Showcase stays closed until a Record Owner opens it.
app.post('/api/games/:gameId/uploads', auth, ownerOnly, async (req, res) => {
  const game = await gameFor(req);
  const open = !!req.body.open;
  if (open && game.status === 'archived') fail('Reopen the Showcase before opening music sharing');
  if (open === !!game.uploads_open) return res.json({ ok: true });
  await db.run('UPDATE games SET uploads_open = ? WHERE id = ?', open ? 1 : 0, game.id);
  await G.post(game.id, 'phase', req.user.id, open
    ? 'Music sharing is OPEN! Head to the Showcase and share a link to the tracks you made this season.'
    : 'Music sharing is closed for now.');
  res.json({ ok: true });
});

// The Release Guide stays hidden from students until a Record Owner opens it.
app.post('/api/games/:gameId/guide', auth, ownerOnly, async (req, res) => {
  const game = await gameFor(req);
  const open = !!req.body.open;
  if (open === !!game.guide_open) return res.json({ ok: true });
  await db.run('UPDATE games SET guide_open = ? WHERE id = ?', open ? 1 : 0, game.id);
  await G.post(game.id, 'phase', req.user.id, open
    ? 'The Release Guide is OPEN! Find it in the menu: a step-by-step path from your finished song to Spotify, Apple Music and every other streaming service.'
    : 'The Release Guide is closed for now.');
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
      "INSERT INTO users (username, role, game_id, display_name, role_title, color, claim_code, created_at) VALUES (?, 'player', ?, ?, ?, ?, ?, ?) RETURNING id",
      username, game.id, displayName, roleTitle, COLORS[count % COLORS.length], G.newClaimCode(), Date.now()
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
  if (req.body.active != null) active = req.body.active ? 1 : 0;
  const muted = req.body.muted != null ? (req.body.muted ? 1 : 0) : p.muted;
  const profile = req.body.profileUrl !== undefined ? G.profileUrl(req.body.profileUrl) : p.profile_url;
  // Moving an artist to another season: their money and deals stay in the old season's
  // records; in the new one they start fresh (with its advance if it's already live).
  const gameId = req.body.gameId != null ? int(req.body.gameId, 'Season') : p.game_id;
  const target = await G.getGame(gameId);
  const moving = gameId !== p.game_id;
  if (moving && ['archived', 'offloaded'].includes(target.status)) fail('That season is archived');
  if (moving && p.game_id) {
    // Their deals can't be finished from another season, so settle them first.
    const open = (await db.get(
      `SELECT COUNT(*) AS n FROM contracts WHERE game_id = ? AND (buyer_id = ? OR seller_id = ?) AND status IN (${G.OPEN_STATUSES.map(() => '?').join(',')})`,
      p.game_id, p.id, p.id, ...G.OPEN_STATUSES
    )).n;
    if (open) fail(`${p.display_name} has ${open} open ${open === 1 ? 'deal' : 'deals'} in this season. Finish, cancel or void ${open === 1 ? 'it' : 'them'} before moving them.`);
  }
  await tx(async () => {
    if (active && (moving || !p.active)) {
      const count = (await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'player' AND game_id = ? AND active = 1 AND id != ?", gameId, p.id)).n;
      if (count >= target.max_players) fail(`${target.name} is full (${target.max_players} artists max)`);
    }
    await db.run('UPDATE users SET username = ?, display_name = ?, role_title = ?, active = ?, game_id = ?, muted = ?, profile_url = ? WHERE id = ?', username, displayName, roleTitle, active, gameId, muted, profile || null, p.id);
    if (moving) {
      if (target.status === 'active') await G.payAdvance(target, p.id);
      if (p.game_id) {
        await db.run("UPDATE job_requests SET status = 'closed', updated_at = ? WHERE game_id = ? AND user_id = ? AND status = 'open'", Date.now(), p.game_id, p.id);
        await db.run("DELETE FROM job_applicants WHERE user_id = ? AND request_id IN (SELECT id FROM job_requests WHERE game_id = ? AND status = 'open')", p.id, p.game_id);
      }
      await G.post(gameId, 'join', p.id, `${displayName} joined ${target.name}${roleTitle ? ` as ${roleTitle}` : ''}.`);
    }
  });
  if (!active) await db.run('DELETE FROM sessions WHERE user_id = ?', p.id);
  res.json({ ok: true });
});

// Clears the PIN and issues a new sign-up code; the player uses it to set a new PIN.
app.post('/api/players/:userId/reset-pin', auth, ownerOnly, async (req, res) => {
  const p = await ownedPlayer(req);
  const code = G.newClaimCode();
  await db.run('UPDATE users SET pin = NULL, claim_code = ? WHERE id = ?', code, p.id);
  await db.run('DELETE FROM sessions WHERE user_id = ?', p.id);
  res.json({ ok: true, claimCode: code });
});

// ---------- treasury (owner) ----------
app.post('/api/games/:gameId/grants', auth, ownerOnly, async (req, res) => {
  const game = await gameFor(req);
  if (game.status === 'archived') fail('This season is archived');
  const amount = int(req.body.amount, 'Amount', { min: -100_000_000, max: 100_000_000 });
  if (amount === 0) fail('Amount cannot be zero');
  const memo = str(req.body.memo, 'Memo', { max: 140 });
  await tx(async () => {
    const players = await recipients(game, req.body.userIds);
    for (const p of players) await G.ledgerEntry(game.id, p.id, amount, amount > 0 ? 'grant' : 'fine', { memo, by: req.user.id });
    // Payments are announced in the lobby; fines aren't. Each artist sees their own in Data.
    if (amount > 0) {
      const who = req.body.userIds === 'all' ? 'every artist' : players.map((p) => p.display_name).join(', ');
      await G.post(game.id, 'grant', req.user.id, `The label paid ${G.fmt$(amount)} to ${who}${memo ? `: ${memo}` : ''}.`);
    }
  });
  res.json({ ok: true });
});

/** The artists a treasury action applies to: 'all' active artists, or a list of ids on this roster. */
async function recipients(game, userIds) {
  if (userIds === 'all') {
    const all = await db.all("SELECT * FROM users WHERE role = 'player' AND game_id = ? AND active = 1", game.id);
    if (!all.length) fail('There are no artists on this roster yet');
    return all;
  }
  const ids = (Array.isArray(userIds) ? userIds : []).map((v) => int(v, 'Player'));
  if (!ids.length) fail('Pick at least one artist');
  const players = [];
  for (const id of ids) {
    const p = await db.get("SELECT * FROM users WHERE id = ? AND role = 'player' AND game_id = ?", id, game.id);
    if (!p) fail('One of those artists is not on this roster');
    players.push(p);
  }
  return players;
}

// Charge a fee/fine or pay an income item straight from the rate sheet.
app.post('/api/games/:gameId/charges', auth, ownerOnly, async (req, res) => {
  const game = await gameFor(req);
  if (game.status === 'archived') fail('This season is archived');
  const sheet = R.sheetFor(game);
  const fine = R.findItem(sheet.fines, String(req.body.itemId || ''));
  const payout = fine ? null : R.findItem(sheet.payouts, String(req.body.itemId || ''));
  const item = fine || payout;
  if (!item || item.type === 'auto') fail('Pick an item from the rate sheet');
  const note = str(req.body.memo, 'Note', { max: 140 });
  let quantity = 1;
  let amount = item.amount;
  if (item.type === 'per') {
    quantity = int(req.body.quantity, `Number of ${item.per}s`, { min: 1, max: 100 });
    amount = item.amount * quantity;
  } else if (item.type === 'min') {
    amount = int(req.body.amount, `${item.name} amount`, { min: item.amount, max: 100_000_000 });
  }
  const percent = item.type === 'percent' ? int(req.body.percent, 'Percent of account', { min: item.min, max: item.max }) : null;
  const label = `${item.name}${item.type === 'per' ? ` (${quantity} ${item.per}${quantity === 1 ? '' : 's'})` : ''}${percent ? ` (${percent}% of account)` : ''}${note ? `: ${note}` : ''}`;
  const charged = await tx(async () => {
    const players = await recipients(game, req.body.userIds);
    const out = [];
    for (const p of players) {
      // A percentage fine takes that share of the cash the artist has now.
      const due = percent ? Math.floor((Math.max(0, await G.balanceOf(p.id, game.id)) * percent) / 100) : amount;
      if (!due) continue;
      await G.ledgerEntry(game.id, p.id, fine ? -due : due, fine ? 'fine' : 'grant', { memo: label, by: req.user.id });
      out.push({ userId: p.id, amount: due });
    }
    if (payout && out.length) {
      const who = req.body.userIds === 'all' ? 'every artist' : players.map((p) => p.display_name).join(', ');
      await G.post(game.id, 'grant', req.user.id, `The label paid ${who} ${G.fmt$(amount)} for ${item.name.toLowerCase()}.`);
    }
    return out;
  });
  res.json({ ok: true, charged });
});

// Owners change the season's rate sheet amounts. Deals already made keep their price.
app.put('/api/games/:gameId/rates', auth, ownerOnly, async (req, res) => {
  const game = await gameFor(req);
  const overrides = R.overridesFrom(req.body || {}, fail);
  await db.run('UPDATE games SET rate_sheet = ? WHERE id = ?', overrides, game.id);
  res.json({ ok: true, rates: R.sheetFor({ ...game, rate_sheet: overrides }) });
});

// ---------- full game state ----------
// Built from the shared season cache (src/statecache.js), so a classroom of
// browsers refreshing every few seconds doesn't re-read the season each time.
app.get('/api/rev', auth, (req, res) => res.json({ rev: SC.rev() }));

app.get('/api/games/:gameId/state', auth, async (req, res) => {
  const game = await gameFor(req);
  const isOwner = req.user.role === 'owner';
  const me = req.user;
  const rev = SC.rev();
  const e = await SC.entryFor(game);

  const roster = e.stats.map((r) => ({
    ...publicUser(r.player, { withPin: isOwner }), stats: r.stats, progress: r.progress, badges: r.badges,
    tutorial: r.player.id === me.id || isOwner ? r.tutorial : undefined,
  }));

  const pub = new Set(G.PUBLIC_STATUSES);
  const contractsOut = [...e.contracts.values()]
    .filter((c) => isOwner || c.buyer_id === me.id || c.seller_id === me.id || pub.has(c.status))
    .sort((a, b) => b.updated_at - a.updated_at || b.id - a.id)
    .map((c) => {
      const party = isOwner || c.buyer_id === me.id || c.seller_id === me.id;
      return {
        id: c.id, buyerId: c.buyer_id, sellerId: c.seller_id, title: c.title,
        jobId: c.job_id, pricing: c.pricing, quantity: c.quantity, unitRate: c.unit_rate,
        terms: party ? c.terms : '', amount: c.amount, escrow: c.escrow, dueDays: c.due_days, status: c.status,
        rating: c.rating, createdAt: c.created_at, updatedAt: c.updated_at, approvedAt: c.approved_at, completedAt: c.completed_at,
        events: party ? (e.events.get(c.id) || []).map((x) => ({ actorId: x.actor_id, action: x.action, note: x.note, amount: x.amount, at: x.created_at })) : [],
        ...(({ dueAt, deliveredAt, overdue, late }) => ({ dueAt, deliveredAt, overdue, late }))(G.deadline(c, e.events.get(c.id) || [])),
      };
    });

  // Lobby: students only see what the Record Owners allow; owners see everything.
  const lobby = LB.lobbyOf(game);
  const canSee = (f) => isOwner || LB.studentCanSee(f, lobby);
  const feedOut = (f) => ({ id: f.id, kind: f.kind, actorId: f.actor_id, message: f.message, at: f.created_at, ...(isOwner ? { hidden: !!f.hidden } : {}) });
  const feed = [...e.feed.values()].filter(canSee).sort((a, b) => b.created_at - a.created_at || b.id - a.id).slice(0, 150).map(feedOut);
  let pinned = lobby.pinned ? (e.feed.get(lobby.pinned) || await db.get('SELECT * FROM feed WHERE id = ? AND game_id = ?', lobby.pinned, game.id)) : null;
  if (pinned && !canSee(pinned)) pinned = null;

  const myLikes = new Set(e.likes.filter((l) => l.user_id === me.id).map((l) => l.track_id));
  const tracks = e.tracks.map((t) => ({
    id: t.id, userId: t.user_id, title: t.title, genre: t.genre, description: t.description, credits: t.credits,
    url: t.url, plays: t.plays, likes: t.likes, liked: myLikes.has(t.id), createdAt: t.created_at,
  }));

  const ledgerAll = [...e.ledger.values()].sort((a, b) => b.id - a.id);
  const reversed = new Set(ledgerAll.filter((l) => l.reverses).map((l) => l.reverses));
  const ledgerRows = isOwner ? ledgerAll.slice(0, 500) : ledgerAll.filter((l) => l.user_id === me.id).slice(0, 300);
  const vault = ledgerAll.reduce((a, l) => (l.user_id == null ? a + l.amount : a), 0);

  const { rate_sheet, summary, lobby: _lobby, ...gameOut } = game;
  res.json({
    rev,
    lobby: { chat: lobby.chat, show: lobby.show, pinned: pinned ? feedOut(pinned) : null, mutedMe: !isOwner && !!me.muted, categories: LB.CATEGORIES },
    game: { ...gameOut, clock: G.clock(game) },
    rates: R.sheetFor(game),
    roster, owners: e.owners, former: e.former, contracts: contractsOut, feed, tracks, vault,
    ledger: ledgerRows.map((l) => ({
      id: l.id, userId: l.user_id, amount: l.amount, kind: l.kind, contractId: l.contract_id, memo: l.memo, at: l.created_at,
      reverses: l.reverses || null, undone: reversed.has(l.id), by: isOwner ? l.created_by : undefined,
    })),
    // Studio: owners see every request; students see their own, plus the approved schedule (who and when).
    bookings: (e.bookings || []).filter((x) => isOwner || x.user_id === me.id || x.status === 'approved').map((x) => {
      const mineOrOwner = isOwner || x.user_id === me.id;
      return {
        id: x.id, userId: x.user_id, startsAt: x.starts_at, minutes: x.minutes, status: x.status,
        purpose: mineOrOwner ? x.purpose : '', guests: mineOrOwner ? x.guests : '', note: mineOrOwner ? x.owner_note : '',
        decidedAt: x.decided_at, createdAt: x.created_at,
      };
    }),
    challenges: (e.challenges || []).map((c) => {
      const all = (e.entries || []).filter((x) => x.challenge_id === c.id);
      const closed = c.status !== 'active' || Date.now() >= c.ends_at;
      // Students see other entries only once it's closed, so nobody copies.
      const visible = isOwner || closed ? all : all.filter((x) => x.user_id === me.id);
      return {
        id: c.id, title: c.title, description: c.description, startsAt: c.starts_at, endsAt: c.ends_at, prizes: parsePrizes(c.prizes),
        status: c.status, createdAt: c.created_at, entryCount: all.length,
        entries: visible.map((x) => ({ userId: x.user_id, url: x.url, note: x.note, place: x.place, at: x.updated_at })),
      };
    }),
    requests: (e.requests || []).map((q) => {
      const apps = (e.applicants || []).filter((a) => a.request_id === q.id);
      const mine = isOwner || q.user_id === me.id;
      let amount = null;
      try { amount = G.priceJob(game, { jobId: q.job_id, pricing: q.pricing, quantity: q.quantity }).amount; } catch {}
      const label = q.kind === 'label';
      if (label) amount = Number(q.amount);
      const myApp = apps.find((a) => a.user_id === me.id);
      return {
        id: q.id, kind: q.kind, userId: q.user_id, jobId: q.job_id, pricing: q.pricing, quantity: q.quantity, dueDays: q.due_days, details: q.details,
        status: q.status, contractId: q.contract_id, createdAt: q.created_at, amount,
        ...(label ? { payoutId: q.payout_id, spots: q.spots, whenText: q.when_text, picked: apps.filter((a) => a.status !== 'applied').map((a) => a.user_id) } : {}),
        applicants: mine ? apps.map((a) => ({ userId: a.user_id, note: a.note, at: a.created_at, status: a.status })) : undefined,
        applicantCount: apps.length, applied: !!myApp, myStatus: myApp?.status || null,
      };
    }),
    serverTime: Date.now(),
  });
});

// ---------- lobby chat ----------
app.post('/api/games/:gameId/feed', auth, async (req, res) => {
  const game = await gameFor(req);
  if (game.status === 'archived') fail('This season is archived');
  const message = str(req.body.message, 'Message', { min: 1, max: 280 });
  const kind = req.user.role === 'owner' ? 'announcement' : 'chat';
  if (kind === 'chat') {
    const lobby = LB.lobbyOf(game);
    if (lobby.chat === 'off') fail('The lobby is closed right now.', 403);
    if (lobby.chat === 'announce') fail('Only Record Owners can post in the lobby right now.', 403);
    if (req.user.muted) fail('A Record Owner has paused your chat. You can still read the lobby.', 403);
  }
  await G.post(game.id, kind, req.user.id, message);
  res.json({ ok: true });
});

// ---------- paste-in roster (owners) ----------
/** A username from a name that isn't the full name: first name + last initial + 2 digits (mariag14). */
function suggestUsername(name, taken) {
  const parts = String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s'-]/g, ' ').split(/[\s'-]+/).filter(Boolean);
  const base = ((parts[0] || 'artist').slice(0, 14) + (parts.length > 1 ? parts[parts.length - 1][0] : '')).padEnd(3, 'x');
  for (let i = 0; i < 500; i++) {
    const u = `${base}${10 + Math.floor(Math.random() * 90)}`;
    if (!taken.has(u)) { taken.add(u); return u; }
  }
  const u = `${base}${Date.now() % 100000}`; taken.add(u); return u;
}

// Paste a class list. dryRun: suggest usernames and show problems; otherwise sign everyone
// (all or nothing) and return their sign-up codes for printing slips.
app.post('/api/games/:gameId/players/bulk', auth, ownerOnly, async (req, res) => {
  const game = await gameFor(req);
  if (game.status === 'archived') fail('This season is archived');
  const raw = Array.isArray(req.body?.entries) ? req.body.entries : [];
  if (!raw.length) fail('Paste at least one name');
  if (raw.length > G.MAX_PLAYERS) fail(`That's more than ${G.MAX_PLAYERS} names`);
  const taken = new Set((await db.all('SELECT LOWER(username) AS u FROM users')).map((r) => r.u));
  const seen = new Set();
  const entries = raw.map((r) => {
    const displayName = str(r.displayName, 'Name', { max: 40 });
    const roleTitle = str(r.roleTitle, 'Role', { max: 40 });
    let username = str(r.username, 'Username', { max: 24 });
    if (!username && displayName) username = suggestUsername(displayName, taken);
    const problems = [];
    if (!displayName) problems.push('Name is missing');
    if (!G.isUsername(username)) problems.push('Usernames are 3-24 letters, numbers, dots, dashes or underscores');
    else if (seen.has(username.toLowerCase())) problems.push('Used twice in this list');
    else if (r.username && taken.has(username.toLowerCase())) problems.push('That username is taken');
    seen.add(username.toLowerCase());
    return { displayName, roleTitle, username, problems };
  });
  const count = (await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'player' AND game_id = ? AND active = 1", game.id)).n;
  const room = game.max_players - count;
  if (req.body.dryRun) return res.json({ entries, room });
  if (entries.some((e) => e.problems.length)) fail('Fix the highlighted names first');
  if (entries.length > room) fail(`Only ${room} ${room === 1 ? 'spot is' : 'spots are'} left on this roster (${game.max_players} max)`);
  const created = await tx(async () => {
    const out = [];
    for (const [i, e] of entries.entries()) {
      if (await db.get('SELECT 1 FROM users WHERE username = ?', e.username)) fail(`${e.username} was just taken. Check again.`);
      const code = G.newClaimCode();
      const { id } = await db.run(
        "INSERT INTO users (username, role, game_id, display_name, role_title, color, claim_code, created_at) VALUES (?, 'player', ?, ?, ?, ?, ?, ?) RETURNING id",
        e.username, game.id, e.displayName, e.roleTitle, COLORS[(count + i) % COLORS.length], code, Date.now()
      );
      if (game.status === 'active') await G.payAdvance(game, id);
      out.push({ id, username: e.username, displayName: e.displayName, claimCode: code });
    }
    await G.post(game.id, 'join', req.user.id, `${out.length} new ${out.length === 1 ? 'artist' : 'artists'} signed to the label: ${out.map((o) => o.displayName).join(', ')}.`.slice(0, 1000));
    return out;
  });
  res.json({ ok: true, created });
});

// ---------- undo a payment or fine (owners) ----------
app.post('/api/ledger/:entryId/reverse', auth, ownerOnly, async (req, res) => {
  const r = await G.reverseEntry(int(req.params.entryId, 'Transaction'), req.user);
  res.json({ ok: true, id: r.id });
});

// ---------- studio time ----------
const STUDIO_LENGTHS = [30, 45, 60, 90, 120, 150, 180, 240];
const MAX_PENDING_BOOKINGS = 5;
async function bookingFor(req) {
  const b = await db.get('SELECT * FROM studio_bookings WHERE id = ?', int(req.params.bookingId, 'Booking'));
  if (!b) fail('That studio request is gone', 404);
  if (req.user.role !== 'owner' && req.user.game_id !== b.game_id) fail('Not your label', 403);
  return { b, game: await G.getGame(b.game_id) };
}

// A student asks for studio time. The day and start time come from their browser, as one timestamp.
app.post('/api/games/:gameId/studio', auth, async (req, res) => {
  const game = await gameFor(req);
  if (req.user.role !== 'player') fail('Only artists request studio time', 403);
  if (!['active', 'showcase'].includes(game.status)) fail('Studio requests open once the season starts');
  const b = req.body || {};
  const startsAt = int(b.startsAt, 'Day and start time', { min: 0 });
  if (startsAt < Date.now() - 5 * 60_000) fail('Pick a time that hasn\'t passed yet');
  if (startsAt > Date.now() + 120 * G.DAY) fail('You can book up to 120 days ahead');
  const minutes = int(b.minutes, 'Length', { min: 15, max: 480 });
  if (!STUDIO_LENGTHS.includes(minutes)) fail('Pick a length from the list');
  const purpose = str(b.purpose, 'What you\'re recording', { min: 3, max: 300 });
  const guests = str(b.guests, "Who's coming", { max: 200 });
  const open = (await db.get("SELECT COUNT(*) AS n FROM studio_bookings WHERE game_id = ? AND user_id = ? AND status = 'pending'", game.id, req.user.id)).n;
  if (open >= MAX_PENDING_BOOKINGS) fail(`You have ${MAX_PENDING_BOOKINGS} requests waiting already. Wait for an answer or cancel one.`);
  const now = Date.now();
  const { id } = await db.run('INSERT INTO studio_bookings (game_id, user_id, starts_at, minutes, purpose, guests, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
    game.id, req.user.id, startsAt, minutes, purpose, guests, now, now);
  res.json({ id });
});

// Owners approve or decline (with an optional note); students can cancel their own.
app.post('/api/studio/:bookingId/decide', auth, ownerOnly, async (req, res) => {
  const { b } = await bookingFor(req);
  const action = String(req.body?.action || '');
  const note = str(req.body?.note, 'Note', { max: 300 });
  const to = { approve: 'approved', decline: 'declined', cancel: 'cancelled' }[action];
  if (!to) fail('Unknown action');
  if (action === 'cancel' ? !['pending', 'approved'].includes(b.status) : b.status !== 'pending') fail('That request was already answered');
  await db.run('UPDATE studio_bookings SET status = ?, owner_note = ?, decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?', to, note, req.user.id, Date.now(), Date.now(), b.id);
  res.json({ ok: true });
});

app.post('/api/studio/:bookingId/cancel', auth, async (req, res) => {
  const { b } = await bookingFor(req);
  if (b.user_id !== req.user.id) fail('Only the artist who asked can cancel it', 403);
  if (!['pending', 'approved'].includes(b.status)) fail('That request is already closed');
  if (b.status === 'approved' && Date.now() >= b.starts_at) fail('That session has already started');
  await db.run("UPDATE studio_bookings SET status = 'cancelled', updated_at = ? WHERE id = ?", Date.now(), b.id);
  res.json({ ok: true });
});

// After an approved session's start time: the artist didn't show. Charges the rate sheet's no-show fee (undoable).
app.post('/api/studio/:bookingId/noshow', auth, ownerOnly, async (req, res) => {
  const { b, game } = await bookingFor(req);
  if (b.status !== 'approved') fail('Only approved sessions can be marked as a no-show');
  if (Date.now() < b.starts_at) fail("That session hasn't started yet");
  if (game.status === 'archived') fail('This season is archived');
  const fee = R.findItem(R.sheetFor(game).fines, 'studio-no-show');
  await tx(async () => {
    await db.run("UPDATE studio_bookings SET status = 'noshow', decided_by = ?, updated_at = ? WHERE id = ?", req.user.id, Date.now(), b.id);
    if (fee?.amount > 0) await G.ledgerEntry(game.id, b.user_id, -fee.amount, 'fine', { memo: `${fee.name}: ${new Date(Number(b.starts_at)).toISOString().slice(0, 10)}`, by: req.user.id });
  });
  res.json({ ok: true, fee: fee?.amount || 0 });
});

// ---------- studio challenges ----------
const CH_MAX_SPAN = 366 * G.DAY;
const parsePrizes = (raw) => { try { const p = JSON.parse(raw || '[]'); return Array.isArray(p) ? p : []; } catch { return []; } };
/** Is a challenge taking entries right now? */
const challengeOpen = (c, now = Date.now()) => c.status === 'active' && now >= c.starts_at && now < c.ends_at;

/** Validate an owner's challenge form (create or edit). Dates are timestamps chosen in the owner's browser. */
function challengeInput(b, cur = null) {
  const title = str(b.title ?? cur?.title, 'Title', { min: 3, max: 80 });
  const description = str(b.description ?? cur?.description, 'Description', { max: 1000 });
  const startsAt = int(b.startsAt ?? cur?.starts_at, 'Start date', { min: 0 });
  const endsAt = int(b.endsAt ?? cur?.ends_at, 'End date', { min: 0 });
  if (endsAt <= startsAt) fail('The end date has to be after the start date');
  if (endsAt - startsAt > CH_MAX_SPAN) fail('A challenge can run for up to a year');
  const raw = Array.isArray(b.prizes) ? b.prizes : cur ? parsePrizes(cur.prizes) : [];
  const prizes = raw.slice(0, 3).map((v, i) => (v === '' || v == null ? null : int(v, `${['1st', '2nd', '3rd'][i]} prize`, { min: 0, max: 100_000 })));
  while (prizes.length && prizes[prizes.length - 1] == null) prizes.pop();
  if (prizes[0] == null) fail('Set a 1st place prize (it can be $0)');
  if (prizes.includes(null)) fail('Fill in the prizes in order: 1st, then 2nd, then 3rd');
  return { title, description, startsAt, endsAt, prizes };
}
async function challengeFor(req) {
  const c = await db.get('SELECT * FROM challenges WHERE id = ?', int(req.params.challengeId, 'Challenge'));
  if (!c) fail('That challenge is gone', 404);
  if (req.user.role !== 'owner' && req.user.game_id !== c.game_id) fail('Not your label', 403);
  return { c, game: await G.getGame(c.game_id) };
}
const prizeText = (prizes) => prizes.map((p, i) => `${['1st', '2nd', '3rd'][i]} ${G.fmt$(p)}`).join(', ');

app.post('/api/games/:gameId/challenges', auth, ownerOnly, async (req, res) => {
  const game = await gameFor(req);
  if (game.status === 'archived') fail('This season is archived');
  const v = challengeInput(req.body || {});
  if (v.endsAt <= Date.now()) fail('The end date has already passed');
  const now = Date.now();
  const { id } = await db.run(
    'INSERT INTO challenges (game_id, title, description, starts_at, ends_at, prizes, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
    game.id, v.title, v.description, v.startsAt, v.endsAt, JSON.stringify(v.prizes), req.user.id, now, now
  );
  await G.post(game.id, 'challenge', req.user.id, v.startsAt <= now
    ? `New studio challenge: "${v.title}". Prizes: ${prizeText(v.prizes)}. Open Challenges to enter.`
    : `Coming up: the "${v.title}" studio challenge. Prizes: ${prizeText(v.prizes)}. See Challenges for the dates.`);
  res.json({ id });
});

app.patch('/api/challenges/:challengeId', auth, ownerOnly, async (req, res) => {
  const { c } = await challengeFor(req);
  if (c.status !== 'active') fail('Winners have been picked or it was cancelled, so it can\'t be changed');
  const v = challengeInput(req.body || {}, c);
  await db.run('UPDATE challenges SET title = ?, description = ?, starts_at = ?, ends_at = ?, prizes = ?, updated_at = ? WHERE id = ?',
    v.title, v.description, v.startsAt, v.endsAt, JSON.stringify(v.prizes), Date.now(), c.id);
  res.json({ ok: true });
});

app.post('/api/challenges/:challengeId/end', auth, ownerOnly, async (req, res) => {
  const { c } = await challengeFor(req);
  if (!challengeOpen(c)) fail("It isn't open right now");
  await db.run('UPDATE challenges SET ends_at = ?, updated_at = ? WHERE id = ?', Date.now(), Date.now(), c.id);
  res.json({ ok: true });
});

app.post('/api/challenges/:challengeId/cancel', auth, ownerOnly, async (req, res) => {
  const { c } = await challengeFor(req);
  if (c.status !== 'active') fail('Already finished');
  await db.run("UPDATE challenges SET status = 'cancelled', updated_at = ? WHERE id = ?", Date.now(), c.id);
  res.json({ ok: true });
});

// An artist's entry: a link plus a note; they can change it until the end date.
app.put('/api/challenges/:challengeId/entry', auth, async (req, res) => {
  const { c, game } = await challengeFor(req);
  if (req.user.role !== 'player') fail('Only artists enter challenges', 403);
  if (game.status === 'archived') fail('This season is archived');
  if (!challengeOpen(c)) fail(Date.now() < c.starts_at ? "This challenge hasn't started yet" : 'This challenge is closed');
  const url = G.httpUrl(req.body?.url, 'Link');
  const note = str(req.body?.note, 'Note', { max: 500 });
  const now = Date.now();
  await db.run(`INSERT INTO challenge_entries (challenge_id, user_id, url, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (challenge_id, user_id) DO UPDATE SET url = EXCLUDED.url, note = EXCLUDED.note, updated_at = EXCLUDED.updated_at`, c.id, req.user.id, url, note, now, now);
  await db.run('UPDATE challenges SET updated_at = ? WHERE id = ?', now, c.id);
  res.json({ ok: true });
});

app.delete('/api/challenges/:challengeId/entry', auth, async (req, res) => {
  const { c } = await challengeFor(req);
  if (!challengeOpen(c)) fail('This challenge is closed');
  await db.run('DELETE FROM challenge_entries WHERE challenge_id = ? AND user_id = ?', c.id, req.user.id);
  res.json({ ok: true });
});

// Owners pick 1st (and 2nd, 3rd if there are prizes for them) after the end date; prizes pay out.
app.post('/api/challenges/:challengeId/winners', auth, ownerOnly, async (req, res) => {
  const { c, game } = await challengeFor(req);
  if (c.status !== 'active') fail('Winners were already picked, or it was cancelled');
  if (Date.now() < c.ends_at) fail('Pick winners after the end date (or end it now first)');
  if (game.status === 'archived') fail('This season is archived');
  const prizes = parsePrizes(c.prizes);
  const places = (Array.isArray(req.body?.places) ? req.body.places : []).filter((v) => v != null && v !== '').map((v) => int(v, 'Winner'));
  if (!places.length) fail('Pick at least a 1st place');
  if (places.length > Math.max(1, prizes.length)) fail(`This challenge has prizes for ${prizes.length} ${prizes.length === 1 ? 'place' : 'places'}`);
  if (new Set(places).size !== places.length) fail('Each artist can only win one place');
  const names = [];
  await tx(async () => {
    for (const [i, uid] of places.entries()) {
      const e = await db.get('SELECT 1 FROM challenge_entries WHERE challenge_id = ? AND user_id = ?', c.id, uid);
      if (!e) fail("Winners have to be artists who entered");
      await db.run('UPDATE challenge_entries SET place = ? WHERE challenge_id = ? AND user_id = ?', i + 1, c.id, uid);
      const place = ['1st', '2nd', '3rd'][i];
      if (prizes[i] > 0) await G.ledgerEntry(game.id, uid, prizes[i], 'grant', { memo: `Challenge prize: ${c.title} (${place} place)`.slice(0, 140), by: req.user.id });
      names.push(`${place}: ${await G.nameOf(uid)}${prizes[i] > 0 ? ` (${G.fmt$(prizes[i])})` : ''}`);
    }
    await db.run("UPDATE challenges SET status = 'judged', updated_at = ? WHERE id = ?", Date.now(), c.id);
    await G.post(game.id, 'challenge', req.user.id, `"${c.title}" winners! ${names.join(', ')}. Congratulations!`);
  });
  res.json({ ok: true });
});

// ---------- job board ----------
async function requestFor(req) {
  const q = await db.get('SELECT * FROM job_requests WHERE id = ?', int(req.params.requestId, 'Request'));
  if (!q) fail('That request is gone', 404);
  if (req.user.role !== 'owner' && req.user.game_id !== q.game_id) fail('Not your label', 403);
  return { q, game: await G.getGame(q.game_id) };
}
const MAX_OPEN_REQUESTS = 3;

app.post('/api/games/:gameId/requests', auth, async (req, res) => {
  const game = await gameFor(req);
  if (req.user.role !== 'player') fail('Only artists post on the job board', 403);
  if (game.status !== 'active') fail('The job board is open while the season is live');
  const b = req.body || {};
  const price = G.priceJob(game, b); // validates the job, pricing and quantity
  const dueDays = b.dueDays ? int(b.dueDays, 'Due in (school days)', { min: 1, max: G.MAX_DAYS }) : null;
  const details = str(b.details, 'Details', { max: 500 });
  const open = (await db.get("SELECT COUNT(*) AS n FROM job_requests WHERE game_id = ? AND user_id = ? AND status = 'open' AND kind = 'artist'", game.id, req.user.id)).n;
  if (open >= MAX_OPEN_REQUESTS) fail(`You can have up to ${MAX_OPEN_REQUESTS} open requests. Close one first.`);
  const now = Date.now();
  const { id } = await db.run(
    'INSERT INTO job_requests (game_id, user_id, job_id, pricing, quantity, due_days, details, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
    game.id, req.user.id, price.job.id, price.pricing, price.quantity, dueDays, details, now, now
  );
  const what = price.pricing === 'project' ? 'project rate' : `${price.quantity} ${price.job.unit === 'item' ? 'item' : 'hour'}${price.quantity === 1 ? '' : 's'}`;
  await G.post(game.id, 'request', req.user.id, `${req.user.display_name} is looking for a ${price.job.name} (${what}, ${G.fmt$(price.amount)}). Check the Job Board.`);
  res.json({ id });
});

app.post('/api/requests/:requestId/apply', auth, async (req, res) => {
  const { q, game } = await requestFor(req);
  if (req.user.role !== 'player') fail('Only artists can raise a hand', 403);
  if (q.user_id === req.user.id) fail("You can't apply to your own request");
  if (q.status !== 'open' || !(game.status === 'active' || (q.kind === 'label' && game.status === 'showcase'))) fail('This request is closed');
  const note = str(req.body?.note, 'Note', { max: 280 });
  await db.run('INSERT INTO job_applicants (request_id, user_id, note, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (request_id, user_id) DO UPDATE SET note = EXCLUDED.note', q.id, req.user.id, note, Date.now());
  await db.run('UPDATE job_requests SET updated_at = ? WHERE id = ?', Date.now(), q.id);
  res.json({ ok: true });
});

app.delete('/api/requests/:requestId/apply', auth, async (req, res) => {
  const { q } = await requestFor(req);
  const mine = await db.get('SELECT status FROM job_applicants WHERE request_id = ? AND user_id = ?', q.id, req.user.id);
  if (mine && mine.status !== 'applied') fail("You've been picked for this. Talk to a Record Owner if you can't do it.");
  await db.run('DELETE FROM job_applicants WHERE request_id = ? AND user_id = ?', q.id, req.user.id);
  res.json({ ok: true });
});

// The poster picks someone who raised a hand: it becomes a rate-sheet deal they've
// both agreed to, so it goes straight to the Record Owners for approval.
app.post('/api/requests/:requestId/hire', auth, async (req, res) => {
  const { q, game } = await requestFor(req);
  if (q.kind === 'label') fail('Label jobs are picked and paid by the Record Owners');
  if (q.user_id !== req.user.id) fail('Only the artist who posted this can pick someone', 403);
  if (q.status !== 'open') fail('This request is closed');
  const pick = int(req.body?.userId, 'Artist');
  if (!(await db.get('SELECT 1 FROM job_applicants WHERE request_id = ? AND user_id = ?', q.id, pick))) fail("That artist didn't raise a hand for this");
  const contractId = await tx(async () => {
    const cid = await G.createContract(game, req.user, {
      sellerId: pick, jobId: q.job_id, pricing: q.pricing, quantity: q.quantity, dueDays: q.due_days, terms: q.details,
    }, { acceptedBy: pick });
    await db.run("UPDATE job_requests SET status = 'filled', contract_id = ?, updated_at = ? WHERE id = ?", cid, Date.now(), q.id);
    return cid;
  });
  res.json({ ok: true, contractId });
});

// ---------- label jobs (owners post paid work from the rate sheet) ----------
// Volunteering in other classes and studio assistant work: owners post it, artists raise a
// hand, owners pick up to `spots` artists and pay each one when the work is done.
app.post('/api/games/:gameId/label-jobs', auth, ownerOnly, async (req, res) => {
  const game = await gameFor(req);
  if (!['active', 'showcase'].includes(game.status)) fail('Label jobs can be posted while the season is live or in the Showcase');
  const b = req.body || {};
  const item = R.findItem(R.sheetFor(game).payouts, String(b.payoutId || ''));
  if (!item || item.type === 'auto') fail('Pick a paid job from the rate sheet');
  let amount = item.amount; let quantity = null;
  if (item.type === 'per') { quantity = int(b.quantity, `Number of ${item.per}s`, { min: 1, max: 20 }); amount = item.amount * quantity; }
  else if (item.type === 'min') amount = int(b.amount, `${item.name} pay`, { min: item.amount, max: 100_000 });
  const spots = int(b.spots ?? 1, 'Artists needed', { min: 1, max: 10 });
  const whenText = str(b.whenText, 'When', { max: 100 });
  const details = str(b.details, 'Details', { max: 500 });
  const now = Date.now();
  const { id } = await db.run(
    "INSERT INTO job_requests (game_id, user_id, kind, job_id, pricing, quantity, payout_id, amount, spots, when_text, details, created_at, updated_at) VALUES (?, ?, 'label', ?, 'label', ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    game.id, req.user.id, item.id, quantity, item.id, amount, spots, whenText, details, now, now
  );
  await G.post(game.id, 'request', req.user.id, `The label is looking for ${spots === 1 ? 'an artist' : `${spots} artists`}: ${item.name}${whenText ? ` (${whenText})` : ''}, paying ${G.fmt$(amount)}${spots > 1 ? ' each' : ''}. Raise your hand on the Job Board.`);
  res.json({ id });
});

async function labelJobFor(req) {
  const r = await requestFor(req);
  if (r.q.kind !== 'label') fail("That isn't a label job");
  return r;
}

// Pick an artist who raised a hand (up to the number of spots).
app.post('/api/requests/:requestId/pick', auth, ownerOnly, async (req, res) => {
  const { q } = await labelJobFor(req);
  if (q.status !== 'open') fail('This job is closed');
  const uid = int(req.body?.userId, 'Artist');
  await tx(async () => {
    const a = await db.get('SELECT status FROM job_applicants WHERE request_id = ? AND user_id = ?', q.id, uid);
    if (!a) fail("That artist didn't raise a hand for this");
    if (a.status !== 'applied') fail('Already picked');
    const picked = (await db.get("SELECT COUNT(*) AS n FROM job_applicants WHERE request_id = ? AND status <> 'applied'", q.id)).n;
    if (picked >= q.spots) fail(`All ${q.spots} ${q.spots === 1 ? 'spot is' : 'spots are'} taken`);
    await db.run("UPDATE job_applicants SET status = 'picked' WHERE request_id = ? AND user_id = ?", q.id, uid);
    await db.run(`UPDATE job_requests SET updated_at = ?, status = CASE WHEN ? >= spots THEN 'filled' ELSE status END WHERE id = ?`, Date.now(), picked + 1, q.id);
  });
  res.json({ ok: true });
});

// Un-pick (before they're paid): the spot opens again.
app.post('/api/requests/:requestId/unpick', auth, ownerOnly, async (req, res) => {
  const { q } = await labelJobFor(req);
  const uid = int(req.body?.userId, 'Artist');
  const a = await db.get('SELECT status FROM job_applicants WHERE request_id = ? AND user_id = ?', q.id, uid);
  if (!a || a.status !== 'picked') fail('Only a picked artist who has not been paid can be removed');
  await db.run("UPDATE job_applicants SET status = 'applied' WHERE request_id = ? AND user_id = ?", q.id, uid);
  if (q.status === 'filled') await db.run("UPDATE job_requests SET status = 'open', updated_at = ? WHERE id = ?", Date.now(), q.id);
  else await db.run('UPDATE job_requests SET updated_at = ? WHERE id = ?', Date.now(), q.id);
  res.json({ ok: true });
});

// The work is done: pay the artist the job's amount (a label payment, so it can be undone).
app.post('/api/requests/:requestId/pay', auth, ownerOnly, async (req, res) => {
  const { q, game } = await labelJobFor(req);
  if (game.status === 'archived') fail('This season is archived');
  const uid = int(req.body?.userId, 'Artist');
  const item = R.findItem(R.sheetFor(game).payouts, q.payout_id);
  await tx(async () => {
    const a = await db.get('SELECT status FROM job_applicants WHERE request_id = ? AND user_id = ?', q.id, uid);
    if (!a || a.status !== 'picked') fail(a?.status === 'paid' ? 'Already paid' : 'Pick the artist first');
    const label = `${item?.name || 'Label job'}${q.when_text ? ` (${q.when_text})` : ''}`.slice(0, 140);
    await G.ledgerEntry(game.id, uid, Number(q.amount), 'grant', { memo: label, by: req.user.id });
    const entry = await db.get('SELECT id FROM ledger WHERE game_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1', game.id, uid);
    await db.run("UPDATE job_applicants SET status = 'paid', paid_entry = ? WHERE request_id = ? AND user_id = ?", entry.id, q.id, uid);
    await db.run('UPDATE job_requests SET updated_at = ? WHERE id = ?', Date.now(), q.id);
    await G.post(game.id, 'grant', req.user.id, `The label paid ${await G.nameOf(uid)} ${G.fmt$(q.amount)} for ${(item?.name || 'a label job').toLowerCase()}.`);
  });
  res.json({ ok: true });
});

app.post('/api/requests/:requestId/close', auth, async (req, res) => {
  const { q } = await requestFor(req);
  if (q.user_id !== req.user.id && req.user.role !== 'owner') fail('Only the artist who posted this or a Record Owner can close it', 403);
  if (q.status === 'open') await db.run("UPDATE job_requests SET status = 'closed', updated_at = ? WHERE id = ?", Date.now(), q.id);
  res.json({ ok: true });
});

// ---------- lobby controls (owners) ----------
app.put('/api/games/:gameId/lobby', auth, ownerOnly, async (req, res) => {
  const game = await gameFor(req);
  const lobby = LB.updatedLobby(game, req.body || {}, fail);
  await db.run('UPDATE games SET lobby = ? WHERE id = ?', JSON.stringify(lobby), game.id);
  res.json({ ok: true, lobby });
});

async function feedRow(req) {
  const f = await db.get('SELECT * FROM feed WHERE id = ?', int(req.params.feedId, 'Message'));
  if (!f) fail('That message is gone', 404);
  return f;
}

// Hide or show one lobby post for students, or pin it to the top.
app.post('/api/feed/:feedId/moderate', auth, ownerOnly, async (req, res) => {
  const f = await feedRow(req);
  const game = await G.getGame(f.game_id);
  const action = String(req.body.action || '');
  if (action === 'hide' || action === 'show') {
    await db.run('UPDATE feed SET hidden = ? WHERE id = ?', action === 'hide' ? 1 : 0, f.id);
  } else if (action === 'pin' || action === 'unpin') {
    const lobby = LB.updatedLobby(game, { pinned: action === 'pin' ? f.id : null }, fail);
    await db.run('UPDATE games SET lobby = ? WHERE id = ?', JSON.stringify(lobby), game.id);
  } else fail('Unknown action');
  SC.drop(game.id); // edits to old rows aren't picked up incrementally
  res.json({ ok: true });
});

// Delete one lobby post for good.
app.delete('/api/feed/:feedId', auth, ownerOnly, async (req, res) => {
  const f = await feedRow(req);
  const game = await G.getGame(f.game_id);
  await db.run('DELETE FROM feed WHERE id = ?', f.id);
  if (LB.lobbyOf(game).pinned === f.id) {
    await db.run('UPDATE games SET lobby = ? WHERE id = ?', JSON.stringify(LB.updatedLobby(game, { pinned: null }, fail)), game.id);
  }
  SC.drop(game.id);
  res.json({ ok: true });
});

// Delete every student chat message in a season (announcements and activity stay).
app.post('/api/games/:gameId/lobby/clear-chat', auth, ownerOnly, async (req, res) => {
  const game = await gameFor(req);
  const { changes } = await db.run("DELETE FROM feed WHERE game_id = ? AND kind = 'chat'", game.id);
  const lobby = LB.lobbyOf(game);
  if (lobby.pinned && !(await db.get('SELECT 1 FROM feed WHERE id = ?', lobby.pinned))) {
    await db.run('UPDATE games SET lobby = ? WHERE id = ?', JSON.stringify(LB.updatedLobby(game, { pinned: null }, fail)), game.id);
  }
  SC.drop(game.id);
  res.json({ ok: true, deleted: changes });
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
  if (!game.uploads_open || game.status === 'archived') fail("Music sharing isn't open yet. A Record Owner will open it.");
  const count = (await db.get('SELECT COUNT(*) AS n FROM tracks WHERE user_id = ? AND game_id = ?', req.user.id, game.id)).n;
  if (count >= MAX_TRACKS_PER_PLAYER) fail(`You can share up to ${MAX_TRACKS_PER_PLAYER} tracks a season`);
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
// Owners get everything. Artists get what the app already shows them: the public
// roster, lobby and Showcase, their own transactions, and the private details
// (terms, notes) only of deals they're part of. Other artists' fines stay private.
async function exportData(game, viewer) {
  const isOwner = viewer.role === 'owner';
  const users = await db.all("SELECT * FROM users WHERE role = 'player' AND game_id = ? ORDER BY id", game.id);
  const stats = new Map((await G.playerStats(game)).map((r) => [r.player.id, r]));
  const pub = G.PUBLIC_STATUSES.map(() => '?').join(',');
  const contracts = isOwner
    ? await db.all('SELECT * FROM contracts WHERE game_id = ? ORDER BY id', game.id)
    : (await db.all(`SELECT * FROM contracts WHERE game_id = ? AND (buyer_id = ? OR seller_id = ? OR status IN (${pub})) ORDER BY id`,
      game.id, viewer.id, viewer.id, ...G.PUBLIC_STATUSES))
      .map((c) => (c.buyer_id === viewer.id || c.seller_id === viewer.id ? c : { ...c, terms: '' }));
  const mine = new Set(contracts.filter((c) => isOwner || c.buyer_id === viewer.id || c.seller_id === viewer.id).map((c) => c.id));
  const events = (await db.all('SELECT e.* FROM contract_events e JOIN contracts c ON c.id = e.contract_id WHERE c.game_id = ? ORDER BY e.id', game.id))
    .filter((e) => mine.has(e.contract_id));
  return {
    exportedAt: new Date().toISOString(),
    game: (({ rate_sheet, ...g }) => ({ ...g, clock: G.clock(game) }))(game),
    rate_sheet: R.sheetFor(game),
    players: users.map((u) => {
      const s = stats.get(u.id);
      const row = {
        id: u.id, username: u.username, display_name: u.display_name, role_title: u.role_title, bio: u.bio, active: u.active,
        balance: s.stats.balance, escrow: s.stats.escrow, net_worth: s.stats.netWorth, earned: s.stats.earned, spent: s.stats.spent,
        deals_sold: s.stats.dealsSold, deals_bought: s.stats.dealsBought, rating: s.stats.rating, level: s.progress.level,
        xp: s.progress.xp, title: s.progress.title, tracks: s.stats.tracks, likes: s.stats.likes,
        badges: s.badges.map((b) => b.name).join('; '), profile_url: u.profile_url || '', joined_at: new Date(u.created_at).toISOString(),
      };
      if (isOwner) { row.pin = u.pin; row.claim_code = u.pin == null ? u.claim_code : null; }
      return row;
    }),
    ledger: isOwner
      ? await db.all('SELECT * FROM ledger WHERE game_id = ? ORDER BY id', game.id)
      : await db.all('SELECT * FROM ledger WHERE game_id = ? AND user_id = ? ORDER BY id', game.id, viewer.id),
    contracts,
    contract_events: events,
    feed: isOwner
      ? await db.all('SELECT * FROM feed WHERE game_id = ? ORDER BY id', game.id)
      : (await db.all('SELECT * FROM feed WHERE game_id = ? ORDER BY id', game.id)).filter((f) => LB.studentCanSee(f, LB.lobbyOf(game))).map(({ hidden, ...f }) => f),
    tracks: await db.all('SELECT t.*, (SELECT COUNT(*) FROM track_likes l WHERE l.track_id = t.id) AS likes FROM tracks t WHERE game_id = ? ORDER BY id', game.id),
    studio_bookings: isOwner
      ? await db.all('SELECT * FROM studio_bookings WHERE game_id = ? ORDER BY starts_at', game.id)
      : await db.all('SELECT * FROM studio_bookings WHERE game_id = ? AND user_id = ? ORDER BY starts_at', game.id, viewer.id),
    challenges: (await db.all('SELECT id, title, description, starts_at, ends_at, prizes, status, created_at FROM challenges WHERE game_id = ? ORDER BY id', game.id)),
    challenge_entries: (await db.all('SELECT e.*, c.status AS c_status, c.ends_at AS c_ends FROM challenge_entries e JOIN challenges c ON c.id = e.challenge_id WHERE c.game_id = ? ORDER BY e.challenge_id, e.created_at', game.id))
      .filter((x) => isOwner || x.user_id === viewer.id || x.c_status !== 'active' || Date.now() >= x.c_ends)
      .map(({ c_status, c_ends, ...x }) => x),
    job_requests: await db.all('SELECT id, kind, user_id, job_id, pricing, quantity, due_days, payout_id, amount, spots, when_text, details, status, contract_id, created_at FROM job_requests WHERE game_id = ? ORDER BY id', game.id),
  };
}

const slug = (s) => String(s).replace(/[^a-zA-Z0-9 _-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'untitled';

/** Remember when an owner last downloaded a season's full records (offloading needs a fresh one). */
async function markBackedUp(req, games) {
  if (req.user.role !== 'owner') return;
  for (const g of games) await db.run('UPDATE games SET backed_up_at = ? WHERE id = ?', Date.now(), g.id);
}

app.get('/api/games/:gameId/export.json', auth, async (req, res) => {
  const game = await gameFor(req);
  res.set('Content-Disposition', `attachment; filename="cardinal-records-${slug(game.name)}-${new Date().toISOString().slice(0, 10)}.json"`);
  const data = await exportData(game, req.user);
  await markBackedUp(req, [game]);
  res.json(data);
});

app.get('/api/games/:gameId/export.zip', auth, async (req, res) => {
  const game = await gameFor(req);
  const data = await exportData(game, req.user);
  await markBackedUp(req, [game]);
  const base = `cardinal-records-${slug(game.name)}-${new Date().toISOString().slice(0, 10)}`;
  res.set('Content-Type', 'application/zip');
  res.set('Content-Disposition', `attachment; filename="${base}.zip"`);
  const zip = new ZipWriter(res);
  zip.add(`${base}/data.json`, JSON.stringify(data, null, 2));
  for (const table of ['players', 'ledger', 'contracts', 'contract_events', 'feed', 'tracks']) {
    zip.add(`${base}/csv/${table}.csv`, toCsv(data[table]));
  }
  zip.finish();
});

// ---------- backups & offload (owners) ----------
// A printable PDF of the class records, for when the website is down.
async function sendBackupPdf(req, res, games, name) {
  if (!games.length) fail('There are no seasons to back up yet');
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.pdf"`);
  await writeBackupPdf(res, games, { pins: req.query.pins === '1', by: req.user.display_name, tz: String(req.query.tz || '') });
  await markBackedUp(req, games);
}

app.get('/api/games/:gameId/backup.pdf', auth, ownerOnly, async (req, res) => {
  const game = await gameFor(req);
  await sendBackupPdf(req, res, [game], `cardinal-records-${slug(game.name)}`);
});

// Grading report: the whole class, or one student with ?player=ID.
app.get('/api/games/:gameId/report.pdf', auth, ownerOnly, async (req, res) => {
  const game = await gameFor(req);
  let playerId = null; let who = 'class';
  if (req.query.player) {
    playerId = int(req.query.player, 'Artist');
    const p = await db.get("SELECT username FROM users WHERE id = ? AND role = 'player' AND game_id = ?", playerId, game.id);
    if (!p) fail('That artist is not on this roster', 404);
    who = p.username;
  }
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="grading-report-${slug(game.name)}-${slug(who)}-${new Date().toISOString().slice(0, 10)}.pdf"`);
  await writeReportPdf(res, game, { playerId, by: req.user.display_name, tz: String(req.query.tz || '') });
});

app.get('/api/backup.pdf', auth, ownerOnly, async (req, res) => {
  const games = [];
  for (const { id } of await db.all("SELECT id FROM games WHERE status != 'offloaded' ORDER BY created_at")) games.push(await G.getGame(id));
  await sendBackupPdf(req, res, games, 'cardinal-records-all-seasons');
});

/**
 * Delete a season's records and its artists (their usernames free up). Anyone who
 * still has records in another season is only signed out and detached.
 * Call inside tx(). Returns how many artists were deleted.
 */
async function purgeSeason(gameId) {
  await db.run('DELETE FROM contract_events WHERE contract_id IN (SELECT id FROM contracts WHERE game_id = ?)', gameId);
  await db.run('DELETE FROM contracts WHERE game_id = ?', gameId);
  await db.run('DELETE FROM ledger WHERE game_id = ?', gameId);
  await db.run('DELETE FROM feed WHERE game_id = ?', gameId);
  await db.run('DELETE FROM tracks WHERE game_id = ?', gameId);
  await db.run('DELETE FROM services WHERE game_id = ?', gameId);
  await db.run('DELETE FROM job_requests WHERE game_id = ?', gameId); // applicants go with them
  await db.run('DELETE FROM challenges WHERE game_id = ?', gameId); // entries go with them
  await db.run('DELETE FROM studio_bookings WHERE game_id = ?', gameId);
  const gone = await db.run(`DELETE FROM users u WHERE u.role = 'player' AND u.game_id = ?
    AND NOT EXISTS (SELECT 1 FROM ledger l WHERE l.user_id = u.id)
    AND NOT EXISTS (SELECT 1 FROM contracts c WHERE c.buyer_id = u.id OR c.seller_id = u.id)
    AND NOT EXISTS (SELECT 1 FROM tracks t WHERE t.user_id = u.id)
    AND NOT EXISTS (SELECT 1 FROM track_likes k WHERE k.user_id = u.id)
    AND NOT EXISTS (SELECT 1 FROM services s WHERE s.user_id = u.id)`, gameId);
  await db.run("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role = 'player' AND game_id = ?)", gameId);
  await db.run("UPDATE users SET game_id = NULL, active = 0 WHERE role = 'player' AND game_id = ?", gameId);
  return gone.changes;
}

// End of a season: clear its records off the database for a fresh start. Only an
// archived season that's been backed up since it was archived, and the owner must
// type its name. The season stays listed as a one-line record.
app.post('/api/games/:gameId/offload', auth, ownerOnly, async (req, res) => {
  const game = await gameFor(req);
  if (game.status !== 'archived') fail('Archive the season before offloading it');
  if (!game.backed_up_at || game.backed_up_at < (game.archived_at || 0)) fail('Download a backup of this season (PDF or ZIP) first. It has to be taken after the season was archived.');
  if (String(req.body.confirm || '').trim().toLowerCase() !== game.name.trim().toLowerCase()) fail("Type the season's name exactly to confirm");
  const stats = await G.playerStats(game);
  const done = (await db.get("SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS v FROM contracts WHERE game_id = ? AND status = 'completed'", game.id));
  const summary = {
    artists: stats.length,
    deals: done.n,
    dealValue: done.v,
    tracks: (await db.get('SELECT COUNT(*) AS n FROM tracks WHERE game_id = ?', game.id)).n,
    startedAt: game.started_at,
    endedAt: game.ended_at,
    backedUpAt: game.backed_up_at,
    offloadedBy: req.user.display_name,
  };
  const freed = await tx(async () => {
    const gone = await purgeSeason(game.id);
    await db.run("UPDATE games SET status = 'offloaded', uploads_open = 0, offloaded_at = ?, summary = ? WHERE id = ?", Date.now(), JSON.stringify(summary), game.id);
    return gone;
  });
  SC.drop(game.id);
  res.json({ ok: true, artistsRemoved: freed });
});

// Remove a season entirely: an offloaded season's one-line record, or a season that
// was never started (a test or a mistake; typing its name confirms). A season that
// has been played goes through archive, backup and offload first.
app.delete('/api/games/:gameId', auth, ownerOnly, async (req, res) => {
  const game = await gameFor(req, { offloaded: true });
  if (!['offloaded', 'setup'].includes(game.status)) fail('This season has been played. Archive it, download a backup and offload it first.');
  if (game.status === 'setup' && String(req.body?.confirm || '').trim().toLowerCase() !== game.name.trim().toLowerCase()) fail("Type the season's name exactly to confirm");
  const removed = await tx(async () => {
    const n = game.status === 'setup' ? await purgeSeason(game.id) : 0;
    await db.run('DELETE FROM games WHERE id = ?', game.id);
    return n;
  });
  SC.drop(game.id);
  res.json({ ok: true, artistsRemoved: removed });
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
  // Artists signed before sign-up codes existed get one now.
  for (const { id } of await db.all("SELECT id FROM users WHERE role = 'player' AND pin IS NULL AND claim_code IS NULL")) {
    await db.run('UPDATE users SET claim_code = ? WHERE id = ? AND claim_code IS NULL', G.newClaimCode(), id);
  }
  app.listen(PORT, () => console.log(`Cardinal Records is live on http://localhost:${PORT}`));
})().catch((err) => {
  console.error('[startup] Could not connect to Postgres:', err.message);
  process.exit(1);
});

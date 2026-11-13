'use strict';
// Shared, incrementally-updated copy of each season's state.
//
// Every open browser refreshes the label every 10 seconds. Reading the whole
// season from Postgres for each of them would use up Neon's free 5 GB/month of
// data transfer within weeks. Instead:
//   - a revision number goes up on every change (any successful write request);
//     browsers ask /api/rev first and only load the state when it moved;
//   - the server keeps one copy of each season and, when the revision moves,
//     only fetches the rows that are new or changed. Ledger, contract events
//     and feed are append-only; contracts carry updated_at.
// So 30 students cost about the same database traffic as one.
const crypto = require('node:crypto');
const { db } = require('./db');
const G = require('./game');

const BOOT = crypto.randomBytes(4).toString('hex'); // a restart makes every browser reload
let REV = 0;
const bump = () => { REV += 1; };
const rev = () => `${BOOT}.${REV}`;

// Rows inserted in a transaction that commits a moment after a later one can
// land with a slightly lower id, so each refresh looks back a little and dedupes.
const LOOKBACK = 50;
const FEED_KEEP = 150;
const cache = new Map(); // gameId -> entry
const pending = new Map(); // gameId -> Promise, so simultaneous polls share one refresh
const generation = new Map(); // gameId -> number, bumped by drop() so an in-flight refresh can't put back stale rows

function fresh(gameId) {
  return {
    gameId, rev: -1, status: null,
    contracts: new Map(), contractsSince: 0,
    events: new Map(), eventsMax: 0,
    ledger: new Map(), ledgerMax: 0,
    feed: new Map(), feedMax: 0,
  };
}

async function refresh(game) {
  const gen = generation.get(game.id) || 0;
  let e = cache.get(game.id);
  // A change of phase can mean deleted rows (offload) or wrapped clocks: start over.
  if (!e || e.status !== game.status) e = fresh(game.id);
  const at = REV;
  const gid = game.id;

  for (const c of await db.all('SELECT * FROM contracts WHERE game_id = ? AND updated_at >= ?', gid, Math.max(0, e.contractsSince - 5000))) {
    e.contracts.set(c.id, c);
    if (c.updated_at > e.contractsSince) e.contractsSince = c.updated_at;
  }
  for (const ev of await db.all(
    'SELECT e.* FROM contract_events e JOIN contracts c ON c.id = e.contract_id WHERE c.game_id = ? AND e.id > ? ORDER BY e.id', gid, Math.max(0, e.eventsMax - LOOKBACK)
  )) {
    const list = e.events.get(ev.contract_id) || [];
    if (!list.some((x) => x.id === ev.id)) { list.push(ev); list.sort((a, b) => a.created_at - b.created_at || a.id - b.id); }
    e.events.set(ev.contract_id, list);
    if (ev.id > e.eventsMax) e.eventsMax = ev.id;
  }
  for (const l of await db.all('SELECT * FROM ledger WHERE game_id = ? AND id > ? ORDER BY id', gid, Math.max(0, e.ledgerMax - LOOKBACK))) {
    e.ledger.set(l.id, l);
    if (l.id > e.ledgerMax) e.ledgerMax = l.id;
  }
  const feedRows = e.feedMax
    ? await db.all('SELECT * FROM feed WHERE game_id = ? AND id > ? ORDER BY id', gid, Math.max(0, e.feedMax - LOOKBACK))
    : (await db.all('SELECT * FROM feed WHERE game_id = ? ORDER BY created_at DESC, id DESC LIMIT ?', gid, FEED_KEEP));
  for (const f of feedRows) { e.feed.set(f.id, f); if (f.id > e.feedMax) e.feedMax = f.id; }
  if (e.feed.size > FEED_KEEP * 2) {
    const keep = [...e.feed.values()].sort((a, b) => b.created_at - a.created_at || b.id - a.id).slice(0, FEED_KEEP);
    e.feed = new Map(keep.map((f) => [f.id, f]));
  }

  // Small tables and aggregates: re-read whole (a few KB).
  e.stats = await G.playerStats(game);
  e.tracks = await db.all(
    'SELECT t.*, (SELECT COUNT(*) FROM track_likes l WHERE l.track_id = t.id) AS likes FROM tracks t WHERE game_id = ? ORDER BY created_at DESC', gid
  );
  e.likes = await db.all('SELECT l.track_id, l.user_id FROM track_likes l JOIN tracks t ON t.id = l.track_id WHERE t.game_id = ?', gid);
  // Job board: open requests plus the last few filled/closed ones, and who raised a hand.
  e.requests = await db.all(
    "SELECT * FROM job_requests WHERE game_id = ? AND (status = 'open' OR updated_at > ?) ORDER BY created_at DESC LIMIT 100", gid, Date.now() - 14 * 86_400_000
  );
  e.applicants = e.requests.length
    ? await db.all(`SELECT * FROM job_applicants WHERE request_id IN (${e.requests.map(() => '?').join(',')}) ORDER BY created_at`, ...e.requests.map((r) => r.id))
    : [];
  e.owners = (await db.all("SELECT id, display_name, color FROM users WHERE role = 'owner'"))
    .map((o) => ({ id: o.id, displayName: o.display_name, color: o.color }));
  e.former = (await db.all(
    `SELECT id, display_name, color FROM users WHERE role = 'player' AND game_id IS DISTINCT FROM ? AND id IN (
       SELECT user_id FROM ledger WHERE game_id = ? UNION SELECT buyer_id FROM contracts WHERE game_id = ? UNION SELECT seller_id FROM contracts WHERE game_id = ?)`,
    gid, gid, gid, gid
  )).map((u) => ({ id: u.id, displayName: u.display_name, color: u.color, former: true }));

  e.rev = at;
  e.status = game.status;
  // Dropped while this ran (a message was hidden/deleted): don't keep it, read again from scratch.
  if ((generation.get(gid) || 0) !== gen) { cache.delete(gid); return refresh(game); }
  cache.set(gid, e);
  return e;
}

/** The season's shared data, refreshed if anything changed since it was read. */
async function entryFor(game) {
  const e = cache.get(game.id);
  if (e && e.rev === REV && e.status === game.status) return e;
  if (!pending.has(game.id)) {
    pending.set(game.id, refresh(game).finally(() => pending.delete(game.id)));
  }
  const got = await pending.get(game.id);
  // A write landed while that refresh ran: read again so the caller sees it.
  return got.rev === REV ? got : refresh(game);
}

/** Forget a season's copy (after edits to old rows: hidden or deleted messages, offload). */
const drop = (gameId) => { generation.set(gameId, (generation.get(gameId) || 0) + 1); cache.delete(gameId); };

module.exports = { bump, rev, entryFor, drop };

'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const pg = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Run `neon deploy` (or `neon env pull`) to write it to .env.local.');
}

// COUNT/SUM/AVG come back as int8/numeric, which pg returns as strings. Every value
// here (cents-free money, ms timestamps, counts) fits in a JS number.
pg.types.setTypeParser(pg.types.builtins.INT8, Number);
pg.types.setTypeParser(pg.types.builtins.NUMERIC, Number);

// One pool for the whole long-running server. Use Neon's pooled (-pooler) DATABASE_URL.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.PG_POOL_MAX) || 10 });
pool.on('error', (err) => console.error('[db] idle client error', err));

const SCHEMA = `
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS games (
  id               SERIAL  PRIMARY KEY,
  name             TEXT    NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'setup',   -- setup | active | showcase | archived
  duration_days    INTEGER NOT NULL,
  starting_balance INTEGER NOT NULL DEFAULT 0,
  label_cut_pct    INTEGER NOT NULL DEFAULT 10,
  max_players      INTEGER NOT NULL DEFAULT 30,
  started_at       BIGINT,
  ended_at         BIGINT,
  created_by       INTEGER,
  created_at       BIGINT  NOT NULL,
  uploads_open     INTEGER NOT NULL DEFAULT 0          -- Record Owners switch music uploads on and off
);

CREATE TABLE IF NOT EXISTS users (
  id           SERIAL  PRIMARY KEY,
  username     CITEXT  NOT NULL UNIQUE,                -- case-insensitive, like SQLite's COLLATE NOCASE
  pin          TEXT,                                   -- NULL until the player claims the account
  role         TEXT    NOT NULL CHECK (role IN ('owner', 'player')),
  game_id      INTEGER REFERENCES games(id),
  display_name TEXT    NOT NULL,
  role_title   TEXT    NOT NULL DEFAULT '',
  bio          TEXT    NOT NULL DEFAULT '',
  color        TEXT,
  active       INTEGER NOT NULL DEFAULT 1,
  tutorial     TEXT    NOT NULL DEFAULT '{}',
  created_at   BIGINT  NOT NULL,
  last_seen    BIGINT
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT  NOT NULL
);

-- Every money movement. user_id NULL = the label vault (label cut on completed deals).
CREATE TABLE IF NOT EXISTS ledger (
  id          SERIAL  PRIMARY KEY,
  game_id     INTEGER NOT NULL REFERENCES games(id),
  user_id     INTEGER REFERENCES users(id),
  amount      BIGINT  NOT NULL,
  kind        TEXT    NOT NULL,   -- advance | grant | fine | escrow_hold | escrow_refund | payment | label_fee
  contract_id INTEGER,
  memo        TEXT    NOT NULL DEFAULT '',
  created_by  INTEGER,
  created_at  BIGINT  NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
  id              SERIAL  PRIMARY KEY,
  game_id         INTEGER NOT NULL REFERENCES games(id),
  user_id         INTEGER NOT NULL REFERENCES users(id),
  title           TEXT    NOT NULL,
  description     TEXT    NOT NULL DEFAULT '',
  category        TEXT    NOT NULL DEFAULT 'Other',
  price           BIGINT  NOT NULL,
  turnaround_days INTEGER NOT NULL DEFAULT 7,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      BIGINT  NOT NULL
);

-- offered -> (countered) -> review -> active -> delivered -> completed
-- side exits: declined, rejected, cancelled
CREATE TABLE IF NOT EXISTS contracts (
  id           SERIAL  PRIMARY KEY,
  game_id      INTEGER NOT NULL REFERENCES games(id),
  buyer_id     INTEGER NOT NULL REFERENCES users(id),
  seller_id    INTEGER NOT NULL REFERENCES users(id),
  service_id   INTEGER REFERENCES services(id),
  title        TEXT    NOT NULL,
  terms        TEXT    NOT NULL DEFAULT '',
  amount       BIGINT  NOT NULL,
  escrow       BIGINT  NOT NULL DEFAULT 0,
  due_days     INTEGER,
  status       TEXT    NOT NULL,
  rating       INTEGER,
  created_at   BIGINT  NOT NULL,
  updated_at   BIGINT  NOT NULL,
  approved_at  BIGINT,
  completed_at BIGINT
);

CREATE TABLE IF NOT EXISTS contract_events (
  id          SERIAL  PRIMARY KEY,
  contract_id INTEGER NOT NULL REFERENCES contracts(id),
  actor_id    INTEGER,
  action      TEXT    NOT NULL,
  note        TEXT    NOT NULL DEFAULT '',
  amount      BIGINT,
  created_at  BIGINT  NOT NULL
);

CREATE TABLE IF NOT EXISTS feed (
  id         SERIAL  PRIMARY KEY,
  game_id    INTEGER NOT NULL REFERENCES games(id),
  kind       TEXT    NOT NULL,
  actor_id   INTEGER,
  message    TEXT    NOT NULL,
  created_at BIGINT  NOT NULL
);

CREATE TABLE IF NOT EXISTS tracks (
  id          SERIAL  PRIMARY KEY,
  game_id     INTEGER NOT NULL REFERENCES games(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  title       TEXT    NOT NULL,
  genre       TEXT    NOT NULL DEFAULT '',
  description TEXT    NOT NULL DEFAULT '',
  credits     TEXT    NOT NULL DEFAULT '',
  url         TEXT    NOT NULL,                       -- Spotify, SoundCloud, YouTube… (http/https only)
  plays       INTEGER NOT NULL DEFAULT 0,
  created_at  BIGINT  NOT NULL
);

CREATE TABLE IF NOT EXISTS track_likes (
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  user_id  INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (track_id, user_id)
);

-- Tracks used to be uploaded audio files; now they're links to a streaming site.
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS url TEXT NOT NULL DEFAULT '';
ALTER TABLE tracks ALTER COLUMN url DROP DEFAULT;
ALTER TABLE tracks DROP COLUMN IF EXISTS filename, DROP COLUMN IF EXISTS mime, DROP COLUMN IF EXISTS size;

-- Rate sheet: owner changes to the default amounts, per season (JSON).
ALTER TABLE games ADD COLUMN IF NOT EXISTS rate_sheet TEXT NOT NULL DEFAULT '{}';
-- Contracts are priced from the rate sheet: a job, hourly/per-item or project pricing.
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS job_id TEXT,
  ADD COLUMN IF NOT EXISTS pricing TEXT,      -- unit | project
  ADD COLUMN IF NOT EXISTS quantity INTEGER,  -- hours/class blocks or items, for unit pricing
  ADD COLUMN IF NOT EXISTS unit_rate BIGINT;  -- the rate in effect when the deal was made

-- Backups and end-of-season offload. status can also be 'offloaded': the season's
-- records were deleted after a backup, leaving this row and a small JSON summary.
-- Undo: a reversal is a new ledger row pointing at the entry it cancels (the ledger stays append-only).
ALTER TABLE ledger ADD COLUMN IF NOT EXISTS reverses INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_reverses ON ledger(reverses) WHERE reverses IS NOT NULL;

-- Studio time: students request a session (day, start, length, what for, who's coming);
-- Record Owners approve or decline it, and can mark a no-show (rate sheet fee).
CREATE TABLE IF NOT EXISTS studio_bookings (
  id          SERIAL  PRIMARY KEY,
  game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL,
  starts_at   BIGINT  NOT NULL,
  minutes     INTEGER NOT NULL,
  purpose     TEXT    NOT NULL DEFAULT '',
  guests      TEXT    NOT NULL DEFAULT '',
  status      TEXT    NOT NULL DEFAULT 'pending',  -- pending | approved | declined | cancelled | noshow
  owner_note  TEXT    NOT NULL DEFAULT '',
  decided_by  INTEGER,
  decided_at  BIGINT,
  created_at  BIGINT  NOT NULL,
  updated_at  BIGINT  NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_studio_game ON studio_bookings(game_id, starts_at);

-- Release Guide: hidden from students until a Record Owner opens it (per season).
ALTER TABLE games ADD COLUMN IF NOT EXISTS guide_open INTEGER NOT NULL DEFAULT 0;

-- Studio challenges: owners set a challenge for any date range (from / to) with prizes;
-- artists submit a link while it's open; owners pick 1st-3rd and prizes pay out.
CREATE TABLE IF NOT EXISTS challenges (
  id          SERIAL  PRIMARY KEY,
  game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  starts_at   BIGINT  NOT NULL,
  ends_at     BIGINT  NOT NULL,
  prizes      TEXT    NOT NULL DEFAULT '[]',     -- JSON [1st, 2nd, 3rd]
  status      TEXT    NOT NULL DEFAULT 'active', -- active | judged | cancelled
  created_by  INTEGER,
  created_at  BIGINT  NOT NULL,
  updated_at  BIGINT  NOT NULL
);
CREATE TABLE IF NOT EXISTS challenge_entries (
  challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL,
  url          TEXT    NOT NULL,
  note         TEXT    NOT NULL DEFAULT '',
  place        INTEGER,                         -- 1, 2, 3 once judged
  created_at   BIGINT  NOT NULL,
  updated_at   BIGINT  NOT NULL,
  PRIMARY KEY (challenge_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_challenges_game ON challenges(game_id);

-- Job board: an artist posts what they need; labelmates raise a hand; the poster picks one
-- and it becomes a normal rate-sheet deal. user ids aren't foreign keys so offloading a
-- season can delete its artists; rows go when their season or request does.
CREATE TABLE IF NOT EXISTS job_requests (
  id          SERIAL  PRIMARY KEY,
  game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL,
  job_id      TEXT    NOT NULL,
  pricing     TEXT    NOT NULL,
  quantity    INTEGER,
  due_days    INTEGER,
  details     TEXT    NOT NULL DEFAULT '',
  status      TEXT    NOT NULL DEFAULT 'open',   -- open | filled | closed
  contract_id INTEGER,
  created_at  BIGINT  NOT NULL,
  updated_at  BIGINT  NOT NULL
);
CREATE TABLE IF NOT EXISTS job_applicants (
  request_id INTEGER NOT NULL REFERENCES job_requests(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL,
  note       TEXT    NOT NULL DEFAULT '',
  created_at BIGINT  NOT NULL,
  PRIMARY KEY (request_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_requests_game ON job_requests(game_id, status);
-- Label jobs: Record Owners post paid work from the rate sheet (volunteering, studio assistant).
-- kind 'label' rows use payout_id/amount/spots/when_text; picked artists are paid when the work is done.
ALTER TABLE job_requests ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'artist',
  ADD COLUMN IF NOT EXISTS payout_id TEXT,
  ADD COLUMN IF NOT EXISTS amount BIGINT,
  ADD COLUMN IF NOT EXISTS spots INTEGER,
  ADD COLUMN IF NOT EXISTS when_text TEXT NOT NULL DEFAULT '';
ALTER TABLE job_applicants ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'applied', -- applied | picked | paid
  ADD COLUMN IF NOT EXISTS paid_entry INTEGER;

-- Artist profile: a link to a Google Slides/Docs page showing what the artist is good at.
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_url TEXT;

-- Lobby controls: hidden messages, per-season lobby settings (JSON, see src/lobby.js), muted artists.
ALTER TABLE feed ADD COLUMN IF NOT EXISTS hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN IF NOT EXISTS lobby TEXT NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS muted INTEGER NOT NULL DEFAULT 0;

-- One-time sign-up code a new artist needs (with their username) to pick their PIN.
-- Cleared once they've claimed the account; a PIN reset issues a new one.
ALTER TABLE users ADD COLUMN IF NOT EXISTS claim_code TEXT;

ALTER TABLE games ADD COLUMN IF NOT EXISTS archived_at BIGINT,
  ADD COLUMN IF NOT EXISTS backed_up_at BIGINT,
  ADD COLUMN IF NOT EXISTS offloaded_at BIGINT,
  ADD COLUMN IF NOT EXISTS summary TEXT;

CREATE INDEX IF NOT EXISTS idx_ledger_game     ON ledger(game_id, user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_user     ON ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_contracts_game  ON contracts(game_id, status);
CREATE INDEX IF NOT EXISTS idx_feed_game       ON feed(game_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_contract ON contract_events(contract_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user   ON sessions(user_id);
`;

// Statements inside tx() run on that transaction's client; everything else uses the pool.
const txClient = new AsyncLocalStorage();

/** The app's SQL uses `?` placeholders; Postgres wants $1, $2, ... */
const toPg = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };
const query = (sql, params) => (txClient.getStore() || pool).query(toPg(sql), params);

const db = {
  /** First row or undefined. */
  get: async (sql, ...params) => (await query(sql, params)).rows[0],
  all: async (sql, ...params) => (await query(sql, params)).rows,
  /** Returns { changes, id } where id comes from a `RETURNING id` clause. */
  run: async (sql, ...params) => {
    const r = await query(sql, params);
    return { changes: r.rowCount, id: r.rows[0]?.id };
  },
};

// Every write transaction takes this lock, so money moves stay serialized the way
// SQLite's BEGIN IMMEDIATE kept them (balance checks can't race each other).
const WRITE_LOCK = 0x43524543; // "CREC"

/** Run async fn inside a transaction; rolls back on throw. */
async function tx(fn) {
  if (txClient.getStore()) return fn();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [WRITE_LOCK]);
    const result = await txClient.run(client, fn);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Create tables on first boot. Safe to run from several instances at once.
 * Schema changes go over the direct (unpooled) connection when one is configured.
 */
async function migrate() {
  const direct = process.env.DATABASE_URL_UNPOOLED && new pg.Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
  const client = direct || (await pool.connect());
  try {
    if (direct) await direct.connect();
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [WRITE_LOCK]);
    await client.query(SCHEMA);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (direct) await direct.end().catch(() => {});
    else client.release();
  }
}

module.exports = { db, tx, migrate, pool };

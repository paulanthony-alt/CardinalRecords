'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { AsyncLocalStorage } = require('node:async_hooks');
const pg = require('pg');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

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
  filename    TEXT    NOT NULL,
  mime        TEXT    NOT NULL,
  size        INTEGER NOT NULL,
  plays       INTEGER NOT NULL DEFAULT 0,
  created_at  BIGINT  NOT NULL
);

CREATE TABLE IF NOT EXISTS track_likes (
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  user_id  INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (track_id, user_id)
);

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

/** Create tables on first boot. Safe to run from several instances at once. */
async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [WRITE_LOCK]);
    await client.query(SCHEMA);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { db, tx, migrate, pool, DATA_DIR, UPLOAD_DIR };

'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'cardinal.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS games (
  id               INTEGER PRIMARY KEY,
  name             TEXT    NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'setup',   -- setup | active | showcase | archived
  duration_days    INTEGER NOT NULL,
  starting_balance INTEGER NOT NULL DEFAULT 0,
  label_cut_pct    INTEGER NOT NULL DEFAULT 10,
  max_players      INTEGER NOT NULL DEFAULT 30,
  started_at       INTEGER,
  ended_at         INTEGER,
  created_by       INTEGER,
  created_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY,
  username     TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  pin          TEXT,                                   -- NULL until the player claims the account
  role         TEXT    NOT NULL CHECK (role IN ('owner', 'player')),
  game_id      INTEGER REFERENCES games(id),
  display_name TEXT    NOT NULL,
  role_title   TEXT    NOT NULL DEFAULT '',
  bio          TEXT    NOT NULL DEFAULT '',
  color        TEXT,
  active       INTEGER NOT NULL DEFAULT 1,
  tutorial     TEXT    NOT NULL DEFAULT '{}',
  created_at   INTEGER NOT NULL,
  last_seen    INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

-- Every money movement. user_id NULL = the label vault (label cut on completed deals).
CREATE TABLE IF NOT EXISTS ledger (
  id          INTEGER PRIMARY KEY,
  game_id     INTEGER NOT NULL REFERENCES games(id),
  user_id     INTEGER REFERENCES users(id),
  amount      INTEGER NOT NULL,
  kind        TEXT    NOT NULL,   -- advance | grant | fine | escrow_hold | escrow_refund | payment | label_fee
  contract_id INTEGER,
  memo        TEXT    NOT NULL DEFAULT '',
  created_by  INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
  id              INTEGER PRIMARY KEY,
  game_id         INTEGER NOT NULL REFERENCES games(id),
  user_id         INTEGER NOT NULL REFERENCES users(id),
  title           TEXT    NOT NULL,
  description     TEXT    NOT NULL DEFAULT '',
  category        TEXT    NOT NULL DEFAULT 'Other',
  price           INTEGER NOT NULL,
  turnaround_days INTEGER NOT NULL DEFAULT 7,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL
);

-- offered -> (countered) -> review -> active -> delivered -> completed
-- side exits: declined, rejected, cancelled
CREATE TABLE IF NOT EXISTS contracts (
  id           INTEGER PRIMARY KEY,
  game_id      INTEGER NOT NULL REFERENCES games(id),
  buyer_id     INTEGER NOT NULL REFERENCES users(id),
  seller_id    INTEGER NOT NULL REFERENCES users(id),
  service_id   INTEGER REFERENCES services(id),
  title        TEXT    NOT NULL,
  terms        TEXT    NOT NULL DEFAULT '',
  amount       INTEGER NOT NULL,
  escrow       INTEGER NOT NULL DEFAULT 0,
  due_days     INTEGER,
  status       TEXT    NOT NULL,
  rating       INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  approved_at  INTEGER,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS contract_events (
  id          INTEGER PRIMARY KEY,
  contract_id INTEGER NOT NULL REFERENCES contracts(id),
  actor_id    INTEGER,
  action      TEXT    NOT NULL,
  note        TEXT    NOT NULL DEFAULT '',
  amount      INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS feed (
  id         INTEGER PRIMARY KEY,
  game_id    INTEGER NOT NULL REFERENCES games(id),
  kind       TEXT    NOT NULL,
  actor_id   INTEGER,
  message    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tracks (
  id          INTEGER PRIMARY KEY,
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
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS track_likes (
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  user_id  INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (track_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ledger_game     ON ledger(game_id, user_id);
CREATE INDEX IF NOT EXISTS idx_contracts_game  ON contracts(game_id, status);
CREATE INDEX IF NOT EXISTS idx_feed_game       ON feed(game_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_contract ON contract_events(contract_id);
`);

// Columns added after the first release. Each runs once on an existing database.
const migrations = [
  ['games', 'uploads_open', 'INTEGER NOT NULL DEFAULT 0'], // Record Owners switch music uploads on and off
];
for (const [table, column, def] of migrations) {
  const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
}

/** Run fn inside a transaction; rolls back on throw. */
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { db, tx, DATA_DIR, UPLOAD_DIR };

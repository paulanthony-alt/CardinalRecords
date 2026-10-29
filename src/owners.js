'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { db } = require('./db');

/**
 * Record Owner (admin) accounts come from, in order of precedence:
 *   1. OWNER_ACCOUNTS env var: JSON array, or "username:pin:Display Name,username2:pin2"
 *   2. owners.json in the project root (see owners.example.json)
 * Owners are created on first boot only. After that, an owner's PIN is theirs
 * to change in the app; restarting never overwrites it.
 */
function readOwnerConfig() {
  const env = process.env.OWNER_ACCOUNTS;
  if (env) {
    const trimmed = env.trim();
    if (trimmed.startsWith('[')) return JSON.parse(trimmed);
    return trimmed.split(',').map((entry) => {
      const [username, pin, displayName] = entry.split(':').map((s) => s && s.trim());
      return { username, pin, displayName };
    });
  }
  const file = path.join(__dirname, '..', 'owners.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  return [];
}

function loadOwners() {
  let owners = readOwnerConfig();
  const existingOwners = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner'").get().n;

  if (!owners.length && !existingOwners) {
    owners = [{ username: 'owner', pin: '0000', displayName: 'Record Owner' }];
    console.warn('[owners] No owner accounts configured. Created default owner "owner" / PIN 0000. CHANGE IT.');
  }

  const find = db.prepare('SELECT id, role FROM users WHERE username = ?');
  const insert = db.prepare(
    "INSERT INTO users (username, pin, role, display_name, role_title, color, created_at) VALUES (?, ?, 'owner', ?, 'Record Owner', '#C8102E', ?)"
  );
  for (const o of owners) {
    if (!o || !o.username) continue;
    if (!/^\d{4,6}$/.test(String(o.pin || ''))) {
      console.warn(`[owners] Skipping "${o.username}": PIN must be 4-6 digits.`);
      continue;
    }
    const existing = find.get(o.username);
    if (existing) {
      if (existing.role !== 'owner') console.warn(`[owners] "${o.username}" already exists as a player; skipped.`);
      continue;
    }
    insert.run(o.username, String(o.pin), o.displayName || o.username, Date.now());
    console.log(`[owners] Created Record Owner "${o.username}".`);
  }
}

module.exports = { loadOwners };

'use strict';
// Lobby controls: Record Owners decide how chat works and which kinds of lobby
// posts students can see. Stored per season as JSON in games.lobby.
//
//   chat: 'open'      students can chat
//         'announce'  students can read; only owners post
//         'off'       the lobby is hidden from students
//   show: { <category>: false } hides that category from students
//   pinned: feed id shown at the top of the lobby, or null
// Owners always see everything, including hidden messages (marked as hidden).

const CATEGORIES = [
  // id, label, the feed kinds it covers
  ['chat', 'Student chat messages', ['chat']],
  ['announcement', 'Record Owner announcements', ['announcement']],
  ['deal', 'Deals signed and approved', ['deal', 'service']],
  ['paid', 'Deals delivered and paid out', ['paid']],
  ['grant', 'Label payments and Game Bonuses', ['grant']],
  ['join', 'New artists joining', ['join']],
  ['track', 'Music shared to the Showcase', ['track']],
  ['release', 'Release Guide finished', ['release']],
  ['phase', 'Season updates (start, end, music sharing)', ['phase']],
];
const CATEGORY_OF = new Map(CATEGORIES.flatMap(([id, , kinds]) => kinds.map((k) => [k, id])));
const CHAT_MODES = ['open', 'announce', 'off'];

function lobbyOf(game) {
  let o = {};
  try { o = JSON.parse(game.lobby || '{}') || {}; } catch {}
  const show = {};
  for (const [id] of CATEGORIES) show[id] = o.show?.[id] !== false;
  return { chat: CHAT_MODES.includes(o.chat) ? o.chat : 'open', show, pinned: Number.isInteger(o.pinned) ? o.pinned : null };
}

/** Can a student see this feed row? (Owners see everything.) */
function studentCanSee(row, lobby) {
  if (lobby.chat === 'off' || row.hidden) return false;
  const cat = CATEGORY_OF.get(row.kind);
  return cat ? lobby.show[cat] : true;
}

/** Merge an owner's changes into the stored settings. */
function updatedLobby(game, body, fail) {
  const cur = lobbyOf(game);
  if (body.chat != null) {
    if (!CHAT_MODES.includes(body.chat)) fail('Pick a chat setting');
    cur.chat = body.chat;
  }
  if (body.show && typeof body.show === 'object') {
    for (const [id] of CATEGORIES) if (id in body.show) cur.show[id] = !!body.show[id];
  }
  if ('pinned' in body) cur.pinned = Number.isInteger(body.pinned) ? body.pinned : null;
  return cur;
}

module.exports = { CATEGORIES: CATEGORIES.map(([id, label]) => ({ id, label })), CHAT_MODES, lobbyOf, studentCanSee, updatedLobby };

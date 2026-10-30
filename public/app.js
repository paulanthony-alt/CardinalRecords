'use strict';
/* Cardinal Records client: a dependency-free single-page app. */

// ============================================================ helpers
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(Number(n) || 0).toLocaleString('en-US');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const cno = (id) => 'CR-' + String(id).padStart(4, '0');
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
const dateStr = (ts) => new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
function hash(str) { let h = 2166136261; for (const c of String(str)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

const ICONS = {
  home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  bag: '<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  chart: '<path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  map: '<path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z"/><path d="M8 2v16"/><path d="M16 6v16"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  pause: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
  next: '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>',
  prev: '<polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/>',
  heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  dollar: '<path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  award: '<circle cx="12" cy="8" r="7"/><path d="M8.21 13.89L7 23l5-3 5 3-1.21-9.12"/>',
  menu: '<path d="M3 12h18M3 6h18M3 18h18"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  vault: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  bulb: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
  refresh: '<path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
};
const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;

// ============================================================ state
const S = {
  user: null,
  games: [],
  gameId: null,
  state: null,
  stateKey: '',
  login: freshLogin(),
  ui: { marketCat: 'All', marketQ: '', contractTab: 'action', consoleTab: 'review', reveal: new Set(), guideStep: null, chartTab: 'worth' },
};
function freshLogin() { return { step: 'user', username: '', info: null, pin: '', firstPin: '', error: '' }; }

const isOwner = () => S.user?.role === 'owner';
const game = () => S.state?.game;
const me = () => S.state?.roster.find((p) => p.id === S.user.id);
const person = (id) => S.state?.roster.find((p) => p.id === id) || S.state?.owners.find((o) => o.id === id);
const nameOf = (id) => (id == null ? 'The Label' : person(id)?.displayName || 'Unknown');
const activeRoster = () => S.state.roster.filter((p) => p.active);
const online = (p) => p?.lastSeen && Date.now() - p.lastSeen < 5 * 60_000;
const live = () => game()?.status === 'active';
// Music lives on streaming sites; name the platform from the link's host.
const PLATFORMS = [
  [/(^|\.)spotify\.com$/, 'Spotify'], [/(^|\.)soundcloud\.com$/, 'SoundCloud'], [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube'],
  [/(^|\.)music\.apple\.com$/, 'Apple Music'], [/(^|\.)bandcamp\.com$/, 'Bandcamp'], [/(^|\.)audiomack\.com$/, 'Audiomack'],
  [/(^|\.)tidal\.com$/, 'Tidal'], [/(^|\.)deezer\.com$/, 'Deezer'], [/(^|\.)music\.amazon\./, 'Amazon Music'],
];
function platformOf(url) {
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
  return PLATFORMS.find(([re]) => re.test(host))?.[1] || host || 'the web';
}
const listenAttrs = (t) => `href="${esc(t.url)}" target="_blank" rel="noopener noreferrer" data-listen="${t.id}"`;
const uploadsOpen = () => !!game()?.uploads_open && game().status !== 'archived';
const uploadToggle = (cls = '') => (isOwner() && game().status !== 'archived'
  ? `<button class="btn ${cls}" data-act="uploads" data-open="${uploadsOpen() ? 0 : 1}">${icon(uploadsOpen() ? 'lock' : 'upload')}${uploadsOpen() ? 'Close uploads' : 'Open uploads'}</button>` : '');

// ============================================================ api
async function api(method, url, body) {
  const init = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  const res = await fetch(url, init);
  let data = null;
  try { data = await res.json(); } catch {}
  if (res.status === 401 && S.user && !url.startsWith('/api/login') && !url.startsWith('/api/me/pin')) {
    S.user = null; S.state = null; render();
    throw new Error('Your session ended. Please sign in again.');
  }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

async function loadMe() {
  const r = await api('GET', '/api/me');
  S.user = r.user;
  S.games = r.games;
  const saved = Number(store.get('cr.game'));
  const ids = S.games.map((g) => g.id);
  S.gameId = isOwner() ? (ids.includes(saved) ? saved : ids[0] ?? null) : S.user.gameId;
}

async function loadState() {
  if (!S.gameId) { S.state = null; S.stateKey = ''; return; }
  const st = await api('GET', `/api/games/${S.gameId}/state`);
  delete st.serverTime;
  S.state = st;
  S.stateKey = JSON.stringify(st);
  checkLevelUp();
}

async function refresh() {
  try { await loadState(); } catch (e) { toast(e.message, 'err'); }
  render();
}

/** Run a mutation, toast its result, then refresh state. */
async function act(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg, 'ok');
    await refresh();
    return r ?? true;
  } catch (e) {
    toast(e.message, 'err');
    return false;
  }
}

function checkLevelUp() {
  const m = me();
  if (!m) return;
  const key = `cr.lvl.${S.gameId}.${m.id}`;
  const prev = Number(store.get(key) || 0);
  if (prev && m.progress.level > prev) {
    toast(`Level up! You're now Level ${m.progress.level}: ${m.progress.title}`, 'gold', 'zap');
    confetti();
  }
  store.set(key, m.progress.level);
}

// ============================================================ toasts, confetti, modal
function toast(msg, type = 'ok', ic) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${icon(ic || (type === 'err' ? 'x' : type === 'gold' ? 'star' : 'check'))}<span>${esc(msg)}</span>`;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), type === 'err' ? 5000 : 3500);
}

function confetti() {
  const colors = ['#d62839', '#f5c04a', '#ffffff', '#ff4d5e', '#3ddc97', '#b18cff'];
  for (let i = 0; i < 70; i++) {
    const c = document.createElement('i');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = 1.6 + Math.random() * 1.8 + 's';
    c.style.animationDelay = Math.random() * 0.4 + 's';
    c.style.transform = `rotate(${Math.random() * 360}deg)`;
    document.body.append(c);
    setTimeout(() => c.remove(), 4200);
  }
}

function modal(html, { wide = false } = {}) {
  $('#modal-root').innerHTML = `<div class="modal-bg" data-act="modal-bg"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div></div>`;
  const first = $('#modal-root input:not([type=hidden]):not([type=checkbox]):not([type=radio]), #modal-root textarea, #modal-root select');
  if (first) setTimeout(() => first.focus(), 30);
}
const closeModal = () => { $('#modal-root').innerHTML = ''; };
const modalOpen = () => !!$('#modal-root').firstChild;
const closeX = '<svg width="8" height="7" viewBox="0 0 8 7" aria-hidden="true"><path d="M0 0h2l2 2 2-2h2L5 3.5 8 7H6L4 5 2 7H0l3-3.5z" fill="#000"/></svg>';
const modalHead = (title, sub = '') => `
  <div class="tb modal-head"><span class="t">${title}</span><button type="button" class="tbtn" data-act="close-modal" aria-label="Close">${closeX}</button></div>
  ${sub ? `<p class="modal-sub">${sub}</p>` : ''}`;

// ============================================================ small components
function avatar(p, cls = '') {
  if (!p) return `<span class="av ${cls}" style="--c:#555">?</span>`;
  const initials = (p.displayName || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return `<span class="av ${cls} ${p.role === 'player' && online(p) ? 'on' : ''}" style="--c:${esc(p.color || '#D62839')}">${esc(initials)}</span>`;
}
const nameLine = (id, cls = 'sm') => {
  const p = person(id);
  if (!p) return `<span class="name-line"><b>The Label</b></span>`;
  return `<span class="name-line">${avatar(p, cls)}<b>${esc(p.displayName)}</b></span>`;
};
const artistLink = (id) => (person(id)?.role === 'player' ? `<a href="#/artist/${id}" style="text-decoration:none">${nameLine(id)}</a>` : nameLine(id));
const empty = (ic, title, text = '', extra = '') => `<div class="empty">${icon(ic)}<b>${title}</b>${text ? `<p>${text}</p>` : ''}${extra}</div>`;
const stat = (label, value, sub = '', cls = '', ic = '') => `<div class="stat ${cls}"><small>${ic ? icon(ic) : ''}${label}</small><b>${value}</b>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
function cover(seed, color) {
  const h = hash(seed);
  const c1 = color || `hsl(${h % 360} 70% 45%)`;
  const c2 = `hsl(${(h >> 8) % 360} 65% 22%)`;
  return `--c1:${esc(c1)};--c2:${c2}`;
}
const badgesHtml = (badges) => (badges?.length ? `<div class="badges">${badges.map((b) => `<span class="badge" title="${esc(b.desc)}">${icon('award')}${esc(b.name)}</span>`).join('')}</div>` : '');
const phaseLabel = { setup: 'Pre-season', active: 'Season live', showcase: 'Showcase', archived: 'Archived' };
const ranking = () => [...activeRoster()].sort((a, b) => b.stats.netWorth - a.stats.netWorth || b.progress.xp - a.progress.xp);

// ============================================================ contracts logic (client mirror of the server rules)
const STATUS = {
  offered: 'Offer sent', countered: 'Countered', review: 'Label review', active: 'In progress',
  delivered: 'Delivered', completed: 'Paid', declined: 'Declined', rejected: 'Rejected', cancelled: 'Cancelled',
};
const OPEN = ['offered', 'countered', 'review', 'active', 'delivered'];
const STEPS = ['Offer', 'Agreed', 'Label review', 'In progress', 'Delivered', 'Paid'];
const stepIndex = { offered: 0, countered: 0, review: 2, active: 3, delivered: 4, completed: 6 };

function actionsFor(c) {
  const u = S.user;
  const out = [];
  const seller = u.id === c.sellerId;
  const buyer = u.id === c.buyerId;
  const isLive = live();
  if (seller && c.status === 'offered' && isLive) out.push(['accept', 'Sign contract', 'primary'], ['counter', 'Counter', ''], ['decline', 'Decline', 'danger']);
  if (seller && c.status === 'countered') out.push(['decline', 'Retract', 'danger']);
  if (buyer && c.status === 'countered' && isLive) out.push(['accept_counter', `Accept ${money(c.amount)}`, 'primary']);
  if (buyer && ['offered', 'countered'].includes(c.status)) out.push(['withdraw', 'Withdraw', 'danger']);
  if (seller && c.status === 'active') out.push(['deliver', 'Mark delivered', 'primary']);
  if (buyer && c.status === 'delivered') out.push(['confirm', 'Confirm & pay', 'green'], ['revise', 'Request changes', '']);
  if (isOwner() && c.status === 'review') out.push(['approve', 'Approve', 'green'], ['reject', 'Reject', 'danger']);
  if (isOwner() && ['active', 'delivered'].includes(c.status)) out.push(['complete', 'Force pay out', '']);
  if (isOwner() && OPEN.includes(c.status) && c.status !== 'review') out.push(['cancel', 'Void & refund', 'danger']);
  return out;
}
const needsMe = (c) => actionsFor(c).some(([a]) => ['accept', 'accept_counter', 'confirm', 'approve', 'deliver'].includes(a));

function stepper(c, mini = false) {
  const dead = ['declined', 'rejected', 'cancelled'].includes(c.status);
  const idx = dead ? -1 : stepIndex[c.status];
  return `<div class="stepper ${mini ? 'mini' : ''} ${dead ? 'dead' : ''}">${STEPS.map((s, i) =>
    `<div class="st ${i < idx ? 'done' : ''} ${i === idx ? 'cur' : ''}"><span class="dot"></span>${s}</div>`).join('')}</div>`;
}

function contractCard(c) {
  const acts = actionsFor(c);
  const needs = needsMe(c);
  return `<div class="it contract st-${c.status} ${needs ? 'sel' : ''}" data-act="nav" data-to="#/contract/${c.id}">
    <span class="chip s-${c.status}">${STATUS[c.status]}</span>
    <div class="it-main"><div><b>${esc(c.title)}</b> <span class="c-no mono">${cno(c.id)}</span>${needs ? ' <span class="needs-tag">Your move</span>' : ''}</div>
      <div class="sub">${esc(nameOf(c.buyerId))} hired ${esc(nameOf(c.sellerId))}${c.dueDays ? ` · due in ${plural(c.dueDays, 'day')}` : ''}</div></div>
    <div class="it-amt mono">${money(c.amount)}</div>
    ${acts.length ? `<div class="c-actions">${acts.slice(0, 3).map(([a, l, k]) => `<button class="btn sm ${k}" data-act="contract" data-id="${c.id}" data-a="${a}">${l}</button>`).join('')}</div>` : ''}
  </div>`;
}

// ============================================================ login
function loginView() {
  const L = S.login;
  let card;
  if (L.step === 'user') {
    card = `
      <h2>Sign in</h2><p class="sub">Enter the username your Record Owner gave you.</p>
      <form data-form="lookup" autocomplete="off">
        <label class="field"><span>Username</span><input name="username" value="${esc(L.username)}" autocapitalize="off" spellcheck="false" placeholder="e.g. lil.cardinal" required /></label>
        <button class="btn primary lg block">Continue</button>
      </form>
      <p class="hint">No account? Ask a Record Owner to sign you to the label.</p>`;
  } else {
    const titles = { pin: ['Enter your PIN', 'Welcome back to the label.'], claim1: ['Create your PIN', 'First time here! Pick a 4 to 6 digit PIN. Your Record Owner can look it up if you forget.'], claim2: ['Confirm your PIN', 'Type the same PIN one more time.'] };
    const [t, sub] = titles[L.step];
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'];
    card = `
      <div class="who">${avatar({ displayName: L.info.displayName, color: L.info.color })}<div><b>${esc(L.info.displayName)}</b><small>@${esc(L.info.username)}${L.info.role === 'owner' ? ' · Record Owner' : ''}</small></div>
        <button class="btn ghost sm" data-act="login-back">Not you?</button></div>
      <h2>${t}</h2><p class="sub">${sub}</p>
      <div class="pin-dots" id="pin-dots">${[0, 1, 2, 3, 4, 5].map((i) => `<span class="${i < L.pin.length ? 'on' : ''} ${i >= 4 ? 'opt' : ''}"></span>`).join('')}</div>
      <div class="pin-err">${esc(L.error)}</div>
      <div class="keypad">${keys.map((k) => `<button type="button" class="${k === 'ok' ? 'ok' : k === 'del' ? 'del' : ''}" data-act="pin-key" data-k="${k}" aria-label="${k === 'ok' ? 'Submit' : k === 'del' ? 'Delete' : k}">${k === 'ok' ? icon('check') : k === 'del' ? 'Delete' : k}</button>`).join('')}</div>
      <p class="hint">You can also type on your keyboard.</p>`;
  }
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return `<div class="login">
    <div class="win login-win" role="dialog" aria-labelledby="login-t">
      <div class="tb"><span class="t" id="login-t">Log On to Cardinal Records</span></div>
      <div class="login-body">
        <div class="login-art">${bird(56)}<h1>Cardinal<br/>Records</h1>
          <p>Run your corner of the label. Sell your skills, hire your labelmates, stack your cash, and drop your music.</p>
          <div class="login-steps"><span class="chip">Sign</span><span class="chip">Collaborate</span><span class="chip">Get paid</span><span class="chip">Release</span></div></div>
        <div class="login-card">${card}</div>
      </div>
    </div>
    <footer class="taskbar raised"><span class="btn start">${bird(16)}Cardinal</span><span style="flex:1"></span><span class="well tw">${today}</span><span class="well tw" id="clock">${clockText()}</span></footer>
  </div>`;
}

async function pinKey(k) {
  const L = S.login;
  if (k === 'del') L.pin = L.pin.slice(0, -1);
  else if (k === 'ok') return submitPin();
  else if (L.pin.length < 6) L.pin += k;
  L.error = '';
  render();
  if (L.pin.length === 6) submitPin();
}

async function submitPin() {
  const L = S.login;
  if (L.pin.length < 4) { L.error = 'PINs are 4 to 6 digits'; render(); return; }
  try {
    if (L.step === 'claim1') { L.firstPin = L.pin; L.pin = ''; L.step = 'claim2'; render(); return; }
    if (L.step === 'claim2') {
      if (L.pin !== L.firstPin) { Object.assign(L, { step: 'claim1', pin: '', firstPin: '', error: "Those PINs didn't match. Try again." }); render(); shakePin(); return; }
      await api('POST', '/api/claim', { username: L.info.username, pin: L.pin });
    } else {
      await api('POST', '/api/login', { username: L.info.username, pin: L.pin });
    }
    S.login = freshLogin();
    await start();
  } catch (e) {
    L.pin = ''; L.error = e.message; render(); shakePin();
  }
}
const shakePin = () => { const d = $('#pin-dots'); if (d) { d.classList.remove('shake'); void d.offsetWidth; d.classList.add('shake'); } };

// ============================================================ shell
function navItems() {
  const st = S.state;
  const contractsNeeding = st ? st.contracts.filter(needsMe).length : 0;
  const review = st ? st.contracts.filter((c) => c.status === 'review').length : 0;
  const items = [];
  if (isOwner()) items.push({ group: 'Record Owner' }, { to: 'console', label: 'Console', ic: 'shield', count: review });
  items.push(
    { group: 'The Label' },
    { to: 'hq', label: 'HQ', ic: 'home' },
    { to: 'lobby', label: 'Lobby', ic: 'message' },
    { to: 'market', label: 'Market', ic: 'bag' },
    { to: 'contracts', label: 'Contracts', ic: 'file', count: isOwner() ? 0 : contractsNeeding },
    { to: 'roster', label: 'Roster', ic: 'users' },
    { to: 'charts', label: 'Charts', ic: 'chart' },
    { group: 'Season Finale' },
    { to: 'showcase', label: 'Showcase', ic: 'music' },
    { to: 'guide', label: 'Release Guide', ic: 'map' },
    { group: 'You' },
    { to: 'data', label: 'Data', ic: 'download' },
    { to: 'profile', label: 'Profile', ic: 'user' },
  );
  return items;
}

const BIRD = '<path d="M1 31 L9 24 C5 19 8 13 13 12 L11 3 L18 9 C21 6 26 8 27 12 L32 14 L27 16 C28 24 20 29 11 28 Z"/>';
const bird = (size = 16, cls = '') => `<svg class="bird ${cls}" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">${BIRD}</svg>`;

/** The taskbar's red button does the most useful next thing for this person. */
function taskAction() {
  const st = S.state;
  if (!st) return isOwner() ? ['Create a season', '#/console'] : null;
  if (isOwner()) {
    const n = st.contracts.filter((c) => c.status === 'review').length;
    return [n ? `Review queue (${n})` : 'Label Console', '#/console'];
  }
  const n = st.contracts.filter(needsMe).length;
  if (n) return [`Your move (${n})`, '#/contracts'];
  if (uploadsOpen() && !me()?.stats.tracks) return ['Share your music', null, 'upload'];
  if (live()) return ['Make a deal', '#/market'];
  if (['showcase', 'archived'].includes(st.game.status)) return ['Release Guide', '#/guide'];
  return ['List a service', '#/market'];
}

const clockText = () => new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

function shellView(view) {
  const g = game();
  const route = currentRoute()[0];
  const navRoute = { contract: 'contracts', artist: 'roster' }[route] || route;
  const nav = navItems().filter((it) => !it.group).map((it) =>
    `<a href="#/${it.to}" class="mi ${navRoute === it.to ? 'on' : ''}">${it.label}${it.count ? `<span class="count">${it.count}</span>` : ''}</a>`).join('');
  const switcher = isOwner() && S.games.length
    ? `<select class="season-pick" data-change="switch-game" aria-label="Label season">${S.games.map((x) => `<option value="${x.id}" ${x.id === S.gameId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`
    : g ? `<span class="season-name">${esc(g.name)}</span>` : '';
  const m = me();
  const u = S.user;
  const wells = [];
  if (g) {
    const c = g.clock;
    wells.push(`<span class="well tw phase-${g.status}" title="Season phase">${phaseLabel[g.status]}</span>`);
    wells.push(m ? `<span class="well tw cash" title="Cash on hand">Cash ${money(m.stats.balance)}</span>` : `<span class="well tw cash" title="Label vault">Vault ${money(S.state.vault)}</span>`);
    wells.push(`<span class="well tw" title="${g.status === 'active' ? `${plural(c.daysLeft, 'day')} left` : ''}">Day ${g.status === 'setup' ? 0 : c.day} of ${c.totalDays}</span>`);
    if (m) wells.push(`<a class="well tw lvl" href="#/profile" title="${m.progress.levelXp} / ${m.progress.levelSpan} XP to the next level">Lv ${m.progress.level} ${esc(m.progress.title)}</a>`);
  }
  const ta = taskAction();
  const taBtn = ta ? (ta[2] ? `<button class="btn go task-go" data-act="${ta[2]}">${ta[0]}</button>` : `<a class="btn go task-go" href="${ta[1]}">${ta[0]}</a>`) : '';
  return `<div class="shell">
    <header class="menubar raised">
      <a class="brand" href="#/hq">${bird(18)}Cardinal Records</a>
      <nav class="menu" aria-label="Main">${nav}</nav>
      <div class="menu-right">${switcher}
        <span class="who-name">${esc(m?.displayName || u.displayName)}</span>
        <button class="mi" data-act="logout">Sign out</button></div>
    </header>
    <section class="view" id="view">${u.startingPin && route !== 'profile' ? `<div class="banner red">${icon('key')}<div><b>You're still using your starting PIN</b><p>Pick a new one so nobody else can sign in as you.</p></div><div class="actions"><a class="btn" href="#/profile">Change PIN</a></div></div>` : ''}${view}</section>
    <footer class="taskbar raised">
      <a class="btn start" href="#/hq">${bird(16)}Cardinal</a>
      <div class="tasks">${wells.join('')}</div>
      <span class="well tw clock" id="clock">${clockText()}</span>
      ${taBtn}
    </footer>
  </div>`;
}

const pageHead = (kicker, title, sub = '', actions = '') => `
  <div class="page-head"><div><div class="kicker">${kicker}</div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;

function phaseBanner() {
  const g = game();
  const m = me();
  if (!g) return '';
  if (g.status === 'setup') return `<div class="banner amber">${icon('clock')}<div><b>Pre-season</b><p>The Record Owner hasn't started the clock yet. ${m ? 'List your services now so you are ready to make deals on Day 1.' : 'Sign your artists, then start the season from the Label Console.'}</p></div>
    <div class="actions">${m ? '<a class="btn" href="#/market">List a service</a>' : '<a class="btn primary" href="#/console">Open console</a>'}</div></div>`;
  if (g.status === 'active' && uploadsOpen()) return `<div class="banner purple">${icon('upload')}<div><b>Music uploads are open</b><p>${m ? 'A Record Owner opened uploads early. Share a link to your tracks in the Showcase whenever they are ready.' : 'Artists can share links to their music in the Showcase now.'}</p></div>
    <div class="actions">${m ? '<button class="btn primary" data-act="upload">Share your music</button>' : uploadToggle()}<a class="btn" href="#/showcase">Showcase</a></div></div>`;
  if (g.status === 'active' && g.clock.daysLeft <= 7) return `<div class="banner red">${icon('flag')}<div><b>Final stretch: ${plural(g.clock.daysLeft, 'day')} left</b><p>Wrap up your deals and finish your music. The Showcase opens when the season ends.</p></div></div>`;
  if (g.status === 'showcase' && !uploadsOpen()) return `<div class="banner purple">${icon('music')}<div><b>The season has wrapped</b><p>${m ? 'Get your final mix ready. Music uploads open once a Record Owner activates them.' : "Artists can't upload their music until you open uploads."}</p></div>
    <div class="actions">${uploadToggle('primary')}<a class="btn" href="#/showcase">Showcase</a></div></div>`;
  if (g.status === 'showcase') {
    const tracks = m ? m.stats.tracks : 0;
    return `<div class="banner purple">${icon('music')}<div><b>Music uploads are open</b><p>${m ? (tracks ? `You've shared ${plural(tracks, 'track')}. Next: get it on streaming services.` : 'Share a link to the music you made this season so your labelmates can listen.') : 'Artists are sharing their music now.'}</p></div>
      <div class="actions">${uploadToggle()}${m && !tracks ? '<button class="btn primary" data-act="upload">Share your music</button>' : ''}${m && tracks ? `<button class="btn primary" data-act="guide-modal">${m.stats.released ? 'Review' : 'Open'} Release Guide</button>` : ''}<a class="btn" href="#/showcase">Listen</a></div></div>`;
  }
  if (g.status === 'archived') return `<div class="banner grey">${icon('lock')}<div><b>This season is archived</b><p>Everything is read-only now. You can still listen to the Showcase and download all the data.</p></div><div class="actions"><a class="btn" href="#/data">Download data</a></div></div>`;
  return '';
}

// ============================================================ views
function hqView() {
  if (isOwner()) return ownerHqView();
  const m = me();
  const s = m.stats;
  const p = m.progress;
  const rank = ranking().findIndex((x) => x.id === m.id) + 1;
  const mine = S.state.contracts.filter((c) => c.buyerId === m.id || c.sellerId === m.id);
  const todo = mine.filter(needsMe);
  const openDeals = mine.filter((c) => OPEN.includes(c.status) && !needsMe(c));
  return `${phaseBanner()}
    <div class="card"><div class="card-head"><h3>Artist File: ${esc(m.displayName)}</h3><span class="more mono">@${esc(m.username)}</span></div><div class="hero">
      ${avatar(m, 'xl')}
      <div style="min-width:0;flex:1">
        <div class="kicker" style="font-size:11.5px;font-weight:700;letter-spacing:.16em;color:var(--red);text-transform:uppercase">Level ${p.level} · ${esc(p.title)}</div>
        <h1>${esc(m.displayName)}</h1>
        <div class="meta">${esc(m.roleTitle || 'Artist')} · @${esc(m.username)}</div>
        <div class="xp"><div class="lbls"><span>${p.levelXp} / ${p.levelSpan} XP</span><span>Level ${p.level + 1}</span></div><div class="bar"><i style="width:${(p.levelXp / p.levelSpan) * 100}%"></i></div></div>
        ${badgesHtml(m.badges)}
      </div>
      <div class="side"><small class="dim" style="letter-spacing:.12em;text-transform:uppercase;font-size:11px">Chart position</small><div class="num" style="font-size:54px;font-weight:700;line-height:1">#${rank || '-'}</div><small class="muted">of ${activeRoster().length} artists</small></div>
    </div></div>
    <div class="stats">
      ${stat('Cash on hand', money(s.balance), 'Ready to spend', 'gold', 'dollar')}
      ${stat('In escrow', money(s.escrow), 'Locked in your open offers', '', 'lock')}
      ${stat('Net worth', money(s.netWorth), `Cash + escrow`, 'red', 'chart')}
      ${stat('Earned', money(s.earned), `From ${plural(s.dealsSold, 'deal')} delivered`, '', 'award')}
      ${stat('Rating', s.rating ? `${s.rating} ★` : '—', s.rating ? 'Average from clients' : 'No reviews yet', '', 'star')}
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h3>${icon('zap')}Your move</h3><a class="more" href="#/contracts">All contracts →</a></div>
        ${todo.length ? `<div class="contracts">${todo.slice(0, 4).map(contractCard).join('')}</div>`
          : empty('check', 'Nothing waiting on you', live() ? 'Browse the Marketplace to hire a labelmate, or list a service to get hired.' : '', live() ? '<a class="btn primary" href="#/market" style="margin-top:8px">Open Marketplace</a>' : '')}
        ${openDeals.length ? `<h3 style="margin:20px 0 12px">In motion</h3><div class="contracts">${openDeals.slice(0, 4).map(contractCard).join('')}</div>` : ''}
      </div>
      <div class="stack">
        <div class="card"><div class="card-head"><h3>${icon('chart')}The Cardinal Chart</h3><a class="more" href="#/charts">Full chart →</a></div>${miniChart()}</div>
        <div class="card"><div class="card-head"><h3>${icon('message')}Lobby</h3><a class="more" href="#/lobby">Open lobby →</a></div>${feedList(S.state.feed.slice(0, 7))}</div>
      </div>
    </div>`;
}

function ownerHqView() {
  const st = S.state;
  if (!st) return pageHead('Record Owner', 'Welcome to Cardinal Records', 'Create your first label season to start signing artists.', '<a class="btn primary" href="#/console">Create a season</a>');
  const r = activeRoster();
  const cash = r.reduce((a, p) => a + p.stats.balance, 0);
  const escrow = r.reduce((a, p) => a + p.stats.escrow, 0);
  const review = st.contracts.filter((c) => c.status === 'review');
  const done = st.contracts.filter((c) => c.status === 'completed');
  return `${phaseBanner()}
    ${pageHead('Record Owner', esc(st.game.name), 'Your label at a glance.', '<a class="btn primary" href="#/console">Label Console</a>')}
    <div class="stats" style="margin-top:0">
      ${stat('Artists signed', `${r.length}<span class="dim" style="font-size:15px"> / ${st.game.max_players}</span>`, '', '', 'users')}
      ${stat('Cash in circulation', money(cash), 'Across all artists', 'gold', 'dollar')}
      ${stat('Held in escrow', money(escrow), 'Open offers and deals', '', 'lock')}
      ${stat('Label vault', money(st.vault), `${st.game.label_cut_pct}% cut on completed deals`, 'red', 'vault')}
      ${stat('Deals closed', done.length, money(done.reduce((a, c) => a + c.amount, 0)) + ' total', '', 'check')}
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-head"><h3>${icon('shield')}Awaiting your review</h3><a class="more" href="#/console">Review queue →</a></div>
        ${review.length ? review.slice(0, 5).map(reviewItem).join('') : empty('check', 'Queue is clear', 'New contracts land here once both artists agree.')}</div>
      <div class="stack">
        <div class="card"><div class="card-head"><h3>${icon('chart')}The Cardinal Chart</h3><a class="more" href="#/charts">Full chart →</a></div>${miniChart()}</div>
        <div class="card"><div class="card-head"><h3>${icon('message')}Lobby</h3><a class="more" href="#/lobby">Open lobby →</a></div>${feedList(st.feed.slice(0, 6))}</div>
      </div>
    </div>`;
}

function miniChart() {
  const r = ranking().slice(0, 5);
  if (!r.length) return empty('users', 'No artists yet');
  return `<table class="t">${r.map((p, i) => `<tr class="clickable top${i + 1} ${p.id === S.user.id ? 'me' : ''}" data-act="nav" data-to="#/artist/${p.id}">
    <td class="pos">${i + 1}</td><td>${nameLine(p.id)}</td><td class="r num gold">${money(p.stats.netWorth)}</td></tr>`).join('')}</table>`;
}

const FEED_ICON = { deal: 'file', paid: 'dollar', grant: 'dollar', fine: 'dollar', join: 'user', service: 'bag', track: 'music', phase: 'clock', chat: 'message', announcement: 'shield', release: 'award' };
function feedList(items) {
  if (!items.length) return empty('message', 'Quiet in here', 'Activity across the label will show up here.');
  return `<ul class="feed">${items.map((f) => {
    const p = person(f.actorId);
    if (f.kind === 'chat' || f.kind === 'announcement') {
      return `<li class="k-${f.kind}">${f.kind === 'chat' ? avatar(p) : `<span class="ico">${icon('shield')}</span>`}<div class="body">
        <div><b>${esc(p?.displayName || 'Record Owner')}</b> <time>· ${ago(f.at)}</time>${f.kind === 'announcement' ? ' <span class="tag">Label</span>' : ''}</div>
        <div class="chat-msg">${esc(f.message)}</div></div></li>`;
    }
    return `<li class="k-${f.kind}"><span class="ico">${icon(FEED_ICON[f.kind] || 'zap')}</span><div class="body"><div class="msg">${esc(f.message)}</div><time>${ago(f.at)}</time></div></li>`;
  }).join('')}</ul>`;
}

function lobbyView() {
  const st = S.state;
  const board = st.contracts.filter((c) => ['active', 'delivered'].includes(c.status));
  const around = activeRoster().filter(online);
  return `${pageHead('The Label', 'Lobby', 'Everything happening at Cardinal Records: approved deals, payouts, new signings and labelmate chatter.')}
    <div class="grid-2" style="margin-top:0">
      <div class="card">
        ${st.game.status !== 'archived' ? `<form class="composer" data-form="chat"><input name="message" maxlength="280" placeholder="${isOwner() ? 'Post an announcement to the whole label…' : 'Say something to the label…'}" autocomplete="off" required /><button class="btn primary">${icon('send')}Post</button></form>` : ''}
        ${feedList(st.feed)}
      </div>
      <div class="stack">
        <div class="card"><div class="card-head"><h3>${icon('file')}Deal board</h3><span class="more">${plural(board.length, 'active deal')}</span></div>
          ${board.length ? `<table class="t">${board.slice(0, 10).map((c) => `<tr class="clickable" data-act="nav" data-to="#/contract/${c.id}"><td><b>${esc(c.title)}</b><div class="dim" style="font-size:12.5px">${esc(nameOf(c.buyerId))} → ${esc(nameOf(c.sellerId))}</div></td><td class="r num gold">${money(c.amount)}</td></tr>`).join('')}</table>`
            : empty('file', 'No live deals', 'Deals appear here once the label approves them.')}</div>
        <div class="card"><div class="card-head"><h3>${icon('users')}In the building</h3><span class="more">${around.length} online</span></div>
          ${around.length ? around.map((p) => `<div style="padding:5px 0">${artistLink(p.id)}</div>`).join('') : '<p class="muted">Nobody else is online right now.</p>'}</div>
      </div>
    </div>`;
}

const CATEGORIES = ['Production', 'Beat', 'Vocals', 'Songwriting', 'Mixing', 'Mastering', 'Instrument', 'Artwork', 'Video', 'Marketing', 'Other'];

function marketView() {
  const st = S.state;
  const ui = S.ui;
  const q = ui.marketQ.toLowerCase();
  const open = ['setup', 'active'].includes(st.game.status);
  const all = st.services.filter((s) => s.active || s.userId === S.user.id);
  const list = all.filter((s) => (ui.marketCat === 'All' || s.category === ui.marketCat) &&
    (!q || `${s.title} ${s.description} ${nameOf(s.userId)}`.toLowerCase().includes(q)));
  const cats = ['All', ...CATEGORIES.filter((c) => all.some((s) => s.category === c))];
  const actions = me() && open ? `<button class="btn" data-act="custom-offer">${icon('dollar')}Custom offer</button><button class="btn primary" data-act="new-service">${icon('plus')}List a service</button>` : '';
  return `${pageHead('The Label', 'Marketplace', 'Hire your labelmates for beats, verses, mixes, artwork and more. Every offer becomes a contract the label reviews before work starts.', actions)}
    ${!open ? `<div class="banner grey">${icon('lock')}<div><b>The marketplace is closed</b><p>The season has wrapped, so no new deals can be made.</p></div></div>` : ''}
    <div class="toolbar">
      <input type="search" placeholder="Search services or artists" value="${esc(ui.marketQ)}" data-input="market-q" />
      <div class="chips">${cats.map((c) => `<button class="chip ${ui.marketCat === c ? 'on' : ''}" data-act="market-cat" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    </div>
    ${list.length ? `<div class="grid-cards">${list.map(serviceCard).join('')}</div>`
      : empty('bag', all.length ? 'No matches' : 'No services yet', all.length ? 'Try another search or category.' : 'Be the first to list what you can do for the label.')}`;
}

function serviceCard(s) {
  const mine = s.userId === S.user.id;
  const btn = mine ? `<button class="btn sm" data-act="edit-service" data-id="${s.id}">${icon('edit')}Edit</button>`
    : me() && live() ? `<button class="btn sm primary" data-act="offer" data-id="${s.id}">Make offer</button>` : '';
  return `<div class="service ${mine ? 'mine' : ''} ${s.active ? '' : 'off'}">
    <div style="display:flex;align-items:center;gap:8px"><span class="tag">${esc(s.category)}</span>${mine ? '<span class="tag" style="background:var(--red);color:#fff">Yours</span>' : ''}${s.active ? '' : '<span class="tag">Paused</span>'}</div>
    <h4>${esc(s.title)}</h4>
    ${artistLink(s.userId)}
    <div class="desc">${esc(s.description) || '<span class="dim">No description.</span>'}</div>
    <div class="foot"><div class="price"><small>Asking</small>${money(s.price)}</div><span class="dim" style="font-size:12.5px">${icon('clock')} ${plural(s.turnaroundDays, 'day')}</span>${btn}</div>
  </div>`;
}

function contractsView() {
  const st = S.state;
  const uid = S.user.id;
  const mine = isOwner() ? st.contracts : st.contracts.filter((c) => c.buyerId === uid || c.sellerId === uid);
  const tabs = [
    ['action', isOwner() ? 'Needs review' : 'Your move', mine.filter(needsMe)],
    ['open', 'Open', mine.filter((c) => OPEN.includes(c.status) && !needsMe(c))],
    ['history', 'History', mine.filter((c) => !OPEN.includes(c.status))],
    ['board', 'Deal board', st.contracts.filter((c) => ['active', 'delivered', 'completed'].includes(c.status))],
  ];
  if (!tabs.find((t) => t[0] === S.ui.contractTab)) S.ui.contractTab = 'action';
  const cur = tabs.find((t) => t[0] === S.ui.contractTab);
  const blurb = {
    action: isOwner() ? 'Contracts both artists agreed to, waiting for the label to approve.' : 'Offers to sign, counters to answer, and work to deliver or approve.',
    open: 'Deals in progress. Money stays in escrow until the work is delivered and confirmed.',
    history: 'Paid, declined, rejected and cancelled contracts.',
    board: 'Every approved deal at the label. This is what the whole lobby sees.',
  }[cur[0]];
  return `${pageHead('The Label', 'Contracts', 'Offer → artist signs → label approves → work → delivery → payment. The buyer’s money sits in escrow the whole time.', me() && live() ? `<a class="btn primary" href="#/market">${icon('plus')}New deal</a>` : '')}
    <div class="tabs">${tabs.map(([k, l, arr]) => `<button class="${k === cur[0] ? 'on' : ''}" data-act="contract-tab" data-tab="${k}">${l}<span class="count">${arr.length}</span></button>`).join('')}</div>
    <p class="muted" style="margin-top:-6px">${blurb}</p>
    ${cur[2].length ? `<div class="contracts">${cur[2].map(contractCard).join('')}</div>` : empty('file', 'Nothing here', cur[0] === 'action' ? "You're all caught up." : '')}`;
}

function contractDetailView(id) {
  const c = S.state.contracts.find((x) => x.id === Number(id));
  if (!c) return empty('file', 'Contract not found', "It may be private to the artists involved.", '<a class="btn" href="#/contracts">Back to contracts</a>');
  const g = game();
  const fee = Math.round((c.amount * g.label_cut_pct) / 100);
  const acts = actionsFor(c);
  const party = isOwner() || c.buyerId === S.user.id || c.sellerId === S.user.id;
  // Signatures: the buyer signs by offering, the artist by accepting (or by countering
  // and having it accepted), the owner by approving. Non-parties only see public deals.
  const publicDeal = ['active', 'delivered', 'completed'].includes(c.status);
  const has = (...actions) => c.events.some((e) => actions.includes(e.action));
  const approver = c.events.find((e) => e.action === 'approve')?.actorId;
  const sig = (ok, name) => (ok ? `<div class="s">${esc(name)}</div>` : '<div class="s none">awaiting signature</div>');
  const signed = {
    buyer: sig(true, nameOf(c.buyerId)),
    seller: sig(publicDeal || c.status === 'review' || has('accept', 'accept_counter'), nameOf(c.sellerId)),
    owner: sig(publicDeal || !!approver, approver ? nameOf(approver) : 'Cardinal Records'),
  };
  const stamp = { completed: ['paid', 'Paid in full'], active: ['ok', 'Approved'], delivered: ['ok', 'Approved'], review: ['wait', 'Under review'], rejected: ['no', 'Rejected'], declined: ['no', 'Declined'], cancelled: ['no', 'Void'] }[c.status];
  const evLabel = { offered: 'made an offer', accept: 'signed the contract', counter: 'countered', accept_counter: 'accepted the counter offer', decline: 'declined', withdraw: 'withdrew the offer', approve: 'approved the deal', reject: 'rejected the deal', deliver: 'marked the work delivered', revise: 'requested changes', confirm: 'confirmed delivery and paid', complete: 'paid out the deal', cancel: 'voided the contract' };
  return `
    <div class="page-head"><div><div class="kicker"><a href="#/contracts" style="text-decoration:none">← Contracts</a></div><h1>${esc(c.title)}</h1></div>
      <div class="actions"><span class="status s-${c.status}" style="font-size:12px;padding:6px 12px">${STATUS[c.status]}</span></div></div>
    <div class="card" style="margin-bottom:16px">${stepper(c)}</div>
    <div class="grid-2" style="margin-top:0">
      <div class="doc">
        ${stamp ? `<div class="stamp ${stamp[0]}">${stamp[1]}</div>` : ''}
        <div class="lh"><img src="/logo.svg" alt="" /><div><b>Cardinal Records</b><small>Service agreement</small></div><div class="no"><small>${cno(c.id)}</small><br/><small>${new Date(c.createdAt).toLocaleDateString()}</small></div></div>
        <h2>${esc(c.title)}</h2>
        <p class="clause"><b>Parties</b><strong>${esc(nameOf(c.buyerId))}</strong> (the "Client") engages <strong>${esc(nameOf(c.sellerId))}</strong> (the "Artist") under the label ${esc(g.name)}.</p>
        <div class="clause"><b>Scope of work</b>${party ? `<div class="terms">${esc(c.terms) || '<i>No additional terms. Standard service as listed.</i>'}</div>` : '<i>Terms are private to the parties.</i>'}</div>
        <div class="clause"><b>Compensation</b>
          <table class="money-table"><tr><td>Deal value</td><td>${money(c.amount)}</td></tr><tr><td>Label cut (${g.label_cut_pct}%)</td><td>-${money(fee)}</td></tr><tr><td>Paid to the Artist on completion</td><td>${money(c.amount - fee)}</td></tr></table>
          <small class="mono muted">Currently held in escrow: ${money(c.escrow)}</small></div>
        ${c.dueDays ? `<p class="clause"><b>Delivery</b>Within ${plural(c.dueDays, 'day')} of label approval.</p>` : ''}
        ${c.rating ? `<p class="clause"><b>Client rating</b>${'★'.repeat(c.rating)}${'☆'.repeat(5 - c.rating)}</p>` : ''}
        <div class="sigs"><div class="sig">${signed.buyer}Client</div><div class="sig">${signed.seller}Artist</div><div class="sig">${signed.owner}Record Owner</div></div>
      </div>
      <div class="stack">
        ${acts.length ? `<div class="card"><div class="card-head"><h3>${icon('zap')}Actions</h3></div><div class="c-actions">${acts.map(([a, l, k]) => `<button class="btn ${k}" data-act="contract" data-id="${c.id}" data-a="${a}">${l}</button>`).join('')}</div></div>` : ''}
        <div class="card"><div class="card-head"><h3>${icon('clock')}History</h3></div>
          ${c.events.length ? `<ul class="timeline">${c.events.map((e) => `<li>${avatar(person(e.actorId), 'sm')}<div style="flex:1;min-width:0"><b>${esc(nameOf(e.actorId))}</b> ${evLabel[e.action] || esc(e.action)}${e.amount != null && ['offered', 'counter'].includes(e.action) ? ` at <b class="gold">${money(e.amount)}</b>` : ''}
            <div><time>${dateStr(e.at)}</time></div>${e.note && e.action !== 'offered' ? `<div class="note">${esc(e.note)}</div>` : ''}</div></li>`).join('')}</ul>`
            : '<p class="muted">The full history is visible to the artists on this contract.</p>'}
        </div>
      </div>
    </div>`;
}

function rosterView() {
  const r = S.state.roster.filter((p) => p.active || isOwner());
  return `${pageHead('The Label', 'Roster', `${plural(activeRoster().length, 'artist')} signed to ${esc(game().name)}.`, isOwner() ? `<button class="btn primary" data-act="console-tab" data-tab="roster">${icon('plus')}Sign an artist</button>` : '')}
    ${r.length ? `<div class="grid-cards">${r.map((p) => `<a class="artist ${p.active ? '' : 'off'}" href="#/artist/${p.id}">
      <div class="top">${avatar(p, 'lg')}<div style="min-width:0"><b>${esc(p.displayName)}</b><small>${esc(p.roleTitle || 'Artist')}</small></div><span class="lvl-pill">LVL ${p.progress.level}</span></div>
      ${badgesHtml(p.badges.slice(0, 3))}
      <div class="mini-stats"><div><small>Net worth</small><b class="gold">${money(p.stats.netWorth)}</b></div><div><small>Deals</small><b>${p.stats.dealsSold + p.stats.dealsBought}</b></div><div><small>Rating</small><b>${p.stats.rating ? p.stats.rating + '★' : '—'}</b></div></div>
    </a>`).join('')}</div>` : empty('users', 'No artists yet', isOwner() ? 'Sign artists from the Label Console.' : '')}`;
}

function artistView(id) {
  const p = S.state.roster.find((x) => x.id === Number(id));
  if (!p) return empty('user', 'Artist not found');
  const services = S.state.services.filter((s) => s.userId === p.id && s.active);
  const deals = S.state.contracts.filter((c) => (c.buyerId === p.id || c.sellerId === p.id) && ['active', 'delivered', 'completed'].includes(c.status));
  const tracks = S.state.tracks.filter((t) => t.userId === p.id);
  const rank = ranking().findIndex((x) => x.id === p.id) + 1;
  const canHire = me() && live() && p.id !== S.user.id && p.active;
  return `<div class="page-head"><div class="kicker"><a href="#/roster" style="text-decoration:none">← Roster</a></div></div>
    <div class="card"><div class="profile-hero">${avatar(p, 'xl')}<div style="flex:1;min-width:0">
      <div class="kicker" style="font-size:11.5px;font-weight:700;letter-spacing:.16em;color:var(--red);text-transform:uppercase">Level ${p.progress.level} · ${esc(p.progress.title)}</div>
      <h1>${esc(p.displayName)}</h1><div class="muted">${esc(p.roleTitle || 'Artist')} · @${esc(p.username)}${online(p) ? ' · <span class="green">Online</span>' : ''}</div>
      ${p.bio ? `<div class="bio">${esc(p.bio)}</div>` : ''}${badgesHtml(p.badges)}</div>
      ${canHire ? `<button class="btn primary" data-act="custom-offer" data-seller="${p.id}">${icon('dollar')}Make an offer</button>` : ''}</div></div>
    <div class="stats">
      ${stat('Chart', rank ? `#${rank}` : '—', '', 'red', 'chart')}
      ${stat('Net worth', money(p.stats.netWorth), '', 'gold', 'dollar')}
      ${stat('Earned', money(p.stats.earned), '', '', 'award')}
      ${stat('Deals', p.stats.dealsSold + p.stats.dealsBought, `${p.stats.dealsSold} delivered · ${p.stats.dealsBought} hired`, '', 'file')}
      ${stat('Rating', p.stats.rating ? `${p.stats.rating} ★` : '—', '', '', 'star')}
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-head"><h3>${icon('bag')}Services</h3></div>${services.length ? `<div class="grid-cards">${services.map(serviceCard).join('')}</div>` : '<p class="muted">No services listed.</p>'}</div>
      <div class="stack">
        <div class="card"><div class="card-head"><h3>${icon('file')}Deal history</h3></div>${deals.length ? `<table class="t">${deals.map((c) => `<tr class="clickable" data-act="nav" data-to="#/contract/${c.id}"><td><b>${esc(c.title)}</b><div class="dim" style="font-size:12.5px">${c.sellerId === p.id ? `for ${esc(nameOf(c.buyerId))}` : `hired ${esc(nameOf(c.sellerId))}`}</div></td><td><span class="status s-${c.status}">${STATUS[c.status]}</span></td><td class="r num gold">${money(c.amount)}</td></tr>`).join('')}</table>` : '<p class="muted">No public deals yet.</p>'}</div>
        ${tracks.length ? `<div class="card"><div class="card-head"><h3>${icon('music')}Music</h3></div><div class="tracks" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">${tracks.map(trackCard).join('')}</div></div>` : ''}
      </div>
    </div>`;
}

function chartsView() {
  const r = activeRoster();
  const tabs = {
    worth: ['Net worth', (p) => p.stats.netWorth, money],
    earned: ['Top earners', (p) => p.stats.earned, money],
    deals: ['Most deals', (p) => p.stats.dealsSold + p.stats.dealsBought, (v) => v],
    xp: ['XP', (p) => p.progress.xp, (v) => `${v.toLocaleString()} XP`],
    fans: ['Fan favorites', (p) => p.stats.likes, (v) => `${v} ♥`],
  };
  const [, key, fmt] = tabs[S.ui.chartTab] || tabs.worth;
  const sorted = [...r].sort((a, b) => key(b) - key(a) || b.progress.xp - a.progress.xp);
  return `${pageHead('The Label', 'The Cardinal Chart', 'Who is running the label this season. Money talks, but so do deals and fans.')}
    <div class="tabs">${Object.entries(tabs).map(([k, [l]]) => `<button class="${S.ui.chartTab === k ? 'on' : ''}" data-act="chart-tab" data-tab="${k}">${l}</button>`).join('')}</div>
    <div class="card">${sorted.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>#</th><th>Artist</th><th>Level</th><th class="r">Cash</th><th class="r">Deals</th><th class="r">Rating</th><th class="r">${tabs[S.ui.chartTab]?.[0] || 'Net worth'}</th></tr></thead><tbody>
      ${sorted.map((p, i) => `<tr class="clickable top${i + 1} ${p.id === S.user.id ? 'me' : ''}" data-act="nav" data-to="#/artist/${p.id}">
        <td class="pos">${i + 1}</td><td>${nameLine(p.id)}<div class="dim" style="font-size:12px;margin-left:32px">${esc(p.roleTitle || '')}</div></td>
        <td><span class="lvl-pill" style="margin:0">LVL ${p.progress.level}</span> <span class="muted" style="font-size:12.5px">${esc(p.progress.title)}</span></td>
        <td class="r num">${money(p.stats.balance)}</td><td class="r">${p.stats.dealsSold + p.stats.dealsBought}</td><td class="r">${p.stats.rating ? p.stats.rating + '★' : '—'}</td>
        <td class="r num gold" style="font-size:16px;font-weight:700">${fmt(key(p))}</td></tr>`).join('')}
    </tbody></table></div>` : empty('chart', 'No artists yet')}</div>`;
}

function trackCard(t) {
  const p = person(t.userId);
  const where = platformOf(t.url);
  return `<div class="track" data-track="${t.id}">
    <a class="cover" style="${cover(t.id + t.title, p?.color)}" ${listenAttrs(t)} aria-label="Listen to ${esc(t.title)} on ${esc(where)}"><div class="vinyl"></div>
      <span class="play ext">${icon('external')}</span></a>
    <div><h4 title="${esc(t.title)}">${esc(t.title)}</h4><div class="by">${esc(p?.displayName)}${t.genre ? ` · ${esc(t.genre)}` : ''}</div></div>
    <a class="btn primary sm listen" ${listenAttrs(t)}>${icon('external')}Listen on ${esc(where)}</a>
    <div class="meta"><span title="Times the link was opened">${icon('play')} ${t.plays}</span>
      <button class="like ${t.liked ? 'on' : ''}" data-act="like" data-id="${t.id}" ${t.userId === S.user.id || isOwner() ? 'disabled' : ''} aria-label="Like">${icon('heart')} ${t.likes}</button>
      ${t.userId === S.user.id || isOwner() ? `<button class="btn ghost icon sm" style="margin-left:auto" data-act="track-info" data-id="${t.id}" aria-label="Details">${icon('edit')}</button>` : `<button class="btn ghost sm" style="margin-left:auto" data-act="track-info" data-id="${t.id}">Credits</button>`}</div>
  </div>`;
}

function showcaseView() {
  const g = game();
  const m = me();
  if (['setup', 'active'].includes(g.status) && !uploadsOpen()) {
    const left = g.status === 'setup' ? g.duration_days : g.clock.daysLeft;
    return `${pageHead('Season Finale', 'Showcase')}
      <div class="card lock"><div class="big">${icon('lock')}</div>
        <h2>The Showcase opens when the season wraps</h2>
        <p>At the end of the season, once a Record Owner opens uploads, every artist shares a link to the music they made here (Spotify, SoundCloud, YouTube…) and the whole label listens. Then you'll get a step-by-step guide to releasing it on streaming services.</p>
        <div class="countdown"><div><b>${left}</b><small>Days to go</small></div><div><b>${g.status === 'setup' ? 0 : g.clock.day}</b><small>Current day</small></div><div><b>${g.duration_days}</b><small>Season length</small></div></div>
        <p class="dim">Use the season to build your track: hire producers, writers, singers and engineers from the Marketplace.</p>
        <div style="display:flex;gap:8px;justify-content:center;margin-top:10px">${uploadToggle()}<a class="btn" href="#/guide">Preview the Release Guide</a></div></div>`;
  }
  const tracks = S.state.tracks;
  const canUpload = m && uploadsOpen();
  return `${phaseBanner()}
    ${pageHead('Season Finale', 'Showcase', `${plural(tracks.length, 'track')} from ${plural(new Set(tracks.map((t) => t.userId)).size, 'artist')}. Tap a track to listen, show some love.`,
      `${uploadToggle()}${canUpload ? `<button class="btn primary" data-act="upload">${icon('upload')}Share your music</button>` : ''}`)}
    ${tracks.length ? `<div class="tracks">${tracks.map(trackCard).join('')}</div>` : empty('music', 'No music yet', canUpload ? 'Be the first to share a track.' : uploadsOpen() ? 'Artists are getting their links ready.' : "Uploads aren't open yet. A Record Owner will open them.", canUpload ? '<button class="btn primary" data-act="upload" style="margin-top:10px">Share your music</button>' : '')}`;
}

// ---------- release guide ----------
const GUIDE = window.RELEASE_GUIDE;
function guideState() {
  const t = me()?.tutorial || {};
  return { done: t.done || {}, completedAt: t.completedAt };
}
function guideHtml(inModal) {
  const gs = guideState();
  const doneCount = GUIDE.filter((s) => gs.done[s.id]).length;
  if (S.ui.guideStep == null) {
    const firstOpen = GUIDE.findIndex((s) => !gs.done[s.id]);
    S.ui.guideStep = firstOpen === -1 ? 0 : firstOpen;
  }
  if (S.ui.guideStep === 'done') {
    return `<div class="guide" style="display:block"><div class="guide-done"><div class="trophy">${icon('award', '')}</div>
      <h2 style="font-size:30px;margin:10px 0">You're ready to release!</h2>
      <p class="muted" style="max-width:480px;margin:0 auto 20px">You went from signing your first contract to having a real plan to get your music on Spotify, Apple Music and everywhere else. Go make it official.</p>
      <div style="display:flex;gap:8px;justify-content:center"><button class="btn" data-act="guide-go" data-i="0">Review the steps</button>${inModal ? '<button class="btn primary" data-act="close-modal">Back to the Showcase</button>' : '<a class="btn primary" href="#/showcase">Back to the Showcase</a>'}</div></div></div>`;
  }
  const i = S.ui.guideStep;
  const step = GUIDE[i];
  const tracking = !!me();
  let dynamic = '';
  if (step.dynamic === 'credits' && me()) {
    const done = S.state.contracts.filter((c) => c.status === 'completed' && (c.buyerId === S.user.id || c.sellerId === S.user.id));
    const hired = done.filter((c) => c.buyerId === S.user.id);
    const worked = done.filter((c) => c.sellerId === S.user.id);
    dynamic = `<div class="credits-box"><h4>From your Cardinal Records contracts</h4>
      ${hired.length ? hired.map((c) => `<div>${nameLine(c.sellerId)}<span class="muted">for "${esc(c.title)}" · ${cno(c.id)}</span></div>`).join('') : '<div class="muted">You did not hire anyone this season.</div>'}
      ${worked.length ? `<h4 style="margin-top:10px">You worked on</h4>${worked.map((c) => `<div>${nameLine(c.buyerId)}<span class="muted">"${esc(c.title)}"</span></div>`).join('')}` : ''}</div>`;
  }
  return `<div class="guide">
    <div class="guide-steps"><div class="gp"><b>Release Guide</b><br/><small>${tracking ? `${doneCount} of ${GUIDE.length} done` : 'Preview'}</small><div class="bar gold"><i style="width:${(doneCount / GUIDE.length) * 100}%"></i></div></div>
      ${GUIDE.map((s, j) => `<button class="${j === i ? 'on' : ''} ${gs.done[s.id] ? 'done' : ''}" data-act="guide-go" data-i="${j}"><span class="n">${gs.done[s.id] ? '✓' : j + 1}</span><span class="lbl-t">${s.title}</span></button>`).join('')}</div>
    <div class="guide-main">
      <span class="kicker">Step ${i + 1} of ${GUIDE.length} · ${step.kicker}</span>
      <h2>${step.title}</h2>
      <div class="gbody">${step.body}</div>
      <ul class="checklist">${step.checklist.map((c) => `<li><span>${c}</span></li>`).join('')}</ul>
      ${dynamic}
      <div class="tip">${icon('bulb')}<span>${step.tip}</span></div>
      <div class="guide-nav">
        ${tracking ? `<label class="check"><input type="checkbox" data-change="guide-done" data-step="${step.id}" ${gs.done[step.id] ? 'checked' : ''} /> I've done this</label>` : '<span style="margin-right:auto" class="dim">Artists can track their progress here.</span>'}
        <button class="btn" data-act="guide-go" data-i="${i - 1}" ${i === 0 ? 'disabled' : ''}>Back</button>
        ${i < GUIDE.length - 1 ? `<button class="btn primary" data-act="guide-next">${tracking ? 'Done, next step' : 'Next'}</button>` : `<button class="btn gold" data-act="guide-finish">${tracking ? 'Finish guide' : 'Finish'}</button>`}
      </div>
    </div></div>`;
}
function guideView() {
  return `${pageHead('Season Finale', 'Release Guide', 'Your step-by-step path from finished song to Spotify, Apple Music and every other streaming service.')}${guideHtml(false)}`;
}
function openGuideModal() {
  modal(`${modalHead('Release Guide')}<div id="guide-wrap">${guideHtml(true)}</div>`, { wide: true });
}
function rerenderGuide() {
  const inModal = $('#modal-root #guide-wrap');
  if (inModal) inModal.innerHTML = guideHtml(true);
  else render();
}
async function setGuideDone(stepId, done) {
  const m = me();
  if (!m) return;
  try {
    const r = await api('PUT', '/api/me/tutorial', { step: stepId, done });
    m.tutorial = r.tutorial;
  } catch (e) { toast(e.message, 'err'); }
}

function profileView() {
  const u = S.user;
  const m = me();
  const p = m || u;
  return `${pageHead('You', 'Profile', 'Your username is set by your Record Owner. Everything else is yours to change.')}
    <div class="grid-2" style="margin-top:0">
      <div class="card"><div class="card-head"><h3>${icon('user')}Artist profile</h3></div>
        <form data-form="profile">
          <label class="field"><span>Artist name</span><input name="displayName" maxlength="40" value="${esc(p.displayName)}" required /></label>
          <label class="field"><span>Role</span><input name="roleTitle" maxlength="40" value="${esc(p.roleTitle)}" placeholder="Producer, vocalist, engineer…" /></label>
          <label class="field"><span>Bio</span><textarea name="bio" maxlength="500" placeholder="What do you bring to the label?">${esc(p.bio)}</textarea></label>
          <label class="field"><span>Color</span><input type="color" name="color" value="${esc(p.color || '#D62839')}" /></label>
          <button class="btn primary">Save profile</button>
        </form></div>
      <div class="stack">
        <div class="card"><div class="card-head"><h3>${icon('key')}Change PIN</h3></div>
          <form data-form="pin">
            <label class="field"><span>Current PIN</span><input name="currentPin" inputmode="numeric" pattern="\\d{4,6}" maxlength="6" type="password" autocomplete="current-password" required /></label>
            <label class="field"><span>New PIN (4 to 6 digits)</span><input name="newPin" inputmode="numeric" pattern="\\d{4,6}" maxlength="6" type="password" autocomplete="new-password" required /></label>
            <p class="dim" style="font-size:12.5px">Record Owners can see your PIN so they can help if you forget it. Don't reuse a PIN you use anywhere else.</p>
            <button class="btn">Update PIN</button>
          </form></div>
        ${m ? `<div class="card"><div class="card-head"><h3>${icon('award')}Progress</h3></div>
          <p><b>Level ${m.progress.level}: ${esc(m.progress.title)}</b> <span class="muted">· ${m.progress.xp.toLocaleString()} XP total</span></p>
          <div class="bar"><i style="width:${(m.progress.levelXp / m.progress.levelSpan) * 100}%"></i></div>
          <p class="dim" style="font-size:12.5px;margin-top:10px">Earn XP by delivering contracts (+120), hiring labelmates (+60), listing services (+20), sharing music (+150), getting likes (+10), finishing the Release Guide (+200), and +1 XP for every $50 you earn.</p>
          ${badgesHtml(m.badges) || '<p class="muted">No badges yet. Close your first deal to earn one.</p>'}</div>` : ''}
      </div>
    </div>`;
}

function dataView() {
  const g = game();
  const ledger = S.state.ledger;
  const KIND = { advance: 'Signing advance', grant: 'Label grant', fine: 'Label fine', escrow_hold: 'Escrow hold', escrow_refund: 'Escrow refund', payment: 'Payment', label_fee: 'Label cut' };
  return `${pageHead('You', 'Data & Export', `Download everything from ${esc(g.name)} at any time: players, money, contracts, the lobby feed and the music.`)}
    <div class="export-grid">
      <div class="export-card">${icon('download')}<b>Full archive (.zip)</b><p>All data as JSON and spreadsheet-ready CSVs, including every Showcase track and its link.</p><a class="btn primary" href="/api/games/${g.id}/export.zip" download>Download ZIP</a></div>
      <div class="export-card">${icon('chart')}<b>Raw JSON</b><p>One file with the complete season data, for developers or backups.</p><a class="btn" href="/api/games/${g.id}/export.json" download>Download JSON</a></div>
    </div>
    ${isOwner() ? '<p class="dim" style="margin-top:12px;font-size:12.5px">Owner exports include player PINs. Store them securely.</p>' : ''}
    <div class="card" style="margin-top:16px"><div class="card-head"><h3>${icon('dollar')}${isOwner() ? 'Label ledger' : 'Your transactions'}</h3><span class="more">${ledger.length} ${ledger.length === 1 ? 'entry' : 'entries'}</span></div>
      ${ledger.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>When</th>${isOwner() ? '<th>Account</th>' : ''}<th>Type</th><th>Memo</th><th class="r">Amount</th></tr></thead><tbody>
        ${ledger.map((l) => `<tr><td class="nowrap dim">${dateStr(l.at)}</td>${isOwner() ? `<td>${l.userId ? esc(nameOf(l.userId)) : '<b>Label vault</b>'}</td>` : ''}<td><span class="tag">${KIND[l.kind] || esc(l.kind)}</span></td><td>${esc(l.memo)}${l.contractId ? ` <a href="#/contract/${l.contractId}" class="dim">${cno(l.contractId)}</a>` : ''}</td><td class="r num ${l.amount >= 0 ? 'amt-pos' : 'amt-neg'}">${l.amount >= 0 ? '+' : ''}${money(l.amount)}</td></tr>`).join('')}
      </tbody></table></div>` : empty('dollar', 'No transactions yet')}</div>`;
}

// ---------- owner console ----------
function reviewItem(c) {
  const fee = Math.round((c.amount * game().label_cut_pct) / 100);
  return `<div class="review-item"><div style="min-width:0">
    <div style="display:flex;gap:8px;align-items:center"><span class="c-no">${cno(c.id)}</span><a href="#/contract/${c.id}"><b>${esc(c.title)}</b></a></div>
    <div class="parties" style="margin-top:6px">${nameLine(c.buyerId)}<span>hires</span>${nameLine(c.sellerId)}<span class="gold num" style="font-weight:700;font-size:15px">${money(c.amount)}</span><span class="dim">(label cut ${money(fee)})</span></div>
    ${c.terms ? `<div class="terms">${esc(c.terms)}</div>` : ''}</div>
    <div class="c-actions"><button class="btn green" data-act="contract" data-id="${c.id}" data-a="approve">${icon('check')}Approve</button><button class="btn danger" data-act="contract" data-id="${c.id}" data-a="reject">Reject</button></div></div>`;
}

function consoleView() {
  const st = S.state;
  const tabs = [['review', 'Review queue'], ['roster', 'Roster & PINs'], ['treasury', 'Treasury'], ['season', 'Season'], ['new', 'New season']];
  if (!st) S.ui.consoleTab = 'new';
  const t = S.ui.consoleTab;
  let body = '';
  if (t === 'new') body = newSeasonForm();
  else if (t === 'review') {
    const review = st.contracts.filter((c) => c.status === 'review');
    const openDeals = st.contracts.filter((c) => ['offered', 'countered', 'active', 'delivered'].includes(c.status));
    body = `<div class="card"><div class="card-head"><h3>${icon('shield')}Awaiting approval</h3><span class="more">${review.length} pending</span></div>
      <p class="muted" style="margin-top:-6px">Both artists have agreed. Approving starts the work and announces the deal to the lobby. Rejecting refunds the buyer's escrow.</p>
      ${review.length ? review.map(reviewItem).join('') : empty('check', 'Queue is clear')}</div>
      <div class="card"><div class="card-head"><h3>${icon('file')}All open contracts</h3></div>${openDeals.length ? `<div class="contracts">${openDeals.map(contractCard).join('')}</div>` : '<p class="muted">No open contracts.</p>'}</div>`;
  } else if (t === 'roster') {
    const r = st.roster;
    const full = activeRoster().length >= st.game.max_players;
    body = `<div class="card"><div class="card-head"><h3>${icon('plus')}Sign an artist</h3><span class="more">${activeRoster().length} / ${st.game.max_players} spots used</span></div>
      ${st.game.status === 'archived' ? '<p class="muted">This season is archived.</p>' : `<form data-form="add-player"><div class="row">
        <label class="field"><span>Username</span><input name="username" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_.\\-]{3,24}" autocapitalize="off" placeholder="lil.cardinal" ${full ? 'disabled' : ''} /><small>They sign in with this. Letters, numbers, . _ -</small></label>
        <label class="field"><span>Artist name</span><input name="displayName" maxlength="40" placeholder="Lil Cardinal" ${full ? 'disabled' : ''} /></label>
        <label class="field"><span>Role</span><input name="roleTitle" maxlength="40" placeholder="Producer" ${full ? 'disabled' : ''} /></label>
      </div><button class="btn primary" ${full ? 'disabled' : ''}>${full ? 'Roster full' : 'Sign artist'}</button>
      <span class="dim" style="font-size:12.5px;margin-left:10px">They'll create their own PIN the first time they sign in.${st.game.status === 'active' && st.game.starting_balance ? ` They'll get the ${money(st.game.starting_balance)} signing advance right away.` : ''}</span></form>`}</div>
      <div class="card"><div class="card-head"><h3>${icon('users')}Roster & PINs</h3>
        <button class="btn ghost sm more" data-act="reveal-all">${icon(S.ui.reveal.size ? 'eyeOff' : 'eye')}${S.ui.reveal.size ? 'Hide' : 'Show'} all PINs</button></div>
        ${r.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Artist</th><th>Username</th><th>PIN</th><th>Last seen</th><th class="r">Cash</th><th class="r">Actions</th></tr></thead><tbody>
        ${r.map((p) => `<tr class="${p.active ? '' : 'off'}"><td>${nameLine(p.id)}<div class="dim" style="font-size:12px;margin-left:32px">${esc(p.roleTitle)}</div></td>
          <td class="mono">@${esc(p.username)}</td>
          <td>${p.claimed ? `<span class="pin-cell">${S.ui.reveal.has(p.id) ? esc(p.pin) : '••••'}<button class="btn ghost icon sm" data-act="reveal" data-id="${p.id}" aria-label="Toggle PIN">${icon(S.ui.reveal.has(p.id) ? 'eyeOff' : 'eye')}</button></span>` : '<span class="tag" style="background:var(--brass)">Unclaimed</span>'}</td>
          <td class="dim nowrap">${p.lastSeen ? ago(p.lastSeen) : 'Never'}</td><td class="r num gold">${money(p.stats.balance)}</td>
          <td class="r nowrap"><button class="btn sm" data-act="edit-player" data-id="${p.id}">Edit</button> ${p.claimed ? `<button class="btn sm" data-act="reset-pin" data-id="${p.id}">Reset PIN</button>` : ''}
            <button class="btn sm ${p.active ? 'danger' : ''}" data-act="toggle-player" data-id="${p.id}">${p.active ? 'Remove' : 'Restore'}</button></td></tr>`).join('')}
        </tbody></table></div>` : empty('users', 'No artists yet', 'Sign your first artist above.')}</div>`;
  } else if (t === 'treasury') {
    const r = activeRoster();
    body = `<div class="stats" style="margin-top:0">${stat('Label vault', money(st.vault), 'Collected from label cuts', 'red', 'vault')}${stat('Cash in circulation', money(r.reduce((a, p) => a + p.stats.balance, 0)), '', 'gold', 'dollar')}${stat('In escrow', money(r.reduce((a, p) => a + p.stats.escrow, 0)), '', '', 'lock')}</div>
      <div class="card" style="margin-top:16px"><div class="card-head"><h3>${icon('dollar')}Send money</h3></div>
      ${st.game.status === 'archived' ? '<p class="muted">This season is archived.</p>' : `<form data-form="grant">
        <div class="row"><label class="field"><span>Amount ($)</span><input name="amount" type="number" step="1" required placeholder="1000" /><small>Use a negative number to fine an artist.</small></label>
        <label class="field"><span>Memo</span><input name="memo" maxlength="140" placeholder="Bonus for best mixdown" /></label></div>
        <div class="field"><span>Recipients</span><label class="check"><input type="checkbox" name="all" value="1" data-change="grant-all" /> Every active artist (${r.length})</label>
          <div class="pick-list" id="grant-picks">${r.map((p) => `<label class="check"><input type="checkbox" name="u" value="${p.id}" /> ${esc(p.displayName)} <span class="dim">· ${money(p.stats.balance)}</span></label>`).join('') || '<span class="muted">No artists yet.</span>'}</div></div>
        <button class="btn gold">${icon('dollar')}Send</button></form>`}</div>
      <div class="card"><div class="card-head"><h3>Recent label transactions</h3><a class="more" href="#/data">Full ledger →</a></div>
        ${st.ledger.filter((l) => ['grant', 'fine', 'advance', 'label_fee'].includes(l.kind)).slice(0, 15).map((l) => `<div style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid var(--rule)"><span>${l.userId ? esc(nameOf(l.userId)) : '<b>Label vault</b>'}</span><span class="dim">${esc(l.memo)}</span><span class="num ${l.amount >= 0 ? 'amt-pos' : 'amt-neg'}" style="margin-left:auto">${l.amount >= 0 ? '+' : ''}${money(l.amount)}</span></div>`).join('') || '<p class="muted">None yet.</p>'}</div>`;
  } else if (t === 'season') {
    const g = st.game;
    const order = ['setup', 'active', 'showcase', 'archived'];
    const at = order.indexOf(g.status);
    const desc = { setup: 'Sign artists, set the rules', active: 'Clock running, deals open', showcase: 'Listen, uploads when you open them', archived: 'Read-only, data export' };
    const controls = {
      setup: `<button class="btn primary lg" data-act="phase" data-phase="active">${icon('zap')}Start the season</button><p class="dim" style="margin-top:8px">Starts Day 1 of ${g.duration_days}${g.starting_balance ? ` and pays every artist a ${money(g.starting_balance)} signing advance` : ''}.</p>`,
      active: `<button class="btn primary" data-act="phase" data-phase="showcase">${icon('flag')}End season & open Showcase</button><p class="dim" style="margin-top:8px">The season also ends automatically after Day ${g.duration_days}. Open deals stay open for you to settle.</p>`,
      showcase: `<button class="btn" data-act="phase" data-phase="archived">${icon('lock')}Archive season</button> <button class="btn ghost" data-act="phase" data-phase="active">Reopen deals</button><p class="dim" style="margin-top:8px">Archiving makes everything read-only. To reopen deals, make the season longer first.</p>`,
      archived: `<button class="btn" data-act="phase" data-phase="showcase">Reopen Showcase</button>`,
    }[g.status];
    body = `<div class="card"><div class="card-head"><h3>${icon('clock')}Season phase</h3></div>
      <div class="phase-track">${order.map((p, i) => `<div class="${i === at ? 'on' : i < at ? 'past' : ''}"><b>${phaseLabel[p]}</b><small>${desc[p]}</small></div>`).join('')}</div>${controls}</div>
      <div class="card"><div class="card-head"><h3>${icon('upload')}Music uploads</h3><span class="status ${uploadsOpen() ? 's-completed' : 's-cancelled'}" style="margin-left:auto">${uploadsOpen() ? 'Open' : 'Closed'}</span></div>
        <p class="muted">${uploadsOpen() ? 'Artists can share links to their tracks in the Showcase right now.' : "Artists can't share music until you open uploads. Ending the season does not open them automatically."}</p>
        ${g.status === 'archived' ? '<p class="dim">Reopen the Showcase to change this.</p>' : uploadToggle(uploadsOpen() ? '' : 'primary')}</div>
      <div class="card"><div class="card-head"><h3>${icon('edit')}Season settings</h3></div>${seasonForm(g, 'settings')}</div>`;
  }
  return `${pageHead('Record Owner', 'Label Console', st ? `Run ${esc(st.game.name)}: approve deals, sign artists, move money and control the season clock.` : 'Create a season to get started.')}
    <div class="tabs">${tabs.filter(([k]) => st || k === 'new').map(([k, l]) => `<button class="${t === k ? 'on' : ''}" data-act="console-tab" data-tab="${k}">${l}${k === 'review' && st ? `<span class="count">${st.contracts.filter((c) => c.status === 'review').length}</span>` : ''}</button>`).join('')}</div>
    ${body}`;
}

function seasonForm(g, form) {
  return `<form data-form="${form}">
    <label class="field"><span>Season name</span><input name="name" maxlength="60" required value="${esc(g?.name || '')}" placeholder="Cardinal Records: Season 1" /></label>
    <div class="row">
      <label class="field"><span>Length (days)</span><input name="durationDays" type="number" min="1" max="365" required value="${g?.duration_days ?? 90}" /><small>Up to 365 days.</small></label>
      <label class="field"><span>Signing advance ($)</span><input name="startingBalance" type="number" min="0" step="1" required value="${g?.starting_balance ?? 10000}" /><small>Each artist gets this on Day 1.</small></label>
    </div>
    <div class="row">
      <label class="field"><span>Label cut (%)</span><input name="labelCutPct" type="number" min="0" max="50" required value="${g?.label_cut_pct ?? 10}" /><small>Taken from each completed deal.</small></label>
      <label class="field"><span>Max artists</span><input name="maxPlayers" type="number" min="1" max="30" required value="${g?.max_players ?? 30}" /><small>Up to 30.</small></label>
    </div>
    <button class="btn primary">${form === 'settings' ? 'Save settings' : 'Create season'}</button></form>`;
}
const newSeasonForm = () => `<div class="card"><div class="card-head"><h3>${icon('plus')}Found a new label season</h3></div>
  <p class="muted" style="margin-top:-6px">Each season is its own game with its own roster (up to 30 artists), money and Showcase.</p>${seasonForm(null, 'new-season')}</div>`;

// ============================================================ modals
function offerModal({ service, sellerId }) {
  const m = me();
  const sellers = activeRoster().filter((p) => p.id !== m.id);
  const seller = service ? person(service.userId) : sellerId ? person(sellerId) : null;
  if (!sellers.length) { toast('There are no other artists to hire yet', 'err'); return; }
  modal(`${modalHead(service ? `Hire ${esc(seller.displayName)}` : 'Make an offer', service ? esc(service.title) : 'Propose custom work to any labelmate.')}
    <form data-form="offer">
      ${service ? `<input type="hidden" name="serviceId" value="${service.id}" /><input type="hidden" name="sellerId" value="${service.userId}" />`
        : `<label class="field"><span>Artist</span><select name="sellerId" required>${sellers.map((p) => `<option value="${p.id}" ${p.id === seller?.id ? 'selected' : ''}>${esc(p.displayName)}${p.roleTitle ? ` (${esc(p.roleTitle)})` : ''}</option>`).join('')}</select></label>`}
      <label class="field"><span>Contract title</span><input name="title" maxlength="100" required value="${esc(service?.title || '')}" placeholder="Hook vocals for my single" /></label>
      <label class="field"><span>Terms</span><textarea name="terms" maxlength="2000" placeholder="What exactly are you paying for? Number of revisions, files to deliver, credit you'll give…"></textarea></label>
      <div class="row">
        <label class="field"><span>Your offer ($)</span><input name="amount" type="number" min="1" max="${m.stats.balance}" step="1" required value="${service ? Math.min(service.price, m.stats.balance) : ''}" />${service ? `<small>Asking price: ${money(service.price)}</small>` : ''}</label>
        <label class="field"><span>Due in (days)</span><input name="dueDays" type="number" min="1" max="365" value="${service?.turnaroundDays || 7}" /></label>
      </div>
      <div class="callout">${icon('lock')}<span>You have <b>${money(m.stats.balance)}</b> in cash. Your offer is held in <b>escrow</b> right away and only paid out when you confirm delivery. The label keeps ${game().label_cut_pct}% of the deal. If the deal falls through, you get it all back.</span></div>
      <div class="modal-foot"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button class="btn primary">${icon('send')}Send offer</button></div>
    </form>`);
}

function serviceModal(s) {
  modal(`${modalHead(s ? 'Edit service' : 'List a service', 'Tell the label what you can do and what it costs.')}
    <form data-form="service">${s ? `<input type="hidden" name="id" value="${s.id}" />` : ''}
      <label class="field"><span>Service</span><input name="title" maxlength="80" required value="${esc(s?.title || '')}" placeholder="Trap beat with stems" /></label>
      <label class="field"><span>Category</span><select name="category">${CATEGORIES.map((c) => `<option ${s?.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <label class="field"><span>Description</span><textarea name="description" maxlength="1000" placeholder="What's included? Revisions? File formats?">${esc(s?.description || '')}</textarea></label>
      <div class="row"><label class="field"><span>Price ($)</span><input name="price" type="number" min="1" step="1" required value="${s?.price || ''}" /></label>
        <label class="field"><span>Turnaround (days)</span><input name="turnaroundDays" type="number" min="1" max="365" required value="${s?.turnaroundDays || 7}" /></label></div>
      ${s ? `<label class="check" style="margin-bottom:14px"><input type="checkbox" name="active" ${s.active ? 'checked' : ''} /> Listed on the Marketplace</label>` : ''}
      <div class="modal-foot"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button class="btn primary">${s ? 'Save' : 'List service'}</button></div>
    </form>`);
}

function contractActionModal(c, a) {
  const cfg = {
    accept: ['Sign this contract?', `You agree to deliver "${esc(c.title)}" for ${money(c.amount)}. It goes to the label for approval next.`, 'Sign contract', 'primary'],
    decline: ['Decline this offer?', `${esc(nameOf(c.buyerId))} gets their ${money(c.escrow)} back.`, 'Decline', 'danger'],
    counter: ['Counter offer', `${esc(nameOf(c.buyerId))} offered ${money(c.amount)}. Name your price.`, 'Send counter', 'primary'],
    accept_counter: ['Accept the counter?', `${esc(nameOf(c.sellerId))} wants ${money(c.amount)}. Escrow will be adjusted to match.`, `Accept ${money(c.amount)}`, 'primary'],
    withdraw: ['Withdraw your offer?', `Your ${money(c.escrow)} comes back to you.`, 'Withdraw', 'danger'],
    approve: ['Approve this deal?', `${esc(nameOf(c.buyerId))} hires ${esc(nameOf(c.sellerId))} for ${money(c.amount)}. It will be announced in the lobby.`, 'Approve deal', 'green'],
    reject: ['Reject this deal?', `The ${money(c.escrow)} in escrow goes back to ${esc(nameOf(c.buyerId))}.`, 'Reject', 'danger'],
    deliver: ['Mark as delivered?', `Let ${esc(nameOf(c.buyerId))} know the work is done. Add a note with links or details.`, 'Mark delivered', 'primary'],
    revise: ['Request changes', `Send the work back to ${esc(nameOf(c.sellerId))} with notes.`, 'Send back', 'primary'],
    confirm: ['Confirm delivery & pay', `This releases ${money(c.escrow)} from escrow to ${esc(nameOf(c.sellerId))} (minus the ${game().label_cut_pct}% label cut). This can't be undone.`, 'Confirm & pay', 'green'],
    complete: ['Force pay out?', `Release ${money(c.escrow)} to ${esc(nameOf(c.sellerId))} now, as if the client confirmed.`, 'Pay out', 'primary'],
    cancel: ['Void this contract?', `Any escrow (${money(c.escrow)}) is returned to ${esc(nameOf(c.buyerId))}.`, 'Void contract', 'danger'],
  }[a];
  const [title, sub, btn, kind] = cfg;
  modal(`${modalHead(title, sub)}
    <form data-form="contract-action"><input type="hidden" name="id" value="${c.id}" /><input type="hidden" name="action" value="${a}" />
      ${a === 'counter' ? `<label class="field"><span>Your price ($)</span><input name="amount" type="number" min="1" step="1" required value="${c.amount}" /></label>` : ''}
      ${a === 'confirm' ? `<div class="field"><span>Rate the work</span><div class="stars" id="stars">${[1, 2, 3, 4, 5].map((n) => `<label class="${n <= 5 ? 'on' : ''}"><input type="radio" name="rating" value="${n}" ${n === 5 ? 'checked' : ''} data-change="stars" />${icon('star')}</label>`).join('')}</div></div>` : ''}
      <label class="field"><span>Note ${['revise', 'reject'].includes(a) ? '' : '(optional)'}</span><textarea name="note" maxlength="1000" ${['revise'].includes(a) ? 'required' : ''} placeholder="${a === 'deliver' ? 'Link to the files, what you delivered…' : a === 'reject' ? 'Why is the label rejecting this?' : 'Anything to add?'}"></textarea></label>
      <div class="modal-foot"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button class="btn ${kind}">${btn}</button></div>
    </form>`);
}

function uploadModal() {
  const done = S.state.contracts.filter((c) => c.status === 'completed' && c.buyerId === S.user.id);
  const credits = done.map((c) => `${nameOf(c.sellerId)}: ${c.title}`).join('\n');
  modal(`${modalHead('Share to the Showcase', 'Link the music you made this season so the whole label can listen.')}
    <form data-form="upload">
      <label class="field"><span>Link to your track</span><input name="url" maxlength="500" required placeholder="https://open.spotify.com/track/…" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" /><small>Spotify, SoundCloud, YouTube, Apple Music, Bandcamp or any other public link.</small></label>
      <label class="field"><span>Track title</span><input name="title" maxlength="100" required /></label>
      <label class="field"><span>Genre</span><input name="genre" maxlength="40" placeholder="Hip-hop, R&B, Pop…" /></label>
      <label class="field"><span>Credits</span><textarea name="credits" maxlength="1000" placeholder="Who worked on it?">${esc(credits)}</textarea><small>Pre-filled from the contracts you paid for this season.</small></label>
      <label class="field"><span>About the track</span><textarea name="description" maxlength="1000"></textarea></label>
      <div class="modal-foot"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button class="btn primary">${icon('upload')}Share</button></div>
    </form>`);
}

function trackInfoModal(t) {
  const p = person(t.userId);
  const mine = t.userId === S.user.id || isOwner();
  modal(`${modalHead(esc(t.title), `${esc(p?.displayName)}${t.genre ? ` · ${esc(t.genre)}` : ''}`)}
    ${t.description ? `<p style="white-space:pre-line">${esc(t.description)}</p>` : ''}
    <div class="field"><span>Credits</span><p style="white-space:pre-line" class="${t.credits ? '' : 'muted'}">${esc(t.credits) || 'No credits listed.'}</p></div>
    <p class="dim" style="font-size:12.5px">${plural(t.plays, 'listen')} · ${plural(t.likes, 'like')} · shared ${ago(t.createdAt)}</p>
    <div class="modal-foot">${mine ? `<button class="btn danger" data-act="delete-track" data-id="${t.id}">${icon('trash')}Delete</button>` : ''}<a class="btn primary" ${listenAttrs(t)}>${icon('external')}Listen on ${esc(platformOf(t.url))}</a></div>`);
}

function editPlayerModal(p) {
  modal(`${modalHead(`Edit ${esc(p.displayName)}`, 'Record Owners set usernames. Changing it changes how they sign in.')}
    <form data-form="edit-player"><input type="hidden" name="id" value="${p.id}" />
      <label class="field"><span>Username</span><input name="username" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_.\\-]{3,24}" value="${esc(p.username)}" /></label>
      <label class="field"><span>Artist name</span><input name="displayName" maxlength="40" required value="${esc(p.displayName)}" /></label>
      <label class="field"><span>Role</span><input name="roleTitle" maxlength="40" value="${esc(p.roleTitle)}" /></label>
      <div class="modal-foot"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button class="btn primary">Save</button></div>
    </form>`);
}

function confirmModal(title, text, btn, kind, onOk) {
  modal(`${modalHead(title, text)}<div class="modal-foot"><button class="btn ghost" data-act="close-modal">Cancel</button><button class="btn ${kind}" data-act="confirm-ok">${btn}</button></div>`);
  S._confirm = onOk;
}

// ============================================================ music links
async function shareTrack(d) {
  const ok = await act(() => api('POST', `/api/games/${S.gameId}/tracks`, d));
  if (!ok) return;
  closeModal();
  toast('Your track is live in the Showcase!', 'gold', 'music');
  confetti();
  S.ui.guideStep = null;
  openGuideModal();
}

// Count a listen when someone opens a track's link (the link itself opens in a new tab).
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-listen]');
  if (!a) return;
  const t = S.state?.tracks.find((x) => x.id === Number(a.dataset.listen));
  if (!t || t.userId === S.user?.id) return;
  api('POST', `/api/tracks/${t.id}/play`).then(() => { t.plays += 1; if (!modalOpen()) render(); }).catch(() => {});
});

// ============================================================ routing & render
function currentRoute() {
  const parts = (location.hash.replace(/^#\/?/, '') || 'hq').split('/');
  return [parts[0], parts[1]];
}

function viewFor() {
  const [r, id] = currentRoute();
  if (!S.state) return isOwner() ? consoleView() : empty('lock', "You're not on a label yet", 'Ask your Record Owner to sign you.');
  if (!isOwner() && !me()) return empty('lock', 'Account not found on this roster');
  switch (r) {
    case 'hq': return hqView();
    case 'lobby': return lobbyView();
    case 'market': return marketView();
    case 'contracts': return contractsView();
    case 'contract': return contractDetailView(id);
    case 'roster': return rosterView();
    case 'artist': return artistView(id);
    case 'charts': return chartsView();
    case 'showcase': return showcaseView();
    case 'guide': return guideView();
    case 'profile': return profileView();
    case 'data': return dataView();
    case 'console': return isOwner() ? consoleView() : hqView();
    default: return hqView();
  }
}

function render() {
  const app = $('#app');
  if (!S.user) {
    app.innerHTML = loginView();
    const u = $('input[name=username]');
    if (u) u.focus();
    return;
  }
  const focusedKey = document.activeElement?.dataset?.input;
  const caret = document.activeElement?.selectionStart;
  app.innerHTML = shellView(viewFor());
  if (focusedKey) {
    const el = $(`[data-input="${focusedKey}"]`);
    if (el) { el.focus(); try { el.setSelectionRange(caret, caret); } catch {} }
  }
}

async function start() {
  try { await loadMe(); } catch { S.user = null; render(); return; }
  await refresh();
}

// ============================================================ events
const ACTIONS = {
  nav: (el) => { location.hash = el.dataset.to; },
  'close-modal': closeModal,
  'confirm-ok': async () => { const fn = S._confirm; closeModal(); if (fn) await fn(); },
  'login-back': () => { S.login = freshLogin(); render(); },
  'pin-key': (el) => pinKey(el.dataset.k),
  logout: async () => { await api('POST', '/api/logout').catch(() => {}); S.user = null; S.state = null; S.login = freshLogin(); render(); },
  'market-cat': (el) => { S.ui.marketCat = el.dataset.cat; render(); },
  'contract-tab': (el) => { S.ui.contractTab = el.dataset.tab; render(); },
  'chart-tab': (el) => { S.ui.chartTab = el.dataset.tab; render(); },
  'console-tab': (el) => { S.ui.consoleTab = el.dataset.tab; if (currentRoute()[0] !== 'console') location.hash = '#/console'; else render(); },
  'new-service': () => serviceModal(null),
  'edit-service': (el) => serviceModal(S.state.services.find((s) => s.id === Number(el.dataset.id))),
  offer: (el) => offerModal({ service: S.state.services.find((s) => s.id === Number(el.dataset.id)) }),
  'custom-offer': (el) => offerModal({ sellerId: Number(el.dataset.seller) || null }),
  contract: (el) => contractActionModal(S.state.contracts.find((c) => c.id === Number(el.dataset.id)), el.dataset.a),
  upload: uploadModal,
  like: async (el) => {
    try {
      await api('POST', `/api/tracks/${el.dataset.id}/like`);
      await loadState();
      if (!modalOpen()) render();
    } catch (e) { toast(e.message, 'err'); }
  },
  'track-info': (el) => trackInfoModal(S.state.tracks.find((t) => t.id === Number(el.dataset.id))),
  'delete-track': (el) => confirmModal('Delete this track?', 'It will be removed from the Showcase for everyone.', 'Delete', 'danger', () => {
    return act(() => api('DELETE', `/api/tracks/${el.dataset.id}`), 'Track deleted');
  }),
  'guide-modal': () => { S.ui.guideStep = null; openGuideModal(); },
  'guide-go': (el) => { S.ui.guideStep = Math.max(0, Number(el.dataset.i)); rerenderGuide(); },
  'guide-next': async () => {
    const step = GUIDE[S.ui.guideStep];
    if (me() && !guideState().done[step.id]) await setGuideDone(step.id, true);
    S.ui.guideStep += 1;
    rerenderGuide();
    $('.guide-main')?.scrollIntoView({ block: 'nearest' });
  },
  'guide-finish': async () => {
    const m = me();
    if (!m) { S.ui.guideStep = 'done'; return rerenderGuide(); }
    const last = GUIDE[GUIDE.length - 1];
    if (!guideState().done[last.id]) await setGuideDone(last.id, true);
    const left = GUIDE.filter((s) => !guideState().done[s.id]);
    if (left.length) {
      toast(`${plural(left.length, 'step')} left. Check them off to finish.`, 'err');
      S.ui.guideStep = GUIDE.indexOf(left[0]);
      return rerenderGuide();
    }
    try {
      const r = await api('PUT', '/api/me/tutorial', { step: last.id, done: true, completed: true });
      m.tutorial = r.tutorial;
    } catch (e) { return toast(e.message, 'err'); }
    S.ui.guideStep = 'done';
    confetti();
    toast('Release Guide complete! +200 XP', 'gold', 'award');
    rerenderGuide();
    loadState().then(() => { if (!modalOpen()) render(); });
  },
  reveal: (el) => { const id = Number(el.dataset.id); S.ui.reveal.has(id) ? S.ui.reveal.delete(id) : S.ui.reveal.add(id); render(); },
  'reveal-all': () => { S.ui.reveal = S.ui.reveal.size ? new Set() : new Set(S.state.roster.map((p) => p.id)); render(); },
  'edit-player': (el) => editPlayerModal(S.state.roster.find((p) => p.id === Number(el.dataset.id))),
  'reset-pin': (el) => {
    const p = S.state.roster.find((x) => x.id === Number(el.dataset.id));
    confirmModal(`Reset ${esc(p.displayName)}'s PIN?`, 'Their PIN is cleared and they are signed out. They will create a new PIN the next time they sign in.', 'Reset PIN', 'danger',
      () => act(() => api('POST', `/api/players/${p.id}/reset-pin`), 'PIN reset'));
  },
  'toggle-player': (el) => {
    const p = S.state.roster.find((x) => x.id === Number(el.dataset.id));
    if (!p.active) return act(() => api('PATCH', `/api/players/${p.id}`, { active: true }), `${p.displayName} is back on the roster`);
    confirmModal(`Remove ${esc(p.displayName)}?`, "They are signed out and can't sign in. Their money, deals and history stay in the records, and you can restore them later.", 'Remove', 'danger',
      () => act(() => api('PATCH', `/api/players/${p.id}`, { active: false }), 'Artist removed'));
  },
  uploads: (el) => {
    const open = el.dataset.open === '1';
    confirmModal(open ? 'Open music uploads?' : 'Close music uploads?',
      open ? 'Every artist on this season can upload tracks to the Showcase, and the lobby is told.' : 'Artists won\'t be able to upload new tracks. Tracks already uploaded stay up.',
      open ? 'Open uploads' : 'Close uploads', open ? 'primary' : 'danger',
      () => act(() => api('POST', `/api/games/${S.gameId}/uploads`, { open }), open ? 'Uploads are open' : 'Uploads closed'));
  },
  phase: (el) => {
    const ph = el.dataset.phase;
    const text = {
      active: game().status === 'setup' ? 'The clock starts now and signing advances are paid out.' : 'Deals reopen for the remaining days.',
      showcase: game().status === 'archived' ? 'Artists can listen again. Open uploads separately if you want them.' : "No new deals can be made. Music uploads stay closed until you open them.",
      archived: 'The season becomes read-only. Data stays downloadable.',
    }[ph];
    confirmModal(`Move to ${phaseLabel[ph]}?`, text, 'Confirm', 'primary', () => act(() => api('POST', `/api/games/${S.gameId}/phase`, { phase: ph }), 'Season updated'));
  },
};

const FORMS = {
  lookup: async (d) => {
    try {
      const info = await api('POST', '/api/login/lookup', { username: d.username });
      Object.assign(S.login, { username: d.username, info, step: info.claimed ? 'pin' : 'claim1', pin: '', error: '' });
    } catch (e) { S.login.username = d.username; toast(e.message, 'err'); }
    render();
  },
  chat: async (d, f) => { if (await act(() => api('POST', `/api/games/${S.gameId}/feed`, { message: d.message }))) f.reset(); },
  offer: async (d) => {
    const ok = await act(() => api('POST', `/api/games/${S.gameId}/contracts`, { ...d, sellerId: Number(d.sellerId), amount: Number(d.amount), dueDays: d.dueDays ? Number(d.dueDays) : null }), 'Offer sent. Your money is in escrow.');
    if (ok) { closeModal(); S.ui.contractTab = 'open'; location.hash = `#/contract/${ok.id}`; }
  },
  service: async (d) => {
    const body = { ...d, price: Number(d.price), turnaroundDays: Number(d.turnaroundDays) };
    const ok = d.id ? await act(() => api('PATCH', `/api/services/${d.id}`, { ...body, active: !!d.active }), 'Service updated')
      : await act(() => api('POST', `/api/games/${S.gameId}/services`, body), 'Service listed on the Marketplace');
    if (ok) closeModal();
  },
  'contract-action': async (d) => {
    const body = { action: d.action, note: d.note || '' };
    if (d.amount) body.amount = Number(d.amount);
    if (d.rating) body.rating = Number(d.rating);
    const msgs = { accept: 'Signed! Sent to the label for approval.', approve: 'Deal approved and announced', confirm: 'Paid! Deal complete.', complete: 'Paid out', deliver: 'Marked delivered' };
    const ok = await act(() => api('POST', `/api/contracts/${d.id}/action`, body), msgs[d.action] || 'Contract updated');
    if (ok) { closeModal(); if (['confirm', 'complete', 'approve'].includes(d.action)) confetti(); }
  },
  upload: (d) => shareTrack(d),
  profile: (d) => act(async () => { await api('PUT', '/api/me', d); await loadMe(); }, 'Profile saved'),
  pin: async (d, f) => { if (await act(async () => { await api('PUT', '/api/me/pin', d); await loadMe(); }, 'PIN updated')) f.reset(); },
  'add-player': async (d, f) => { if (await act(() => api('POST', `/api/games/${S.gameId}/players`, d), `${d.displayName || d.username} signed to the label`)) f.reset(); },
  'edit-player': async (d) => { if (await act(() => api('PATCH', `/api/players/${d.id}`, d), 'Artist updated')) closeModal(); },
  grant: async (d, f) => {
    const ids = new FormData(f).getAll('u').map(Number);
    const amount = Number(d.amount);
    const body = { amount, memo: d.memo, userIds: d.all ? 'all' : ids };
    if (await act(() => api('POST', `/api/games/${S.gameId}/grants`, body), amount > 0 ? `Sent ${money(amount)}` : `Fined ${money(-amount)}`)) f.reset();
  },
  settings: (d) => act(() => api('PATCH', `/api/games/${S.gameId}`, d), 'Settings saved'),
  'new-season': async (d) => {
    try {
      const r = await api('POST', '/api/games', d);
      toast('Season created. Now sign your artists.', 'ok');
      store.set('cr.game', r.id);
      await loadMe();
      S.ui.consoleTab = 'roster';
      await refresh();
    } catch (e) { toast(e.message, 'err'); }
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  if (el.tagName === 'A' && el.getAttribute('href')) return;
  // Every modal sits inside the backdrop, so only a click on the backdrop itself counts;
  // anything else (like a form's submit button) must keep its default behavior.
  if (el.dataset.act === 'modal-bg') { if (e.target === el) closeModal(); return; }
  const fn = ACTIONS[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el, e); }
});

document.addEventListener('submit', (e) => {
  const f = e.target.closest('[data-form]');
  if (!f) return;
  e.preventDefault();
  const fn = FORMS[f.dataset.form];
  if (fn) fn(Object.fromEntries(new FormData(f)), f);
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  const k = el.dataset.change;
  if (k === 'switch-game') {
    S.gameId = Number(el.value);
    store.set('cr.game', S.gameId);
    await refresh();
  } else if (k === 'guide-done') {
    await setGuideDone(el.dataset.step, el.checked);
    rerenderGuide();
  } else if (k === 'grant-all') {
    $$('#grant-picks input').forEach((i) => { i.disabled = el.checked; });
  } else if (k === 'stars') {
    const v = Number(el.value);
    $$('#stars label').forEach((l, i) => l.classList.toggle('on', i < v));
  }
});

document.addEventListener('input', (e) => {
  if (e.target.dataset.input === 'market-q') { S.ui.marketQ = e.target.value; render(); }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalOpen()) return closeModal();
  if (!S.user && S.login.step !== 'user') {
    if (/^\d$/.test(e.key)) pinKey(e.key);
    else if (e.key === 'Backspace') pinKey('del');
    else if (e.key === 'Enter') pinKey('ok');
  }
});

window.addEventListener('hashchange', () => { closeModal(); render(); window.scrollTo(0, 0); });

// Keep everyone in sync: re-fetch the label state every 10s, without clobbering
// an open modal or a form someone is typing in.
setInterval(async () => {
  if (!S.user || !S.gameId || document.hidden) return;
  const before = S.stateKey;
  try { await loadState(); } catch { return; }
  const typing = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !document.activeElement.dataset.input;
  if (S.stateKey !== before && !modalOpen() && !typing) render();
}, 10_000);

setInterval(() => { const c = $('#clock'); if (c) c.textContent = clockText(); }, 20_000);

start();

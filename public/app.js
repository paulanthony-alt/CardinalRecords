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
  ui: { contractTab: 'action', reveal: new Set(), guideStep: null, chartTab: 'worth', adminOpen: false },
};
function freshLogin() { return { step: 'user', username: '', info: null, pin: '', firstPin: '', error: '' }; }

const isOwner = () => S.user?.role === 'owner';
const game = () => S.state?.game;
const me = () => S.state?.roster.find((p) => p.id === S.user.id);
const person = (id) => S.state?.roster.find((p) => p.id === id) || S.state?.owners.find((o) => o.id === id) || S.state?.former?.find((o) => o.id === id);
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
  ? `<button class="btn ${cls}" data-act="uploads" data-open="${uploadsOpen() ? 0 : 1}">${icon(uploadsOpen() ? 'lock' : 'music')}${uploadsOpen() ? 'Close music sharing' : 'Open music sharing'}</button>` : '');

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
  const ids = liveGames().map((g) => g.id);
  S.gameId = isOwner() ? (ids.includes(saved) ? saved : ids[0] ?? null) : S.user.gameId;
}

async function loadState() {
  if (!S.gameId) { S.state = null; S.stateKey = ''; return; }
  const st = await api('GET', `/api/games/${S.gameId}/state`);
  delete st.serverTime;
  S.rev = st.rev;
  delete st.rev;
  S.loadedAt = Date.now();
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
const phaseLabel = { setup: 'Pre-season', active: 'Season live', showcase: 'Showcase', archived: 'Archived', offloaded: 'Offloaded' };
const phaseClass = { setup: 'offered', active: 'active', showcase: 'review', archived: 'cancelled', offloaded: 'cancelled' };
/** Seasons that still have data (offloaded ones only keep a one-line record). */
const liveGames = () => S.games.filter((x) => x.status !== 'offloaded');
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
  if (seller && c.status === 'offered' && isLive) out.push(['accept', 'Sign contract', 'primary'], ['decline', 'Decline', 'danger']);
  if (seller && c.status === 'countered') out.push(['decline', 'Retract', 'danger']);
  if (buyer && ['offered', 'countered'].includes(c.status)) out.push(['withdraw', 'Withdraw', 'danger']);
  if (seller && c.status === 'active') out.push(['deliver', 'Mark delivered', 'primary']);
  if (buyer && c.status === 'delivered') out.push(['confirm', 'Confirm & pay', 'green'], ['revise', 'Request changes', '']);
  if (isOwner() && c.status === 'review') out.push(['approve', 'Approve', 'green'], ['reject', 'Reject', 'danger']);
  if (isOwner() && ['active', 'delivered'].includes(c.status)) out.push(['complete', 'Force pay out', '']);
  if (isOwner() && ['active', 'delivered', 'completed'].includes(c.status) && !c.events.some((e) => e.action === 'late_fee')) out.push(['late_fee', 'Late fee', 'danger']);
  if (isOwner() && ['active', 'delivered'].includes(c.status)) out.push(['undone', 'Work not done', 'danger']);
  if (isOwner() && OPEN.includes(c.status) && c.status !== 'review') out.push(['cancel', 'Void & refund', 'danger']);
  return out;
}
const needsMe = (c) => actionsFor(c).some(([a]) => ['accept', 'confirm', 'approve', 'deliver'].includes(a));

/** How a deal was priced from the rate sheet, e.g. "3 hours × $40" or "Project rate". */
function pricingText(c) {
  if (!c.jobId) return '';
  const job = S.state.rates.jobs.find((j) => j.id === c.jobId);
  if (c.pricing === 'project') return 'Project rate';
  const unit = job?.unit === 'item' ? 'item' : 'hour';
  return `${plural(c.quantity, unit)} × ${money(c.unitRate)}`;
}

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
      <div class="sub">${esc(nameOf(c.buyerId))} hired ${esc(nameOf(c.sellerId))}${c.jobId ? ` · ${esc(pricingText(c))}` : ''}${c.dueDays ? ` · due in ${plural(c.dueDays, 'day')}` : ''}</div></div>
    <div class="it-amt mono">${money(c.amount)}</div>
    ${acts.length ? `<div class="c-actions">${acts.slice(0, 3).map(([a, l, k]) => `<button class="btn sm ${k}" data-act="contract" data-id="${c.id}" data-a="${a}">${l}</button>`).join('')}</div>` : ''}
  </div>`;
}

// ============================================================ login
// ============================================================ privacy
// Keep this in step with what the server actually stores (see README: Privacy).
function privacyModal() {
  modal(`${modalHead('Privacy: only what the game needs', 'Cardinal Records collects the minimum it needs to run the class game, and nothing else.')}
    <div class="privacy">
      <h4>What we keep</h4>
      <ul>
        <li>Your <b>username</b> (set by your Record Owner) and the <b>artist name, role, bio and color</b> you choose.</li>
        <li>Your <b>PIN</b>, so you can sign in. Record Owners can look it up if you forget it, so don't reuse a PIN from anywhere else.</li>
        <li><b>What you do in the game:</b> your label money, deals and ratings, lobby messages, Release Guide progress and the music links you share.</li>
        <li>When you were <b>last online</b>, for the online dot.</li>
        <li>One <b>sign-in cookie</b> that keeps you signed in on this device for up to 30 days. No other cookies.</li>
      </ul>
      <h4>What we don't collect</h4>
      <ul>
        <li>No email, phone number, address, birthday, photo or location.</li>
        <li>No ads, analytics or tracking, and nothing is sold or shared. The site loads nothing from other companies.</li>
        <li>Music links open on the streaming site (Spotify, SoundCloud…), which has its own privacy policy.</li>
      </ul>
      <h4>Who can see it</h4>
      <ul>
        <li><b>Record Owners</b> (your teachers) can see everything, including PINs.</li>
        <li><b>Other artists</b> on your label see your public profile, balance and chart rank, approved deals, the lobby and the Showcase.</li>
        <li>Your <b>fines, transactions and private deal details</b> stay between you, the other artist on that deal, and the Record Owners.</li>
      </ul>
      <h4>How long we keep it</h4>
      <ul>
        <li>You can download your data any time from Data.</li>
        <li>At the end of the season, Record Owners save a backup of the class records and then <b>offload</b> the season, which deletes it from the server.</li>
        <li>The site runs on Render (website) and Neon (database) in the US. Like any web host, they keep short-term technical logs, such as IP addresses, to run their services.</li>
      </ul>
    </div>
    <div class="modal-foot"><button class="btn primary" data-act="close-modal">Got it</button></div>`);
}
const privacyLink = (cls = 'hint', style = '') => `<p class="${cls}"${style ? ` style="${style}"` : ''}><button type="button" class="linkbtn" data-act="privacy">${icon('lock')}Privacy: we only collect what the game needs</button></p>`;

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
      <p class="hint">No account? Ask a Record Owner to sign you to the label.</p>
      ${privacyLink()}`;
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
      <p class="hint">You can also type on your keyboard.</p>
      ${privacyLink()}`;
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
  const items = [];
  items.push(
    { group: 'The Label' },
    { to: 'hq', label: 'HQ', ic: 'home' },
    { to: 'lobby', label: 'Lobby', ic: 'message' },
    { to: 'rates', label: 'Rate Sheet', ic: 'dollar' },
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
  if (!st) return isOwner() ? ['Create a season', '#/admin/new'] : null;
  if (isOwner()) {
    const n = st.contracts.filter((c) => c.status === 'review').length;
    return [n ? `Review queue (${n})` : 'Admin', n ? '#/admin/review' : '#/admin/season'];
  }
  const n = st.contracts.filter(needsMe).length;
  if (n) return [`Your move (${n})`, '#/contracts'];
  if (uploadsOpen() && !me()?.stats.tracks) return ['Share your music', null, 'upload'];
  if (live()) return ['Hire someone', '#/rates'];
  if (['showcase', 'archived'].includes(st.game.status)) return ['Release Guide', '#/guide'];
  return ['Rate Sheet', '#/rates'];
}

const clockText = () => new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

const ADMIN_TABS = [
  ['review', 'Review queue', 'shield'], ['roster', 'Roster & PINs', 'users'], ['treasury', 'Treasury & fines', 'dollar'],
  ['rates', 'Rate sheet', 'file'], ['season', 'Season settings', 'clock'], ['seasons', 'All seasons', 'flag'],
  ['backups', 'Backups & offload', 'download'], ['new', 'New season', 'plus'],
];
/** Admin tabs that work without a season open. */
const NO_SEASON_TABS = ['seasons', 'backups', 'new'];

/** The Record Owners' pull-down menu. It sits outside the scrolling menu so it never gets clipped. */
function adminMenu(route) {
  if (!isOwner()) return '';
  const review = S.state ? S.state.contracts.filter((c) => c.status === 'review').length : 0;
  const open = S.ui.adminOpen;
  const items = ADMIN_TABS.filter(([k]) => S.state || NO_SEASON_TABS.includes(k));
  return `<div class="admin-menu">
    <button class="mi admin-btn ${route === 'admin' ? 'on' : ''} ${open ? 'open' : ''}" data-act="admin-menu" aria-haspopup="menu" aria-expanded="${open}">${icon('shield')}Admin${review ? `<span class="count">${review}</span>` : ''}<span class="caret" aria-hidden="true">▾</span></button>
    ${open ? `<div class="admin-drop win" role="menu"><div class="tb"><span class="t">Record Owner</span></div>
      ${items.map(([k, l, ic]) => `<a role="menuitem" href="#/admin/${k}" data-act="admin-go">${icon(ic)}${l}${k === 'review' && review ? `<span class="count">${review}</span>` : ''}</a>`).join('')}</div>` : ''}
  </div>`;
}

function shellView(view) {
  const g = game();
  const route = currentRoute()[0];
  const navRoute = { contract: 'contracts', artist: 'roster' }[route] || route;
  const nav = navItems().filter((it) => !it.group).map((it) =>
    `<a href="#/${it.to}" class="mi ${navRoute === it.to ? 'on' : ''}">${it.label}${it.count ? `<span class="count">${it.count}</span>` : ''}</a>`).join('');
  const switcher = isOwner() && S.games.length
    ? `<select class="season-pick" data-change="switch-game" aria-label="Label season">${liveGames().map((x) => `<option value="${x.id}" ${x.id === S.gameId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`
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
      ${adminMenu(route)}
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
  if (g.status === 'setup') return `<div class="banner amber">${icon('clock')}<div><b>Pre-season</b><p>The Record Owner hasn't started the clock yet. ${m ? 'Read the rate sheet now so you know what every job pays on Day 1.' : 'Sign your artists, then start the season from Admin → Season settings.'}</p></div>
    <div class="actions">${m ? '<a class="btn" href="#/rates">Rate sheet</a>' : '<a class="btn primary" href="#/admin/season">Season settings</a>'}</div></div>`;
  if (g.status === 'active' && uploadsOpen()) return `<div class="banner purple">${icon('upload')}<div><b>Music sharing is open</b><p>${m ? 'A Record Owner opened music sharing early. Share a link to your tracks in the Showcase whenever they are ready.' : 'Artists can share links to their music in the Showcase now.'}</p></div>
    <div class="actions">${m ? '<button class="btn primary" data-act="upload">Share your music</button>' : uploadToggle()}<a class="btn" href="#/showcase">Showcase</a></div></div>`;
  if (g.status === 'active' && g.clock.daysLeft <= 7) return `<div class="banner red">${icon('flag')}<div><b>Final stretch: ${plural(g.clock.daysLeft, 'day')} left</b><p>Wrap up your deals and finish your music. The Showcase opens when the season ends.</p></div></div>`;
  if (g.status === 'showcase' && !uploadsOpen()) return `<div class="banner purple">${icon('music')}<div><b>The season has wrapped</b><p>${m ? 'Get your final mix ready. Music sharing opens once a Record Owner turns it on.' : "Artists can't share their music until you open music sharing."}</p></div>
    <div class="actions">${uploadToggle('primary')}<a class="btn" href="#/showcase">Showcase</a></div></div>`;
  if (g.status === 'showcase') {
    const tracks = m ? m.stats.tracks : 0;
    return `<div class="banner purple">${icon('music')}<div><b>Music sharing is open</b><p>${m ? (tracks ? `You've shared ${plural(tracks, 'track')}. Next: get it on streaming services.` : 'Share a link to the music you made this season so your labelmates can listen.') : 'Artists are sharing their music now.'}</p></div>
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
          : empty('check', 'Nothing waiting on you', live() ? 'Open the rate sheet to hire a labelmate for a job.' : '', live() ? '<a class="btn primary" href="#/rates" style="margin-top:8px">Open the rate sheet</a>' : '')}
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
  if (!st) return pageHead('Record Owner', 'Welcome to Cardinal Records', 'Create your first label season to start signing artists.', '<a class="btn primary" href="#/admin/new">Create a season</a>');
  const r = activeRoster();
  const cash = r.reduce((a, p) => a + p.stats.balance, 0);
  const escrow = r.reduce((a, p) => a + p.stats.escrow, 0);
  const review = st.contracts.filter((c) => c.status === 'review');
  const done = st.contracts.filter((c) => c.status === 'completed');
  return `${phaseBanner()}
    ${pageHead('Record Owner', esc(st.game.name), 'Your label at a glance.', '<a class="btn primary" href="#/admin/review">Admin</a>')}
    <div class="stats" style="margin-top:0">
      ${stat('Artists signed', `${r.length}<span class="dim" style="font-size:15px"> / ${st.game.max_players}</span>`, '', '', 'users')}
      ${stat('Cash in circulation', money(cash), 'Across all artists', 'gold', 'dollar')}
      ${stat('Held in escrow', money(escrow), 'Open offers and deals', '', 'lock')}
      ${stat('Label vault', money(st.vault), st.game.label_cut_pct ? `${st.game.label_cut_pct}% cut on completed deals` : 'No label cut this season', 'red', 'vault')}
      ${stat('Deals closed', done.length, money(done.reduce((a, c) => a + c.amount, 0)) + ' total', '', 'check')}
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-head"><h3>${icon('shield')}Awaiting your review</h3><a class="more" href="#/admin/review">Review queue →</a></div>
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

// ---------- rate sheet ----------
const unitLabel = (j) => (j.unit === 'item' ? 'per item' : 'per hour / class');
const fineAmount = (f) => (f.type === 'percent' ? `${f.min}% to ${f.max}% of account` : f.type === 'min' ? `${money(f.amount)} minimum` : f.type === 'per' ? `${money(f.amount)} per ${f.per}` : money(f.amount));

function ratesView() {
  const r = S.state.rates;
  const canHire = me() && live();
  const jobs = r.jobs.filter((j) => j.active);
  const jobRow = (j) => `<tr><td><b>${esc(j.name)}</b></td><td class="r num">${money(j.unitRate)}<div class="dim" style="font-size:11px">${unitLabel(j)}</div></td>
    <td class="r num">${j.projectRate ? money(j.projectRate) : '—'}</td>${canHire ? `<td class="r"><button class="btn sm primary" data-act="hire" data-job="${esc(j.id)}">Hire</button></td>` : ''}</tr>`;
  return `${pageHead('The Label', 'Rate Sheet', 'Every job pays the rate on this sheet. Pick a job, pick who does it, and pay by the hour, by the item or the project rate.', canHire ? `<button class="btn primary" data-act="hire">${icon('plus')}Hire someone</button>` : '')}
    <div class="banner amber">${icon('shield')}<div>${r.rules.map((t) => `<p style="margin:0 0 6px">${esc(t)}</p>`).join('')}</div></div>
    ${!live() && me() ? `<div class="banner grey">${icon('lock')}<div><b>Hiring is closed</b><p>${game().status === 'setup' ? 'Deals open on Day 1, when the season starts.' : 'The season has wrapped, so no new deals can be made.'}</p></div></div>` : ''}
    <div class="grid-2" style="margin-top:0">
      <div class="card"><div class="card-head"><h3>${icon('dollar')}Income: jobs</h3><span class="more">${jobs.length} jobs</span></div>
        <div class="table-wrap"><table class="t"><thead><tr><th>Job</th><th class="r">Rate</th><th class="r">Project rate</th>${canHire ? '<th></th>' : ''}</tr></thead>
        <tbody>${jobs.map(jobRow).join('')}</tbody></table></div></div>
      <div class="stack">
        <div class="card"><div class="card-head"><h3>${icon('award')}Income from the label</h3></div>
          <table class="t"><tbody>
            <tr><td><b>Advance</b><div class="dim" style="font-size:12px">All students receive an advance at the beginning of the game.</div></td><td class="r num">${money(r.advance)}</td></tr>
            ${r.payouts.map((p) => `<tr><td><b>${esc(p.name)}</b><div class="dim" style="font-size:12px">${esc(p.note)}</div></td><td class="r num nowrap">${p.type === 'min' ? `${money(p.amount)}+` : p.type === 'per' ? `${money(p.amount)} / ${esc(p.per)}` : money(p.amount)}</td></tr>`).join('')}
          </tbody></table></div>
        <div class="card"><div class="card-head" style="background:var(--redd)"><h3>${icon('flag')}Expenses, fees & fines</h3></div>
          <table class="t"><tbody>${r.fines.map((f) => `<tr><td><b>${esc(f.name)}</b><div class="dim" style="font-size:12px">${esc(f.note)}</div></td><td class="r num nowrap">${fineAmount(f)}</td></tr>`).join('')}</tbody></table></div>
      </div>
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
    action: isOwner() ? 'Contracts both artists agreed to, waiting for a teacher to approve before work starts.' : 'Offers to sign, work to deliver, and deliveries to confirm.',
    open: 'Deals in progress. Money stays in escrow until the work is delivered and confirmed.',
    history: 'Paid, declined, rejected and cancelled contracts.',
    board: 'Every approved deal at the label. This is what the whole lobby sees.',
  }[cur[0]];
  return `${pageHead('The Label', 'Contracts', 'Pick a job from the rate sheet → artist signs → a teacher approves → work → delivery → payment. The buyer’s money sits in escrow the whole time.', me() && live() ? `<a class="btn primary" href="#/rates">${icon('plus')}Hire someone</a>` : '')}
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
  const evLabel = { offered: 'made an offer', accept: 'signed the contract', counter: 'countered', accept_counter: 'accepted the counter offer', decline: 'declined', withdraw: 'withdrew the offer', approve: 'approved the deal', reject: 'rejected the deal', deliver: 'marked the work delivered', revise: 'requested changes', confirm: 'confirmed delivery and paid', complete: 'paid out the deal', cancel: 'voided the contract', late_fee: 'charged the artist a late fee', undone: 'marked the work not done, fined the artist and refunded the client' };
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
          <table class="money-table">${c.jobId ? `<tr><td>Rate sheet: ${esc(S.state.rates.jobs.find((j) => j.id === c.jobId)?.name || c.jobId)}</td><td>${esc(pricingText(c))}</td></tr>` : ''}<tr><td>Deal value</td><td>${money(c.amount)}</td></tr>${g.label_cut_pct ? `<tr><td>Label cut (${g.label_cut_pct}%)</td><td>-${money(fee)}</td></tr>` : ''}<tr><td>Paid to the Artist on completion</td><td>${money(c.amount - fee)}</td></tr></table>
          <small class="mono muted">Currently held in escrow: ${money(c.escrow)}</small></div>
        ${c.dueDays ? `<p class="clause"><b>Delivery</b>Within ${plural(c.dueDays, 'day')} of label approval.</p>` : ''}
        ${c.rating ? `<p class="clause"><b>Client rating</b>${'★'.repeat(c.rating)}${'☆'.repeat(5 - c.rating)}</p>` : ''}
        <div class="sigs"><div class="sig">${signed.buyer}Client</div><div class="sig">${signed.seller}Artist</div><div class="sig">${signed.owner}Record Owner</div></div>
      </div>
      <div class="stack">
        ${acts.length ? `<div class="card"><div class="card-head"><h3>${icon('zap')}Actions</h3></div><div class="c-actions">${acts.map(([a, l, k]) => `<button class="btn ${k}" data-act="contract" data-id="${c.id}" data-a="${a}">${l}</button>`).join('')}</div></div>` : ''}
        <div class="card"><div class="card-head"><h3>${icon('clock')}History</h3></div>
          ${c.events.length ? `<ul class="timeline">${c.events.map((e) => `<li>${avatar(person(e.actorId), 'sm')}<div style="flex:1;min-width:0"><b>${esc(nameOf(e.actorId))}</b> ${evLabel[e.action] || esc(e.action)}${e.amount != null && ['offered', 'counter'].includes(e.action) ? ` at <b class="gold">${money(e.amount)}</b>` : ''}${e.amount != null && ['late_fee', 'undone'].includes(e.action) ? ` (<b class="red">${money(e.amount)}</b>)` : ''}
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
    </a>`).join('')}</div>` : empty('users', 'No artists yet', isOwner() ? 'Sign artists from Admin → Roster & PINs.' : '')}`;
}

function artistView(id) {
  const p = S.state.roster.find((x) => x.id === Number(id));
  if (!p) return empty('user', 'Artist not found');
  const jobsDone = [...new Set(S.state.contracts.filter((c) => c.sellerId === p.id && c.status === 'completed' && c.jobId)
    .map((c) => S.state.rates.jobs.find((j) => j.id === c.jobId)?.name).filter(Boolean))];
  const deals = S.state.contracts.filter((c) => (c.buyerId === p.id || c.sellerId === p.id) && ['active', 'delivered', 'completed'].includes(c.status));
  const tracks = S.state.tracks.filter((t) => t.userId === p.id);
  const rank = ranking().findIndex((x) => x.id === p.id) + 1;
  const canHire = me() && live() && p.id !== S.user.id && p.active;
  return `<div class="page-head"><div class="kicker"><a href="#/roster" style="text-decoration:none">← Roster</a></div></div>
    <div class="card"><div class="profile-hero">${avatar(p, 'xl')}<div style="flex:1;min-width:0">
      <div class="kicker" style="font-size:11.5px;font-weight:700;letter-spacing:.16em;color:var(--red);text-transform:uppercase">Level ${p.progress.level} · ${esc(p.progress.title)}</div>
      <h1>${esc(p.displayName)}</h1><div class="muted">${esc(p.roleTitle || 'Artist')} · @${esc(p.username)}${online(p) ? ' · <span class="green">Online</span>' : ''}</div>
      ${p.bio ? `<div class="bio">${esc(p.bio)}</div>` : ''}${badgesHtml(p.badges)}</div>
      ${canHire ? `<button class="btn primary" data-act="hire" data-seller="${p.id}">${icon('dollar')}Hire ${esc(p.displayName)}</button>` : ''}</div></div>
    <div class="stats">
      ${stat('Chart', rank ? `#${rank}` : '—', '', 'red', 'chart')}
      ${stat('Net worth', money(p.stats.netWorth), '', 'gold', 'dollar')}
      ${stat('Earned', money(p.stats.earned), '', '', 'award')}
      ${stat('Deals', p.stats.dealsSold + p.stats.dealsBought, `${p.stats.dealsSold} delivered · ${p.stats.dealsBought} hired`, '', 'file')}
      ${stat('Rating', p.stats.rating ? `${p.stats.rating} ★` : '—', '', '', 'star')}
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-head"><h3>${icon('award')}Jobs delivered</h3></div>${jobsDone.length ? `<div class="chips">${jobsDone.map((n) => `<span class="chip">${esc(n)}</span>`).join('')}</div>` : '<p class="muted">No completed jobs yet.</p>'}</div>
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
        <p>At the end of the season, once a Record Owner opens music sharing, every artist shares a link to the music they made here (Spotify, SoundCloud, YouTube…) and the whole label listens. Then you'll get a step-by-step guide to releasing it on streaming services.</p>
        <div class="countdown"><div><b>${left}</b><small>Days to go</small></div><div><b>${g.status === 'setup' ? 0 : g.clock.day}</b><small>Current day</small></div><div><b>${g.duration_days}</b><small>Season length</small></div></div>
        <p class="dim">Use the season to build your track: hire producers, writers, singers and engineers from the Marketplace.</p>
        <div style="display:flex;gap:8px;justify-content:center;margin-top:10px">${uploadToggle()}<a class="btn" href="#/guide">Preview the Release Guide</a></div></div>`;
  }
  const tracks = S.state.tracks;
  const canUpload = m && uploadsOpen();
  return `${phaseBanner()}
    ${pageHead('Season Finale', 'Showcase', `${plural(tracks.length, 'track')} from ${plural(new Set(tracks.map((t) => t.userId)).size, 'artist')}. Tap a track to listen, show some love.`,
      `${uploadToggle()}${canUpload ? `<button class="btn primary" data-act="upload">${icon('upload')}Share your music</button>` : ''}`)}
    ${tracks.length ? `<div class="tracks">${tracks.map(trackCard).join('')}</div>` : empty('music', 'No music yet', canUpload ? 'Be the first to share a track.' : uploadsOpen() ? 'Artists are getting their links ready.' : "Music sharing isn't open yet. A Record Owner will open it.", canUpload ? '<button class="btn primary" data-act="upload" style="margin-top:10px">Share your music</button>' : '')}`;
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
          <p class="dim" style="font-size:12.5px;margin-top:10px">Earn XP by delivering contracts (+120), hiring labelmates (+60), sharing music (+150), getting likes (+10), finishing the Release Guide (+200), and +1 XP for every $50 you earn. The rate sheet's Game Bonus pays $40 for every two different people you hire.</p>
          ${badgesHtml(m.badges) || '<p class="muted">No badges yet. Close your first deal to earn one.</p>'}</div>` : ''}
      </div>
    </div>`;
}

function dataView() {
  const g = game();
  const ledger = S.state.ledger;
  const KIND = { advance: 'Signing advance', grant: 'Label payment', bonus: 'Game bonus', fine: 'Fee / fine', escrow_hold: 'Escrow hold', escrow_refund: 'Escrow refund', payment: 'Payment', label_fee: 'Label cut' };
  return `${pageHead('You', 'Data & Export', `Download everything from ${esc(g.name)} at any time: players, money, contracts, the lobby feed and the music.`)}
    <div class="export-grid">
      <div class="export-card">${icon('download')}<b>Full archive (.zip)</b><p>All data as JSON and spreadsheet-ready CSVs, including every Showcase track and its link.</p><a class="btn primary" href="/api/games/${g.id}/export.zip" download>Download ZIP</a></div>
      <div class="export-card">${icon('chart')}<b>Raw JSON</b><p>One file with the complete season data, for developers or backups.</p><a class="btn" href="/api/games/${g.id}/export.json" download>Download JSON</a></div>
    </div>
    ${privacyLink('dim', 'margin-top:12px;font-size:12.5px')}
    <p class="dim" style="margin-top:12px;font-size:12.5px">${isOwner() ? 'Owner exports include player PINs. Store them securely. For a printable PDF of the class records, use <a href="#/admin/backups">Admin → Backups &amp; offload</a>.' : "Your download has the label's public records plus your own transactions and deals. Other artists' fees and private deal details aren't included."}</p>
    <div class="card" style="margin-top:16px"><div class="card-head"><h3>${icon('dollar')}${isOwner() ? 'Label ledger' : 'Your transactions'}</h3><span class="more">${ledger.length} ${ledger.length === 1 ? 'entry' : 'entries'}</span></div>
      ${ledger.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>When</th>${isOwner() ? '<th>Account</th>' : ''}<th>Type</th><th>Memo</th><th class="r">Amount</th></tr></thead><tbody>
        ${ledger.map((l) => `<tr><td class="nowrap dim">${dateStr(l.at)}</td>${isOwner() ? `<td>${l.userId ? esc(nameOf(l.userId)) : '<b>Label vault</b>'}</td>` : ''}<td><span class="tag">${KIND[l.kind] || esc(l.kind)}</span></td><td>${esc(l.memo)}${l.contractId ? ` <a href="#/contract/${l.contractId}" class="dim">${cno(l.contractId)}</a>` : ''}</td><td class="r num ${l.amount >= 0 ? 'amt-pos' : 'amt-neg'}">${l.amount >= 0 ? '+' : ''}${money(l.amount)}</td></tr>`).join('')}
      </tbody></table></div>` : empty('dollar', 'No transactions yet')}</div>`;
}

// ---------- owner console ----------
function reviewItem(c) {
  const fee = Math.round((c.amount * game().label_cut_pct) / 100);
  const detail = [pricingText(c), fee ? `label cut ${money(fee)}` : ''].filter(Boolean).join(' · ');
  return `<div class="review-item"><div style="min-width:0">
    <div style="display:flex;gap:8px;align-items:center"><span class="c-no">${cno(c.id)}</span><a href="#/contract/${c.id}"><b>${esc(c.title)}</b></a></div>
    <div class="parties" style="margin-top:6px">${nameLine(c.buyerId)}<span>hires</span>${nameLine(c.sellerId)}<span class="gold num" style="font-weight:700;font-size:15px">${money(c.amount)}</span>${detail ? `<span class="dim">(${esc(detail)})</span>` : ''}</div>
    ${c.terms ? `<div class="terms">${esc(c.terms)}</div>` : ''}</div>
    <div class="c-actions"><button class="btn green" data-act="contract" data-id="${c.id}" data-a="approve">${icon('check')}Approve</button><button class="btn danger" data-act="contract" data-id="${c.id}" data-a="reject">Reject</button></div></div>`;
}

/** Checkboxes for picking artists, with an "every active artist" switch. */
function pickArtists(id) {
  const r = activeRoster();
  return `<div class="field"><span>Artists</span><label class="check"><input type="checkbox" name="all" value="1" data-change="pick-all" data-target="${id}" /> Every active artist (${r.length})</label>
    <div class="pick-list" id="${id}">${r.map((p) => `<label class="check"><input type="checkbox" name="u" value="${p.id}" /> ${esc(p.displayName)} <span class="dim">· ${money(p.stats.balance)}</span></label>`).join('') || '<span class="muted">No artists yet.</span>'}</div></div>`;
}

/** A rate-sheet item picker whose extra fields (how many, amount, percent) follow the chosen item. */
function itemForm(form, label, items, button) {
  const first = items[0];
  const opt = (i) => `<option value="${esc(i.id)}" data-type="${i.type}" data-per="${esc(i.per || '')}" data-amount="${i.amount}" data-min="${i.min ?? ''}" data-max="${i.max ?? ''}">${esc(i.name)} · ${fineAmount(i)}</option>`;
  const show = (t) => (first?.type === t ? '' : 'hidden');
  return `<form data-form="${form}">
    <label class="field"><span>${label}</span><select name="itemId" data-change="item-pick">${items.map(opt).join('')}</select></label>
    <div class="row">
      <label class="field" data-show="per" ${show('per')}><span>How many <span data-per-label>${esc(first?.per || '')}</span>s</span><input name="quantity" type="number" min="1" max="100" step="1" value="1" /></label>
      <label class="field" data-show="min" ${show('min')}><span>Amount ($)</span><input name="amount" type="number" step="1" min="${first?.type === 'min' ? first.amount : 0}" value="${first?.type === 'min' ? first.amount : ''}" /><small>At least the sheet's minimum.</small></label>
      <label class="field" data-show="percent" ${show('percent')}><span>Percent of account</span><input name="percent" type="number" step="1" min="50" max="100" value="50" /><small>Of the cash each artist has now.</small></label>
      <label class="field"><span>Note (optional)</span><input name="memo" maxlength="140" placeholder="What it's for" /></label>
    </div>
    ${pickArtists(`${form}-picks`)}
    <button class="btn primary">${button}</button></form>`;
}

function adminView(tab) {
  const st = S.state;
  const t = st ? (ADMIN_TABS.some(([k]) => k === tab) ? tab : 'review') : (NO_SEASON_TABS.includes(tab) ? tab : 'new');
  const archived = st?.game.status === 'archived';
  let body = '';
  if (t === 'new') body = newSeasonForm();
  else if (t === 'seasons') {
    body = `<div class="card"><div class="card-head"><h3>${icon('flag')}All seasons</h3><span class="more">${plural(S.games.length, 'season')}</span></div>
      <p class="muted" style="margin-top:-4px">Every Record Owner can run and change every season, whoever created it.</p>
      ${S.games.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Season</th><th>Phase</th><th>Day</th><th class="r">Artists</th><th>Created by</th><th></th></tr></thead><tbody>
      ${S.games.map((x) => `<tr class="${x.id === S.gameId ? 'me' : ''}"><td><b>${esc(x.name)}</b><div class="dim" style="font-size:12px">${new Date(x.created_at).toLocaleDateString()}</div></td>
        <td><span class="status s-${phaseClass[x.status]}">${phaseLabel[x.status]}</span></td>
        ${x.status === 'offloaded'
    ? `<td class="nowrap dim">${new Date(x.offloaded_at).toLocaleDateString()}</td><td class="r">${x.summary?.artists ?? 0}</td><td>${esc(x.createdByName || '—')}</td><td class="r nowrap"><a class="btn sm" href="#/admin/backups">Details</a></td></tr>`
    : `<td class="nowrap">${x.status === 'setup' ? 'Not started' : `Day ${x.clock.day} of ${x.clock.totalDays}`}</td><td class="r">${x.players ?? 0} / ${x.max_players}</td>
        <td>${esc(x.createdByName || '—')}</td>
        <td class="r nowrap">${x.id === S.gameId ? '<span class="tag">Open now</span>' : `<button class="btn sm" data-act="open-season" data-id="${x.id}">Open</button>`} <button class="btn sm" data-act="open-season" data-id="${x.id}" data-tab="season">Settings</button></td></tr>`}`).join('')}
      </tbody></table></div>` : empty('flag', 'No seasons yet')}
      <a class="btn primary" href="#/admin/new" style="margin-top:12px">${icon('plus')}New season</a></div>`;
  } else if (t === 'backups') {
    body = backupsView();
  } else if (t === 'review') {
    const review = st.contracts.filter((c) => c.status === 'review');
    const openDeals = st.contracts.filter((c) => ['offered', 'countered', 'active', 'delivered'].includes(c.status));
    body = `<div class="card"><div class="card-head"><h3>${icon('shield')}Awaiting approval</h3><span class="more">${review.length} pending</span></div>
      <p class="muted" style="margin-top:-6px">Both artists have agreed. Every service must be approved by a teacher before the work is done. Approving starts the work and announces the deal to the lobby. Rejecting refunds the buyer's escrow.</p>
      ${review.length ? review.map(reviewItem).join('') : empty('check', 'Queue is clear')}</div>
      <div class="card"><div class="card-head"><h3>${icon('file')}All open contracts</h3></div>
        <p class="muted" style="margin-top:-4px">Open a contract to charge the late fee, mark the work not done, pay it out or void it.</p>
        ${openDeals.length ? `<div class="contracts">${openDeals.map(contractCard).join('')}</div>` : '<p class="muted">No open contracts.</p>'}</div>`;
  } else if (t === 'roster') {
    const r = st.roster;
    const full = activeRoster().length >= st.game.max_players;
    body = `<div class="card"><div class="card-head"><h3>${icon('plus')}Sign an artist</h3><span class="more">${activeRoster().length} / ${st.game.max_players} spots used</span></div>
      ${archived ? '<p class="muted">This season is archived.</p>' : `<form data-form="add-player"><div class="row">
        <label class="field"><span>Username</span><input name="username" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_.\\-]{3,24}" autocapitalize="off" placeholder="lil.cardinal" ${full ? 'disabled' : ''} /><small>They sign in with this. Letters, numbers, . _ -</small></label>
        <label class="field"><span>Artist name</span><input name="displayName" maxlength="40" placeholder="Lil Cardinal" ${full ? 'disabled' : ''} /></label>
        <label class="field"><span>Role</span><input name="roleTitle" maxlength="40" placeholder="Producer" ${full ? 'disabled' : ''} /></label>
      </div><button class="btn primary" ${full ? 'disabled' : ''}>${full ? 'Roster full' : 'Sign artist'}</button>
      <span class="dim" style="font-size:12.5px;margin-left:10px">They'll create their own PIN the first time they sign in.${st.game.status === 'active' && st.game.starting_balance ? ` They'll get the ${money(st.game.starting_balance)} advance right away.` : ''}</span></form>`}</div>
      <div class="card"><div class="card-head"><h3>${icon('users')}Roster & PINs</h3>
        <button class="btn ghost sm more" data-act="reveal-all">${icon(S.ui.reveal.size ? 'eyeOff' : 'eye')}${S.ui.reveal.size ? 'Hide' : 'Show'} all PINs</button></div>
        ${r.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Artist</th><th>Username</th><th>PIN</th><th>Last seen</th><th class="r">Cash</th><th class="r">Actions</th></tr></thead><tbody>
        ${r.map((p) => `<tr class="${p.active ? '' : 'off'}"><td>${nameLine(p.id)}<div class="dim" style="font-size:12px;margin-left:32px">${esc(p.roleTitle)}</div></td>
          <td class="mono">@${esc(p.username)}</td>
          <td>${p.claimed ? `<span class="pin-cell">${S.ui.reveal.has(p.id) ? esc(p.pin) : '••••'}<button class="btn ghost icon sm" data-act="reveal" data-id="${p.id}" aria-label="Toggle PIN">${icon(S.ui.reveal.has(p.id) ? 'eyeOff' : 'eye')}</button></span>` : '<span class="tag" style="background:var(--brass)">Unclaimed</span>'}</td>
          <td class="dim nowrap">${p.lastSeen ? ago(p.lastSeen) : 'Never'}</td><td class="r num ${p.stats.balance < 0 ? 'red' : 'gold'}">${money(p.stats.balance)}</td>
          <td class="r nowrap"><button class="btn sm" data-act="edit-player" data-id="${p.id}">Edit</button> ${p.claimed ? `<button class="btn sm" data-act="reset-pin" data-id="${p.id}">Reset PIN</button>` : ''}
            <button class="btn sm ${p.active ? 'danger' : ''}" data-act="toggle-player" data-id="${p.id}">${p.active ? 'Remove' : 'Restore'}</button></td></tr>`).join('')}
        </tbody></table></div>` : empty('users', 'No artists yet', 'Sign your first artist above.')}</div>`;
  } else if (t === 'treasury') {
    const r = activeRoster();
    const fines = st.rates.fines;
    const payouts = st.rates.payouts.filter((x) => x.type !== 'auto');
    body = `<div class="stats" style="margin-top:0">${stat('Cash in circulation', money(r.reduce((a, p) => a + p.stats.balance, 0)), 'Across all artists', 'gold', 'dollar')}${stat('In escrow', money(r.reduce((a, p) => a + p.stats.escrow, 0)), 'Open offers and deals', '', 'lock')}${stat('Label vault', money(st.vault), st.game.label_cut_pct ? `${st.game.label_cut_pct}% cut on completed deals` : 'No label cut this season', 'red', 'vault')}</div>
      ${archived ? '<div class="card" style="margin-top:16px"><p class="muted">This season is archived.</p></div>' : `
      <div class="grid-2">
        <div class="card"><div class="card-head" style="background:var(--redd)"><h3>${icon('flag')}Charge a fee or fine</h3></div>
          <p class="muted" style="margin-top:-4px">Amounts come from the rate sheet. Fines can take an artist below $0. They aren't announced in the lobby; each artist sees their own in Data.</p>
          ${itemForm('charge', 'Fee or fine', fines, `${icon('flag')}Charge`)}</div>
        <div class="stack">
          <div class="card"><div class="card-head"><h3>${icon('award')}Pay from the rate sheet</h3></div>
            <p class="muted" style="margin-top:-4px">The advance and the Game Bonus are paid automatically.</p>
            ${itemForm('payout', 'Income item', payouts, `${icon('dollar')}Pay`)}</div>
          <div class="card"><div class="card-head"><h3>${icon('dollar')}Custom amount</h3></div>
            <form data-form="grant">
              <div class="row"><label class="field"><span>Amount ($)</span><input name="amount" type="number" step="1" required placeholder="100" /><small>Negative to take money away.</small></label>
              <label class="field"><span>Memo</span><input name="memo" maxlength="140" placeholder="Best mixdown of the week" /></label></div>
              ${pickArtists('grant-picks')}
              <button class="btn">${icon('dollar')}Send</button></form></div>
        </div>
      </div>`}
      <div class="card"><div class="card-head"><h3>Recent label transactions</h3><a class="more" href="#/data">Full ledger →</a></div>
        ${st.ledger.filter((l) => ['grant', 'fine', 'bonus', 'advance', 'label_fee'].includes(l.kind)).slice(0, 15).map((l) => `<div style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid var(--rule)"><span>${l.userId ? esc(nameOf(l.userId)) : '<b>Label vault</b>'}</span><span class="dim">${esc(l.memo)}</span><span class="num ${l.amount >= 0 ? 'amt-pos' : 'amt-neg'}" style="margin-left:auto">${l.amount >= 0 ? '+' : ''}${money(l.amount)}</span></div>`).join('') || '<p class="muted">None yet.</p>'}</div>`;
  } else if (t === 'rates') {
    const r = st.rates;
    const num = (name, v) => `<input class="rate-in" name="${name}" type="number" min="0" max="1000000" step="1" value="${v ?? 0}" aria-label="${name}" />`;
    body = `<form data-form="rates-edit">
      <div class="card"><div class="card-head"><h3>${icon('dollar')}Jobs</h3><span class="more">for ${esc(st.game.name)}</span></div>
        <p class="muted" style="margin-top:-4px">Players hire at these prices; they can't set their own. Deals already made keep the price they were made at. Untick a job to stop new hires for it.</p>
        <div class="table-wrap"><table class="t"><thead><tr><th>Job</th><th>Rate</th><th>Project rate</th><th class="r">Hireable</th></tr></thead><tbody>
        ${r.jobs.map((j) => `<tr><td><b>${esc(j.name)}</b></td><td class="nowrap">$ ${num(`job.${j.id}.unitRate`, j.unitRate)} <span class="dim">${unitLabel(j)}</span></td><td class="nowrap">$ ${num(`job.${j.id}.projectRate`, j.projectRate)}</td>
          <td class="r"><input type="checkbox" name="job.${esc(j.id)}.active" ${j.active ? 'checked' : ''} aria-label="${esc(j.name)} can be hired" /></td></tr>`).join('')}
        </tbody></table></div></div>
      <div class="grid-2">
        <div class="card"><div class="card-head" style="background:var(--redd)"><h3>${icon('flag')}Fees & fines</h3></div>
          <table class="t"><tbody>${r.fines.map((f) => `<tr><td><b>${esc(f.name)}</b></td><td class="r nowrap">${f.type === 'percent' ? `<span class="dim">${f.min}% to ${f.max}% of account</span>` : `$ ${num(`fine.${f.id}.amount`, f.amount)} <span class="dim">${f.type === 'per' ? `per ${esc(f.per)}` : f.type === 'min' ? 'minimum' : ''}</span>`}</td></tr>`).join('')}</tbody></table></div>
        <div class="card"><div class="card-head"><h3>${icon('award')}Income from the label</h3></div>
          <table class="t"><tbody><tr><td><b>Advance</b><div class="dim" style="font-size:12px">Change it in Season settings.</div></td><td class="r num">${money(st.game.starting_balance)}</td></tr>
          ${r.payouts.map((x) => `<tr><td><b>${esc(x.name)}</b></td><td class="r nowrap">$ ${num(`payout.${x.id}.amount`, x.amount)} <span class="dim">${x.type === 'per' ? `per ${esc(x.per)}` : x.type === 'min' ? 'minimum' : ''}</span></td></tr>`).join('')}</tbody></table></div>
      </div>
      <div style="margin-top:16px;display:flex;gap:8px"><button class="btn primary lg">${icon('check')}Save rate sheet</button></div></form>`;
  } else if (t === 'season') {
    const g = st.game;
    const order = ['setup', 'active', 'showcase', 'archived'];
    const at = order.indexOf(g.status);
    const desc = { setup: 'Sign artists, set the rules', active: 'Clock running, deals open', showcase: 'Listen; music sharing when you open it', archived: 'Read-only, data export' };
    const controls = {
      setup: `<button class="btn primary lg" data-act="phase" data-phase="active">${icon('zap')}Start the season</button><p class="dim" style="margin-top:8px">Starts Day 1 of ${g.duration_days}${g.starting_balance ? ` and pays every artist a ${money(g.starting_balance)} advance` : ''}.</p>`,
      active: `<button class="btn primary" data-act="phase" data-phase="showcase">${icon('flag')}End season & open Showcase</button><p class="dim" style="margin-top:8px">The season also ends automatically after Day ${g.duration_days}. Open deals stay open for you to settle.</p>`,
      showcase: `<button class="btn" data-act="phase" data-phase="archived">${icon('lock')}Archive season</button> <button class="btn ghost" data-act="phase" data-phase="active">Reopen deals</button><p class="dim" style="margin-top:8px">Archiving makes everything read-only. To reopen deals, make the season longer first.</p>`,
      archived: `<button class="btn" data-act="phase" data-phase="showcase">Reopen Showcase</button>`,
    }[g.status];
    body = `<div class="card"><div class="card-head"><h3>${icon('clock')}Season phase</h3></div>
      <div class="phase-track">${order.map((p, i) => `<div class="${i === at ? 'on' : i < at ? 'past' : ''}"><b>${phaseLabel[p]}</b><small>${desc[p]}</small></div>`).join('')}</div>${controls}</div>
      <div class="card"><div class="card-head"><h3>${icon('music')}Music sharing</h3><span class="status ${uploadsOpen() ? 's-completed' : 's-cancelled'}" style="margin-left:auto">${uploadsOpen() ? 'Open' : 'Closed'}</span></div>
        <p class="muted">${uploadsOpen() ? 'Artists can share links (Spotify, SoundCloud, YouTube…) to their tracks in the Showcase right now.' : "Artists can't share music until you open music sharing. Ending the season does not open it automatically."}</p>
        ${g.status === 'archived' ? '<p class="dim">Reopen the Showcase to change this.</p>' : uploadToggle(uploadsOpen() ? '' : 'primary')}</div>
      <div class="card"><div class="card-head"><h3>${icon('edit')}Season settings</h3></div>${seasonForm(g, 'settings')}</div>`;
  }
  const label = ADMIN_TABS.find(([k]) => k === t)?.[1];
  return `${pageHead('Record Owner · Admin', label, st && !NO_SEASON_TABS.includes(t) ? `Working on ${esc(st.game.name)}. Switch seasons with the picker at the top right or in All seasons.` : 'Every Record Owner can run every season.')}
    <div class="tabs">${ADMIN_TABS.filter(([k]) => st || NO_SEASON_TABS.includes(k)).map(([k, l]) => `<a class="tab-link ${t === k ? 'on' : ''}" href="#/admin/${k}">${l}${k === 'review' && st ? `<span class="count">${st.contracts.filter((c) => c.status === 'review').length}</span>` : ''}</a>`).join('')}</div>
    ${body}`;
}

/** Owners: printable PDF backups of every season, and offloading a finished season. */
function backupsView() {
  const live = liveGames();
  const gone = S.games.filter((x) => x.status === 'offloaded');
  const when = (ts) => (ts ? dateStr(ts) : '<span class="dim">Never</span>');
  const fresh = (x) => x.backed_up_at && x.backed_up_at >= (x.archived_at || 0);
  return `<div class="card"><div class="card-head"><h3>${icon('download')}Back up class data</h3><span class="more">${plural(live.length, 'season')}</span></div>
      <p class="muted" style="margin-top:-4px">Download a PDF of the class records: every artist's balance and full statement, every contract, the Showcase links and the rate sheet in effect. It opens and prints on any computer, so you still have the records if the website is ever down. Keep a copy after every grading period.</p>
      <label class="check" style="margin:8px 0 12px"><input type="checkbox" id="backup-pins" /> Include student PINs <span class="dim">(store that copy securely)</span></label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"><button class="btn primary" data-act="backup" data-fmt="pdf" ${live.length ? '' : 'disabled'}>${icon('download')}All seasons (PDF)</button></div>
      ${live.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Season</th><th>Phase</th><th class="r">Artists</th><th>Last backup</th><th class="r">Download</th></tr></thead><tbody>
      ${live.map((x) => `<tr><td><b>${esc(x.name)}</b></td><td><span class="status s-${phaseClass[x.status]}">${phaseLabel[x.status]}</span></td><td class="r">${x.players ?? 0}</td><td class="nowrap">${when(x.backed_up_at)}</td>
        <td class="r nowrap"><button class="btn sm" data-act="backup" data-fmt="pdf" data-id="${x.id}">PDF</button> <button class="btn sm" data-act="backup" data-fmt="zip" data-id="${x.id}">ZIP</button></td></tr>`).join('')}
      </tbody></table></div>` : empty('download', 'No seasons to back up')}
      <p class="dim" style="font-size:12.5px;margin-top:10px">The ZIP has the same records as spreadsheet-ready CSV files plus raw JSON, and always includes PINs.</p></div>
    <div class="card"><div class="card-head" style="background:var(--redd)"><h3>${icon('trash')}Offload a finished season</h3></div>
      <p class="muted" style="margin-top:-4px">Clears a finished season off the server so next year starts fresh: its artists, money, contracts, lobby and Showcase are deleted, and their usernames free up. The season stays in All seasons as a one-line record.</p>
      <ol class="muted" style="margin:6px 0 12px 18px;line-height:1.7"><li>Archive the season (Season settings).</li><li>Download its backup above (PDF, and the ZIP if you want spreadsheets).</li><li>Offload it here. This can't be undone.</li></ol>
      ${live.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Season</th><th>Phase</th><th>Ready?</th><th class="r"></th></tr></thead><tbody>
      ${live.map((x) => {
    const ready = x.status === 'archived' && fresh(x);
    const why = x.status !== 'archived' ? 'Archive it first' : fresh(x) ? `Backed up ${dateStr(x.backed_up_at)}` : 'Download a backup first';
    return `<tr><td><b>${esc(x.name)}</b></td><td><span class="status s-${phaseClass[x.status]}">${phaseLabel[x.status]}</span></td><td class="${ready ? '' : 'dim'}">${why}</td>
        <td class="r"><button class="btn sm danger" data-act="offload" data-id="${x.id}" ${ready ? '' : 'disabled'}>Offload…</button></td></tr>`;
  }).join('')}</tbody></table></div>` : '<p class="muted">No seasons yet.</p>'}</div>
    ${gone.length ? `<div class="card"><div class="card-head"><h3>${icon('lock')}Offloaded seasons</h3><span class="more">${plural(gone.length, 'season')}</span></div>
      <p class="muted" style="margin-top:-4px">Their records live in the backup files you downloaded.</p>
      <div class="table-wrap"><table class="t"><thead><tr><th>Season</th><th>Ran</th><th class="r">Artists</th><th class="r">Deals</th><th class="r">Tracks</th><th>Offloaded</th><th class="r"></th></tr></thead><tbody>
      ${gone.map((x) => `<tr><td><b>${esc(x.name)}</b></td><td class="nowrap dim">${x.summary?.startedAt ? `${new Date(x.summary.startedAt).toLocaleDateString()} – ${x.summary.endedAt ? new Date(x.summary.endedAt).toLocaleDateString() : ''}` : '—'}</td>
        <td class="r">${x.summary?.artists ?? 0}</td><td class="r">${x.summary?.deals ?? 0}${x.summary?.dealValue ? ` <span class="dim">(${money(x.summary.dealValue)})</span>` : ''}</td><td class="r">${x.summary?.tracks ?? 0}</td>
        <td class="nowrap">${new Date(x.offloaded_at).toLocaleDateString()}${x.summary?.offloadedBy ? ` <span class="dim">by ${esc(x.summary.offloadedBy)}</span>` : ''}</td>
        <td class="r"><button class="btn sm" data-act="remove-season" data-id="${x.id}">Remove from list</button></td></tr>`).join('')}
      </tbody></table></div></div>` : ''}`;
}

function seasonForm(g, form) {
  return `<form data-form="${form}">
    <label class="field"><span>Season name</span><input name="name" maxlength="60" required value="${esc(g?.name || '')}" placeholder="Cardinal Records: Season 1" /></label>
    <div class="row">
      <label class="field"><span>Length (days)</span><input name="durationDays" type="number" min="1" max="365" required value="${g?.duration_days ?? 90}" /><small>Up to 365 days.</small></label>
      <label class="field"><span>Signing advance ($)</span><input name="startingBalance" type="number" min="0" step="1" required value="${g?.starting_balance ?? 1000}" /><small>The rate sheet's advance. Each artist gets it on Day 1.</small></label>
    </div>
    <div class="row">
      <label class="field"><span>Label cut (%)</span><input name="labelCutPct" type="number" min="0" max="50" required value="${g?.label_cut_pct ?? 0}" /><small>Optional. The rate sheet has none.</small></label>
      <label class="field"><span>Max artists</span><input name="maxPlayers" type="number" min="1" max="30" required value="${g?.max_players ?? 30}" /><small>Up to 30.</small></label>
    </div>
    <button class="btn primary">${form === 'settings' ? 'Save settings' : 'Create season'}</button></form>`;
}
const newSeasonForm = () => `<div class="card"><div class="card-head"><h3>${icon('plus')}Found a new label season</h3></div>
  <p class="muted" style="margin-top:-6px">Each season is its own game with its own roster (up to 30 artists), money, rate sheet and Showcase. You can run as many seasons as you like, side by side.</p>${seasonForm(null, 'new-season')}</div>`;

// ============================================================ modals
function hireModal({ jobId, sellerId }) {
  const m = me();
  const sellers = activeRoster().filter((p) => p.id !== m.id);
  if (!sellers.length) { toast('There are no other artists to hire yet', 'err'); return; }
  const jobs = S.state.rates.jobs.filter((j) => j.active);
  const job = jobs.find((j) => j.id === jobId) || jobs[0];
  modal(`${modalHead('Hire a labelmate', 'Prices come from the rate sheet. A teacher approves the deal before any work starts.')}
    <form data-form="hire" id="hire-form">
      <label class="field"><span>Job</span><select name="jobId" required data-change="hire-calc">${jobs.map((j) => `<option value="${esc(j.id)}" ${j.id === job.id ? 'selected' : ''}>${esc(j.name)} · ${money(j.unitRate)} ${unitLabel(j)}${j.projectRate ? ` · ${money(j.projectRate)} project` : ''}</option>`).join('')}</select></label>
      <label class="field"><span>Artist</span><select name="sellerId" required>${sellers.map((p) => `<option value="${p.id}" ${p.id === sellerId ? 'selected' : ''}>${esc(p.displayName)}${p.roleTitle ? ` (${esc(p.roleTitle)})` : ''}</option>`).join('')}</select></label>
      <div class="field"><span>Pay by</span><div class="row pricing">
        <label class="check"><input type="radio" name="pricing" value="unit" checked data-change="hire-calc" /> <span id="hire-unit-label">The ${job.unit === 'item' ? 'item' : 'hour / class'}</span></label>
        <label class="check"><input type="radio" name="pricing" value="project" data-change="hire-calc" /> The project rate</label></div></div>
      <div class="row">
        <label class="field" id="hire-qty"><span id="hire-qty-label">${job.unit === 'item' ? 'Items' : 'Hours / class blocks'}</span><input name="quantity" type="number" min="1" max="100" step="1" value="1" required data-input-calc="1" /></label>
        <label class="field"><span>Due in (days)</span><input name="dueDays" type="number" min="1" max="365" value="7" /></label>
      </div>
      <label class="field"><span>What it's for (optional)</span><input name="title" maxlength="100" placeholder="${esc(job.name)} for my single" /></label>
      <label class="field"><span>Details</span><textarea name="terms" maxlength="2000" placeholder="What exactly needs doing? Files to deliver, credit you'll give…"></textarea></label>
      <div class="callout">${icon('lock')}<span>Total: <b id="hire-total" class="mono">${money(job.unitRate)}</b>. You have <b>${money(m.stats.balance)}</b>. The total is held in <b>escrow</b> right away and paid out when you confirm delivery. If the deal falls through, you get it all back.</span></div>
      <div class="modal-foot"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button class="btn primary">${icon('send')}Send offer</button></div>
    </form>`);
}

/** Recompute the hire total as the job, pricing or quantity changes. */
function hireCalc() {
  const f = $('#hire-form');
  if (!f) return;
  const job = S.state.rates.jobs.find((j) => j.id === f.jobId.value);
  const project = f.querySelector('input[name=pricing]:checked')?.value === 'project';
  const projectRadio = f.querySelector('input[name=pricing][value=project]');
  projectRadio.disabled = !job.projectRate;
  if (!job.projectRate && project) f.querySelector('input[name=pricing][value=unit]').checked = true;
  const useProject = project && !!job.projectRate;
  $('#hire-unit-label').textContent = `The ${job.unit === 'item' ? 'item' : 'hour / class'} (${money(job.unitRate)} each)`;
  $('#hire-qty-label').textContent = job.unit === 'item' ? 'Items' : 'Hours / class blocks';
  $('#hire-qty').hidden = useProject;
  f.quantity.required = !useProject;
  const qty = Math.max(1, Math.floor(Number(f.quantity.value) || 1));
  $('#hire-total').textContent = money(useProject ? job.projectRate : job.unitRate * qty);
}

function contractActionModal(c, a) {
  const cfg = {
    accept: ['Sign this contract?', `You agree to deliver "${esc(c.title)}" for ${money(c.amount)}. It goes to the label for approval next.`, 'Sign contract', 'primary'],
    decline: ['Decline this offer?', `${esc(nameOf(c.buyerId))} gets their ${money(c.escrow)} back.`, 'Decline', 'danger'],
    withdraw: ['Withdraw your offer?', `Your ${money(c.escrow)} comes back to you.`, 'Withdraw', 'danger'],
    approve: ['Approve this deal?', `${esc(nameOf(c.buyerId))} hires ${esc(nameOf(c.sellerId))} for ${money(c.amount)}. It will be announced in the lobby.`, 'Approve deal', 'green'],
    reject: ['Reject this deal?', `The ${money(c.escrow)} in escrow goes back to ${esc(nameOf(c.buyerId))}.`, 'Reject', 'danger'],
    deliver: ['Mark as delivered?', `Let ${esc(nameOf(c.buyerId))} know the work is done. Add a note with links or details.`, 'Mark delivered', 'primary'],
    revise: ['Request changes', `Send the work back to ${esc(nameOf(c.sellerId))} with notes.`, 'Send back', 'primary'],
    confirm: ['Confirm delivery & pay', `This releases ${money(c.escrow)} from escrow to ${esc(nameOf(c.sellerId))} (minus the ${game().label_cut_pct}% label cut). This can't be undone.`, 'Confirm & pay', 'green'],
    complete: ['Force pay out?', `Release ${money(c.escrow)} to ${esc(nameOf(c.sellerId))} now, as if the client confirmed.`, 'Pay out', 'primary'],
    cancel: ['Void this contract?', `Any escrow (${money(c.escrow)}) is returned to ${esc(nameOf(c.buyerId))}.`, 'Void contract', 'danger'],
    late_fee: ['Charge the late fee?', `${esc(nameOf(c.sellerId))} is charged the rate sheet's ${money(S.state.rates.fines.find((f) => f.id === 'late-incomplete')?.amount)} late / incomplete fee. ${esc(nameOf(c.buyerId))} is not charged, and the deal carries on.`, 'Charge late fee', 'danger'],
    undone: ['Mark the work not done?', `${esc(nameOf(c.sellerId))} is charged the ${money(S.state.rates.fines.find((f) => f.id === 'undone')?.amount)} undone fine, ${esc(nameOf(c.buyerId))} gets their ${money(c.escrow)} back, and the contract is cancelled.`, 'Fine & refund', 'danger'],
  }[a];
  const [title, sub, btn, kind] = cfg;
  modal(`${modalHead(title, sub)}
    <form data-form="contract-action"><input type="hidden" name="id" value="${c.id}" /><input type="hidden" name="action" value="${a}" />
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
      <label class="field"><span>Link to your track</span><input type="url" name="url" maxlength="500" required placeholder="https://open.spotify.com/track/…" inputmode="url" autocomplete="off" /><small>Spotify, SoundCloud, YouTube, Apple Music, Bandcamp or any other public link.</small></label>
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
      <label class="field"><span>Season</span><select name="gameId">${liveGames().filter((x) => x.status !== 'archived' || x.id === p.gameId).map((x) => `<option value="${x.id}" ${x.id === p.gameId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
        <small>Moving an artist keeps their money and deals in this season's records. In the new season they start fresh. Finish or void their open deals first.</small></label>
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
  if (!S.state) return isOwner() ? adminView(r === 'admin' ? id : 'new') : empty('lock', "You're not on a label yet", 'Ask your Record Owner to sign you.');
  if (!isOwner() && !me()) return empty('lock', 'Account not found on this roster');
  switch (r) {
    case 'hq': return hqView();
    case 'lobby': return lobbyView();
    case 'rates':
    case 'market': return ratesView();
    case 'contracts': return contractsView();
    case 'contract': return contractDetailView(id);
    case 'roster': return rosterView();
    case 'artist': return artistView(id);
    case 'charts': return chartsView();
    case 'showcase': return showcaseView();
    case 'guide': return guideView();
    case 'profile': return profileView();
    case 'data': return dataView();
    case 'admin':
    case 'console': return isOwner() ? adminView(id) : hqView();
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
  'modal-bg': (el, e) => { if (e.target === el) closeModal(); },
  'close-modal': closeModal,
  privacy: privacyModal,
  'confirm-ok': async () => { const fn = S._confirm; closeModal(); if (fn) await fn(); },
  'login-back': () => { S.login = freshLogin(); render(); },
  'pin-key': (el) => pinKey(el.dataset.k),
  logout: async () => { await api('POST', '/api/logout').catch(() => {}); S.user = null; S.state = null; S.login = freshLogin(); render(); },
  'contract-tab': (el) => { S.ui.contractTab = el.dataset.tab; render(); },
  'chart-tab': (el) => { S.ui.chartTab = el.dataset.tab; render(); },
  'console-tab': (el) => { location.hash = `#/admin/${el.dataset.tab}`; },
  'admin-menu': () => { S.ui.adminOpen = !S.ui.adminOpen; render(); },
  'admin-go': () => { S.ui.adminOpen = false; },
  'open-season': async (el) => {
    S.gameId = Number(el.dataset.id);
    store.set('cr.game', S.gameId);
    await refresh();
    if (el.dataset.tab) location.hash = `#/admin/${el.dataset.tab}`;
  },
  backup: (el) => {
    const pins = $('#backup-pins')?.checked ? 1 : 0;
    const tz = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || '');
    const url = el.dataset.fmt === 'zip' ? `/api/games/${el.dataset.id}/export.zip`
      : el.dataset.id ? `/api/games/${el.dataset.id}/backup.pdf?pins=${pins}&tz=${tz}` : `/api/backup.pdf?pins=${pins}&tz=${tz}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('Preparing your backup. It will download in a moment.', 'ok', 'download');
    // Pick up the new "last backup" time once the server has built the file.
    setTimeout(async () => { try { await loadMe(); if (!modalOpen()) render(); } catch {} }, 4000);
  },
  offload: (el) => {
    const x = S.games.find((g) => g.id === Number(el.dataset.id));
    if (!x) return;
    modal(`${modalHead(`Offload ${esc(x.name)}?`, `This permanently deletes the season's ${plural(x.players ?? 0, 'artist')}, their money, contracts, lobby and Showcase from the server. Their usernames free up for next season. Make sure you've saved the backup file somewhere safe. This can't be undone.`)}
      <form data-form="offload"><input type="hidden" name="id" value="${x.id}" />
        <label class="field"><span>Type the season's name to confirm</span><input name="confirm" required autocomplete="off" placeholder="${esc(x.name)}" /></label>
        <div class="modal-foot"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button class="btn danger">${icon('trash')}Offload season</button></div></form>`);
  },
  'remove-season': (el) => confirmModal('Remove from the list?', 'The one-line record of this offloaded season goes away. Your backup files are not affected.', 'Remove', 'danger',
    () => act(async () => { await api('DELETE', `/api/games/${el.dataset.id}`); await loadMe(); }, 'Season removed from the list')),
  hire: (el) => hireModal({ jobId: el.dataset.job, sellerId: Number(el.dataset.seller) || null }),
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
    confirmModal(open ? 'Open music sharing?' : 'Close music sharing?',
      open ? 'Every artist on this season can share links to their tracks in the Showcase, and the lobby is told.' : 'Artists won\'t be able to share new tracks. Tracks already shared stay up.',
      open ? 'Open music sharing' : 'Close music sharing', open ? 'primary' : 'danger',
      () => act(() => api('POST', `/api/games/${S.gameId}/uploads`, { open }), open ? 'Music sharing is open' : 'Music sharing closed'));
  },
  phase: (el) => {
    const ph = el.dataset.phase;
    const text = {
      active: game().status === 'setup' ? 'The clock starts now and signing advances are paid out.' : 'Deals reopen for the remaining days.',
      showcase: game().status === 'archived' ? 'Artists can listen again. Open music sharing separately if you want it.' : "No new deals can be made. Music sharing stays closed until you open it.",
      archived: 'The season becomes read-only. Data stays downloadable, and you can then back it up and offload it in Admin → Backups & offload.',
    }[ph];
    confirmModal(`Move to ${phaseLabel[ph]}?`, text, 'Confirm', 'primary', () => act(() => api('POST', `/api/games/${S.gameId}/phase`, { phase: ph }), 'Season updated'));
  },
};

/** Charge a fee/fine or pay an income item from the rate sheet. */
async function chargeItem(d, f, verb) {
  const opt = f.itemId.selectedOptions[0];
  const body = { itemId: d.itemId, memo: d.memo, userIds: d.all ? 'all' : new FormData(f).getAll('u').map(Number) };
  if (opt.dataset.type === 'per') body.quantity = Number(d.quantity);
  if (opt.dataset.type === 'min') body.amount = Number(d.amount);
  if (opt.dataset.type === 'percent') body.percent = Number(d.percent);
  const r = await act(() => api('POST', `/api/games/${S.gameId}/charges`, body));
  if (!r) return;
  const total = r.charged.reduce((a, x) => a + x.amount, 0);
  toast(r.charged.length ? `${verb} ${plural(r.charged.length, 'artist')} · ${money(total)} total` : 'Nothing to charge: those artists have no cash', r.charged.length ? 'ok' : 'err');
}

/** Show the extra fields (how many / amount / percent) that the chosen rate-sheet item needs. */
function itemFields(select) {
  const f = select.form;
  const o = select.selectedOptions[0].dataset;
  for (const el of f.querySelectorAll('[data-show]')) el.hidden = el.dataset.show !== o.type;
  const per = f.querySelector('[data-per-label]');
  if (per) per.textContent = o.per;
  if (o.type === 'min') { f.amount.min = o.amount; f.amount.value = o.amount; }
  if (o.type === 'percent') { f.percent.min = o.min; f.percent.max = o.max; f.percent.value = o.min; }
}

const FORMS = {
  lookup: async (d) => {
    try {
      const info = await api('POST', '/api/login/lookup', { username: d.username });
      Object.assign(S.login, { username: d.username, info, step: info.claimed ? 'pin' : 'claim1', pin: '', error: '' });
    } catch (e) { S.login.username = d.username; toast(e.message, 'err'); }
    render();
  },
  chat: async (d, f) => { if (await act(() => api('POST', `/api/games/${S.gameId}/feed`, { message: d.message }))) f.reset(); },
  hire: async (d) => {
    const body = { ...d, sellerId: Number(d.sellerId), quantity: d.pricing === 'project' ? null : Number(d.quantity), dueDays: d.dueDays ? Number(d.dueDays) : null };
    const ok = await act(() => api('POST', `/api/games/${S.gameId}/contracts`, body), 'Offer sent. Your money is in escrow.');
    if (ok) { closeModal(); S.ui.contractTab = 'open'; location.hash = `#/contract/${ok.id}`; }
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
  'edit-player': async (d) => {
    const ok = await act(async () => { await api('PATCH', `/api/players/${d.id}`, { ...d, gameId: Number(d.gameId) }); await loadMe(); }, 'Artist updated');
    if (ok) closeModal();
  },
  grant: async (d, f) => {
    const amount = Number(d.amount);
    const body = { amount, memo: d.memo, userIds: d.all ? 'all' : new FormData(f).getAll('u').map(Number) };
    if (await act(() => api('POST', `/api/games/${S.gameId}/grants`, body), amount > 0 ? `Sent ${money(amount)}` : `Took ${money(-amount)}`)) f.reset();
  },
  charge: (d, f) => chargeItem(d, f, 'Charged'),
  payout: (d, f) => chargeItem(d, f, 'Paid'),
  'rates-edit': (d, f) => {
    const body = { jobs: {}, payouts: {}, fines: {} };
    for (const el of f.querySelectorAll('input[name]')) {
      const [kind, id, field] = el.name.split('.');
      const group = { job: 'jobs', payout: 'payouts', fine: 'fines' }[kind];
      if (!group) continue;
      body[group][id] = body[group][id] || {};
      body[group][id][field] = el.type === 'checkbox' ? el.checked : Number(el.value);
    }
    return act(() => api('PUT', `/api/games/${S.gameId}/rates`, body), 'Rate sheet saved');
  },
  settings: (d) => act(() => api('PATCH', `/api/games/${S.gameId}`, d), 'Settings saved'),
  offload: async (d) => {
    const ok = await act(async () => {
      await api('POST', `/api/games/${d.id}/offload`, { confirm: d.confirm });
      await loadMe();
    }, 'Season offloaded. Fresh start!');
    if (ok) { closeModal(); location.hash = '#/admin/backups'; }
  },
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
  if (S.ui.adminOpen && !e.target.closest('.admin-menu')) { S.ui.adminOpen = false; render(); }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  if (el.tagName === 'A' && el.getAttribute('href')) return;
  const fn = ACTIONS[el.dataset.act];
  if (!fn) return;
  // The modal backdrop wraps the whole dialog: only a click on the backdrop itself is
  // ours, so radios, checkboxes and links inside the dialog keep working.
  if (el.dataset.act === 'modal-bg' && e.target !== el) return;
  e.preventDefault();
  fn(el, e);
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
  } else if (k === 'pick-all') {
    $$(`#${el.dataset.target} input`).forEach((i) => { i.disabled = el.checked; });
  } else if (k === 'item-pick') {
    itemFields(el);
  } else if (k === 'hire-calc') {
    hireCalc();
  } else if (k === 'stars') {
    const v = Number(el.value);
    $$('#stars label').forEach((l, i) => l.classList.toggle('on', i < v));
  }
});

document.addEventListener('input', (e) => {
  if (e.target.dataset.inputCalc) hireCalc();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalOpen()) return closeModal();
  if (e.key === 'Escape' && S.ui.adminOpen) { S.ui.adminOpen = false; render(); return $('.admin-btn')?.focus(); }
  if (!S.user && S.login.step !== 'user') {
    if (/^\d$/.test(e.key)) pinKey(e.key);
    else if (e.key === 'Backspace') pinKey('del');
    else if (e.key === 'Enter') pinKey('ok');
  }
});

window.addEventListener('hashchange', () => { S.ui.adminOpen = false; closeModal(); render(); window.scrollTo(0, 0); });

// Keep everyone in sync without wearing out the free database plan: every 10s ask
// the server whether anything changed (a tiny request) and only then reload the
// label. Pause when the tab is hidden or nobody has touched it for 10 minutes.
const IDLE_MS = 10 * 60_000;
let lastActivity = Date.now();
let wasIdle = false;
const markActive = () => {
  lastActivity = Date.now();
  if (wasIdle) { wasIdle = false; syncState(); }
};
for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll']) window.addEventListener(ev, markActive, { passive: true, capture: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncState(); });

async function syncState() {
  if (!S.user || !S.gameId || document.hidden) return;
  if (Date.now() - lastActivity > IDLE_MS) { wasIdle = true; return; }
  try {
    const { rev } = await api('GET', '/api/rev');
    // Reload when something changed, and every 5 minutes anyway (clock, online dots).
    if (rev === S.rev && Date.now() - (S.loadedAt || 0) < 5 * 60_000) return;
  } catch { return; }
  const before = S.stateKey;
  try { await loadState(); } catch { return; }
  const typing = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !document.activeElement.dataset.input;
  if (S.stateKey !== before && !modalOpen() && !typing) render();
}
setInterval(syncState, 10_000);

setInterval(() => { const c = $('#clock'); if (c) c.textContent = clockText(); }, 20_000);

start();

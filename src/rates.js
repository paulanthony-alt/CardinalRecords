'use strict';
// The Recording Game rate sheet. Every season starts from these numbers; Record
// Owners can change the amounts per season (stored as overrides in games.rate_sheet).
// Players can't set their own prices: every job is paid at the sheet's rate.

const RULES = [
  'All services rendered MUST be approved by a teacher BEFORE the work is done. Use the Services To Be Rendered form AFTER it has been approved.',
  'If you agree to work for someone and do NOT perform the work ON TIME, you will be charged a late fee that will be deducted from your account by Cardinal Records. The student who hired you will not be charged a late fee.',
  "Binding arbitration: in the event of a dispute between students that cannot be resolved between them, ALL disputes will be brought to Dr. Freedman, whose resolution will be final.",
];

// unit: what the per-unit rate is charged by. projectRate: flat price for the whole job.
const job = (id, name, unit, unitRate, projectRate) => ({ id, name, unit, unitRate, projectRate });
const JOBS = [
  job('lyricist', 'Lyricist', 'hour', 40, 400),
  job('beat-maker', 'Beat Maker', 'hour', 40, 400),
  job('sound-designer', 'Sound Designer', 'hour', 50, 500),
  job('instrumentalist', 'Instrumentalist / performer', 'hour', 50, 500),
  job('background-vocals', 'Background vocals', 'hour', 50, 500),
  job('lead-vocals', 'Lead vocals', 'hour', 75, 750),
  job('rapper', 'Rapper', 'hour', 75, 750),
  job('arranger', 'Arranger / orchestrator', 'hour', 40, 400),
  job('audio-editor', 'Audio editor', 'hour', 50, 500),
  job('recording-engineer', 'Audio / recording engineer', 'hour', 75, 750),
  job('mixing-engineer', 'Mixing engineer', 'hour', 50, 500),
  job('mastering-engineer', 'Mastering engineer', 'hour', 50, 500),
  job('music-producer', 'Music producer', 'hour', 75, 750),
  job('contractor', 'Contractor / personnel manager', 'item', 100, 100),
  job('graphic-designer', 'Graphic designer', 'item', 50, 500),
  job('social-media', 'Social media', 'item', 50, 500),
  job('public-relations', 'Public relations (PR)', 'item', 50, 500),
  job('copy-writer', 'Copy writer / editor', 'item', 40, 400),
  job('merchandising', 'Merchandising', 'item', 40, 400),
  job('live-sound', 'Live sound help', 'item', 40, 400),
];

// Money the label pays out. `auto` items are paid by the game itself.
const PAYOUTS = [
  { id: 'hire-bonus', name: 'Cardinal Record Game Bonus', amount: 40, type: 'auto',
    note: 'You get ONE bonus from Cardinal Records for every TWO (2) DIFFERENT people you hire. Paid automatically when a deal is completed.' },
  { id: 'volunteer', name: 'Volunteer in other GHS EMusic classes', amount: 40, type: 'per', per: 'class block',
    note: 'Earn the hourly rate for every class block you help in (Intro to EMusic, EMusic 1, EMusic 2 and/or Songwriting & Recording). You must get approval from Dr. Freedman in advance for each class session.' },
  { id: 'studio-assistant', name: 'Studio Assistant (for Freeds or Mr. Polise)', amount: 15, type: 'min',
    note: 'A minimum of $15. The amount varies.' },
];

// type: fixed (one charge), per (amount × quantity), min (owner sets an amount at or above it),
// percent (a share of the artist's cash, between min and max %).
const FINES = [
  { id: 'project-fee', name: 'Project fee', amount: 400, type: 'fixed', note: 'Project fees are paid to the studio at the beginning of each semester.' },
  { id: 'mixing-time', name: 'Mixing time with teacher', amount: 100, type: 'per', per: 'song', note: 'Per song. There is no hourly rate: teachers spend as much time with students as needed.' },
  { id: 'mastering-time', name: 'Mastering time with teacher', amount: 100, type: 'per', per: 'song', note: 'Per song. There is no hourly rate: teachers spend as much time with students as needed.' },
  { id: 'late-incomplete', name: 'Late / incomplete deliverables fee', amount: 50, type: 'fixed',
    note: 'If you agree to work for another artist or Cardinal Records and do NOT perform the work ON TIME, or the work is INCOMPLETE, you are charged a late fee. The student who hired you is not charged. Being out of school with an excused absence does NOT negate the fee.' },
  { id: 'undone', name: 'Undone fine (work not done)', amount: 100, type: 'fixed',
    note: 'If you agree to work for someone and do NOT perform the work at all. Being out of school with an excused absence does NOT negate the fee.' },
  { id: 'studio-no-show', name: 'Recording studio no-show', amount: 25, type: 'fixed',
    note: 'If you book studio time and do not show up, or the person you want to record does not show up. Cancel or rebook up to 24 hours before (Monday slots by Friday); changes are charged the bank processing fee.' },
  { id: 'general', name: 'General fine', amount: 25, type: 'min',
    note: 'For anything outside the class rules, the Game Rules or the GHS Code of Conduct, at the teacher\'s discretion. Includes inappropriate use of cell phones and electronic devices. A minimum of $25.' },
  { id: 'late-deliverables', name: 'Late fee: deliverables to Cardinal Records', amount: 50, type: 'per', per: 'item',
    note: "If you're late submitting any part of your single's music files, assets, information or other deliverables: charged for EACH item that is late." },
  { id: 'bank-processing', name: 'Bank processing fee', amount: 15, type: 'fixed',
    note: 'If a mistake on the Services To Be Rendered form means Cardinal Records has to adjust bank accounts.' },
  { id: 'tardy', name: 'Tardy to class', amount: 67, type: 'fixed', note: 'Three (3) tardies equal one unexcused absence, per the GHS Code of Conduct and Attendance Policy.' },
  { id: 'unexcused-absence', name: 'Unexcused absence', amount: 200, type: 'fixed',
    note: 'Also affects your class grade: each unexcused absence lowers it one whole grade, and three in a semester is an F.' },
  { id: 'cheating', name: 'Cheating / plagiarism', amount: 0, type: 'percent', min: 50, max: 100,
    note: "50% to 100% of your total bank account. Passing off someone else's work, using copyrighted material without permission, or using work not made in the GHS Lab or Recording Studio. Your account may be zeroed out and you may be disqualified." },
];

const MAX_RATE = 1_000_000;
const clone = (v) => JSON.parse(JSON.stringify(v));

function parseOverrides(raw) {
  try { const o = JSON.parse(raw || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
}

// Items Record Owners add themselves (stored per season in games.rate_sheet under `custom`).
// Removed ones stay stored (marked removed) so old deals and payments keep their names.
const SECTIONS = ['jobs', 'payouts', 'fines'];
const MAX_CUSTOM = 40;
const customOf = (o) => Object.fromEntries(SECTIONS.map((k) => [k, Array.isArray(o.custom?.[k]) ? o.custom[k] : []]));

/** The season's rate sheet: the defaults plus owner-added items, with any owner changes applied. */
function sheetFor(game) {
  const o = parseOverrides(game.rate_sheet);
  const c = customOf(o);
  const live = (list) => list.filter((x) => !x.removed);
  const jobs = [...clone(JOBS), ...clone(live(c.jobs))].map((j) => ({ active: true, ...j, ...(o.jobs?.[j.id] || {}) }));
  const payouts = [...clone(PAYOUTS), ...clone(live(c.payouts))].map((p) => ({ ...p, ...(o.payouts?.[p.id] || {}) }));
  const fines = [...clone(FINES), ...clone(live(c.fines))].map((f) => ({ ...f, ...(o.fines?.[f.id] || {}) }));
  // Names of removed items, so old deals, label jobs and payments still show what they were.
  const retired = SECTIONS.flatMap((k) => c[k].filter((x) => x.removed).map((x) => ({ id: x.id, name: x.name, section: k })));
  return { rules: RULES, advance: game.starting_balance, jobs, payouts, fines, retired };
}

const findItem = (list, id) => list.find((x) => x.id === id);

/**
 * Validate an owner's edit and return the overrides JSON to store. Only amounts
 * (and whether a job can be hired) are editable; names and notes come from the sheet.
 */
function overridesFrom(body, fail, game = {}) {
  const cur = parseOverrides(game.rate_sheet);
  const c = customOf(cur);
  const all = (base, list) => [...base, ...list.filter((x) => !x.removed)];
  const amount = (v, label) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > MAX_RATE) fail(`${label} must be a whole number of dollars from 0 to ${MAX_RATE.toLocaleString()}`);
    return n;
  };
  const out = { jobs: {}, payouts: {}, fines: {}, custom: c };
  for (const [id, v] of Object.entries(body.jobs || {})) {
    const j = findItem(all(JOBS, c.jobs), id);
    if (!j) fail(`Unknown job: ${id}`);
    out.jobs[id] = {
      unitRate: amount(v.unitRate ?? j.unitRate, `${j.name} rate`),
      projectRate: amount(v.projectRate ?? j.projectRate, `${j.name} project rate`),
      active: v.active !== false,
    };
  }
  for (const [id, v] of Object.entries(body.payouts || {})) {
    const p = findItem(all(PAYOUTS, c.payouts), id);
    if (!p) fail(`Unknown payout: ${id}`);
    out.payouts[id] = { amount: amount(v.amount ?? p.amount, p.name) };
  }
  for (const [id, v] of Object.entries(body.fines || {})) {
    const f = findItem(all(FINES, c.fines), id);
    if (!f) fail(`Unknown fee or fine: ${id}`);
    if (f.type === 'percent') continue;
    out.fines[id] = { amount: amount(v.amount ?? f.amount, f.name) };
  }
  return JSON.stringify(out);
}

/**
 * Add, change or remove an owner-made item. Returns { json, item } (json: the new games.rate_sheet).
 *   jobs:    { name, unit: 'hour' | 'item', unitRate, projectRate, note }
 *   payouts: { name, type: 'fixed' | 'per' | 'min', amount, per, note }   (money the label pays)
 *   fines:   { name, type: 'fixed' | 'per' | 'min', amount, per, note }   (fees and fines)
 * Amounts already set on the sheet are kept in sync: an edit here replaces any override for the item.
 */
function customItem(game, section, body, fail, { id = null, remove = false } = {}) {
  if (!SECTIONS.includes(section)) fail('Pick where it goes: a job, label pay, or a fee or fine');
  const o = parseOverrides(game.rate_sheet);
  const c = customOf(o);
  const list = c[section];
  const cur = id ? list.find((x) => x.id === id && !x.removed) : null;
  if (id && !cur) fail('That item is not on the rate sheet (only items you added can be changed here)', 404);
  if (remove) {
    cur.removed = true;
    for (const k of SECTIONS) if (o[k]) delete o[k][cur.id];
    return { json: JSON.stringify({ ...o, custom: c }), item: cur };
  }
  const text = (v, label, { min = 0, max }) => {
    const t = String(v ?? '').replace(/\s+/g, ' ').trim();
    if (t.length < min) fail(min > 1 ? `${label} needs at least ${min} characters` : `${label} is required`);
    if (t.length > max) fail(`${label} can be at most ${max} characters`);
    return t;
  };
  const money = (v, label, { min = 0 } = {}) => {
    const n = Number(v);
    if (v === '' || v == null || !Number.isInteger(n) || n < min || n > MAX_RATE) fail(`${label} must be a whole number of dollars from ${min} to ${MAX_RATE.toLocaleString()}`);
    return n;
  };
  const b = { ...(cur || {}), ...body };
  const name = text(b.name, 'Name', { min: 2, max: 60 });
  const defaults = { jobs: JOBS, payouts: PAYOUTS, fines: FINES }[section];
  const clash = [...defaults, ...list.filter((x) => !x.removed && x.id !== cur?.id)].find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (clash) fail(`"${clash.name}" is already on the rate sheet`);
  const note = text(b.note, 'Description', { max: 300 });
  let item;
  if (section === 'jobs') {
    const unit = b.unit === 'item' ? 'item' : 'hour';
    const unitRate = money(b.unitRate, unit === 'item' ? 'Rate per item' : 'Rate per hour / class');
    const projectRate = money(b.projectRate ?? 0, 'Project rate');
    if (!unitRate && !projectRate) fail('Set a rate, a project rate, or both');
    item = { name, unit, unitRate, projectRate, note };
  } else {
    const type = ['fixed', 'per', 'min'].includes(b.type) ? b.type : 'fixed';
    const amount = money(b.amount, type === 'min' ? 'Minimum amount' : 'Amount', { min: section === 'payouts' && type !== 'min' ? 1 : 0 });
    const per = type === 'per' ? text(b.per, 'What it is "per" (like song, item, class block)', { min: 2, max: 30 }).toLowerCase() : undefined;
    item = { name, type, amount, ...(per ? { per } : {}), note };
  }
  if (cur) {
    Object.assign(cur, item);
    if (section !== 'jobs' && !item.per) delete cur.per;
    if (o[section]) delete o[section][cur.id]; // the amounts set here win over earlier edits
    return { json: JSON.stringify({ ...o, custom: c }), item: cur };
  }
  if (list.filter((x) => !x.removed).length >= MAX_CUSTOM) fail(`Up to ${MAX_CUSTOM} added items per section`);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'item';
  const newId = `custom-${slug}-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
  const made = { id: newId, ...item, custom: true };
  list.push(made);
  return { json: JSON.stringify({ ...o, custom: c }), item: made };
}

module.exports = { sheetFor, overridesFrom, findItem, customItem, SECTIONS };

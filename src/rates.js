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

/** The season's rate sheet: the defaults with any owner changes applied. */
function sheetFor(game) {
  const o = parseOverrides(game.rate_sheet);
  const jobs = clone(JOBS).map((j) => ({ active: true, ...j, ...(o.jobs?.[j.id] || {}) }));
  const payouts = clone(PAYOUTS).map((p) => ({ ...p, ...(o.payouts?.[p.id] || {}) }));
  const fines = clone(FINES).map((f) => ({ ...f, ...(o.fines?.[f.id] || {}) }));
  return { rules: RULES, advance: game.starting_balance, jobs, payouts, fines };
}

const findItem = (list, id) => list.find((x) => x.id === id);

/**
 * Validate an owner's edit and return the overrides JSON to store. Only amounts
 * (and whether a job can be hired) are editable; names and notes come from the sheet.
 */
function overridesFrom(body, fail) {
  const amount = (v, label) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > MAX_RATE) fail(`${label} must be a whole number of dollars from 0 to ${MAX_RATE.toLocaleString()}`);
    return n;
  };
  const out = { jobs: {}, payouts: {}, fines: {} };
  for (const [id, v] of Object.entries(body.jobs || {})) {
    const j = findItem(JOBS, id);
    if (!j) fail(`Unknown job: ${id}`);
    out.jobs[id] = {
      unitRate: amount(v.unitRate ?? j.unitRate, `${j.name} rate`),
      projectRate: amount(v.projectRate ?? j.projectRate, `${j.name} project rate`),
      active: v.active !== false,
    };
  }
  for (const [id, v] of Object.entries(body.payouts || {})) {
    const p = findItem(PAYOUTS, id);
    if (!p) fail(`Unknown payout: ${id}`);
    out.payouts[id] = { amount: amount(v.amount ?? p.amount, p.name) };
  }
  for (const [id, v] of Object.entries(body.fines || {})) {
    const f = findItem(FINES, id);
    if (!f) fail(`Unknown fee or fine: ${id}`);
    if (f.type === 'percent') continue;
    out.fines[id] = { amount: amount(v.amount ?? f.amount, f.name) };
  }
  return JSON.stringify(out);
}

module.exports = { sheetFor, overridesFrom, findItem };

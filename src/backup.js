'use strict';
// Printable PDF backup of a season's class records, for Record Owners: if the
// server is ever down, this is the copy you can read (and print) on any computer.
const PDFDocument = require('pdfkit');
const { db } = require('./db');
const G = require('./game');
const { sheetFor } = require('./rates');

const RED = '#a8132b';
const REDD = '#6f0c1d';
const INK = '#1a1a1a';
const DIM = '#5f5d57';
const RULE = '#d9d8d0';
const ROW = '#f3f2ec';
const PAGE = { size: 'LETTER', margin: 40 };
const KIND = {
  advance: 'Signing advance', grant: 'Label payment', bonus: 'Game bonus', fine: 'Fee / fine',
  escrow_hold: 'Escrow hold', escrow_refund: 'Escrow refund', payment: 'Payment', label_fee: 'Label cut',
};
const PHASE = { setup: 'Pre-season', active: 'Season live', showcase: 'Showcase', archived: 'Archived' };

// The PDF's built-in fonts only cover Western European characters, so fold accents
// and drop anything else (emoji, other scripts) rather than printing garbage.
const KEEP = new Set('‘’“”–—…•€');
function clean(v) {
  const s = String(v ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '');
  let out = '';
  for (const ch of s) out += ch.charCodeAt(0) <= 0xff || KEEP.has(ch) ? ch : '';
  out = out.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').replace(/ {2,}/g, ' ').trim();
  return out || (String(v ?? '').trim() ? '?' : '');
}
const money = (n) => `${n < 0 ? '-' : ''}$${Math.abs(Number(n) || 0).toLocaleString('en-US')}`;

/** Gather everything the PDF prints for one season. */
async function seasonData(game) {
  // Natural order, so "Artist 2" comes before "Artist 10".
  const stats = (await G.playerStats(game)).sort((a, b) =>
    a.player.display_name.localeCompare(b.player.display_name, 'en', { numeric: true, sensitivity: 'base' }));
  const players = stats.map((r) => r.player);
  const finesByUser = new Map((await db.all(
    "SELECT user_id, SUM(amount) AS v FROM ledger WHERE game_id = ? AND kind = 'fine' GROUP BY user_id", game.id
  )).map((r) => [r.user_id, -r.v]));
  const names = new Map((await db.all(
    `SELECT id, display_name FROM users WHERE id IN (
       SELECT user_id FROM ledger WHERE game_id = ? UNION SELECT buyer_id FROM contracts WHERE game_id = ?
       UNION SELECT seller_id FROM contracts WHERE game_id = ? UNION SELECT user_id FROM tracks WHERE game_id = ?)`,
    game.id, game.id, game.id, game.id
  )).map((u) => [u.id, u.display_name]));
  for (const p of players) names.set(p.id, p.display_name);
  return {
    game,
    clock: G.clock(game),
    sheet: sheetFor(game),
    stats,
    fines: finesByUser,
    names,
    ledger: await db.all('SELECT * FROM ledger WHERE game_id = ? ORDER BY created_at, id', game.id),
    contracts: await db.all('SELECT * FROM contracts WHERE game_id = ? ORDER BY id', game.id),
    tracks: await db.all(
      'SELECT t.*, (SELECT COUNT(*) FROM track_likes l WHERE l.track_id = t.id) AS likes FROM tracks t WHERE game_id = ? ORDER BY created_at', game.id
    ),
  };
}

/**
 * A PDF document with the house style: banner headings, striped tables that repeat their
 * header across pages, and page footers. Shared by the backup and the grading report.
 */
function pdfKit(out, { title, tz: wantTz } = {}) {
  let tz = 'UTC';
  try { if (wantTz) { new Intl.DateTimeFormat('en-US', { timeZone: wantTz }); tz = wantTz; } } catch {}
  const dfmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' });
  const dtfmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const date = (ms) => (ms ? dfmt.format(new Date(Number(ms))) : '');
  const generated = dtfmt.format(new Date());

  const doc = new PDFDocument({ ...PAGE, bufferPages: true, info: { Title: title, Author: 'Cardinal Records' } });
  doc.pipe(out);
  const L = doc.page.margins.left;
  const W = doc.page.width - L - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 18; // room for the footer
  const pageSeason = []; // season name per page, for footers

  const newPage = (season) => {
    doc.addPage();
    pageSeason[doc.bufferedPageRange().count - 1] = season;
    doc.y = doc.page.margins.top;
  };
  const ensure = (h, season) => { if (doc.y + h > bottom()) newPage(season); };

  const banner = (title, sub) => {
    const y = doc.y;
    doc.rect(L, y, W, 26).fill(RED);
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(12).text(clean(title), L + 10, y + 8, { width: W - 20, lineBreak: false });
    doc.y = y + 32;
    if (sub) doc.fillColor(DIM).font('Helvetica').fontSize(8.5).text(clean(sub), L, doc.y, { width: W }).moveDown(0.4);
    doc.fillColor(INK);
  };

  /** A table that wraps cell text, stripes rows and repeats its header on new pages. */
  const table = (cols, rows, season, { size = 8 } = {}) => {
    const total = cols.reduce((a, c) => a + c.w, 0);
    const widths = cols.map((c) => (c.w / total) * W);
    const pad = 3;
    const head = () => {
      ensure(18, season);
      const y = doc.y;
      doc.rect(L, y, W, 15).fill(REDD);
      doc.font('Helvetica-Bold').fontSize(size).fillColor('#fff');
      let x = L;
      cols.forEach((c, i) => { doc.text(clean(c.h), x + pad, y + 4, { width: widths[i] - pad * 2, align: c.align || 'left', lineBreak: false }); x += widths[i]; });
      doc.y = y + 15;
    };
    head();
    if (!rows.length) {
      doc.font('Helvetica-Oblique').fontSize(size).fillColor(DIM).text('None.', L + pad, doc.y + 4);
      doc.moveDown(0.6);
      return;
    }
    rows.forEach((r, ri) => {
      doc.font('Helvetica').fontSize(size);
      const cells = r.map((v) => clean(v));
      const h = Math.max(...cells.map((v, i) => doc.heightOfString(v || ' ', { width: widths[i] - pad * 2 }))) + pad * 2;
      if (doc.y + h > bottom()) { newPage(season); head(); doc.font('Helvetica').fontSize(size); }
      const y = doc.y;
      if (ri % 2) doc.rect(L, y, W, h).fill(ROW);
      let x = L;
      cells.forEach((v, i) => {
        const c = cols[i];
        doc.font(c.bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(c.color?.(r[i]) || INK)
          .text(v, x + pad, y + pad, { width: widths[i] - pad * 2, align: c.align || 'left' });
        x += widths[i];
      });
      doc.moveTo(L, y + h).lineTo(L + W, y + h).lineWidth(0.4).strokeColor(RULE).stroke();
      doc.y = y + h;
    });
    doc.x = L;
    doc.moveDown(0.8);
  };
  const negRed = (v) => (String(v).startsWith('-') ? RED : INK);

  /** Footers on every page: `label(i)` names page i. Then closes the document. */
  const finish = (label) => {
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      // Writing inside the bottom margin would make PDFKit start a new page, so lift it for the footer.
      const margin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const y = doc.page.height - margin - 8;
      doc.font('Helvetica').fontSize(7.5).fillColor(DIM)
        .text(clean(label(i)), L, y, { width: W * 0.75, lineBreak: false })
        .text(`Page ${i + 1} of ${range.count}`, L + W * 0.75, y, { width: W * 0.25, align: 'right', lineBreak: false });
      doc.page.margins.bottom = margin;
    }
    doc.end();
  };
  return { doc, L, W, date, generated, pageSeason, newPage, ensure, banner, table, negRed, finish };
}
/**
 * Stream a PDF for these seasons into `out` (an HTTP response).
 * opts: { pins: include student PINs, by: who downloaded it, tz: the viewer's time zone }
 */
async function writeBackupPdf(out, games, opts = {}) {
  const seasons = [];
  for (const g of games) seasons.push(await seasonData(g));

  const { doc, L, W, date, generated, pageSeason, newPage, ensure, banner, table, negRed, finish } = pdfKit(out, { title: 'Cardinal Records class records backup', tz: opts.tz });

  // ---------- title page ----------
  pageSeason[0] = null;
  doc.rect(0, 0, doc.page.width, 120).fill(RED);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(26).text('CARDINAL RECORDS', L, 42);
  doc.font('Helvetica').fontSize(12).text('Class records backup', L, 76);
  doc.fillColor(INK).font('Helvetica').fontSize(10);
  doc.y = 150;
  doc.text(`Generated ${clean(generated)}${opts.by ? ` by ${clean(opts.by)}` : ''}.`);
  doc.moveDown(0.6);
  doc.text('This file is a full, readable copy of each season below: the roster and balances, every transaction, every contract, the Showcase and the rate sheet in effect. Keep it with your class records in case the website is ever unavailable.', { width: W });
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fillColor(RED).text(opts.pins
    ? 'PRIVATE: this copy includes student PINs. Store it securely and do not share it with students.'
    : 'PRIVATE: this copy contains student records. Store it securely. (Student PINs are not included.)', { width: W });
  doc.moveDown(1.2);
  doc.fillColor(INK);
  table(
    [{ h: 'Season', w: 34, bold: true }, { h: 'Phase', w: 14 }, { h: 'Dates', w: 26 }, { h: 'Artists', w: 10, align: 'right' }, { h: 'Deals', w: 10, align: 'right' }],
    seasons.map((s) => [
      s.game.name, PHASE[s.game.status] || s.game.status,
      s.game.started_at ? `${date(s.game.started_at)} - ${s.game.ended_at ? date(s.game.ended_at) : `day ${s.clock.day} of ${s.clock.totalDays}`}` : 'Not started',
      String(s.stats.length), String(s.contracts.length),
    ]),
    null
  );

  for (const s of seasons) {
    const g = s.game;
    const nm = (id) => (id == null ? 'Label vault' : s.names.get(id) || `#${id}`);
    newPage(g.name);

    // ---------- season overview ----------
    banner(g.name, `${PHASE[g.status] || g.status} - ${g.started_at ? `started ${date(g.started_at)}${g.ended_at ? `, ended ${date(g.ended_at)}` : `, day ${s.clock.day} of ${s.clock.totalDays}`}` : 'not started yet'} - ${g.duration_days}-day season - ${money(g.starting_balance)} advance - ${g.label_cut_pct}% label cut`);
    const cash = s.stats.reduce((a, r) => a + r.stats.balance, 0);
    const escrow = s.stats.reduce((a, r) => a + r.stats.escrow, 0);
    const vault = s.ledger.filter((l) => l.user_id == null).reduce((a, l) => a + l.amount, 0);
    const done = s.contracts.filter((c) => c.status === 'completed');
    doc.font('Helvetica').fontSize(9).fillColor(INK).text(
      `${s.stats.length} artists - ${money(cash)} cash in circulation - ${money(escrow)} in escrow - ${money(vault)} label vault - ${done.length} completed deals worth ${money(done.reduce((a, c) => a + c.amount, 0))} - ${s.tracks.length} Showcase tracks`,
      L, doc.y, { width: W }
    );
    doc.moveDown(0.8);

    // ---------- roster ----------
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text('Roster and balances');
    doc.moveDown(0.3);
    const rosterCols = [
      { h: 'Artist', w: 20, bold: true }, { h: 'Username', w: 14 }, ...(opts.pins ? [{ h: 'PIN / code', w: 10 }] : []), { h: 'Role', w: 10 },
      { h: 'Cash', w: 10, align: 'right', color: negRed }, { h: 'Escrow', w: 9, align: 'right' }, { h: 'Net worth', w: 10, align: 'right', color: negRed },
      { h: 'Earned', w: 9, align: 'right' }, { h: 'Fines', w: 8, align: 'right' }, { h: 'Sold/Bought', w: 13, align: 'right' }, { h: 'Level', w: 6, align: 'right' },
    ];
    table(rosterCols, s.stats.map((r) => [
      `${r.player.display_name}${r.player.active ? '' : ' (removed)'}`, `@${r.player.username}`, ...(opts.pins ? [r.player.pin ?? (r.player.claim_code ? `code ${r.player.claim_code.slice(0, 3)}-${r.player.claim_code.slice(3)}` : 'unclaimed')] : []), r.player.role_title,
      money(r.stats.balance), money(r.stats.escrow), money(r.stats.netWorth), money(r.stats.earned), money(s.fines.get(r.player.id) || 0),
      `${r.stats.dealsSold}/${r.stats.dealsBought}`, String(r.progress.level),
    ]), g.name);

    // ---------- contracts ----------
    ensure(60, g.name);
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text('Contracts');
    doc.moveDown(0.3);
    const job = (c) => s.sheet.jobs.find((j) => j.id === c.job_id)?.name || '';
    const pricing = (c) => (c.pricing === 'project' ? 'Project rate'
      : c.pricing === 'unit' ? `${c.quantity} x ${money(c.unit_rate)}` : '');
    table(
      [{ h: 'No.', w: 8 }, { h: 'Title / job', w: 20, bold: true }, { h: 'Client', w: 14 }, { h: 'Artist', w: 14 }, { h: 'Pricing', w: 12 },
        { h: 'Amount', w: 9, align: 'right' }, { h: 'Status', w: 10 }, { h: 'Made', w: 10 }, { h: 'Done', w: 10 }],
      s.contracts.map((c) => [
        `CR-${String(c.id).padStart(4, '0')}`, `${c.title}${job(c) && job(c) !== c.title ? `\n${job(c)}` : ''}`, nm(c.buyer_id), nm(c.seller_id), pricing(c),
        money(c.amount), c.status, date(c.created_at), date(c.completed_at),
      ]),
      g.name
    );

    // ---------- showcase ----------
    ensure(60, g.name);
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text('Showcase music');
    doc.moveDown(0.3);
    table(
      [{ h: 'Track', w: 22, bold: true }, { h: 'Artist', w: 15 }, { h: 'Genre', w: 10 }, { h: 'Link', w: 39 }, { h: 'Likes', w: 7, align: 'right' }, { h: 'Plays', w: 7, align: 'right' }],
      s.tracks.map((t) => [t.title, nm(t.user_id), t.genre, t.url, String(t.likes), String(t.plays)]),
      g.name
    );

    // ---------- artist profiles ----------
    const withProfile = s.stats.filter((r) => r.player.profile_url);
    if (withProfile.length) {
      ensure(60, g.name);
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text('Artist profiles');
      doc.moveDown(0.3);
      table([{ h: 'Artist', w: 25, bold: true }, { h: 'Role', w: 20 }, { h: 'Profile link', w: 55 }],
        withProfile.map((r) => [r.player.display_name, r.player.role_title, r.player.profile_url]), g.name);
    }

    // ---------- rate sheet ----------
    ensure(60, g.name);
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text('Rate sheet in effect');
    doc.moveDown(0.3);
    table(
      [{ h: 'Job', w: 50, bold: true }, { h: 'Rate', w: 20, align: 'right' }, { h: 'Project rate', w: 18, align: 'right' }, { h: 'Hireable', w: 12, align: 'right' }],
      s.sheet.jobs.map((j) => [j.name, `${money(j.unitRate)} / ${j.unit === 'item' ? 'item' : 'hour or class'}`, money(j.projectRate), j.active ? 'Yes' : 'No']),
      g.name
    );
    table(
      [{ h: 'Fee, fine or payout', w: 60, bold: true }, { h: 'Amount', w: 40, align: 'right' }],
      [
        ['Signing advance', money(g.starting_balance)],
        ...s.sheet.payouts.map((p) => [p.name, `${money(p.amount)}${p.type === 'per' ? ` per ${p.per}` : p.type === 'min' ? ' minimum' : ''}`]),
        ...s.sheet.fines.map((f) => [f.name, f.type === 'percent' ? `${f.min}% to ${f.max}% of account` : `${money(f.amount)}${f.type === 'per' ? ` per ${f.per}` : f.type === 'min' ? ' minimum' : ''}`]),
      ],
      g.name
    );

    // ---------- statements ----------
    newPage(g.name);
    banner(`${g.name}: artist statements`, 'Every transaction on each artist\'s account, oldest first, with the running balance.');
    const byUser = new Map();
    for (const l of s.ledger) { if (l.user_id == null) continue; if (!byUser.has(l.user_id)) byUser.set(l.user_id, []); byUser.get(l.user_id).push(l); }
    const ids = [...s.stats.map((r) => r.player.id), ...[...byUser.keys()].filter((id) => !s.stats.some((r) => r.player.id === id))];
    for (const id of ids) {
      const rows = byUser.get(id) || [];
      const r = s.stats.find((x) => x.player.id === id);
      ensure(70, g.name);
      doc.rect(L, doc.y, W, 0.8).fill(RED);
      doc.moveDown(0.25);
      doc.font('Helvetica-Bold').fontSize(10).fillColor(INK)
        .text(clean(`${nm(id)}${r ? `  @${r.player.username}` : '  (moved to another season)'}`), L, doc.y, { continued: !!r });
      if (r) doc.font('Helvetica').fontSize(8.5).fillColor(DIM).text('     ' + clean(`cash ${money(r.stats.balance)} - escrow ${money(r.stats.escrow)} - net worth ${money(r.stats.netWorth)}`));
      doc.moveDown(0.25);
      let run = 0;
      table(
        [{ h: 'Date', w: 13 }, { h: 'Type', w: 15 }, { h: 'Memo', w: 46 }, { h: 'Amount', w: 13, align: 'right', color: negRed }, { h: 'Balance', w: 13, align: 'right', color: negRed }],
        rows.map((l) => { run += l.amount; return [date(l.created_at), KIND[l.kind] || l.kind, l.memo, `${l.amount >= 0 ? '+' : ''}${money(l.amount)}`, money(run)]; }),
        g.name,
        { size: 7.5 }
      );
    }
  }

  finish((i) => `Cardinal Records backup - ${pageSeason[i] || 'Contents'} - generated ${generated}`);
}

// ---------- grading report ----------
// How many Release Guide steps there are (the guide lives in the client's public/guide.js).
let GUIDE_STEPS = null;
function guideSteps() {
  if (GUIDE_STEPS == null) {
    try {
      const sandbox = { window: {} };
      require('node:vm').runInNewContext(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'guide.js'), 'utf8'), sandbox);
      GUIDE_STEPS = sandbox.window.RELEASE_GUIDE.map((s) => s.id);
    } catch { GUIDE_STEPS = []; }
  }
  return GUIDE_STEPS;
}

/**
 * A one-page-per-student grading report: the numbers, the work they delivered (on time
 * or late), who they hired, fees and fines, music, profile and Release Guide progress,
 * with space for the teacher's notes. Whole class, or one student with `playerId`.
 */
async function writeReportPdf(out, game, opts = {}) {
  const s = await seasonData(game);
  const kit = pdfKit(out, { title: `Cardinal Records grading report: ${game.name}`, tz: opts.tz });
  const { doc, L, W, date, generated, pageSeason, newPage, ensure, banner, table, negRed, finish } = kit;
  const nm = (id) => (id == null ? 'Label vault' : s.names.get(id) || `#${id}`);
  const events = new Map();
  for (const e of await db.all('SELECT e.* FROM contract_events e JOIN contracts c ON c.id = e.contract_id WHERE c.game_id = ? ORDER BY e.id', game.id)) {
    if (!events.has(e.contract_id)) events.set(e.contract_id, []);
    events.get(e.contract_id).push(e);
  }
  const chats = new Map((await db.all("SELECT actor_id AS k, COUNT(*) AS n FROM feed WHERE game_id = ? AND kind = 'chat' GROUP BY actor_id", game.id)).map((r) => [r.k, r.n]));
  const challengeRows = await db.all('SELECT e.user_id, e.place FROM challenge_entries e JOIN challenges c ON c.id = e.challenge_id WHERE c.game_id = ? AND c.status <> ?', game.id, 'cancelled');
  const steps = guideSteps();
  const jobName = (c) => s.sheet.jobs.find((j) => j.id === c.job_id)?.name || c.title;
  const KIND = { advance: 'Signing advance', grant: 'Label payment', bonus: 'Game bonus', fine: 'Fee / fine' };
  let students = s.stats;
  if (opts.playerId) students = students.filter((r) => r.player.id === opts.playerId);

  const cardFor = (r) => {
    const p = r.player;
    const sold = s.contracts.filter((c) => c.seller_id === p.id);
    const bought = s.contracts.filter((c) => c.buyer_id === p.id);
    const withDue = sold.filter((c) => c.due_days && c.approved_at && ['delivered', 'completed'].includes(c.status));
    const late = withDue.filter((c) => G.deadline(c, events.get(c.id) || []).late);
    const overdue = sold.filter((c) => G.deadline(c, events.get(c.id) || []).overdue);
    const mine = s.ledger.filter((l) => l.user_id === p.id);
    const sum = (kinds) => mine.filter((l) => kinds.includes(l.kind)).reduce((a, l) => a + l.amount, 0);
    const tracks = s.tracks.filter((t) => t.user_id === p.id);
    const done = Object.keys(r.tutorial?.done || {}).filter((k) => steps.includes(k)).length;
    return { p, sold, bought, withDue, late, overdue, mine, tracks, done,
      payments: sum(['grant', 'bonus']), fines: -sum(['fine']), chats: chats.get(p.id) || 0,
      entered: challengeRows.filter((x) => x.user_id === p.id).length, won: challengeRows.filter((x) => x.user_id === p.id && x.place).length };
  };
  const cards = students.map(cardFor);

  // ---------- cover: the whole class at a glance ----------
  pageSeason[0] = game.name;
  doc.rect(0, 0, doc.page.width, 110).fill('#a8132b');
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(24).text('GRADING REPORT', L, 38);
  doc.font('Helvetica').fontSize(12).text(clean(`${game.name}${opts.playerId && cards[0] ? `: ${cards[0].p.display_name}` : ''}`), L, 70);
  doc.y = 132;
  doc.fillColor('#1a1a1a').font('Helvetica').fontSize(9.5).text(clean(
    `Generated ${generated}${opts.by ? ` by ${opts.by}` : ''}. ${game.started_at ? `Season started ${date(game.started_at)}, day ${s.clock.day} of ${s.clock.totalDays}.` : 'Season not started yet.'} ` +
    'Each student has their own page: the numbers, the work they delivered (on time or late), who they hired, fees and fines, their music, profile and Release Guide progress, and space for your notes.'), L, doc.y, { width: W });
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fillColor('#a8132b').fontSize(9).text('PRIVATE: student records. Store securely.', L, doc.y, { width: W });
  doc.moveDown(0.8);
  table([
    { h: 'Artist', w: 20, bold: true }, { h: 'Cash', w: 9, align: 'right', color: negRed }, { h: 'Net worth', w: 10, align: 'right', color: negRed },
    { h: 'Earned', w: 9, align: 'right' }, { h: 'Fines', w: 8, align: 'right' }, { h: 'Delivered', w: 9, align: 'right' }, { h: 'Late', w: 6, align: 'right' },
    { h: 'Hired', w: 7, align: 'right' }, { h: 'Rating', w: 7, align: 'right' }, { h: 'Tracks', w: 7, align: 'right' }, { h: 'Guide', w: 8, align: 'right' },
  ], cards.map((c) => {
    const st = s.stats.find((x) => x.player.id === c.p.id).stats;
    return [c.p.display_name, money(st.balance), money(st.netWorth), money(st.earned), money(c.fines), String(st.dealsSold), String(c.late.length),
      String(st.dealsBought), st.rating ? `${st.rating}/5` : '-', String(c.tracks.length), `${c.done}/${steps.length || '?'}`];
  }), game.name);

  // ---------- one page per student ----------
  for (const c of cards) {
    const r = s.stats.find((x) => x.player.id === c.p.id);
    const st = r.stats;
    newPage(game.name);
    banner(`${c.p.display_name}`, `@${c.p.username} - ${c.p.role_title || 'Artist'} - ${game.name} - Level ${r.progress.level} ${r.progress.title}${c.p.active ? '' : ' - removed from roster'}`);
    table([{ h: 'Money', w: 30, bold: true }, { h: '', w: 20, align: 'right' }, { h: 'Work', w: 30, bold: true }, { h: '', w: 20, align: 'right' }], [
      ['Cash now', money(st.balance), 'Deals delivered (as the artist)', String(st.dealsSold)],
      ['Net worth (cash + escrow)', money(st.netWorth), 'Delivered on time (with a deadline)', c.withDue.length ? `${c.withDue.length - c.late.length} of ${c.withDue.length}` : 'No deadlines'],
      ['Earned from deals', money(st.earned), 'Delivered late', String(c.late.length)],
      ['Spent hiring labelmates', money(st.spent), 'Overdue right now', String(c.overdue.length)],
      ['Label payments and bonuses', money(c.payments), 'Artists hired', String(st.dealsBought)],
      ['Fees and fines', c.fines ? `-${money(c.fines)}` : money(0), 'Average rating from clients', st.rating ? `${st.rating} / 5` : 'No ratings yet'],
      ['Showcase tracks / likes', `${c.tracks.length} / ${st.likes}`, 'Release Guide', `${c.done} of ${steps.length} steps${r.tutorial?.completedAt ? ' (finished)' : ''}`],
      ['Lobby messages posted', String(c.chats), 'Studio challenges entered / placed', `${c.entered} / ${c.won}`],
      ['', '', 'Badges', r.badges.map((b) => b.name).join(', ') || 'None yet'],
    ], game.name, { size: 8.5 });
    if (c.p.profile_url) { doc.font('Helvetica').fontSize(8.5).fillColor('#1a1a1a').text(clean(`Artist profile: ${c.p.profile_url}`), L, doc.y, { width: W }); doc.moveDown(0.6); }

    ensure(50, game.name);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#1a1a1a').text('Work delivered as the artist', L, doc.y); doc.moveDown(0.25);
    table([{ h: 'No.', w: 9 }, { h: 'Job', w: 22, bold: true }, { h: 'Client', w: 17 }, { h: 'Amount', w: 10, align: 'right' }, { h: 'Status', w: 11 }, { h: 'Due', w: 13 }, { h: 'Delivery', w: 18 }],
      c.sold.map((k) => {
        const d = G.deadline(k, events.get(k.id) || []);
        const delivery = d.deliveredAt ? `${date(d.deliveredAt)}${d.dueAt ? (d.late ? ' (late)' : ' (on time)') : ''}` : d.overdue ? 'OVERDUE' : '';
        return [`CR-${String(k.id).padStart(4, '0')}`, jobName(k), nm(k.buyer_id), money(k.amount), k.status, d.dueAt ? date(d.dueAt) : '', delivery];
      }), game.name, { size: 7.5 });
    ensure(50, game.name);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#1a1a1a').text('Artists they hired', L, doc.y); doc.moveDown(0.25);
    table([{ h: 'No.', w: 9 }, { h: 'Job', w: 25, bold: true }, { h: 'Artist', w: 20 }, { h: 'Amount', w: 12, align: 'right' }, { h: 'Status', w: 14 }, { h: 'Rating given', w: 20 }],
      c.bought.map((k) => [`CR-${String(k.id).padStart(4, '0')}`, jobName(k), nm(k.seller_id), money(k.amount), k.status, k.rating ? `${k.rating}/5` : '']), game.name, { size: 7.5 });
    ensure(50, game.name);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#1a1a1a').text('Advance, label payments, fees and fines', L, doc.y); doc.moveDown(0.25);
    table([{ h: 'Date', w: 14 }, { h: 'Type', w: 16 }, { h: 'Memo', w: 54 }, { h: 'Amount', w: 16, align: 'right', color: negRed }],
      c.mine.filter((l) => KIND[l.kind]).map((l) => [date(l.created_at), KIND[l.kind], l.memo, `${l.amount >= 0 ? '+' : ''}${money(l.amount)}`]), game.name, { size: 7.5 });
    ensure(90, game.name);
    const y = doc.y + 2;
    doc.rect(L, y, W, 80).lineWidth(0.8).strokeColor('#c9a227').stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#a8132b').text('TEACHER NOTES / GRADE', L + 8, y + 7);
    for (let i = 1; i <= 3; i++) doc.moveTo(L + 8, y + 18 + i * 18).lineTo(L + W - 8, y + 18 + i * 18).lineWidth(0.4).strokeColor('#d9d8d0').stroke();
    doc.y = y + 88;
  }
  if (!cards.length) { doc.font('Helvetica-Oblique').fontSize(10).fillColor('#5f5d57').text('No artists on this roster yet.', L, doc.y); }
  finish((i) => `Cardinal Records grading report - ${pageSeason[i] || game.name} - generated ${generated}`);
}

module.exports = { writeBackupPdf, writeReportPdf };

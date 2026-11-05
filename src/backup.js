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
 * Stream a PDF for these seasons into `out` (an HTTP response).
 * opts: { pins: include student PINs, by: who downloaded it, tz: the viewer's time zone }
 */
async function writeBackupPdf(out, games, opts = {}) {
  const seasons = [];
  for (const g of games) seasons.push(await seasonData(g));

  let tz = 'UTC';
  try { if (opts.tz) { new Intl.DateTimeFormat('en-US', { timeZone: opts.tz }); tz = opts.tz; } } catch {}
  const dfmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' });
  const dtfmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const date = (ms) => (ms ? dfmt.format(new Date(Number(ms))) : '');
  const generated = dtfmt.format(new Date());

  const doc = new PDFDocument({ ...PAGE, bufferPages: true, info: { Title: 'Cardinal Records class records backup', Author: 'Cardinal Records' } });
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

  // ---------- footers ----------
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    // Writing inside the bottom margin would make PDFKit start a new page, so lift it for the footer.
    const margin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - margin - 8;
    doc.font('Helvetica').fontSize(7.5).fillColor(DIM)
      .text(clean(`Cardinal Records backup - ${pageSeason[i] || 'Contents'} - generated ${generated}`), L, y, { width: W * 0.75, lineBreak: false })
      .text(`Page ${i + 1} of ${range.count}`, L + W * 0.75, y, { width: W * 0.25, align: 'right', lineBreak: false });
    doc.page.margins.bottom = margin;
  }
  doc.end();
}

module.exports = { writeBackupPdf };

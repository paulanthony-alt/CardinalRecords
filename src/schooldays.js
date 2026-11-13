'use strict';
// School-day due dates: weekends don't count.
//
// "Due in N days" means N school days (Monday to Friday) after the day the label
// approved the deal, due by the end of that day (11:59:59 PM) in the school's time
// zone. Approved Friday with 1 day -> due end of Monday. Approved Saturday with
// 1 day -> due end of Monday. Holidays are not skipped (yet).

const SCHOOL_TZ = process.env.SCHOOL_TZ || 'America/New_York';
const DAY = 86_400_000;

/** The calendar date and weekday of a moment, in a time zone. */
function localParts(ms, tz = SCHOOL_TZ) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(ms)).map((p) => [p.type, Number(p.value)]));
  return { y: parts.year, m: parts.month, d: parts.day, h: parts.hour % 24, mi: parts.minute, s: parts.second };
}

/** The moment it is a given local wall-clock time in a time zone (handles daylight saving). */
function zonedTime(y, m, d, h, mi, s, ms, tz = SCHOOL_TZ) {
  const want = Date.UTC(y, m - 1, d, h, mi, s, ms);
  let guess = want;
  for (let i = 0; i < 3; i++) {
    const p = localParts(guess, tz);
    const shown = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s, ms);
    const diff = want - shown;
    if (!diff) break;
    guess += diff;
  }
  return guess;
}

/** When a deal approved at `approvedAt` with `days` school days is due (end of that day, school time). */
function schoolDueAt(approvedAt, days, tz = SCHOOL_TZ) {
  const p = localParts(Number(approvedAt), tz);
  let day = Date.UTC(p.y, p.m - 1, p.d); // a calendar date, as midnight UTC, just for counting
  let left = Math.max(1, Number(days) || 1);
  while (left > 0) {
    day += DAY;
    const wd = new Date(day).getUTCDay(); // 0 Sunday, 6 Saturday
    if (wd !== 0 && wd !== 6) left -= 1;
  }
  const d = new Date(day);
  return zonedTime(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 23, 59, 59, 999, tz);
}

module.exports = { SCHOOL_TZ, schoolDueAt, localParts };

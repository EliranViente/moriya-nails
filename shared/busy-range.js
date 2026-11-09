/**
 * Busy intervals for a range of dates, grouped by Israel calendar day.
 * Shared by netlify/functions/busy-slots.js and the local dev server so both
 * answer /api/busy-slots identically.
 *
 * One request can now cover the whole booking window (`from`..`to`) instead of
 * one request per Friday: the calendar used to wait on 4–5 serverless calls
 * (each its own Google round trip) before it could draw a single day.
 *
 * The caller supplies `queryFreebusy(timeMin, timeMax)` → [{start, end}] (ISO
 * strings, as Google's freeBusy returns them), so this module stays free of
 * any Google client library.
 */
const TZ             = 'Asia/Jerusalem';
const DATE_RE        = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MIN        = 24 * 60;
const MAX_RANGE_DAYS = 100; // the client window is ~2 months; cap abuse
const CHUNK_DAYS     = 30;  // keep each freeBusy query well inside Google's limit

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

// hourCycle h23 so midnight is 00, never "24" (which hour12:false can produce).
const localFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});

// ISO instant → { date: 'YYYY-MM-DD', min: minutes since Israel midnight }
function toLocal(iso) {
  const p = {};
  localFmt.formatToParts(new Date(iso)).forEach(x => { p[x.type] = x.value; });
  return { date: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
}

// Reads ?date=YYYY-MM-DD (single day) or ?from=…&to=… (range).
// Returns { from, to, single } or { error }.
function parseRangeQuery(q) {
  q = q || {};
  if (q.date) {
    if (!DATE_RE.test(q.date)) return { error: 'Invalid date (YYYY-MM-DD)' };
    return { from: q.date, to: q.date, single: true };
  }
  if (!q.from || !q.to || !DATE_RE.test(q.from) || !DATE_RE.test(q.to)) {
    return { error: 'Missing or invalid date (YYYY-MM-DD), or from/to range' };
  }
  const span = daysBetween(q.from, q.to);
  if (span < 0)               return { error: '`to` is before `from`' };
  if (span > MAX_RANGE_DAYS)  return { error: `Range longer than ${MAX_RANGE_DAYS} days` };
  return { from: q.from, to: q.to, single: false };
}

function mergeIntervals(list) {
  const sorted = list.slice().sort((a, b) => a.start - b.start);
  const out = [];
  sorted.forEach(iv => {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
    else out.push({ start: iv.start, end: iv.end });
  });
  return out;
}

/**
 * → { 'YYYY-MM-DD': [{start, end}] } for every date in from..to (empty array
 * when the day is free). Minutes are Israel wall-clock; an interval that runs
 * past midnight is split across the days it touches.
 */
async function busyByDate(from, to, queryFreebusy) {
  // Pad a day each side in UTC so the Israel day (UTC+2/+3) is fully covered
  // whatever the DST state; anything outside from..to is dropped below.
  const start = addDays(from, -1);
  const end   = addDays(to, 2);

  const chunks = [];
  for (let s = start; s < end; s = addDays(s, CHUNK_DAYS)) {
    const e = addDays(s, CHUNK_DAYS) < end ? addDays(s, CHUNK_DAYS) : end;
    chunks.push([`${s}T00:00:00Z`, `${e}T00:00:00Z`]);
  }
  const results = await Promise.all(chunks.map(([tMin, tMax]) => queryFreebusy(tMin, tMax)));

  const byDate = {};
  for (let d = from; d <= to; d = addDays(d, 1)) byDate[d] = [];
  const push = (date, s, e) => { if (byDate[date] && e > s) byDate[date].push({ start: s, end: e }); };

  results.flat().forEach(b => {
    const s = toLocal(b.start);
    const e = toLocal(b.end);
    if (s.date === e.date) { push(s.date, s.min, e.min); return; }
    push(s.date, s.min, DAY_MIN);
    for (let d = addDays(s.date, 1); d < e.date; d = addDays(d, 1)) push(d, 0, DAY_MIN);
    push(e.date, 0, e.min);
  });

  // Chunk edges can cut one Google interval in two — merge them back.
  Object.keys(byDate).forEach(d => { byDate[d] = mergeIntervals(byDate[d]); });
  return byDate;
}

module.exports = { TZ, parseRangeQuery, busyByDate };

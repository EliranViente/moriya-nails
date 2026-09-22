/* ═══════════════════════════════════════════
   MORIYA NAILS – Shared day-schedule model
   The single source of truth for how a work day is sliced. Loaded by both the
   client booking flow (app.js) and the admin day view (admin.js), so the day
   Moriya sees in the dashboard is exactly the day clients are offered.

   Availability rows (public.availability) carry a `kind`:
     open      – a working window, sliced into bookable appointments
     block     – a hard break inside the day (never bookable, pushes the grid)
     closed    – marks the whole day off (used to turn a default Friday off)
     bigbreak  – the day's fixed, protected break (a default Friday's morning break)
     float     – the day's floating break; start_time is the "not before" time
                 and the row's length is the break's length
     nodefault – marker: this date does not take the implicit Friday breaks

   Scheduling model: start times sit on a fixed 90-minute grid that stays stable
   regardless of the treatment length. Booked appointments consume their real
   length and push everything after them forward.
     • The big break is fixed and protected: no appointment starts inside it and
       none may run past its end, but one may overrun into it — the break gets
       bitten into and what is left of it is what stays.
     • The floating break is pushed: it is taken once, before the first slot at
       or after its "not before" time, so a long appointment delays it.

   Friday's default hours change through the year so the day still ends at
   least 1.5h before Shabbat (Moriya keeps Shabbat) — see FRIDAY_BANDS below.
═══════════════════════════════════════════ */
(function () {
  const NOMINAL_SLOT = 90;   // grid spacing for empty time

  // Recurring yearly default Friday schedule, picked by the date's month/day
  // (so it repeats every year without edits). Bands are keyed to Tel Aviv
  // candle-lighting time, sized so the day always ends >=1.5h before Shabbat:
  //   band 1 needs candle-lighting >= 18:45, band 2 >= 18:30, band 3 >= 17:00,
  //   band 4 fits any candle-lighting down to the year's earliest (~16:15).
  // The two edges next to Israel's DST switch (band2⇄band3 in spring, band3⇄
  // band4 in autumn) are padded a few days into the safer neighboring band,
  // because the DST date itself moves ~3 days year to year and the clock jump
  // — not just the slow seasonal drift — is what moves candle-lighting's
  // clock-time there; the padding is chosen wide enough to always land on the
  // correct side of Israel's DST rule regardless of the exact date it falls
  // on. `ranges` are inclusive [monthDay, monthDay] pairs, MMDD as a number.
  const FRIDAY_BANDS = [
    { // Band 1 – peak summer
      ranges: [[417, 828]],                                      // Apr 17 – Aug 28
      open: [{ start: 9 * 60, end: 17 * 60 + 15 }],               // 09:00–17:15
      bigBreak:   { start: 10 * 60 + 30, end: 11 * 60 },          // 10:30–11:00 (30 min: 15 rigid + 15 flexible)
      floatBreak: { notBefore: 14 * 60, len: 15 },                // ~14:00–14:15
    },
    { // Band 2 – spring/autumn shoulder
      ranges: [[330, 416], [829, 911]],                           // Mar 30–Apr 16, Aug 29–Sep 11
      open: [{ start: 9 * 60, end: 17 * 60 }],                    // 09:00–17:00
      bigBreak:   { start: 10 * 60 + 30, end: 10 * 60 + 45 },     // 10:30–10:45 (15 min, rigid only)
      floatBreak: { notBefore: 13 * 60 + 45, len: 15 },           // ~13:45–14:00
    },
    { // Band 3 – transitional autumn / late winter
      ranges: [[912, 1016], [213, 329]],                          // Sep 12–Oct 16, Feb 13–Mar 29
      open: [{ start: 9 * 60, end: 15 * 60 + 30 }],                // 09:00–15:30
      bigBreak:   { start: 10 * 60 + 30, end: 10 * 60 + 45 },     // 10:30–10:45
      floatBreak: { notBefore: 13 * 60 + 45, len: 15 },           // ~13:45–14:00
    },
    { // Band 4 – heart of winter
      ranges: [[1017, 1231], [101, 212]],                         // Oct 17 – Feb 12 (wraps year end)
      open: [{ start: 8 * 60 + 30, end: 14 * 60 + 45 }],           // 08:30–14:45
      bigBreak:   { start: 10 * 60, end: 10 * 60 + 15 },          // 10:00–10:15 (rigid only, no room to extend)
      floatBreak: null,                                            // no time left for a second break
    },
  ];

  const pad     = n => String(n).padStart(2, '0');
  const toMin   = hhmm => { const [h, m] = String(hhmm).slice(0, 5).split(':').map(Number); return h * 60 + m; };
  const fromMin = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const isFriday = dateStr => new Date(`${dateStr}T00:00:00`).getDay() === 5;

  // MMDD as a number, e.g. "2026-04-17" → 417. Used to place a date in a
  // FRIDAY_BANDS range regardless of year.
  const monthDay = dateStr => {
    const [, m, d] = String(dateStr).split('-').map(Number);
    return m * 100 + d;
  };

  // Which FRIDAY_BANDS entry a date's month/day falls into, or null (should
  // never happen — the ranges above cover the full year).
  function fridayBand(dateStr) {
    const md = monthDay(dateStr);
    return FRIDAY_BANDS.find(b => b.ranges.some(([lo, hi]) => md >= lo && md <= hi)) || null;
  }

  // Merge overlapping intervals into a sorted, disjoint list.
  function mergeIntervals(list) {
    const sorted = (list || []).filter(x => x && x.end > x.start).sort((a, b) => a.start - b.start);
    const out = [];
    for (const iv of sorted) {
      const last = out[out.length - 1];
      if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
      else out.push({ start: iv.start, end: iv.end });
    }
    return out;
  }

  // Fold one date's availability rows into the day's shape. Unknown kinds are
  // ignored rather than guessed at, so a row this build doesn't understand can
  // never accidentally open time for booking.
  function readRows(rows) {
    const day = { open: [], block: [], closed: false, bigBreak: null, floatBreak: null, noDefault: false };
    (rows || []).forEach(r => {
      const start = toMin(r.start_time);
      const end   = toMin(r.end_time);
      switch (r.kind) {
        case 'closed':    day.closed = true; break;
        case 'open':      day.open.push({ id: r.id, start, end }); break;
        case 'block':     day.block.push({ id: r.id, start, end }); break;
        case 'bigbreak':  day.bigBreak = { id: r.id, start, end }; break;
        case 'float':     day.floatBreak = { id: r.id, notBefore: start, len: Math.max(5, end - start) }; break;
        case 'nodefault': day.noDefault = true; break;
        default:          break;
      }
    });
    return day;
  }

  // The day's effective working windows, applying the Friday default.
  function openWindows(dateStr, day) {
    const d = day || {};
    if (d.closed) return [];
    if (d.open && d.open.length) return d.open.map(w => ({ ...w }));
    if (!isFriday(dateStr)) return [];
    const band = fridayBand(dateStr);
    return band ? band.open.map(w => ({ ...w })) : [];
  }

  // A Friday runs on the default schedule — and so carries the default breaks —
  // when it isn't closed, has no working windows of its own, and hasn't had its
  // breaks customised for that date.
  function usesDefaults(dateStr, day) {
    const d = day || {};
    if (d.closed || d.noDefault) return false;
    if (d.open && d.open.length) return false;
    return isFriday(dateStr);
  }

  // The day's two special breaks. A row set for this date always wins; otherwise
  // a default Friday gets its band's pair (band 4 has no float break) and any
  // other day gets neither.
  function dayBreaks(dateStr, day) {
    const d     = day || {};
    const def   = usesDefaults(dateStr, d);
    const band  = def ? fridayBand(dateStr) : null;
    return {
      big:   d.bigBreak   ? { ...d.bigBreak }   : (band && band.bigBreak   ? { ...band.bigBreak }   : null),
      float: d.floatBreak ? { ...d.floatBreak } : (band && band.floatBreak ? { ...band.floatBreak } : null),
    };
  }

  // Walk one working window the way the booking grid does, emitting every
  // stretch of it in order: bookings, breaks, and the free slots between them.
  // `busy` is a sorted list of {start, end, …} — appointments and hard blocks
  // alike; each item's own fields ride along on the emitted row.
  function walkWindow(win, big, float, busy) {
    const items = [];
    let cursor = win.start, floatUsed = false, guard = 0;

    while (cursor < win.end && guard++ < 300) {
      // Floating break: taken once, before the first slot at/after its time.
      if (float && !floatUsed && cursor >= float.notBefore) {
        floatUsed = true;
        items.push({ kind: 'float', start: cursor, end: cursor + float.len, ref: float });
        cursor += float.len;
        continue;
      }
      // Big break: fixed. Whatever is left of it after an overrunning
      // appointment is what remains — it never moves.
      if (big && cursor >= big.start && cursor < big.end) {
        items.push({ kind: 'big', start: cursor, end: big.end, bitten: cursor > big.start, ref: big });
        cursor = big.end;
        continue;
      }
      // Anything booked over the cursor → advance past its real end.
      const covering = busy.filter(b => b.start <= cursor && cursor < b.end);
      if (covering.length) {
        covering.forEach(b => items.push({ ...b, kind: b.kind || 'busy' }));
        cursor = Math.max(...covering.map(b => b.end));
        continue;
      }
      // Free time. It runs a nominal slot, cut short by whatever comes next —
      // the next booking, the big break, or the end of the working day.
      let next = cursor + NOMINAL_SLOT;
      const nextBusy = busy.find(b => b.start > cursor && b.start < next);
      if (nextBusy) next = nextBusy.start;
      if (big && cursor < big.start && next > big.start) next = big.start;
      if (next > win.end) next = win.end;
      items.push({
        kind: 'free', start: cursor, end: next,
        // Whether a standard 90-minute appointment still fits here.
        full: next - cursor >= NOMINAL_SLOT && cursor + NOMINAL_SLOT <= win.end,
        win,
      });
      cursor = next;
    }
    return items;
  }

  // Start times on the grid, in minutes — the anchors an appointment may take.
  function anchors(win, big, float, busy) {
    return walkWindow(win, big, float, mergeIntervals(busy))
      .filter(i => i.kind === 'free').map(i => i.start);
  }

  // Every start time on `dateStr` at which `duration` minutes actually fit.
  // `busy` holds the day's bookings; the day's own blocks are added here.
  // `notBefore` (minutes) drops slots that have already passed today.
  function availableStarts(duration, dateStr, day, busy, notBefore) {
    const wins   = openWindows(dateStr, day);
    const brk    = dayBreaks(dateStr, day);
    const booked = mergeIntervals([...((day && day.block) || []), ...(busy || [])]);

    const out = [];
    wins.forEach(w => {
      anchors(w, brk.big, brk.float, booked).forEach(a => {
        const end = a + duration;
        if (end > w.end) return;                                             // must finish by the window's end
        if (brk.big && a < brk.big.start && end > brk.big.end) return;       // may bite the big break, never cross it
        if (booked.some(b => a < b.end && end > b.start)) return;            // no overlap with a booking
        out.push(a);
      });
    });
    return [...new Set(out)].sort((a, b) => a - b)
      .filter(m => typeof notBefore !== 'number' || m > notBefore);
  }

  // The whole day in order, for the admin's day view: every window walked in
  // turn, plus anything booked outside the working hours — Moriya can move an
  // appointment to any time she likes, and the day view must never hide one.
  function dayTimeline(dateStr, day, busy) {
    const wins = openWindows(dateStr, day);
    const brk  = dayBreaks(dateStr, day);
    const all  = [
      ...((day && day.block) || []).map(b => ({ ...b, kind: 'block', key: `blk-${b.id}` })),
      ...(busy || []),
    ].sort((a, b) => a.start - b.start || a.end - b.end);

    const items = [];
    const seen  = new Set();   // a booking overlapping two windows is one row
    wins.forEach(w => {
      walkWindow(w, brk.big, brk.float, all).forEach(item => {
        if (item.key) {
          if (seen.has(item.key)) return;
          seen.add(item.key);
        }
        items.push(item);
      });
    });
    all.forEach(b => {
      if (b.key && seen.has(b.key)) return;
      if (wins.some(w => b.start < w.end && b.end > w.start)) return;
      items.push({ ...b, outside: true });
    });
    return items.sort((a, b) => a.start - b.start || a.end - b.end);
  }

  const api = {
    FRIDAY_BANDS, NOMINAL_SLOT,
    toMin, fromMin, isFriday, mergeIntervals, fridayBand,
    readRows, openWindows, usesDefaults, dayBreaks,
    walkWindow, anchors, availableStarts, dayTimeline,
  };
  // Loaded in the browser (window) and, for waitlist-notify.js, under Node
  // (module.exports) — same file, same math, so the two never drift apart.
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.MoriyaSchedule = api;
})();

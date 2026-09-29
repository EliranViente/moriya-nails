/**
 * Waitlist match check + Moriya email (Phase 1) – shared by the Netlify
 * function (/api/waitlist-notify) and the local dev server, so the two
 * can't drift.
 *
 * Given a date, checks each not-yet-notified waiter against the day as it is
 * right now and, for those whose requested treatment (duration_min) now fits,
 * emails Moriya once — in signup order, with the times that fit each of them.
 * A waiter it doesn't fit yet stays un-notified for the next change. No slot
 * is reserved for anyone here — see js/admin.js's manual "הודיעי ללקוחה"
 * button, which is the only thing that actually contacts a client.
 *
 * Called fire-and-forget from the places in js/app.js / js/admin.js that
 * write appointments.status/date directly to Supabase, and from the admin day
 * view whenever a waitlisted date's hours are loaded (there is no single
 * server-side funnel for those writes to hook instead). Every step here is a
 * no-op on missing config/data rather than an error, and the caller never
 * inspects the result, so nothing here can break a cancel/reschedule.
 */
const MoriyaSchedule = require('../js/schedule.js');

// An opening this many minutes (or fewer) short of what a client asked for is
// still worth telling Moriya about: freeing that little extra time — a later
// finish, a shorter break — lets the client book exactly what she wanted.
const NEAR_MISS_MIN = 15;
// The shortest treatment on the menu; nothing shorter is an opening at all.
const BASE_MIN = 75;

function dmy(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

async function fetchWaitingRows(env, dateStr) {
  const url = `${env.url}/rest/v1/waitlist`
    + `?date=eq.${dateStr}&status=eq.waiting&notified_at=is.null`
    + `&select=id,client_name,client_phone,duration_min,services,near_notified_at,created_at`
    + `&order=created_at.asc`;
  const res = await fetch(url, { headers: { apikey: env.key, Authorization: `Bearer ${env.key}` } });
  if (!res.ok) { console.warn('waitlist-notify: waitlist fetch failed', res.status); return []; }
  return res.json().catch(() => []);
}

async function fetchAvailabilityRows(env, dateStr) {
  const url = `${env.url}/rest/v1/availability?date=eq.${dateStr}&select=id,start_time,end_time,kind`;
  const res = await fetch(url, { headers: { apikey: env.key, Authorization: `Bearer ${env.key}` } });
  if (!res.ok) { console.warn('waitlist-notify: availability fetch failed', res.status); return []; }
  return res.json().catch(() => []);
}

// Reuses the site's own /api/busy-slots instead of re-implementing the
// Google Calendar service-account auth in a second place.
async function fetchBusySlots(apiBaseUrl, dateStr) {
  const res = await fetch(`${apiBaseUrl}/api/busy-slots?date=${dateStr}`);
  if (!res.ok) { console.warn('waitlist-notify: busy-slots fetch failed', res.status); return null; }
  const data = await res.json().catch(() => null);
  return data && Array.isArray(data.busySlots) ? data.busySlots : null;
}

// `column` – notified_at (her treatment fit; she's done) or near_notified_at
// (an almost-fit was reported; a real fit can still be emailed later).
async function markNotified(env, ids, column) {
  if (!ids.length) return;
  const url = `${env.url}/rest/v1/waitlist?id=in.(${ids.join(',')})`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: env.key, Authorization: `Bearer ${env.key}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal'
    },
    body: JSON.stringify({ [column]: new Date().toISOString() })
  });
  if (!res.ok) console.warn(`waitlist-notify: ${column} stamp failed`, res.status);
}

// `fits` – [{ waiter, times }]: her treatment fits, at these start times.
// `near` – [{ waiter, times, missing }]: the best opening is `missing` minutes
// short of her treatment; `times` is where that opening starts.
// Both lists are in signup order.
function buildEmail(dateStr, fits, near, siteBaseUrl) {
  const cell  = 'padding:7px 10px;border-bottom:1px solid #f3d7e3';
  const times = t => t.map(MoriyaSchedule.fromMin).join(', ');
  const who = w => `
        <b>${w.client_name || '—'}</b>
        <span style="color:#888;white-space:nowrap"> · ${w.client_phone || ''}</span><br>
        <span style="color:#666;font-size:13px">ביקשה: ${w.services ? `${w.services} · ` : ''}${w.duration_min} דק׳</span><br>`;
  const table = rows => `
        <table style="width:100%;border-collapse:collapse;margin:10px 0 18px;font-size:14px">
          <tbody>${rows}</tbody>
        </table>`;

  const fitRows = fits.map(({ waiter: w, times: t }, i) => `<tr>
      <td style="${cell};white-space:nowrap;vertical-align:top">${i + 1}.</td>
      <td style="${cell}">${who(w)}
        <span style="font-size:13px">שעות שמתאימות לה: <b>${times(t)}</b></span>
      </td>
    </tr>`).join('');

  const nearRows = near.map(({ waiter: w, times: t, missing }, i) => `<tr>
      <td style="${cell};white-space:nowrap;vertical-align:top">${i + 1}.</td>
      <td style="${cell}">${who(w)}
        <span style="font-size:13px;color:#b7791f"><b>חסרות ${missing} דק׳</b> כדי שהיא תוכל לקבוע את התור שביקשה
          (הרווח הפנוי מתחיל ב-<b>${times(t)}</b> ואורכו ${w.duration_min - missing} דק׳).</span>
      </td>
    </tr>`).join('');

  const fitBlock = fits.length ? `
        <p>🎉 <b>יש תור פנוי שמתאים בדיוק</b> לתור שביקשו הלקוחות הבאות (לפי סדר הרשמה):</p>
        ${table(fitRows)}` : '';
  const nearBlock = near.length ? `
        <p>⏳ <b>כמעט יש תור</b> — ללקוחות הבאות חסרות עד ${NEAR_MISS_MIN} דקות כדי לקבוע את התור שביקשו.
           אם תפני את הדקות החסרות (למשל לסיים מעט מאוחר יותר או לקצר הפסקה), הן יוכלו לקבוע:</p>
        ${table(nearRows)}` : '';

  const heading = fits.length ? `🔔 התפנה תור ביום שישי ${dmy(dateStr)}`
                              : `⏳ כמעט התפנה תור ביום שישי ${dmy(dateStr)}`;

  const adminLink = `${siteBaseUrl}/admin.html?waitlist=1`;

  const html = `
    <div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;max-width:540px;margin:0 auto;
                          background:#fff;border:1px solid #f3d7e3;border-radius:14px;overflow:hidden">
      <div style="background:#e78aa8;color:#fff;padding:18px 22px;font-size:18px;font-weight:bold">
        ${heading}
      </div>
      <div style="padding:22px;color:#333;font-size:15px;line-height:1.7">
        <p>שלום מוריה,<br>יש עדכון לגבי רשימת ההמתנה ליום שישי, ${dmy(dateStr)}.</p>
        ${fitBlock}
        ${nearBlock}
        <p style="margin:18px 0 6px">היכנסי לדשבורד כדי להודיע להן:</p>
        <a href="${adminLink}" style="display:inline-block;margin-top:10px;background:#e78aa8;color:#fff;
                  text-decoration:none;padding:11px 22px;border-radius:9px;font-weight:bold">לרשימת ההמתנה</a>
      </div>
    </div>`;

  return {
    subject: fits.length
      ? `🔔 התפנה תור ביום שישי ${dmy(dateStr)} — יש ממתינות ברשימה`
      : `⏳ כמעט התפנה תור ביום שישי ${dmy(dateStr)} — חסרות דקות ספורות`,
    html
  };
}

async function sendEmail(mail, subject, html) {
  if (!mail.key) { console.warn('waitlist-notify: RESEND_API_KEY not set'); return false; }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${mail.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: mail.from, to: [mail.to], subject, html })
    });
    if (!res.ok) { console.warn('waitlist-notify: email failed', res.status, await res.text().catch(() => '')); return false; }
    return true;
  } catch (err) {
    console.warn('waitlist-notify: email error', err.message);
    return false;
  }
}

/**
 * @param {{ date: string, apiBaseUrl: string, siteBaseUrl: string }} args
 *   apiBaseUrl  – where /api/busy-slots can be reached (same origin as
 *                 siteBaseUrl in prod; the API port in local dev).
 *   siteBaseUrl – where /admin.html can be reached (used in the email link).
 * @returns {{ status: number, body: object }} – ready to send as JSON.
 */
async function runWaitlistNotify({ date, apiBaseUrl, siteBaseUrl }) {
  const env = {
    url: process.env.SUPABASE_URL || 'https://yspzwxyxhdjtpcqaebls.supabase.co',
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  };
  const mail = {
    key:  process.env.RESEND_API_KEY || '',
    to:   process.env.APPROVAL_EMAIL_TO || 'moriya681@gmail.com',
    from: process.env.APPROVAL_EMAIL_FROM || 'Moriya Nails <onboarding@resend.dev>',
  };
  const ok = { status: 200, body: { success: true } };

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !env.key) return ok;

  try {
    const waiters = await fetchWaitingRows(env, date);
    if (!waiters.length) return ok;

    const [rows, busy] = await Promise.all([
      fetchAvailabilityRows(env, date),
      fetchBusySlots(apiBaseUrl, date),
    ]);
    if (!busy) return ok; // couldn't read the calendar — safer to skip than to guess

    // Each waiter is measured against her own treatment:
    //  - it fits → emailed once, stamped notified_at, and she's done;
    //  - it's at most NEAR_MISS_MIN short → emailed once as an almost-fit,
    //    stamped near_notified_at, and still eligible for a real fit later;
    //  - otherwise she stays as she is until a later change makes room.
    // Rows from before duration_min was recorded are skipped: all that's
    // known is the day was full for *something* she picked, so no opening can
    // be matched to her — Moriya sees her on the dashboard list instead.
    const day  = MoriyaSchedule.readRows(rows);
    const fits = [], near = [];
    waiters.forEach(w => {
      const need = Number(w.duration_min);
      if (!need) return;
      const t = MoriyaSchedule.availableStarts(need, date, day, busy);
      if (t.length) { fits.push({ waiter: w, times: t }); return; }
      if (w.near_notified_at) return;
      const best = MoriyaSchedule.longestFit(need, Math.min(BASE_MIN, need), date, day, busy);
      if (best && need - best <= NEAR_MISS_MIN) {
        near.push({ waiter: w, missing: need - best,
                    times: MoriyaSchedule.availableStarts(best, date, day, busy) });
      }
    });
    if (!fits.length && !near.length) return ok;

    const { subject, html } = buildEmail(date, fits, near, siteBaseUrl);
    const sent = await sendEmail(mail, subject, html);
    if (sent) {
      await markNotified(env, fits.map(m => m.waiter.id), 'notified_at');
      await markNotified(env, near.map(m => m.waiter.id), 'near_notified_at');
    }

    return ok;
  } catch (err) {
    console.error('waitlist-notify error:', err.message);
    return ok;
  }
}

module.exports = { runWaitlistNotify };

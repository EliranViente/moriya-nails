/**
 * Waitlist match check + Moriya email (Phase 1) – shared by the Netlify
 * function (/api/waitlist-notify) and the local dev server, so the two
 * can't drift.
 *
 * Given a date, checks whether anyone is waiting for it and, if a slot is
 * actually open right now, emails Moriya once with the currently-open times
 * and the ordered (signup order) list of not-yet-notified waiters. No slot
 * is reserved for anyone here — see js/admin.js's manual "הודיעי ללקוחה"
 * button, which is the only thing that actually contacts a client.
 *
 * Called fire-and-forget from the 4 places in js/app.js / js/admin.js that
 * write appointments.status/date directly to Supabase (there is no single
 * server-side funnel for those writes to hook instead). Every step here is a
 * no-op on missing config/data rather than an error, and the caller never
 * inspects the result, so nothing here can break a cancel/reschedule.
 */
const MoriyaSchedule = require('../js/schedule.js');

// Stand-in duration for "is anything open at all" — the mandatory base
// service (js/treatments.js BASES 'base-plain'). No specific client/service
// context exists at this point, so this is the Phase-1 simplification: a
// listed time might not fit every treatment length, only >= this one.
const BASE_DURATION = 75;

function dmy(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

async function fetchWaitingRows(env, dateStr) {
  const url = `${env.url}/rest/v1/waitlist`
    + `?date=eq.${dateStr}&status=eq.waiting&notified_at=is.null`
    + `&select=id,client_name,client_phone,created_at`
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

async function markNotified(env, ids) {
  if (!ids.length) return;
  const url = `${env.url}/rest/v1/waitlist?id=in.(${ids.join(',')})`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: env.key, Authorization: `Bearer ${env.key}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal'
    },
    body: JSON.stringify({ notified_at: new Date().toISOString() })
  });
  if (!res.ok) console.warn('waitlist-notify: notified_at stamp failed', res.status);
}

function buildEmail(dateStr, openTimes, waiters, siteBaseUrl) {
  const timesStr = openTimes.map(MoriyaSchedule.fromMin).join(', ');
  const rows = waiters.map((w, i) => `<tr>
      <td style="padding:7px 10px;border-bottom:1px solid #f3d7e3;white-space:nowrap">${i + 1}.</td>
      <td style="padding:7px 10px;border-bottom:1px solid #f3d7e3"><b>${w.client_name || '—'}</b></td>
      <td style="padding:7px 10px;border-bottom:1px solid #f3d7e3;color:#888;white-space:nowrap">${w.client_phone || ''}</td>
    </tr>`).join('');

  const adminLink = `${siteBaseUrl}/admin.html?waitlist=1`;

  const html = `
    <div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;max-width:540px;margin:0 auto;
                          background:#fff;border:1px solid #f3d7e3;border-radius:14px;overflow:hidden">
      <div style="background:#e78aa8;color:#fff;padding:18px 22px;font-size:18px;font-weight:bold">
        🔔 התפנה תור ביום שישי ${dmy(dateStr)}
      </div>
      <div style="padding:22px;color:#333;font-size:15px;line-height:1.7">
        <p>שלום מוריה,<br>התפנה תור ביום שישי, ${dmy(dateStr)}.</p>
        <p>השעות הפנויות כרגע: <b>${timesStr}</b></p>
        <p>הלקוחות הבאות ברשימת ההמתנה לתאריך הזה (לפי סדר הרשמה):</p>
        <table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:14px">
          <tbody>${rows}</tbody>
        </table>
        <p style="margin:18px 0 6px">היכנסי לדשבורד כדי להודיע להן:</p>
        <a href="${adminLink}" style="display:inline-block;margin-top:10px;background:#e78aa8;color:#fff;
                  text-decoration:none;padding:11px 22px;border-radius:9px;font-weight:bold">לרשימת ההמתנה</a>
      </div>
    </div>`;

  return {
    subject: `🔔 התפנה תור ביום שישי ${dmy(dateStr)} — יש ממתינות ברשימה`,
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

    const day = MoriyaSchedule.readRows(rows);
    const openTimes = MoriyaSchedule.availableStarts(BASE_DURATION, date, day, busy);
    if (!openTimes.length) return ok;

    const { subject, html } = buildEmail(date, openTimes, waiters, siteBaseUrl);
    const sent = await sendEmail(mail, subject, html);
    if (sent) await markNotified(env, waiters.map(w => w.id));

    return ok;
  } catch (err) {
    console.error('waitlist-notify error:', err.message);
    return ok;
  }
}

module.exports = { runWaitlistNotify };

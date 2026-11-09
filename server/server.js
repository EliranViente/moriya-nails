/**
 * Moriya Nails – Backend Server
 * Google Calendar API integration
 * Calendar: moriya681@gmail.com
 */

require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const { google } = require('googleapis');
const { serviceTitle, serviceDetailLines } = require('../shared/calendar-text');
const { deleteClient } = require('../shared/delete-client');
const { getUserFromToken, isAdminUser } = require('../shared/admin-auth');
const { runWaitlistNotify } = require('../shared/waitlist-notify');
const { toLocal, parseRangeQuery, busyByDate, findConflict } = require('../shared/busy-range');

const app = express();
app.use(cors());
app.use(express.json());

// ─── Google Calendar auth ──────────────────────────────────────────────────────
// Uses a Service Account whose credentials are stored in GOOGLE_CREDENTIALS env var.
// The owner's calendar (moriya681@gmail.com) must be shared with the service account.
function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/calendar']
  });
}

const CALENDAR_ID = process.env.CALENDAR_ID || 'moriya681@gmail.com';
const TZ          = 'Asia/Jerusalem';

// Google freeBusy for the calendar, in the shape shared/busy-range expects.
function freebusyQuery(calendar) {
  return async (timeMin, timeMax) => {
    const fbRes = await calendar.freebusy.query({
      requestBody: { timeMin, timeMax, timeZone: TZ, items: [{ id: CALENDAR_ID }] }
    });
    const cal = fbRes.data.calendars?.[CALENDAR_ID];
    if (cal?.errors?.length) throw new Error(`freeBusy: ${cal.errors[0].reason}`);
    return cal?.busy || [];
  };
}

const SB_ENV = { url: process.env.SUPABASE_URL || '', key: process.env.SUPABASE_SERVICE_ROLE_KEY || '' };
const URGENT_WINDOW_MS = 48 * 60 * 60 * 1000;
const PORT = process.env.PORT || 3001;

// Dedicated approval email (parity with the Netlify function). No-op locally when
// RESEND_API_KEY isn't set; best-effort so it never breaks the calendar sync.
async function sendApprovalEmail({ clientName, clientPhone, services, date, time, duration, addedMinutes, totalPrice, notes }) {
  const apiKey = process.env.RESEND_API_KEY;
  const to     = process.env.APPROVAL_EMAIL_TO || 'moriya681@gmail.com';
  const from   = process.env.APPROVAL_EMAIL_FROM || 'Moriya Nails <onboarding@resend.dev>';
  if (!apiKey) return;

  const serviceNames = (services || []).map(s => s.name).join(', ');
  const html = `<div dir="rtl" style="font-family:Arial,sans-serif">⚠️ עדכון תור ממתין לאישורך — `
    + `${clientName || 'לקוחה'}, ${date} ${time}, נוספו ${addedMinutes} דקות (משך ${duration} דק', ${totalPrice} ₪). `
    + `לאישור: הסירי את הסימון "⚠️ ממתין לאישור" מכותרת האירוע ביומן.</div>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject: `⚠️ עדכון תור ממתין לאישור — ${clientName || 'לקוחה'} (${date})`, html })
    });
    if (!res.ok) console.warn('approval email failed:', res.status, await res.text().catch(() => ''));
  } catch (err) { console.warn('approval email error:', err.message); }
}

// Local twin of netlify/functions/manage-booking.js's sendUrgentApprovalEmail().
async function sendUrgentApprovalEmail({ clientName, clientPhone, services, date, time, duration, totalPrice, notes }) {
  const apiKey = process.env.RESEND_API_KEY;
  const to     = process.env.APPROVAL_EMAIL_TO || 'moriya681@gmail.com';
  const from   = process.env.APPROVAL_EMAIL_FROM || 'Moriya Nails <onboarding@resend.dev>';
  if (!apiKey) return;

  const siteUrl = process.env.SITE_URL || 'http://localhost:8000';
  const adminLink = `${siteUrl}/admin.html?pending=1`;
  const serviceNames = (services || []).map(s => s.name).join(', ');
  const html = `<div dir="rtl" style="font-family:Arial,sans-serif">🚨 בקשת תור דחופה ממתינה לאישורך — `
    + `${clientName || 'לקוחה'}, ${date} ${time}, ${serviceNames || '—'} (משך ${duration} דק', ${totalPrice} ₪). `
    + `לאישור/דחייה: <a href="${adminLink}">${adminLink}</a></div>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject: `🚨 בקשת תור דחופה ממתינה לאישור — ${clientName || 'לקוחה'} (${date})`, html })
    });
    if (!res.ok) console.warn('urgent approval email failed:', res.status, await res.text().catch(() => ''));
  } catch (err) { console.warn('urgent approval email error:', err.message); }
}

// ─── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'ok', calendar: CALENDAR_ID }));

// ─── GET /api/busy-slots?date=YYYY-MM-DD  |  ?from=YYYY-MM-DD&to=YYYY-MM-DD ───
// Busy intervals (minutes since Israel midnight) for one day or a whole range,
// grouped by day — parity with netlify/functions/busy-slots.js via shared/busy-range.
app.get('/api/busy-slots', async (req, res) => {
  const range = parseRangeQuery(req.query);
  if (range.error) return res.status(400).json({ error: range.error });

  try {
    const calendar = google.calendar({ version: 'v3', auth: getAuth() });
    const byDate = await busyByDate(range.from, range.to, freebusyQuery(calendar));
    res.json(range.single ? { busySlots: byDate[range.from] } : { from: range.from, to: range.to, byDate });
  } catch (err) {
    console.error('busy-slots error:', err.message);
    res.status(500).json({ error: 'Failed to fetch calendar data', detail: err.message });
  }
});

// ─── POST /api/book ───────────────────────────────────────────────────────────
// Creates a Google Calendar event for the appointment.
app.post('/api/book', async (req, res) => {
  const { date, time, duration, clientName, clientPhone, services, totalPrice, notes, accessToken, force } = req.body;

  if (!date || !time || !duration || !clientName || !clientPhone) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Parity with netlify/functions/book.js. Only enforced when Supabase is
  // configured locally — otherwise this dev server stays "trusted", matching
  // /api/manage-booking's existing local-dev convention below.
  if (SB_ENV.url && SB_ENV.key) {
    const requestedStart = new Date(`${date}T${time}:00+03:00`);
    const isUrgent = (requestedStart.getTime() - Date.now()) < URGENT_WINDOW_MS;
    if (isUrgent) {
      const user = await getUserFromToken(SB_ENV, accessToken);
      if (!isAdminUser(user)) {
        return res.status(403).json({ error: 'too_soon_needs_approval' });
      }
    }
  }

  try {
    const auth     = getAuth();
    const calendar = google.calendar({ version: 'v3', auth });

    const startDT = new Date(`${date}T${time}:00`);
    const endDT   = new Date(startDT.getTime() + duration * 60_000);

    // Parity with netlify/functions/book.js: refuse a time taken since the
    // client loaded her slots; only an admin with `force` may book over it.
    let conflict = null;
    try {
      const [sh, sm] = time.split(':').map(Number);
      conflict = await findConflict({
        date, startMin: sh * 60 + sm, endMin: sh * 60 + sm + Number(duration),
        queryFreebusy: freebusyQuery(calendar)
      });
    } catch (err) { console.warn('book: conflict check failed, booking anyway:', err.message); }
    if (conflict) {
      const caller = force ? await getUserFromToken(SB_ENV, accessToken) : null;
      if (!isAdminUser(caller)) return res.status(409).json({ error: 'slot_taken' });
    }

    const description  = [
      `👩 לקוחה: ${clientName}`,
      `📞 טלפון: ${clientPhone}`,
      `💅 טיפולים: ${serviceDetailLines(services).join('\n')}`,
      `⏱ זמן: ${duration} דקות`,
      `💰 מחיר: ${totalPrice} ₪`,
      notes ? `📝 הערות: ${notes}` : ''
    ].filter(Boolean).join('\n');

    const event = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: {
        summary:     `💅 ${clientName} – ${serviceTitle(services)}`,
        description,
        start: { dateTime: startDT.toISOString(), timeZone: TZ },
        end:   { dateTime: endDT.toISOString(),   timeZone: TZ },
        colorId: '4'  // flamingo / pink
      }
    });

    res.json({ success: true, eventId: event.data.id });
  } catch (err) {
    console.error('book error:', err.message);
    res.status(500).json({ error: 'Failed to create booking', detail: err.message });
  }
});

// ─── POST /api/manage-booking ─────────────────────────────────────────────────
// Local parity with the Netlify function: cancel or reschedule a calendar event.
// (The local dev server is trusted, so it skips the Supabase ownership check.)
app.post('/api/manage-booking', async (req, res) => {
  const { action, eventId, date, time, duration,
          services, totalPrice, clientName, clientPhone, notes,
          pendingApproval, addedMinutes, accessToken } = req.body;
  if (!action) {
    return res.status(400).json({ error: 'Missing action' });
  }

  if (action === 'notify-urgent') {
    await sendUrgentApprovalEmail({ clientName, clientPhone, services, date, time, duration, totalPrice, notes });
    return res.json({ success: true });
  }

  if (!eventId) {
    return res.status(400).json({ error: 'Missing eventId' });
  }

  try {
    const auth     = getAuth();
    const calendar = google.calendar({ version: 'v3', auth });

    if (action === 'cancel') {
      try {
        await calendar.events.delete({ calendarId: CALENDAR_ID, eventId });
      } catch (err) {
        const code = err.code || (err.response && err.response.status);
        if (code !== 404 && code !== 410) throw err; // already gone → success
      }
      return res.json({ success: true });
    }

    if (action === 'update') {
      if (!date || !time) return res.status(400).json({ error: 'Missing date or time' });
      const [sh, sm]   = time.split(':').map(Number);
      const dur        = Number(duration) || 0;
      const endTotal   = sh * 60 + sm + dur;
      const pad        = n => String(n).padStart(2, '0');
      const startLocal = `${date}T${time.length === 5 ? time : time.slice(0, 5)}:00`;
      const endLocal   = `${date}T${pad(Math.floor(endTotal / 60))}:${pad(endTotal % 60)}:00`;

      // Parity with netlify/functions/manage-booking.js: a client's move must
      // land on a free time (her own current slot excluded); Moriya is never
      // stopped.
      const caller = await getUserFromToken(SB_ENV, accessToken);
      if (!isAdminUser(caller) && dur > 0) {
        let conflict = null;
        try {
          const cur = await calendar.events.get({ calendarId: CALENDAR_ID, eventId });
          const cs = cur.data.start?.dateTime, ce = cur.data.end?.dateTime;
          let ignore = null;
          if (cs && ce) {
            const a = toLocal(cs), b = toLocal(ce);
            if (a.date === b.date) ignore = { date: a.date, start: a.min, end: b.min };
          }
          conflict = await findConflict({
            date, startMin: sh * 60 + sm, endMin: endTotal, ignore, queryFreebusy: freebusyQuery(calendar)
          });
        } catch (err) { console.warn('update: conflict check failed, moving anyway:', err.message); }
        if (conflict) return res.status(409).json({ error: 'slot_taken' });
      }

      const patchBody = { start: { dateTime: startLocal, timeZone: TZ } };
      if (dur > 0) patchBody.end = { dateTime: endLocal, timeZone: TZ };

      // Refresh the title/description when extra services were added on update.
      // Mark the same event "⚠️ ממתין לאישור" in place when the addition needs it.
      if (Array.isArray(services) && services.length && clientName) {
        const lines = [];
        if (pendingApproval) {
          lines.push(`⚠️ ממתין לאישורך — הלקוחה הוסיפה ${Number(addedMinutes) || 0} דקות לתור (מעל רבע שעה).`);
          lines.push('לאישור: הסירי את הסימון "⚠️ ממתין לאישור" מכותרת האירוע.');
          lines.push('');
        }
        lines.push(`👩 לקוחה: ${clientName}`);
        lines.push(`📞 טלפון: ${clientPhone}`);
        lines.push(`💅 טיפולים: ${serviceDetailLines(services).join('\n')}`);
        lines.push(`⏱ זמן: ${dur} דקות`);
        lines.push(`💰 מחיר: ${totalPrice} ₪`);
        if (notes) lines.push(`📝 הערות: ${notes}`);
        patchBody.summary     = `${pendingApproval ? '⚠️ ממתין לאישור – ' : ''}💅 ${clientName} – ${serviceTitle(services)}`;
        patchBody.description = lines.join('\n');
      }

      await calendar.events.patch({ calendarId: CALENDAR_ID, eventId, requestBody: patchBody });

      if (pendingApproval) {
        await sendApprovalEmail({
          clientName, clientPhone, services, date, time,
          duration: Number(duration) || 0, addedMinutes: Number(addedMinutes) || 0, totalPrice, notes
        });
      }

      return res.json({ success: true, pendingApproval: !!pendingApproval });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('manage-booking error:', err.message);
    res.status(500).json({ error: 'calendar_sync_failed', detail: err.message });
  }
});

// ─── POST /api/delete-client ──────────────────────────────────────────────────
// Removes a client (parity with the Netlify function – same shared implementation).
// Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the local .env; without them
// it answers 503 not_configured rather than half-doing the job.
app.post('/api/delete-client', async (req, res) => {
  const { status, body } = await deleteClient({
    clientId:    req.body && req.body.clientId,
    accessToken: req.body && req.body.accessToken,
  });
  res.status(status).json(body);
});

// ─── POST /api/waitlist-notify ─────────────────────────────────────────────────
// Parity with the Netlify function (shared/waitlist-notify.js). The static
// site and this API run on different local ports, so unlike production the
// two base URLs genuinely differ: /api/busy-slots lives here, on this server,
// while the email's admin-dashboard link points at the static server (8000).
app.post('/api/waitlist-notify', async (req, res) => {
  const { status, body } = await runWaitlistNotify({
    date:        req.body && req.body.date,
    apiBaseUrl:  `http://localhost:${PORT}`,
    siteBaseUrl: process.env.SITE_URL || 'http://localhost:8000',
  });
  res.status(status).json(body);
});

app.listen(PORT, () => {
  console.log(`✅ Moriya Nails server running on http://localhost:${PORT}`);
  console.log(`📅 Calendar: ${CALENDAR_ID}`);
});

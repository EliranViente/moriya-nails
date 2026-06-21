/**
 * Moriya Nails – Backend Server
 * Google Calendar API integration
 * Calendar: moriya681@gmail.com
 */

require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const { google } = require('googleapis');

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
const WORK_START  = 9;   // 09:00
const WORK_END    = 17;  // 17:00

// ─── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'ok', calendar: CALENDAR_ID }));

// ─── GET /api/busy-slots?date=YYYY-MM-DD ──────────────────────────────────────
// Returns busy time intervals (in minutes since midnight) for a given Friday.
app.get('/api/busy-slots', async (req, res) => {
  const { date } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Missing or invalid date (YYYY-MM-DD)' });
  }

  try {
    const auth     = getAuth();
    const calendar = google.calendar({ version: 'v3', auth });

    const timeMin = new Date(`${date}T${String(WORK_START).padStart(2,'0')}:00:00`);
    const timeMax = new Date(`${date}T${String(WORK_END).padStart(2,'0')}:00:00`);

    const fbRes = await calendar.freebusy.query({
      requestBody: {
        timeMin:  timeMin.toISOString(),
        timeMax:  timeMax.toISOString(),
        timeZone: TZ,
        items:    [{ id: CALENDAR_ID }]
      }
    });

    const busyRaw = fbRes.data.calendars?.[CALENDAR_ID]?.busy || [];

    // Convert to {start, end} in minutes since midnight (Jerusalem time)
    const busySlots = busyRaw.map(b => ({
      start: toMinutes(b.start, TZ),
      end:   toMinutes(b.end,   TZ)
    }));

    res.json({ busySlots });
  } catch (err) {
    console.error('busy-slots error:', err.message);
    res.status(500).json({ error: 'Failed to fetch calendar data', detail: err.message });
  }
});

// ─── POST /api/book ───────────────────────────────────────────────────────────
// Creates a Google Calendar event for the appointment.
app.post('/api/book', async (req, res) => {
  const { date, time, duration, clientName, clientPhone, services, totalPrice, notes } = req.body;

  if (!date || !time || !duration || !clientName || !clientPhone) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const auth     = getAuth();
    const calendar = google.calendar({ version: 'v3', auth });

    const startDT = new Date(`${date}T${time}:00`);
    const endDT   = new Date(startDT.getTime() + duration * 60_000);

    const serviceNames = (services || []).map(s => s.name).join(', ');
    const description  = [
      `👩 לקוחה: ${clientName}`,
      `📞 טלפון: ${clientPhone}`,
      `💅 טיפולים: ${serviceNames}`,
      `⏱ זמן: ${duration} דקות`,
      `💰 מחיר: ${totalPrice} ₪`,
      notes ? `📝 הערות: ${notes}` : ''
    ].filter(Boolean).join('\n');

    const event = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: {
        summary:     `💅 ${clientName} – ${serviceNames}`,
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
  const { action, eventId, date, time, duration } = req.body;
  if (!action || !eventId) {
    return res.status(400).json({ error: 'Missing action or eventId' });
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

      const patchBody = { start: { dateTime: startLocal, timeZone: TZ } };
      if (dur > 0) patchBody.end = { dateTime: endLocal, timeZone: TZ };

      await calendar.events.patch({ calendarId: CALENDAR_ID, eventId, requestBody: patchBody });
      return res.json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('manage-booking error:', err.message);
    res.status(500).json({ error: 'calendar_sync_failed', detail: err.message });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function toMinutes(isoString, tz) {
  // Convert ISO datetime to minutes since midnight in the given timezone
  const d = new Date(isoString);
  const local = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric', minute: 'numeric', hour12: false
  }).formatToParts(d);
  const h = parseInt(local.find(p => p.type === 'hour').value);
  const m = parseInt(local.find(p => p.type === 'minute').value);
  return h * 60 + m;
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Moriya Nails server running on http://localhost:${PORT}`);
  console.log(`📅 Calendar: ${CALENDAR_ID}`);
});

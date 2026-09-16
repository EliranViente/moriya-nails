/**
 * Netlify Function – POST /api/book
 * Creates a Google Calendar event for the appointment.
 */
const { google } = require('googleapis');
const { serviceTitle, serviceDetailLines } = require('../../shared/calendar-text');
const { getUserFromToken, isAdminUser } = require('../../shared/admin-auth');

const CALENDAR_ID = process.env.CALENDAR_ID || '4rsiafj15ii8ae2p0m5i9e9be4@group.calendar.google.com';
const TZ          = 'Asia/Jerusalem';

const SB_ENV = { url: process.env.SUPABASE_URL || '', key: process.env.SUPABASE_SERVICE_ROLE_KEY || '' };
const URGENT_WINDOW_MS = 48 * 60 * 60 * 1000;

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/calendar']
  });
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { date, time, duration, clientName, clientPhone, services, totalPrice, notes, userId, accessToken } = body;
  if (!date || !time || !duration || !clientName || !clientPhone) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  // A slot less than 48h away must go through Moriya's approval flow (see
  // js/app.js's booking submit handler, which skips this call entirely for an
  // urgent request) — the only legitimate caller reaching here for such a slot
  // is her own approval action in js/admin.js, which sends an admin accessToken.
  // Without this, a direct POST to this endpoint could bypass the 48h rule
  // client-side code alone can't enforce. The fixed +03:00 offset is an
  // approximation (Israel is +02:00 outside DST) — fine for a coarse gate a
  // couple of hours either side of the 48h line, unlike the wall-clock+timeZone
  // approach used below for the event itself, which must be exact.
  const requestedStart = new Date(`${date}T${time}:00+03:00`);
  const isUrgent = (requestedStart.getTime() - Date.now()) < URGENT_WINDOW_MS;
  if (isUrgent && SB_ENV.url && SB_ENV.key) {
    const user = await getUserFromToken(SB_ENV, accessToken);
    if (!isAdminUser(user)) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'too_soon_needs_approval' }) };
    }
  }

  try {
    const auth     = getAuth();
    const calendar = google.calendar({ version: 'v3', auth });

    // Build wall-clock datetimes in Jerusalem time (no UTC conversion).
    // The server runs in UTC, so we must NOT use Date()/toISOString() here —
    // we send the local time string together with timeZone, and Google
    // interprets it in Asia/Jerusalem.
    const [sh, sm]  = time.split(':').map(Number);
    const endTotal  = sh * 60 + sm + Number(duration);
    const eh        = String(Math.floor(endTotal / 60)).padStart(2, '0');
    const em        = String(endTotal % 60).padStart(2, '0');
    const startLocal = `${date}T${time}:00`;
    const endLocal   = `${date}T${eh}:${em}:00`;

    const description  = [
      `👩 לקוחה: ${clientName}`,
      `📞 טלפון: ${clientPhone}`,
      `💅 טיפולים: ${serviceDetailLines(services).join('\n')}`,
      `⏱ זמן: ${duration} דקות`,
      `💰 מחיר: ${totalPrice} ₪`,
      notes ? `📝 הערות: ${notes}` : ''
    ].filter(Boolean).join('\n');

    const ev = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: {
        summary:     `💅 תור: ${clientName} – ${serviceTitle(services)}`,
        description,
        start: { dateTime: startLocal, timeZone: TZ },
        end:   { dateTime: endLocal,   timeZone: TZ },
        // Stamp who booked it. If saving the appointment to Supabase fails a
        // moment later, /api/manage-booking?action=rollback uses this to prove
        // the caller is undoing her own event — which is what keeps the rollback
        // from ever touching a real booking or a block Moriya added by hand.
        ...(userId ? { extendedProperties: { private: { bookedBy: String(userId) } } } : {})
        // No colorId – the event inherits the calendar's default color/settings.
      }
    });

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, eventId: ev.data.id }) };
  } catch (err) {
    console.error('book error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to create booking', detail: err.message }) };
  }
};

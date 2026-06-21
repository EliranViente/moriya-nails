/**
 * Netlify Function – POST /api/book
 * Creates a Google Calendar event for the appointment.
 */
const { google } = require('googleapis');

const CALENDAR_ID = process.env.CALENDAR_ID || '4rsiafj15ii8ae2p0m5i9e9be4@group.calendar.google.com';
const TZ          = 'Asia/Jerusalem';

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

  const { date, time, duration, clientName, clientPhone, services, totalPrice, notes } = body;
  if (!date || !time || !duration || !clientName || !clientPhone) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
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

    const serviceNames = (services || []).map(s => s.name).join(', ');
    const description  = [
      `👩 לקוחה: ${clientName}`,
      `📞 טלפון: ${clientPhone}`,
      `💅 טיפולים: ${serviceNames}`,
      `⏱ זמן: ${duration} דקות`,
      `💰 מחיר: ${totalPrice} ₪`,
      notes ? `📝 הערות: ${notes}` : ''
    ].filter(Boolean).join('\n');

    const ev = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: {
        summary:     `💅 תור: ${clientName} – ${serviceNames}`,
        description,
        start: { dateTime: startLocal, timeZone: TZ },
        end:   { dateTime: endLocal,   timeZone: TZ }
        // No colorId – the event inherits the calendar's default color/settings.
      }
    });

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, eventId: ev.data.id }) };
  } catch (err) {
    console.error('book error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to create booking', detail: err.message }) };
  }
};

/**
 * Netlify Function – GET /api/busy-slots?date=YYYY-MM-DD
 * Returns busy time intervals (minutes since midnight, Jerusalem time)
 * for a given Friday, read from the Google Calendar.
 */
const { google } = require('googleapis');

const CALENDAR_ID = process.env.CALENDAR_ID || '4rsiafj15ii8ae2p0m5i9e9be4@group.calendar.google.com';
const TZ          = 'Asia/Jerusalem';
const WORK_START  = 9;   // 09:00
const WORK_END    = 17;  // 17:00

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/calendar']
  });
}

function toMinutes(isoString, tz) {
  const d = new Date(isoString);
  const local = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: 'numeric', minute: 'numeric', hour12: false
  }).formatToParts(d);
  const h = parseInt(local.find(p => p.type === 'hour').value);
  const m = parseInt(local.find(p => p.type === 'minute').value);
  return h * 60 + m;
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  const date = event.queryStringParameters && event.queryStringParameters.date;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing or invalid date (YYYY-MM-DD)' }) };
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

    const busyRaw = (fbRes.data.calendars && fbRes.data.calendars[CALENDAR_ID] && fbRes.data.calendars[CALENDAR_ID].busy) || [];
    const busySlots = busyRaw.map(b => ({
      start: toMinutes(b.start, TZ),
      end:   toMinutes(b.end,   TZ)
    }));

    return { statusCode: 200, headers, body: JSON.stringify({ busySlots }) };
  } catch (err) {
    console.error('busy-slots error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to fetch calendar data', detail: err.message }) };
  }
};

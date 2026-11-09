/**
 * Netlify Function – GET /api/busy-slots
 *   ?date=YYYY-MM-DD          → { busySlots: [{start, end}] }
 *   ?from=YYYY-MM-DD&to=…     → { from, to, byDate: { 'YYYY-MM-DD': [{start, end}] } }
 * Busy intervals in minutes since Israel midnight, read from the Google Calendar.
 * The range form lets the booking calendar load its whole window in one call.
 *
 * Talks to Google's REST API through google-auth-library instead of the full
 * `googleapis` package: that package is huge, and loading it was most of this
 * function's cold-start time — time a client spent staring at an empty calendar.
 */
const { GoogleAuth } = require('google-auth-library');
const { TZ, parseRangeQuery, busyByDate } = require('../../shared/busy-range');

const CALENDAR_ID  = process.env.CALENDAR_ID || '4rsiafj15ii8ae2p0m5i9e9be4@group.calendar.google.com';
const FREEBUSY_URL = 'https://www.googleapis.com/calendar/v3/freeBusy';

// Built once per warm container instead of per request, so a reused (warm)
// invocation skips re-authenticating with Google and reuses the cached token.
let auth;
function getAuth() {
  if (!auth) {
    auth = new GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
      scopes: ['https://www.googleapis.com/auth/calendar']
    });
  }
  return auth;
}

async function queryFreebusy(timeMin, timeMax) {
  const client = await getAuth().getClient();
  const res = await client.request({
    url: FREEBUSY_URL,
    method: 'POST',
    data: { timeMin, timeMax, timeZone: TZ, items: [{ id: CALENDAR_ID }] }
  });
  const cal = res.data.calendars && res.data.calendars[CALENDAR_ID];
  // A calendar-level error (e.g. sharing revoked) must not read as "all free".
  if (cal && cal.errors && cal.errors.length) throw new Error(`freeBusy: ${cal.errors[0].reason}`);
  return (cal && cal.busy) || [];
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const range = parseRangeQuery(event.queryStringParameters);
  if (range.error) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: range.error }) };
  }

  try {
    const byDate = await busyByDate(range.from, range.to, queryFreebusy);
    const body = range.single
      ? { busySlots: byDate[range.from] }
      : { from: range.from, to: range.to, byDate };
    return { statusCode: 200, headers, body: JSON.stringify(body) };
  } catch (err) {
    console.error('busy-slots error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to fetch calendar data', detail: err.message }) };
  }
};

/**
 * Netlify Function – POST /api/manage-booking
 * Keeps the Google Calendar in sync when a client cancels or reschedules.
 *
 * Body: { action: 'cancel' | 'update', eventId, accessToken?,
 *         date?, time?, duration? }
 *   • cancel → deletes the calendar event.
 *   • update → moves the event to a new date/time (and optional duration).
 *
 * Ownership: when the Supabase service-role key is configured we verify the
 * caller actually owns the appointment carrying this eventId before touching
 * the calendar. If it isn't configured yet, we fall back to trusting the
 * opaque eventId (which a client can only learn for their own appointments
 * through row-level security).
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

const SB_URL  = process.env.SUPABASE_URL || '';
const SB_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const sbReady = Boolean(SB_URL && SB_KEY);

// Admins may cancel / reschedule any appointment from the dashboard.
const ADMIN_EMAILS = ['eliran.viente@gmail.com', 'moriya681@gmail.com'];

// Resolve the Supabase user behind an access token.
async function getUserFromToken(accessToken) {
  if (!accessToken || !sbReady) return null;
  try {
    const res = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user && user.id ? user : null;
  } catch { return null; }
}

function isAdminUser(user) {
  return Boolean(user && ADMIN_EMAILS.includes((user.email || '').toLowerCase()));
}

// Does this user own an appointment with the given Google event id?
async function userOwnsEvent(userId, eventId) {
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/appointments?google_event_id=eq.${encodeURIComponent(eventId)}&select=user_id`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
    );
    const rows = await res.json().catch(() => []);
    return Array.isArray(rows) && rows.some(r => r.user_id === userId);
  } catch { return false; }
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

  const { action, eventId, accessToken, date, time, duration } = body;
  if (!action || !eventId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing action or eventId' }) };
  }

  // Defense in depth: when Supabase is configured, verify the caller is either
  // the appointment owner or an admin managing it from the dashboard.
  if (sbReady) {
    const user = await getUserFromToken(accessToken);
    const allowed = user && (isAdminUser(user) || await userOwnsEvent(user.id, eventId));
    if (!allowed) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'not_authorized' }) };
    }
  }

  try {
    const auth     = getAuth();
    const calendar = google.calendar({ version: 'v3', auth });

    if (action === 'cancel') {
      try {
        await calendar.events.delete({ calendarId: CALENDAR_ID, eventId });
      } catch (err) {
        // A 404/410 means it's already gone – treat that as success.
        const code = err.code || (err.response && err.response.status);
        if (code !== 404 && code !== 410) throw err;
      }
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    if (action === 'update') {
      if (!date || !time) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing date or time' }) };
      }
      // Wall-clock Jerusalem time (same approach as /api/book – no UTC math).
      const [sh, sm]  = time.split(':').map(Number);
      const dur       = Number(duration) || 0;
      const startMin  = sh * 60 + sm;
      const endTotal  = startMin + dur;
      const pad       = n => String(n).padStart(2, '0');
      const startLocal = `${date}T${time.length === 5 ? time : time.slice(0, 5)}:00`;
      const endLocal   = `${date}T${pad(Math.floor(endTotal / 60))}:${pad(endTotal % 60)}:00`;

      const patchBody = { start: { dateTime: startLocal, timeZone: TZ } };
      if (dur > 0) patchBody.end = { dateTime: endLocal, timeZone: TZ };

      await calendar.events.patch({ calendarId: CALENDAR_ID, eventId, requestBody: patchBody });
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };
  } catch (err) {
    console.error('manage-booking error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'calendar_sync_failed', detail: err.message }) };
  }
};

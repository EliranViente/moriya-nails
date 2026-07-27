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

// Rebuild the event summary/description from appointment details – kept in sync
// with /api/book so a rescheduled appointment reads identically on the calendar.
// When the update needs Moriya's approval (client added > 15 min), the same event
// is marked in place: a "⚠️ ממתין לאישור" prefix on the title plus a note at the
// top of the description. Moriya approves by removing that prefix from the title.
function buildEventFields({ clientName, clientPhone, services, duration, totalPrice, notes, pendingApproval, addedMinutes }) {
  const serviceNames = (services || []).map(s => s.name).join(', ');
  const lines = [];
  if (pendingApproval) {
    lines.push(`⚠️ ממתין לאישורך — הלקוחה הוסיפה ${addedMinutes} דקות לתור (מעל רבע שעה).`);
    lines.push('לאישור: הסירי את הסימון "⚠️ ממתין לאישור" מכותרת האירוע.');
    lines.push('');
  }
  lines.push(`👩 לקוחה: ${clientName}`);
  lines.push(`📞 טלפון: ${clientPhone}`);
  lines.push(`💅 טיפולים: ${serviceNames}`);
  lines.push(`⏱ זמן: ${duration} דקות`);
  lines.push(`💰 מחיר: ${totalPrice} ₪`);
  if (notes) lines.push(`📝 הערות: ${notes}`);
  const summary = `${pendingApproval ? '⚠️ ממתין לאישור – ' : ''}💅 תור: ${clientName} – ${serviceNames}`;
  return { summary, description: lines.join('\n') };
}

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/calendar']
  });
}

// Dedicated approval notification. When a client's update adds more than 15
// minutes, Moriya gets an email (via Resend) so she can approve it — a reliable
// channel alongside the in-place "⚠️ ממתין לאישור" marker on the calendar event.
// Best-effort: any failure is swallowed so the calendar sync and client response
// never break. No-op when RESEND_API_KEY isn't configured (e.g. local dev).
async function sendApprovalEmail({ clientName, clientPhone, services, date, time, duration, addedMinutes, totalPrice, notes }) {
  const apiKey = process.env.RESEND_API_KEY;
  const to     = process.env.APPROVAL_EMAIL_TO || 'moriya681@gmail.com';
  const from   = process.env.APPROVAL_EMAIL_FROM || 'Moriya Nails <onboarding@resend.dev>';
  if (!apiKey) return; // not configured — skip silently

  const serviceNames = (services || []).map(s => s.name).join(', ');
  const calLink = 'https://calendar.google.com/calendar/u/0/r';
  const html = `
    <div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;
                          background:#fff;border:1px solid #f3d7e3;border-radius:14px;overflow:hidden">
      <div style="background:#e78aa8;color:#fff;padding:18px 22px;font-size:18px;font-weight:bold">
        ⚠️ עדכון תור ממתין לאישורך
      </div>
      <div style="padding:22px;color:#333;font-size:15px;line-height:1.7">
        <p>היי מוריה,<br>לקוחה עדכנה תור והוסיפה <b>${addedMinutes} דקות</b> (מעל רבע שעה), ולכן העדכון ממתין לאישורך.</p>
        <table style="width:100%;border-collapse:collapse;margin:14px 0">
          <tr><td style="padding:6px 0;color:#999">לקוחה</td><td style="padding:6px 0"><b>${clientName || '—'}</b></td></tr>
          <tr><td style="padding:6px 0;color:#999">טלפון</td><td style="padding:6px 0">${clientPhone || '—'}</td></tr>
          <tr><td style="padding:6px 0;color:#999">תאריך ושעה</td><td style="padding:6px 0">${date} · ${time}</td></tr>
          <tr><td style="padding:6px 0;color:#999">טיפולים</td><td style="padding:6px 0">${serviceNames || '—'}</td></tr>
          <tr><td style="padding:6px 0;color:#999">משך חדש</td><td style="padding:6px 0">${duration} דקות</td></tr>
          <tr><td style="padding:6px 0;color:#999">מחיר</td><td style="padding:6px 0">${totalPrice} ₪</td></tr>
          ${notes ? `<tr><td style="padding:6px 0;color:#999">הערות</td><td style="padding:6px 0">${notes}</td></tr>` : ''}
        </table>
        <p style="margin:18px 0 6px">לאישור: פתחי את היומן והסירי את הסימון <b>"⚠️ ממתין לאישור"</b> מכותרת האירוע.</p>
        <a href="${calLink}" style="display:inline-block;margin-top:10px;background:#e78aa8;color:#fff;
                  text-decoration:none;padding:11px 22px;border-radius:9px;font-weight:bold">פתחי את היומן</a>
      </div>
    </div>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `⚠️ עדכון תור ממתין לאישור — ${clientName || 'לקוחה'} (${date})`,
        html
      })
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.warn('approval email failed:', res.status, detail);
    }
  } catch (err) {
    console.warn('approval email error:', err.message);
  }
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

// Is there any appointment row at all behind this calendar event? Used by the
// rollback path, which must never delete an event that did make it to the
// database. A lookup failure counts as "yes" so an unverifiable event is left
// alone rather than deleted on a guess.
async function eventHasAppointment(eventId) {
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/appointments?google_event_id=eq.${encodeURIComponent(eventId)}&select=id`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
    );
    if (!res.ok) return true;
    const rows = await res.json().catch(() => null);
    return !Array.isArray(rows) || rows.length > 0;
  } catch { return true; }
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

  const { action, eventId, accessToken, date, time, duration,
          services, totalPrice, clientName, clientPhone, notes,
          pendingApproval, addedMinutes } = body;
  if (!action || !eventId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing action or eventId' }) };
  }

  // Undo an event whose appointment never made it into the database. It cannot
  // go through the owner check below, because that check reads the appointment
  // row — the very row that is missing. Three conditions replace it, and all
  // must hold: a valid session, a bookedBy stamp matching that session, and no
  // appointment row pointing at the event. A real booking always has a row, and
  // an event Moriya created by hand in the calendar carries no stamp, so neither
  // can be reached from here.
  if (action === 'rollback') {
    if (!sbReady) {
      return { statusCode: 503, headers, body: JSON.stringify({ error: 'not_configured' }) };
    }
    const user = await getUserFromToken(accessToken);
    if (!user) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'not_authorized' }) };
    }
    try {
      const calendar = google.calendar({ version: 'v3', auth: getAuth() });
      let ev;
      try {
        ev = await calendar.events.get({ calendarId: CALENDAR_ID, eventId });
      } catch (err) {
        const code = err.code || (err.response && err.response.status);
        // Already gone – the caller wanted it deleted, so that is a success.
        if (code === 404 || code === 410) {
          return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }
        throw err;
      }
      const stamp = (ev.data && ev.data.extendedProperties && ev.data.extendedProperties.private) || {};
      if (stamp.bookedBy !== user.id) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'not_authorized' }) };
      }
      if (await eventHasAppointment(eventId)) {
        return { statusCode: 409, headers, body: JSON.stringify({ error: 'appointment_exists' }) };
      }
      await calendar.events.delete({ calendarId: CALENDAR_ID, eventId });
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    } catch (err) {
      console.error('rollback error:', err.message);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'rollback_failed', detail: err.message }) };
    }
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

      // When the client added extra services during the update, refresh the
      // event title/description and price so the calendar reflects the new
      // treatment list and duration. If the addition needs approval, the same
      // event is marked "⚠️ ממתין לאישור" in place (no separate event).
      if (Array.isArray(services) && services.length && clientName) {
        Object.assign(patchBody, buildEventFields({
          clientName, clientPhone, services, duration: dur, totalPrice, notes,
          pendingApproval: !!pendingApproval, addedMinutes: Number(addedMinutes) || 0
        }));
      }

      await calendar.events.patch({ calendarId: CALENDAR_ID, eventId, requestBody: patchBody });

      // Notify Moriya by email when the update needs her approval (best-effort).
      if (pendingApproval) {
        await sendApprovalEmail({
          clientName, clientPhone, services, date, time,
          duration: dur, addedMinutes: Number(addedMinutes) || 0, totalPrice, notes
        });
      }

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, pendingApproval: !!pendingApproval }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };
  } catch (err) {
    console.error('manage-booking error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'calendar_sync_failed', detail: err.message }) };
  }
};

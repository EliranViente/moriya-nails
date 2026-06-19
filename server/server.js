/**
 * Moriya Nails – Backend Server
 * Google Calendar API integration
 * Calendar: moriya681@gmail.com
 */

require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const { google } = require('googleapis');
const otp = require('../lib/otp');

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

// ─── POST /api/otp-send ─────────────────────────────────────────────────────
// Generates a one-time code, stores its hash, and sends it over WhatsApp.
app.post('/api/otp-send', async (req, res) => {
  if (!otp.otpConfigured() || !otp.whatsappConfigured()) {
    return res.status(503).json({ error: 'Verification is not configured yet' });
  }
  const phone = otp.normalizePhone(req.body.phone);
  if (!phone) return res.status(400).json({ error: 'invalid_phone' });

  try {
    const existing = await otp.getVerification(phone);
    if (existing) {
      const since = Date.now() - new Date(existing.last_sent_at).getTime();
      if (since < otp.RESEND_COOLDOWN_MS) {
        return res.status(429).json({ error: 'cooldown', retryAfter: Math.ceil((otp.RESEND_COOLDOWN_MS - since) / 1000) });
      }
    }
    const code = otp.generateCode();
    await otp.upsertVerification({
      phone,
      code_hash:    otp.hashCode(code, phone),
      expires_at:   new Date(Date.now() + otp.CODE_TTL_MS).toISOString(),
      attempts:     0,
      last_sent_at: new Date().toISOString(),
    });
    await otp.sendWhatsappOtp(phone, code);
    res.json({ success: true });
  } catch (err) {
    console.error('otp-send error:', err.message);
    res.status(500).json({ error: 'send_failed' });
  }
});

// ─── POST /api/otp-verify ───────────────────────────────────────────────────
// Checks the code; on success returns a verifyToken and (for logged-in users)
// marks profiles.phone_verified = true.
app.post('/api/otp-verify', async (req, res) => {
  if (!otp.otpConfigured()) return res.status(503).json({ error: 'Verification is not configured yet' });
  const phone = otp.normalizePhone(req.body.phone);
  const code  = String(req.body.code || '').replace(/\D/g, '');
  if (!phone) return res.status(400).json({ error: 'invalid_phone' });
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'invalid_code' });

  try {
    const row = await otp.getVerification(phone);
    if (!row) return res.status(400).json({ error: 'no_code' });
    if (Date.now() > new Date(row.expires_at).getTime()) {
      await otp.deleteVerification(phone);
      return res.status(400).json({ error: 'expired' });
    }
    if (row.attempts >= otp.MAX_ATTEMPTS) {
      await otp.deleteVerification(phone);
      return res.status(429).json({ error: 'too_many_attempts' });
    }
    if (otp.hashCode(code, phone) !== row.code_hash) {
      await otp.setAttempts(phone, row.attempts + 1);
      return res.status(400).json({ error: 'wrong_code', remaining: otp.MAX_ATTEMPTS - row.attempts - 1 });
    }
    await otp.deleteVerification(phone);
    if (req.body.accessToken) {
      const user = await otp.getUserFromToken(req.body.accessToken);
      if (user) {
        try { await otp.markProfileVerified(user.id, phone); }
        catch (e) { console.warn('markProfileVerified failed:', e.message); }
      }
    }
    res.json({ success: true, verifyToken: otp.signToken(phone) });
  } catch (err) {
    console.error('otp-verify error:', err.message);
    res.status(500).json({ error: 'verify_failed' });
  }
});

// Confirm the phone behind a booking was actually verified (token or remembered).
async function isPhoneVerified(phone, verifyToken, accessToken) {
  if (!otp.otpConfigured()) return true;
  const canonical = otp.normalizePhone(phone);
  if (!canonical) return false;
  if (verifyToken && otp.verifyToken(verifyToken, canonical)) return true;
  if (accessToken) {
    const user = await otp.getUserFromToken(accessToken);
    if (user) {
      const profile = await otp.getProfile(user.id);
      if (profile && profile.phone_verified && otp.normalizePhone(profile.phone) === canonical) return true;
    }
  }
  return false;
}

// ─── POST /api/book ───────────────────────────────────────────────────────────
// Creates a Google Calendar event for the appointment.
app.post('/api/book', async (req, res) => {
  const { date, time, duration, clientName, clientPhone, services, totalPrice, notes,
          verifyToken, accessToken } = req.body;

  if (!date || !time || !duration || !clientName || !clientPhone) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    if (!(await isPhoneVerified(clientPhone, verifyToken, accessToken))) {
      return res.status(403).json({ error: 'phone_not_verified' });
    }
  } catch (err) {
    console.error('verification check error:', err.message);
    return res.status(500).json({ error: 'verification_failed' });
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

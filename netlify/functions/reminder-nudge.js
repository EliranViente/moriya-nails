/* ═══════════════════════════════════════════
   MORIYA NAILS – Reminder nudge (scheduled)
   A few days before a day that has appointments, email Moriya (the salon owner)
   so she remembers to open the admin dashboard and send each client her WhatsApp
   reminder. The email goes only to Moriya's own address, so it works on Resend's
   free tier with no verified domain. Scheduled daily via netlify.toml.

   No client emails are sent here — this only nudges Moriya. The actual client
   reminders stay in the admin "send reminder" (WhatsApp) flow.
═══════════════════════════════════════════ */

const DAYS_AHEAD = 3; // nudge this many days before the appointment day

const SB_URL = process.env.SUPABASE_URL || 'https://yspzwxyxhdjtpcqaebls.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''; // service role: read all appointments past RLS

const RESEND_KEY = process.env.RESEND_API_KEY || '';
const MAIL_TO    = process.env.APPROVAL_EMAIL_TO || 'moriya681@gmail.com';
const MAIL_FROM  = process.env.APPROVAL_EMAIL_FROM || 'Moriya Nails <onboarding@resend.dev>';

const HE_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const pad = n => String(n).padStart(2, '0');

// Today + `days` as a YYYY-MM-DD string in Jerusalem local time (DST-safe).
function jerusalemDatePlus(days) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date()).split('-').map(Number);
  const base = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days, 12, 0, 0));
  return `${base.getUTCFullYear()}-${pad(base.getUTCMonth() + 1)}-${pad(base.getUTCDate())}`;
}

function heDayName(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  return HE_DAYS[d.getDay()];
}
function dmy(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

async function fetchAppointments(dateStr) {
  if (!SB_KEY) { console.warn('reminder-nudge: SUPABASE_SERVICE_ROLE_KEY not set'); return null; }
  const url = `${SB_URL}/rest/v1/appointments`
    + `?date=eq.${dateStr}&status=neq.cancelled`
    + `&select=client_name,client_phone,start_time,duration_min`
    + `&order=start_time.asc`;
  const res = await fetch(url, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
  if (!res.ok) { console.warn('reminder-nudge: appointments fetch failed', res.status); return null; }
  return res.json().catch(() => []);
}

function buildEmail(dateStr, appts) {
  const rows = appts.map(a => {
    const t = (a.start_time || '').slice(0, 5);
    return `<tr>
      <td style="padding:7px 10px;border-bottom:1px solid #f3d7e3;white-space:nowrap"><b>${t}</b></td>
      <td style="padding:7px 10px;border-bottom:1px solid #f3d7e3">${a.client_name || '—'}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #f3d7e3;color:#888;white-space:nowrap">${a.client_phone || ''}</td>
    </tr>`;
  }).join('');

  const html = `
    <div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;max-width:540px;margin:0 auto;
                          background:#fff;border:1px solid #f3d7e3;border-radius:14px;overflow:hidden">
      <div style="background:#e78aa8;color:#fff;padding:18px 22px;font-size:18px;font-weight:bold">
        💅 תזכורת: שלחי הודעות ללקוחות
      </div>
      <div style="padding:22px;color:#333;font-size:15px;line-height:1.7">
        <p>היי מוריה,<br>
        בעוד ${DAYS_AHEAD} ימים — <b>יום ${heDayName(dateStr)}, ${dmy(dateStr)}</b> — יש לך
        <b>${appts.length}</b> ${appts.length === 1 ? 'תור' : 'תורים'}.</p>
        <p>זו תזכורת קטנה להיכנס למסך האדמין ולשלוח לכל לקוחה את הודעת התזכורת ב-WhatsApp 💗</p>
        <table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:14px">
          <thead><tr style="color:#999;text-align:right">
            <th style="padding:6px 10px">שעה</th><th style="padding:6px 10px">לקוחה</th><th style="padding:6px 10px">טלפון</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="color:#888;font-size:13px">התזכורת נשלחת אוטומטית ${DAYS_AHEAD} ימים לפני כל יום עם תורים.</p>
      </div>
    </div>`;

  return {
    subject: `💅 תזכורת ללקוחות — יום ${heDayName(dateStr)} ${dmy(dateStr)} (${appts.length} תורים)`,
    html
  };
}

async function sendEmail(subject, html) {
  if (!RESEND_KEY) { console.warn('reminder-nudge: RESEND_API_KEY not set'); return; }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: MAIL_FROM, to: [MAIL_TO], subject, html })
  });
  if (!res.ok) console.warn('reminder-nudge: email failed', res.status, await res.text().catch(() => ''));
  else console.log('reminder-nudge: email sent');
}

exports.handler = async () => {
  try {
    const target = jerusalemDatePlus(DAYS_AHEAD);
    const appts  = await fetchAppointments(target);
    if (!Array.isArray(appts) || appts.length === 0) {
      console.log(`reminder-nudge: no appointments on ${target}, nothing to send`);
      return { statusCode: 200, body: `no appointments on ${target}` };
    }
    const { subject, html } = buildEmail(target, appts);
    await sendEmail(subject, html);
    return { statusCode: 200, body: `nudge for ${target} (${appts.length} appts)` };
  } catch (err) {
    console.error('reminder-nudge error:', err.message);
    return { statusCode: 500, body: 'reminder-nudge error' };
  }
};

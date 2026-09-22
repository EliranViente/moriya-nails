/* ═══════════════════════════════════════════
   MORIYA NAILS – Weekly database backup (scheduled)
   Supabase's free tier has no automatic backups, and the dashboard's own
   "Export" only produces an appointments report, not a real backup. This
   pulls every row from every public table (via the service-role key, past
   RLS), plus a whitelisted snapshot of the login identities in auth.users,
   into one JSON file and emails it as an attachment, so a restore is
   possible by hand if the database is ever lost or corrupted. Restoring
   from the file is a manual process — this only produces it. Scheduled
   weekly via netlify.toml, Saturday evening (close to the end of Shabbat).
═══════════════════════════════════════════ */

const SB_URL = process.env.SUPABASE_URL || 'https://yspzwxyxhdjtpcqaebls.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''; // service role: read every row, past RLS

const RESEND_KEY = process.env.RESEND_API_KEY || '';
const MAIL_TO    = process.env.APPROVAL_EMAIL_TO || 'moriya681@gmail.com';
const MAIL_FROM  = process.env.APPROVAL_EMAIL_FROM || 'Moriya Nails <onboarding@resend.dev>';

// Every table under public schema (supabase/schema.sql) — config tables
// (availability, treatments) are included, not just activity data, since a
// real restore needs both.
const TABLES = ['profiles', 'appointments', 'availability', 'waitlist', 'treatments', 'reviews'];

// Generous fixed limit rather than a pagination loop — this is a single
// small salon's data, nowhere near this row count for the foreseeable future.
const ROW_LIMIT = 50000;

function jerusalemDateStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
}

async function fetchTable(name) {
  const url = `${SB_URL}/rest/v1/${name}?select=*&limit=${ROW_LIMIT}`;
  const res = await fetch(url, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
  if (!res.ok) {
    console.error(`backup: ${name} fetch failed`, res.status, await res.text().catch(() => ''));
    return null;
  }
  return res.json().catch(() => null);
}

// The login identities themselves (auth.users) aren't a public-schema table,
// so they need Supabase's admin API rather than the REST endpoint above. Only
// a fixed whitelist of fields is kept — the full admin record also carries
// password hashes and one-time tokens, which have no reason to sit in an
// email attachment. This can't be used to recreate the same login on restore
// (Supabase Auth doesn't support inserting rows back into auth.users) — it's
// a record of who the accounts were, not a restorable login backup.
async function fetchAuthUsers() {
  const perPage = 200;
  const users = [];
  for (let page = 1; ; page++) {
    const url = `${SB_URL}/auth/v1/admin/users?page=${page}&per_page=${perPage}`;
    const res = await fetch(url, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
    if (!res.ok) {
      console.error('backup: auth_users fetch failed', res.status, await res.text().catch(() => ''));
      return page === 1 ? null : users; // partial pages already collected are still useful
    }
    const body = await res.json().catch(() => null);
    const pageUsers = (body && body.users) || [];
    for (const u of pageUsers) {
      users.push({
        id: u.id,
        email: u.email,
        phone: u.phone,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        full_name: (u.user_metadata && (u.user_metadata.full_name || u.user_metadata.name)) || null,
        provider: u.app_metadata && u.app_metadata.provider
      });
    }
    if (pageUsers.length < perPage) break;
  }
  return users;
}

async function sendEmail(dateStr, attachmentBase64, filename, tableCounts) {
  if (!RESEND_KEY) { console.warn('backup: RESEND_API_KEY not set'); return; }

  const rows = Object.entries(tableCounts)
    .map(([name, count]) => `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #f3d7e3">${name}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #f3d7e3;color:#888">${count === null ? 'נכשל' : count}</td>
    </tr>`).join('');

  const html = `
    <div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;max-width:540px;margin:0 auto;
                          background:#fff;border:1px solid #f3d7e3;border-radius:14px;overflow:hidden">
      <div style="background:#e78aa8;color:#fff;padding:18px 22px;font-size:18px;font-weight:bold">
        🗄️ גיבוי שבועי של המערכת
      </div>
      <div style="padding:22px;color:#333;font-size:15px;line-height:1.7">
        <p>היי מוריה,<br>
        מצורף קובץ גיבוי אוטומטי של כל נתוני המערכת מתאריך ${dateStr}. אין צורך לעשות איתו כלום —
        הוא נשמר רק ליתר ביטחון, למקרה שיהיה צורך לשחזר מידע בעתיד.</p>
        <table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:14px">
          <tbody>${rows}</tbody>
        </table>
        <p style="color:#888;font-size:13px">גיבוי זה נשלח אוטומטית כל שבת בערב.</p>
      </div>
    </div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: MAIL_FROM,
      to: [MAIL_TO],
      subject: `🗄️ גיבוי שבועי — ${dateStr}`,
      html,
      attachments: [{ filename, content: attachmentBase64 }]
    })
  });
  if (!res.ok) console.error('backup: email failed', res.status, await res.text().catch(() => ''));
  else console.log('backup: email sent');
}

exports.handler = async () => {
  try {
    if (!SB_KEY) { console.error('backup: SUPABASE_SERVICE_ROLE_KEY not set'); return { statusCode: 200, body: 'not configured' }; }

    const dateStr = jerusalemDateStr();
    const data = {};
    const tableCounts = {};

    for (const table of TABLES) {
      const rows = await fetchTable(table);
      data[table] = rows || [];
      tableCounts[table] = rows ? rows.length : null;
    }

    const authUsers = await fetchAuthUsers();
    data.auth_users = authUsers || [];
    tableCounts.auth_users = authUsers ? authUsers.length : null;

    console.log('backup: row counts', tableCounts);

    const json = JSON.stringify({ generated_at: new Date().toISOString(), tables: data }, null, 2);
    const attachmentBase64 = Buffer.from(json, 'utf8').toString('base64');
    const filename = `moriya-nails-backup-${dateStr}.json`;

    await sendEmail(dateStr, attachmentBase64, filename, tableCounts);

    return { statusCode: 200, body: `backup for ${dateStr}` };
  } catch (err) {
    console.error('backup error:', err.message);
    return { statusCode: 500, body: 'backup error' };
  }
};

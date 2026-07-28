/**
 * Removing a client from the salon – shared by the Netlify function
 * (/api/delete-client) and the local dev server, so the two can't drift.
 *
 * Deleting the *profile row* alone would not do it: the Google identity in
 * auth.users would survive, so the client could still sign in and book, but the
 * booking flow only ever UPDATEs her profile (never inserts one), so she would
 * never reappear in the clients table and her name/phone would stop autofilling.
 * That half-deleted state is invisible from the dashboard, so we delete the auth
 * user instead and let `profiles.id … on delete cascade` take the profile with
 * it. Signing in again afterwards makes her a brand-new client.
 *
 * Her appointment history is deliberately kept: appointments.user_id is
 * `on delete set null`, and every row carries its own client_name/client_phone,
 * so past revenue and the charts stay correct after the client is gone.
 *
 * Needs the service-role key (deleting users is an admin-API call), which is
 * exactly why this runs server-side. The caller's own token is verified first,
 * and must belong to an admin.
 */

// The project URL is not a secret – it already ships to every browser in
// js/auth.js – so it defaults here rather than being one more environment
// variable that can be missing (same pattern as CALENDAR_ID in the calendar
// functions). SUPABASE_URL still overrides it. Only the service-role key has to
// be configured, because that one genuinely is a secret.
const SUPABASE_URL = 'https://yspzwxyxhdjtpcqaebls.supabase.co';

// Same list as is_admin() in supabase/schema.sql and ADMIN_EMAILS in js/auth.js.
const ADMIN_EMAILS = ['eliran.viente@gmail.com', 'moriya681@gmail.com'];

const isAdminEmail = email => ADMIN_EMAILS.includes(String(email || '').toLowerCase());

// Resolve the Supabase user behind an access token.
async function getUserFromToken(env, accessToken) {
  if (!accessToken) return null;
  try {
    const res = await fetch(`${env.url}/auth/v1/user`, {
      headers: { apikey: env.key, Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user && user.id ? user : null;
  } catch { return null; }
}

/**
 * @returns {{ status: number, body: object }} – ready to send as JSON.
 */
async function deleteClient({ clientId, accessToken }) {
  const url = process.env.SUPABASE_URL || SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  // Without the service-role key this cannot be done safely at all, so refuse
  // rather than falling back to something weaker.
  if (!key) return { status: 503, body: { error: 'not_configured' } };
  if (!clientId)    return { status: 400, body: { error: 'Missing clientId' } };

  const env = { url, key };
  const caller = await getUserFromToken(env, accessToken);
  if (!caller || !isAdminEmail(caller.email)) {
    return { status: 403, body: { error: 'not_authorized' } };
  }

  // Deleting yourself would lock you out of the dashboard, and deleting the
  // other admin would let one of them remove the other. Neither is a client.
  if (caller.id === clientId) {
    return { status: 400, body: { error: 'cannot_delete_self' } };
  }

  const adminHeaders = { apikey: key, Authorization: `Bearer ${key}` };
  const userUrl = `${url}/auth/v1/admin/users/${encodeURIComponent(clientId)}`;

  try {
    // Read the target first, so an admin account can't be removed through this
    // endpoint even if the dashboard ever offered it by mistake.
    const lookup = await fetch(userUrl, { headers: adminHeaders });
    if (lookup.status === 404) {
      // Already gone – the caller wanted it removed, so that is a success.
      return { status: 200, body: { success: true, alreadyGone: true } };
    }
    if (!lookup.ok) {
      console.error('delete-client lookup failed:', lookup.status, await lookup.text().catch(() => ''));
      return { status: 502, body: { error: 'lookup_failed' } };
    }
    const target = await lookup.json();
    if (isAdminEmail(target && target.email)) {
      return { status: 400, body: { error: 'cannot_delete_admin' } };
    }

    const res = await fetch(userUrl, { method: 'DELETE', headers: adminHeaders });
    if (!res.ok && res.status !== 404) {
      const detail = await res.text().catch(() => '');
      console.error('delete-client failed:', res.status, detail);
      return { status: 502, body: { error: 'delete_failed', detail } };
    }

    return { status: 200, body: { success: true } };
  } catch (err) {
    console.error('delete-client error:', err.message);
    return { status: 500, body: { error: 'delete_failed', detail: err.message } };
  }
}

module.exports = { deleteClient, isAdminEmail, ADMIN_EMAILS };

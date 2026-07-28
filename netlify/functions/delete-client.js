/**
 * Netlify Function – POST /api/delete-client
 * Removes a client from the salon, on Moriya's request from the dashboard.
 *
 * Body: { clientId, accessToken }
 *
 * Deleting the *profile row* alone would not do it: the Google identity in
 * auth.users would survive, so the client could still sign in and book, but the
 * booking flow only ever UPDATEs her profile (never inserts one), so she would
 * never reappear in the clients table and her name/phone would stop autofilling.
 * That half-deleted state is invisible from the dashboard, so we delete the
 * auth user instead and let `profiles.id … on delete cascade` take the profile
 * with it. Signing in again afterwards makes her a brand-new client.
 *
 * Her appointment history is deliberately kept: appointments.user_id is
 * `on delete set null`, and every row carries its own client_name/client_phone,
 * so past revenue and the charts stay correct after the client is gone.
 *
 * This needs the service-role key (deleting users is an admin-API call), which
 * is exactly why it lives in a function and not in the browser. The caller's own
 * token is verified first, and must belong to an admin.
 */
const SB_URL = process.env.SUPABASE_URL || '';
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Same list as is_admin() in supabase/schema.sql and ADMIN_EMAILS in js/auth.js.
const ADMIN_EMAILS = ['eliran.viente@gmail.com', 'moriya681@gmail.com'];

// Resolve the Supabase user behind an access token.
async function getUserFromToken(accessToken) {
  if (!accessToken) return null;
  try {
    const res = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user && user.id ? user : null;
  } catch { return null; }
}

const isAdminEmail = email => ADMIN_EMAILS.includes(String(email || '').toLowerCase());

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Without the service-role key this cannot be done safely at all, so refuse
  // rather than falling back to something weaker.
  if (!SB_URL || !SB_KEY) {
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'not_configured' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { clientId, accessToken } = body;
  if (!clientId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing clientId' }) };
  }

  const caller = await getUserFromToken(accessToken);
  if (!caller || !isAdminEmail(caller.email)) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'not_authorized' }) };
  }

  // Deleting yourself would lock you out of the dashboard, and deleting the
  // other admin would let one of them remove the other. Neither is a client.
  if (caller.id === clientId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'cannot_delete_self' }) };
  }

  try {
    // Read the target first, so an admin account can't be removed through this
    // endpoint even if the dashboard ever offered it by mistake.
    const lookup = await fetch(`${SB_URL}/auth/v1/admin/users/${encodeURIComponent(clientId)}`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
    });
    if (lookup.status === 404) {
      // Already gone – the caller wanted it removed, so that is a success.
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, alreadyGone: true }) };
    }
    if (!lookup.ok) {
      const detail = await lookup.text().catch(() => '');
      console.error('delete-client lookup failed:', lookup.status, detail);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'lookup_failed' }) };
    }
    const target = await lookup.json();
    if (isAdminEmail(target && target.email)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'cannot_delete_admin' }) };
    }

    const res = await fetch(`${SB_URL}/auth/v1/admin/users/${encodeURIComponent(clientId)}`, {
      method: 'DELETE',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
    });
    if (!res.ok && res.status !== 404) {
      const detail = await res.text().catch(() => '');
      console.error('delete-client failed:', res.status, detail);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'delete_failed', detail }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('delete-client error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'delete_failed', detail: err.message }) };
  }
};

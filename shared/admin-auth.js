/**
 * Is the caller behind a Supabase access token an admin? Shared by every
 * server-side action that must be restricted to Moriya — cancelling/updating
 * an appointment, and (new) creating a calendar event for a slot inside the
 * 48h urgent-approval window. Previously duplicated inline in
 * netlify/functions/manage-booking.js; kept parametrized (env passed in
 * rather than read from process.env here) so each caller keeps deciding its
 * own fallback when Supabase isn't configured, same as shared/delete-client.js.
 */

const ADMIN_EMAILS = ['eliran.viente@gmail.com', 'moriya681@gmail.com'];

async function getUserFromToken(env, accessToken) {
  if (!accessToken || !env || !env.url || !env.key) return null;
  try {
    const res = await fetch(`${env.url}/auth/v1/user`, {
      headers: { apikey: env.key, Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user && user.id ? user : null;
  } catch { return null; }
}

function isAdminUser(user) {
  return Boolean(user && ADMIN_EMAILS.includes((user.email || '').toLowerCase()));
}

module.exports = { ADMIN_EMAILS, getUserFromToken, isAdminUser };

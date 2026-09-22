/**
 * Netlify Function – POST /api/waitlist-notify
 * Body: { date: 'YYYY-MM-DD' }
 *
 * The work itself lives in shared/waitlist-notify.js, so this endpoint and
 * the local dev server (server/server.js) behave identically. See that
 * file's header for the full picture of when/why this runs.
 */
const { runWaitlistNotify } = require('../../shared/waitlist-notify');

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  const ok = { statusCode: 200, headers, body: JSON.stringify({ success: true }) };

  if (event.httpMethod !== 'POST') return ok; // fire-and-forget contract: never error the caller

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return ok; }

  // Netlify injects URL (this deploy's own live site URL) into every
  // function automatically — no env var to configure. SITE_URL remains a
  // manual override, and the literal is a last-resort fallback only (same
  // pattern as manage-booking.js's sendUrgentApprovalEmail).
  const siteUrl = process.env.URL || process.env.SITE_URL || 'https://moriya-nails.netlify.app';

  const { status, body: payload } = await runWaitlistNotify({
    date:        body.date,
    apiBaseUrl:  siteUrl,
    siteBaseUrl: siteUrl,
  });
  return { statusCode: status, headers, body: JSON.stringify(payload) };
};

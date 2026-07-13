/* ═══════════════════════════════════════════
   MORIYA NAILS – Supabase keep-alive (scheduled)
   Free-tier Supabase projects pause after ~7 days without activity. A paused
   project stops resolving (NXDOMAIN) and breaks login for real customers.
   This scheduled function makes one tiny authenticated REST read per day, which
   counts as activity and keeps the project awake. Scheduled via netlify.toml.
═══════════════════════════════════════════ */

// Public values (same anon/publishable key the frontend uses). Overridable via
// Netlify environment variables if the project URL/key ever changes.
const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://yspzwxyxhdjtpcqaebls.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || 'sb_publishable_C77ymTC07RcpoMwmNDESRw_V_gY31OG';

exports.handler = async () => {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?select=id&limit=1`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      }
    );
    console.log('Supabase keep-alive ping:', res.status);
    return { statusCode: 200, body: `keep-alive ok (${res.status})` };
  } catch (err) {
    console.error('Supabase keep-alive failed:', err.message);
    return { statusCode: 500, body: 'keep-alive error' };
  }
};

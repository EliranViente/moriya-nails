/**
 * Netlify Function – POST /api/otp-verify
 * Body: { phone, code, accessToken? }
 * Checks the code against the stored hash. On success it returns a short-lived
 * verifyToken (proof for /api/book) and, for logged-in users (accessToken),
 * marks profiles.phone_verified = true so they never re-verify the same number.
 */
const otp = require('../../lib/otp');

const json = (statusCode, obj) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj),
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  if (!otp.otpConfigured()) return json(503, { error: 'Verification is not configured yet' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const phone = otp.normalizePhone(body.phone);
  const code  = String(body.code || '').replace(/\D/g, '');
  if (!phone) return json(400, { error: 'invalid_phone' });
  if (!/^\d{6}$/.test(code)) return json(400, { error: 'invalid_code' });

  try {
    const row = await otp.getVerification(phone);
    if (!row) return json(400, { error: 'no_code' });
    if (Date.now() > new Date(row.expires_at).getTime()) {
      await otp.deleteVerification(phone);
      return json(400, { error: 'expired' });
    }
    if (row.attempts >= otp.MAX_ATTEMPTS) {
      await otp.deleteVerification(phone);
      return json(429, { error: 'too_many_attempts' });
    }

    if (otp.hashCode(code, phone) !== row.code_hash) {
      await otp.setAttempts(phone, row.attempts + 1);
      return json(400, { error: 'wrong_code', remaining: otp.MAX_ATTEMPTS - row.attempts - 1 });
    }

    // Correct code → burn it so it can't be reused.
    await otp.deleteVerification(phone);

    // If a logged-in user verified, remember it on their profile.
    if (body.accessToken) {
      const user = await otp.getUserFromToken(body.accessToken);
      if (user) {
        try { await otp.markProfileVerified(user.id, phone); }
        catch (e) { console.warn('markProfileVerified failed:', e.message); }
      }
    }

    return json(200, { success: true, verifyToken: otp.signToken(phone) });
  } catch (err) {
    console.error('otp-verify error:', err.message);
    return json(500, { error: 'verify_failed' });
  }
};

/**
 * Netlify Function – POST /api/otp-send
 * Body: { phone }
 * Generates a one-time code, stores its hash in Supabase, and delivers it
 * over WhatsApp (Meta Cloud API). Enforces a short resend cooldown.
 */
const otp = require('../../lib/otp');

const json = (statusCode, obj) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj),
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  if (!otp.otpConfigured() || !otp.whatsappConfigured()) {
    return json(503, { error: 'Verification is not configured yet' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const phone = otp.normalizePhone(body.phone);
  if (!phone) return json(400, { error: 'invalid_phone' });

  try {
    // Resend cooldown: don't allow hammering codes to one number.
    const existing = await otp.getVerification(phone);
    if (existing) {
      const since = Date.now() - new Date(existing.last_sent_at).getTime();
      if (since < otp.RESEND_COOLDOWN_MS) {
        const wait = Math.ceil((otp.RESEND_COOLDOWN_MS - since) / 1000);
        return json(429, { error: 'cooldown', retryAfter: wait });
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
    return json(200, { success: true });
  } catch (err) {
    console.error('otp-send error:', err.message);
    return json(500, { error: 'send_failed' });
  }
};

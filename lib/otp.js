/**
 * Shared phone-verification helpers (CommonJS).
 *
 * Used by both the Netlify serverless functions and the local Express dev
 * server. Relies only on Node built-ins (crypto + global fetch, Node 18+),
 * so no extra npm dependencies are required.
 *
 * Pieces:
 *   • Phone normalisation to canonical E.164 (Israeli-aware).
 *   • One-time-code generation + hashing.
 *   • Short-lived signed "verify tokens" (HMAC) used to prove to /api/book
 *     that a phone was just verified, without keeping server session state.
 *   • Thin Supabase REST helpers (service-role) for the phone_verifications
 *     table and the profiles verification flag.
 *   • WhatsApp Cloud API sender (Meta) for the OTP message.
 */
const crypto = require('crypto');

const CODE_TTL_MS   = 10 * 60 * 1000; // a code is valid for 10 minutes
const TOKEN_TTL_MS  = 15 * 60 * 1000; // a verify token is valid for 15 minutes
const RESEND_COOLDOWN_MS = 30 * 1000; // min gap between two codes to one phone
const MAX_ATTEMPTS   = 5;             // wrong-code guesses before a code is burned

const env = (k, fallback = '') => process.env[k] || fallback;

// ─── Configuration checks ─────────────────────────────────────────────────────
// If the OTP infrastructure isn't configured yet, callers can decide to skip
// verification so the site keeps working until the owner finishes setup.
function otpConfigured() {
  return Boolean(
    env('OTP_TOKEN_SECRET') &&
    env('SUPABASE_URL') &&
    env('SUPABASE_SERVICE_ROLE_KEY')
  );
}
function whatsappConfigured() {
  return Boolean(env('WHATSAPP_TOKEN') && env('WHATSAPP_PHONE_ID'));
}

// ─── Phone normalisation ──────────────────────────────────────────────────────
// Returns canonical E.164 (e.g. "+972501234567") or null if it doesn't look
// like a valid phone. Handles common Israeli inputs: "050-1234567",
// "0501234567", "+972 50-123-4567", "972501234567".
function normalizePhone(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) {
    digits = '+' + digits.slice(1).replace(/\D/g, '');
  } else {
    digits = digits.replace(/\D/g, '');
    if (digits.startsWith('00')) {
      digits = '+' + digits.slice(2);
    } else if (digits.startsWith('0')) {
      digits = '+972' + digits.slice(1);   // local Israeli number
    } else if (digits.startsWith('972')) {
      digits = '+' + digits;
    } else {
      digits = '+' + digits;               // assume already has a country code
    }
  }
  // Basic sanity: + and 8–15 digits (E.164 max is 15).
  if (!/^\+\d{8,15}$/.test(digits)) return null;
  return digits;
}

// WhatsApp Cloud API wants the number without the leading "+".
function toWhatsappNumber(e164) {
  return e164.replace(/^\+/, '');
}

// ─── Codes ────────────────────────────────────────────────────────────────────
function generateCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}
function hashCode(code, phone) {
  return crypto
    .createHmac('sha256', env('OTP_TOKEN_SECRET'))
    .update(`${phone}:${code}`)
    .digest('hex');
}

// ─── Verify tokens (stateless proof of a fresh verification) ───────────────────
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function signToken(phone, ttlMs = TOKEN_TTL_MS) {
  const exp     = Date.now() + ttlMs;
  const payload = `${phone}.${exp}`;
  const sig     = b64url(crypto.createHmac('sha256', env('OTP_TOKEN_SECRET')).update(payload).digest());
  return `${b64url(payload)}.${sig}`;
}
function verifyToken(token, expectedPhone) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  let payload;
  try {
    payload = Buffer.from(parts[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch { return false; }
  const expectedSig = b64url(crypto.createHmac('sha256', env('OTP_TOKEN_SECRET')).update(payload).digest());
  const a = Buffer.from(parts[1]);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const [phone, expStr] = payload.split('.');
  if (phone !== expectedPhone) return false;
  if (!expStr || Date.now() > Number(expStr)) return false;
  return true;
}

// ─── Supabase REST (service role) ──────────────────────────────────────────────
function sbHeaders(extra = {}) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra };
}
async function sbRest(path, opts = {}) {
  const res = await fetch(`${env('SUPABASE_URL')}/rest/v1/${path}`, {
    ...opts,
    headers: sbHeaders(opts.headers),
  });
  return res;
}

async function getVerification(phone) {
  const res  = await sbRest(`phone_verifications?phone=eq.${encodeURIComponent(phone)}&select=*`);
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}
async function upsertVerification(row) {
  return sbRest('phone_verifications', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row),
  });
}
async function setAttempts(phone, attempts) {
  return sbRest(`phone_verifications?phone=eq.${encodeURIComponent(phone)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ attempts }),
  });
}
async function deleteVerification(phone) {
  return sbRest(`phone_verifications?phone=eq.${encodeURIComponent(phone)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
}

// Resolve the Supabase user behind an access token (the logged-in visitor).
async function getUserFromToken(accessToken) {
  if (!accessToken) return null;
  try {
    const res = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`, {
      headers: { apikey: env('SUPABASE_SERVICE_ROLE_KEY'), Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user && user.id ? user : null;
  } catch { return null; }
}
async function getProfile(uid) {
  const res  = await sbRest(`profiles?id=eq.${uid}&select=phone,phone_verified`);
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}
async function markProfileVerified(uid, phone) {
  return sbRest(`profiles?id=eq.${uid}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ phone, phone_verified: true, phone_verified_at: new Date().toISOString() }),
  });
}

// ─── WhatsApp Cloud API sender ──────────────────────────────────────────────────
// Sends an "authentication" template message carrying the one-time code.
// The template (e.g. "otp_code") must be pre-approved in the Meta dashboard
// with one body {{1}} parameter and a one-time-password (copy-code) button.
async function sendWhatsappOtp(e164, code) {
  const version  = env('WHATSAPP_API_VERSION', 'v21.0');
  const phoneId  = env('WHATSAPP_PHONE_ID');
  const template = env('WHATSAPP_TEMPLATE_NAME', 'otp_code');
  const lang     = env('WHATSAPP_LANG', 'he');

  const body = {
    messaging_product: 'whatsapp',
    to: toWhatsappNumber(e164),
    type: 'template',
    template: {
      name: template,
      language: { code: lang },
      components: [
        { type: 'body',   parameters: [{ type: 'text', text: code }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
      ],
    },
  };

  const res = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('WHATSAPP_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`WhatsApp send failed (${res.status}): ${detail}`);
  }
  return res.json().catch(() => ({}));
}

module.exports = {
  CODE_TTL_MS, TOKEN_TTL_MS, RESEND_COOLDOWN_MS, MAX_ATTEMPTS,
  otpConfigured, whatsappConfigured,
  normalizePhone, toWhatsappNumber,
  generateCode, hashCode,
  signToken, verifyToken,
  getVerification, upsertVerification, setAttempts, deleteVerification,
  getUserFromToken, getProfile, markProfileVerified,
  sendWhatsappOtp,
};

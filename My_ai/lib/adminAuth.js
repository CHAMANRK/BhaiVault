// ═══════════════════════════════════════════════════════════════════════
// lib/adminAuth.js — Phase 5 (Creator/Admin Mode, plan Section 7): access
// control. Replaces the OLD client-side `/verify <CREATOR_SECRET>` scheme
// (js/admin.js pre-Phase-5) which shipped a plaintext secret string to
// every browser — that was never real security, just an obscurity check.
//
// TWO WAYS IN, per plan:
//
//   1. PRIMARY — Firebase email/password (Najeef's fixed account).
//      Firebase Auth IS the source of truth: any request carrying a valid
//      Firebase idToken whose decoded email matches ADMIN_EMAIL (env var)
//      AND is verified is admin. No extra Firestore admin-flag doc needed
//      — one less thing that can drift out of sync.
//
//   2. BACKUP — short-lived admin code, env var (ADMIN_BACKUP_CODE), for
//      emergency access from a device that isn't logged into the Google
//      account (plan: "temporary admin code in env var → short-lived
//      session, for emergency access from any device").
//
//      Mechanism chosen (resolves the plan's "Open/Not Yet Decided" note
//      on this): a STATELESS, HMAC-SIGNED TOKEN with a baked-in expiry —
//      not a full login, not a Firestore-tracked session row. Why:
//        - The whole point of the backup path is not needing the real
//          credentials, so it should stay lightweight.
//        - Signed+expiring means no server-side session store to clean
//          up, and it survives Vercel cold starts (unlike keyManager's
//          in-memory health map, which is fine to lose — this shouldn't
//          silently keep someone "logged in forever" if state resets).
//        - Short TTL (2h) bounds the blast radius if a code leak happens;
//          the code itself can be rotated instantly by changing the env
//          var, invalidating every outstanding token immediately (the
//          HMAC secret ALSO comes from env, so token forgery requires
//          both secrets).
//
// api/admin/*.js all call requireAdmin(req.body) at the top — throws a
// {status, message} shaped error the handler turns into a 401/403.
// ═══════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const { verifyIdToken } = require('./firebaseAdmin');

const ADMIN_TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours — plan: "short-lived"

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

function sign(payload) {
  const secret = process.env.ADMIN_TOKEN_SECRET;
  if (!secret) throw new Error('ADMIN_TOKEN_SECRET env var missing');
  return crypto.createHmac('sha256', secret).update(payload).digest();
}

/**
 * issueBackupAdminToken() — called by api/admin/verify.js ONLY after the
 * caller has already proven they know ADMIN_BACKUP_CODE. Returns a compact
 * string: base64url(header).base64url(signature), where header is
 * `{ exp: <ms epoch> }` JSON. No uid/identity claim inside on purpose —
 * this token means "someone who had the backup code, within the last 2h",
 * nothing more granular than that (matches the plan's "emergency access"
 * framing, not a full identity).
 */
function issueBackupAdminToken() {
  const header = JSON.stringify({ exp: Date.now() + ADMIN_TOKEN_TTL_MS });
  const headerB64 = b64url(Buffer.from(header, 'utf8'));
  const sig = sign(headerB64);
  return `${headerB64}.${b64url(sig)}`;
}

/** verifyBackupAdminToken(token) — true/false, also rejects if expired. */
function verifyBackupAdminToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [headerB64, sigB64] = token.split('.');
  try {
    const expected = sign(headerB64);
    const given = b64urlDecode(sigB64);
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return false;
    const header = JSON.parse(b64urlDecode(headerB64).toString('utf8'));
    return typeof header.exp === 'number' && header.exp > Date.now();
  } catch {
    return false;
  }
}

/**
 * checkBackupCode(code) — plain string compare against env var, but
 * timing-safe (backup codes are effectively passwords; no reason to leak
 * timing info on a wrong guess). Returns boolean.
 */
function checkBackupCode(code) {
  const real = process.env.ADMIN_BACKUP_CODE || '';
  const given = String(code || '');
  if (!real) return false; // not configured — backup path disabled entirely
  const a = Buffer.from(real);
  const b = Buffer.from(given);
  if (a.length !== b.length) {
    // timingSafeEqual requires equal length — still do a dummy compare so
    // wrong-length guesses don't return measurably faster.
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/**
 * requireAdmin({ idToken, adminBackupToken }) — the ONE function every
 * api/admin/*.js handler calls first. Returns `{ via: 'email'|'backup',
 * email? }` on success. Throws `{ status, message }` on failure — handlers
 * do:
 *
 *   try { const admin = await requireAdmin(req.body); ... }
 *   catch (e) { res.status(e.status || 401).json({ error: e.message }); return; }
 */
async function requireAdmin({ idToken, adminBackupToken } = {}) {
  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();

  if (idToken) {
    const decoded = await verifyIdToken(idToken);
    if (decoded && adminEmail && (decoded.email || '').toLowerCase() === adminEmail && decoded.email_verified) {
      return { via: 'email', email: decoded.email };
    }
    // Fall through to backup-token check rather than failing immediately —
    // a request might send BOTH (e.g. logged in as a non-admin Google
    // account on a borrowed device, but holding a valid backup token).
  }

  if (adminBackupToken && verifyBackupAdminToken(adminBackupToken)) {
    return { via: 'backup' };
  }

  const err = new Error('Admin access nahi mila — sahi account se login karo ya backup code use karo');
  err.status = 403;
  throw err;
}

module.exports = { requireAdmin, issueBackupAdminToken, verifyBackupAdminToken, checkBackupCode };

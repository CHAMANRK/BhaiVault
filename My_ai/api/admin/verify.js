// ═══════════════════════════════════════════════════════════════════════
// api/admin/verify.js — Phase 5: exchanges ADMIN_BACKUP_CODE for a
// short-lived signed admin token (see lib/adminAuth.js for the full
// mechanism + reasoning). This is the ONLY endpoint that accepts the raw
// backup code in plaintext — every other api/admin/* call takes the
// already-issued token instead, so the actual secret code only ever
// crosses the wire once per emergency-login, not on every admin action.
//
// Also doubles as the "am I admin?" check for the PRIMARY (email) path —
// client calls this with just an idToken (no code) right after normal
// Firebase login to decide whether to show the Creator Mode UI at all.
// ═══════════════════════════════════════════════════════════════════════

const { verifyIdToken } = require('../../lib/firebaseAdmin');
const { checkBackupCode, issueBackupAdminToken } = require('../../lib/adminAuth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  const { idToken, backupCode } = req.body || {};
  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();

  // Path 1: already logged in as the admin Google/email account — just
  // confirm it, no token to issue (the idToken itself IS the credential
  // on every subsequent /api/admin/* call).
  if (idToken) {
    const decoded = await verifyIdToken(idToken);
    if (decoded && adminEmail && (decoded.email || '').toLowerCase() === adminEmail && decoded.email_verified) {
      res.status(200).json({ ok: true, isAdmin: true, via: 'email' });
      return;
    }
    if (!backupCode) {
      // Logged in, but not the admin account, and no backup code offered.
      res.status(200).json({ ok: true, isAdmin: false });
      return;
    }
  }

  // Path 2: backup code route.
  if (backupCode) {
    if (!checkBackupCode(backupCode)) {
      res.status(403).json({ error: 'Galat backup code' });
      return;
    }
    const adminBackupToken = issueBackupAdminToken();
    res.status(200).json({ ok: true, isAdmin: true, via: 'backup', adminBackupToken });
    return;
  }

  res.status(400).json({ error: 'idToken ya backupCode chahiye' });
};

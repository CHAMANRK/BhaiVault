// ═══════════════════════════════════════════════════════════════════════
// api/admin/stats.js — Phase 5: "which keys are down", "how many users
// today/total" — the two concrete stats queries named in plan Section 7.
// Matches api/chat.js's plain-CommonJS/single-file style.
// ═══════════════════════════════════════════════════════════════════════

const { requireAdmin } = require('../../lib/adminAuth');
const { getHealthSnapshot } = require('../../lib/keyManager');
const { getUserCounts } = require('../../lib/adminStore');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  const { idToken, adminBackupToken } = req.body || {};

  try {
    await requireAdmin({ idToken, adminBackupToken });
  } catch (e) {
    res.status(e.status || 401).json({ error: e.message });
    return;
  }

  try {
    const [counts, keyHealth] = await Promise.all([
      getUserCounts(),
      Promise.resolve(getHealthSnapshot()), // sync function — wrapped for a uniform Promise.all
    ]);
    res.status(200).json({ ok: true, ...counts, keyHealth });
  } catch (e) {
    console.error('[api/admin/stats]', e);
    res.status(500).json({ error: e.message || 'Stats fetch fail hua' });
  }
};

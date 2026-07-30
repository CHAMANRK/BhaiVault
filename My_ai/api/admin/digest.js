// ═══════════════════════════════════════════════════════════════════════
// api/admin/digest.js — PHASE 6: read side of cron/dailySummary.js's
// admin-wide rollup (plan Section 7: "Daily digest: on login, AI
// proactively reports — new users today, key health, notable events").
//
// action: 'latest' (most recent digest, whatever day cron last ran) |
//         'get' (a specific date, for backfill/history browsing)
// ═══════════════════════════════════════════════════════════════════════

const { requireAdmin } = require('../../lib/adminAuth');
const { getLatestAdminDigest, getAdminDigest } = require('../../lib/dailySummaryStore');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  const { idToken, adminBackupToken, action, date } = req.body || {};

  try {
    await requireAdmin({ idToken, adminBackupToken });
  } catch (e) {
    res.status(e.status || 401).json({ error: e.message });
    return;
  }

  try {
    switch (action || 'latest') {
      case 'latest': {
        const digest = await getLatestAdminDigest();
        res.status(200).json({ ok: true, digest });
        return;
      }
      case 'get': {
        if (!date) { res.status(400).json({ error: 'date required' }); return; }
        const digest = await getAdminDigest(date);
        res.status(200).json({ ok: true, digest });
        return;
      }
      default:
        res.status(400).json({ error: 'Unknown action: ' + action });
        return;
    }
  } catch (e) {
    console.error('[api/admin/digest]', action, e);
    res.status(500).json({ error: e.message || 'Digest fetch fail hua' });
  }
};

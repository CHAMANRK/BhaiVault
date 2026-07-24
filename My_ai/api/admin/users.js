// ═══════════════════════════════════════════════════════════════════════
// api/admin/users.js — Phase 5: user list (summaries), name/email lookup,
// and raw-chat fetch — the last one ONLY on an explicit uid/query, never
// bundled into the default list response (plan Section 7: "raw chat only
// when explicitly asked by name").
//
// action: 'list' | 'find' | 'rawSessions'
// ═══════════════════════════════════════════════════════════════════════

const { requireAdmin } = require('../../lib/adminAuth');
const { listUserSummaries, findUserByNameOrEmail, getUserRawSessions } = require('../../lib/adminStore');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  const { idToken, adminBackupToken, action, uid, query, limit } = req.body || {};

  try {
    await requireAdmin({ idToken, adminBackupToken });
  } catch (e) {
    res.status(e.status || 401).json({ error: e.message });
    return;
  }

  try {
    switch (action) {
      case 'list': {
        const users = await listUserSummaries(limit || 50);
        res.status(200).json({ ok: true, users });
        return;
      }
      case 'find': {
        if (!query) { res.status(400).json({ error: 'query required' }); return; }
        const matches = await findUserByNameOrEmail(query);
        res.status(200).json({ ok: true, matches });
        return;
      }
      case 'rawSessions': {
        // Explicit-request gate lives HERE, not deeper — this is the one
        // action in this file that returns actual message content.
        if (!uid) { res.status(400).json({ error: 'uid required — raw chat sirf explicit uid ke saath milta hai' }); return; }
        const sessions = await getUserRawSessions(uid, limit || 20);
        res.status(200).json({ ok: true, uid, sessions });
        return;
      }
      default:
        res.status(400).json({ error: 'Unknown action: ' + action });
        return;
    }
  } catch (e) {
    console.error('[api/admin/users]', action, e);
    res.status(500).json({ error: e.message || 'User query fail hua' });
  }
};

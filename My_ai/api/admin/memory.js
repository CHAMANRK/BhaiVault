// ═══════════════════════════════════════════════════════════════════════
// api/admin/memory.js — Phase 5: CRUD for the creator's personal-context
// notes doc (lib/adminMemory.js). Admin-only (requireAdmin), same
// action-in-body style as api/instructions.js / api/sessions.js.
// ═══════════════════════════════════════════════════════════════════════

const { requireAdmin } = require('../../lib/adminAuth');
const { listCreatorMemory, addCreatorMemory, deleteCreatorMemory } = require('../../lib/adminMemory');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  const { idToken, adminBackupToken, action, id, text } = req.body || {};

  try {
    await requireAdmin({ idToken, adminBackupToken });
  } catch (e) {
    res.status(e.status || 401).json({ error: e.message });
    return;
  }

  try {
    switch (action) {
      case 'list': {
        const notes = await listCreatorMemory();
        res.status(200).json({ ok: true, notes });
        return;
      }
      case 'add': {
        if (!text || !String(text).trim()) { res.status(400).json({ error: 'text required' }); return; }
        const note = await addCreatorMemory(text);
        res.status(200).json({ ok: true, note });
        return;
      }
      case 'delete': {
        if (!id) { res.status(400).json({ error: 'id required' }); return; }
        await deleteCreatorMemory(id);
        res.status(200).json({ ok: true });
        return;
      }
      default:
        res.status(400).json({ error: 'Unknown action: ' + action });
        return;
    }
  } catch (e) {
    console.error('[api/admin/memory]', action, e);
    const status = e.code === 'LIMIT_REACHED' ? 409 : 500;
    res.status(status).json({ error: e.message || 'Memory operation fail hua' });
  }
};

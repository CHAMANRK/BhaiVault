// ═══════════════════════════════════════════════════════════════════════
// api/sessions.js — Vercel serverless function, Phase 3 (Sessions / Chat
// History): create/list/get/rename/delete for a user's multi-chat
// sessions, backed by lib/sessionStore.js (Firestore).
//
// Google (non-anonymous) users only — guests stay device-local, no sync,
// per plan Section 5. Client (js/sessions.js) never calls this endpoint
// for a guest account; this file also enforces it server-side (403) so a
// direct call can't accidentally sync guest data anywhere.
//
// Single endpoint, `action` field in the body picks the operation — kept
// as one file (like api/chat.js) rather than a REST-ish path-per-action
// split, to match this project's existing no-build-step/plain-CommonJS
// style and avoid adding new vercel.json routing.
// ═══════════════════════════════════════════════════════════════════════

const { verifyIdToken } = require('../lib/firebaseAdmin');
const {
  listSessions,
  getSession,
  saveSession,
  renameSession,
  deleteSession,
  deleteAllSessions,
} = require('../lib/sessionStore');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  const { idToken, action, id, title, messages, summary } = req.body || {};

  const decoded = await verifyIdToken(idToken);
  if (!decoded) {
    res.status(401).json({ error: 'Login expired ya invalid — dobara login karo' });
    return;
  }

  const isAnonymous = decoded.firebase?.sign_in_provider === 'anonymous';
  if (isAnonymous) {
    // Guests: sessions are device-local only (plan Section 5) — nothing to
    // sync server-side. Client shouldn't call this for guests at all; this
    // is the server-side backstop.
    res.status(403).json({ error: 'Guest chats sync nahi hote — Google se login karo' });
    return;
  }

  const uid = decoded.uid;

  try {
    switch (action) {
      case 'list': {
        const sessions = await listSessions(uid);
        res.status(200).json({ ok: true, sessions });
        return;
      }
      case 'get': {
        if (!id) { res.status(400).json({ error: 'id required' }); return; }
        const session = await getSession(uid, id);
        if (!session) { res.status(404).json({ error: 'Session nahi mila' }); return; }
        res.status(200).json({ ok: true, session });
        return;
      }
      case 'save': {
        const result = await saveSession(uid, { id, title, messages, summary });
        res.status(200).json({ ok: true, ...result });
        return;
      }
      case 'rename': {
        if (!id || !title) { res.status(400).json({ error: 'id and title required' }); return; }
        await renameSession(uid, id, title);
        res.status(200).json({ ok: true });
        return;
      }
      case 'delete': {
        if (!id) { res.status(400).json({ error: 'id required' }); return; }
        await deleteSession(uid, id);
        res.status(200).json({ ok: true });
        return;
      }
      case 'deleteAll': {
        const count = await deleteAllSessions(uid);
        res.status(200).json({ ok: true, deleted: count });
        return;
      }
      default:
        res.status(400).json({ error: 'Unknown action: ' + action });
        return;
    }
  } catch (e) {
    console.error('[api/sessions]', action, e);
    res.status(500).json({ error: e.message || 'Session operation fail hua' });
  }
};

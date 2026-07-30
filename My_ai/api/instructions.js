// ═══════════════════════════════════════════════════════════════════════
// api/instructions.js — Vercel serverless function, Phase 4 (User
// Instructions): list/add/delete for a user's `/instruction` rules,
// backed by lib/instructionStore.js (Firestore).
//
// Google (non-anonymous) users ONLY — per explicit decision, guests don't
// get this feature at all (unlike sessions, which guests keep device-local;
// instructions just don't exist for guests). Same 403 backstop pattern as
// api/sessions.js.
//
// Single endpoint, `action` field in the body picks the operation — same
// style as api/sessions.js / api/chat.js (no build step, plain CommonJS,
// no extra vercel.json routing).
//
// IMPORTANT — this endpoint does NOT do the "AI checks it against core
// rules, confirms first" validation from plan Section 4. That reasoning
// step happens client-side in chat-core.js (the AI itself decides
// safe-vs-conflicting in natural language, in-conversation). This endpoint
// is the dumb persistence layer — it only enforces the hard, mechanical
// rule (max 10), not the soft semantic one (tone/style-only scope). By the
// time chat-core.js calls action:'add' here, the AI has already said
// "got it, I'll do X" in the chat.
// ═══════════════════════════════════════════════════════════════════════

const { verifyIdToken } = require('../lib/firebaseAdmin');
const {
  listInstructions,
  addInstruction,
  deleteInstruction,
  deleteAllInstructions,
} = require('../lib/instructionStore');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  const { idToken, action, id, text } = req.body || {};

  const decoded = await verifyIdToken(idToken);
  if (!decoded) {
    res.status(401).json({ error: 'Login expired ya invalid — dobara login karo' });
    return;
  }

  const isAnonymous = decoded.firebase?.sign_in_provider === 'anonymous';
  if (isAnonymous) {
    // Guests: instructions feature simply isn't available (explicit call —
    // not "device-local like sessions", just off). Client's settings.js /
    // chat-core.js shouldn't call this for guests at all; this is the
    // server-side backstop.
    res.status(403).json({ error: 'Instructions sirf Google login ke saath available hain' });
    return;
  }

  const uid = decoded.uid;

  try {
    switch (action) {
      case 'list': {
        const instructions = await listInstructions(uid);
        res.status(200).json({ ok: true, instructions });
        return;
      }
      case 'add': {
        if (!text || !String(text).trim()) {
          res.status(400).json({ error: 'text required' });
          return;
        }
        const result = await addInstruction(uid, text);
        res.status(200).json({ ok: true, ...result });
        return;
      }
      case 'delete': {
        if (!id) { res.status(400).json({ error: 'id required' }); return; }
        await deleteInstruction(uid, id);
        res.status(200).json({ ok: true });
        return;
      }
      case 'deleteAll': {
        const count = await deleteAllInstructions(uid);
        res.status(200).json({ ok: true, deleted: count });
        return;
      }
      default:
        res.status(400).json({ error: 'Unknown action: ' + action });
        return;
    }
  } catch (e) {
    console.error('[api/instructions]', action, e);
    const status = e.code === 'LIMIT_REACHED' ? 409 : 500;
    res.status(status).json({ error: e.message || 'Instruction operation fail hua' });
  }
};
